import { AskAI, type Ask, type Call, type End, type Event, type Parked, type Say, type Steer } from "./AskAI.ts";
import type { Pick } from "./Pick.ts";
import type { Live } from "./View.ts";
import { err_stack, err_why } from "./Err.ts";

type Waiting = { text: string; tool: string; logged: boolean; started: boolean };

export type Heard = Event | { $: "Ended" };

type Queued<Q> = { q: Q; done: (why: string | null) => void; steer: boolean };

// a message logged, not yet answered (steered: taken into a call's request)
type Sent<Q, M> = { q: Q; m: M; steer: boolean };

type Loop = {
  busy  : boolean;
  going : Promise<void>;
  halt  : AbortController;
};

type Inbox<Q, M> = {
  queue : Queued<Q>[];
  wait  : M[];
  sent  : Sent<Q, M>[];
};

type Calling = {
  call  : Call | null;
  live  : Live[];
  calls : Map<string, Waiting>;
  limit : Parked | null;
  fell  : string | null;
};

export type Run<Q, M> = { name: string; kind: Kind<Q, M> } & Loop & Inbox<Q, M> & Calling;

export type LoopHooks<Q, M> = {
  begin  : (run: Run<Q, M>) => void;
  failed : (run: Run<Q, M>, why: string) => void;
  ending : (run: Run<Q, M>) => void;
  finish : (run: Run<Q, M>) => void;
  parked : (run: Run<Q, M>) => boolean;
};

export type InboxHooks<Q, M> = {
  log    : (run: Run<Q, M>, q: Q) => M | Promise<M>;
  say    : (q: Q, m: M) => Say;
  queued : (run: Run<Q, M>) => void;
  again  : (q: Q) => boolean;
};

export type CallHooks<Q, M> = {
  pick   : () => Pick;
  ask    : (run: Run<Q, M>, take: () => M[]) => Ask | null | Promise<Ask | null>;
  ended  : (run: Run<Q, M>, end: End) => boolean | Promise<boolean>;
  on     : (run: Run<Q, M>, ev: Heard) => void;
};

type Kind<Q, M> = LoopHooks<Q, M> & InboxHooks<Q, M> & CallHooks<Q, M> & { change: () => void };

export namespace Run {

  export function make<Q, M>(name: string, kind: Kind<Q, M>): Run<Q, M> {
    return { name, kind, busy: false, going: Promise.resolve(), call: null, queue: [], wait: [], sent: [], halt: new AbortController(), live: [], calls: new Map(), limit: null, fell: null };
  }

  export function take<Q, M>(run: Run<Q, M>, q: Q, steer = false): Promise<string | null> {
    return Run.takes(run, [q], steer).then(([why]) => why);
  }

  export function takes<Q, M>(run: Run<Q, M>, qs: Q[], steer = false): Promise<(string | null)[]> {
    const dones = qs.map((q) => {
      const { promise, resolve } = Promise.withResolvers<string | null>();
      run.queue.push({ q, done: resolve, steer });
      return promise;
    });
    if (!run.busy) {
      run.going = Run.loop(run);
      return Promise.all(dones);
    }
    run.queue.slice(run.queue.length - qs.length).forEach((x) => x.done(null));
    Run.safe(run, () => run.kind.queued(run));
    run.call?.wake();
    return Promise.all(dones);
  }

  export async function loop<Q, M>(run: Run<Q, M>): Promise<void> {
    const kind = run.kind;
    run.busy = true;
    run.halt = new AbortController();
    let again = false;
    try {
      await Run.logs(run);
      kind.begin(run);
      for (let go = true; go && run.wait.length > 0; ) {
        const asked = kind.ask(run, () => run.wait.splice(0));
        const ask = asked instanceof Promise ? await asked : asked;
        if (ask === null || run.halt.signal.aborted) {
          break;
        }
        let live = true;
        const steer: Steer = { pending: () => live && run.queue.some((x) => x.steer), take: () => (live ? Run.steers(run) : Promise.resolve([])), taken: [] };
        const call = (run.call = AskAI.ask({ ...ask, steer }, (ev) => Run.heard(run, ev)));
        kind.change();
        const end = await call.done;
        live = false;
        run.call = null;
        kind.on(run, { $: "Ended" });
        go = await kind.ended(run, end);
        if (go) {
          await Run.logs(run);
        }
      }
    } catch (err) {
      Run.safe(run, () => kind.failed(run, err_why(err)));
    } finally {
      Run.safe(run, () => kind.ending(run));
      run.call = null;
      // unanswered, so the next call carries them whole: steered messages
      // (a new turn for them, as for messages still queued), and every
      // message of a run parked at a usage limit (its go-on carries them)
      const parked = kind.parked(run);
      const steered = run.sent.filter((s) => s.steer);
      const missed = run.sent.filter((s) => parked || s.steer);
      steered.forEach((s) => (s.steer = false));
      const left = await Run.logs(run);
      again = [...(parked ? [] : steered.map((s) => s.q)), ...left].some(kind.again);
      run.wait = again || parked ? [...missed.map((s) => s.m), ...run.wait] : [];
      run.busy = false;
      if (!again && run.queue.length === 0 && !parked) {
        run.sent = [];
      }
      Run.safe(run, () => kind.finish(run));
    }
    if ((again || run.queue.length > 0) && !run.busy) {
      run.going = Run.loop(run);
    }
  }

  export async function logs<Q, M>(run: Run<Q, M>): Promise<Q[]> {
    const logged: Q[] = [];
    let changed = false;
    for (let x = run.queue.shift(); x !== undefined; x = run.queue.shift()) {
      const msg = await Run.log(run, x, false);
      if (msg !== null) {
        run.wait.push(msg);
        logged.push(x.q);
      }
      changed = true;
    }
    if (changed) {
      Run.safe(run, () => run.kind.queued(run));
    }
    return logged;
  }

  // the steered messages, each taken off the queue before it is logged, for
  // the call to put in its next request
  export async function steers<Q, M>(run: Run<Q, M>): Promise<Say[]> {
    const says: Say[] = [];
    let changed = false;
    for (let k = run.queue.findIndex((x) => x.steer); k >= 0; k = run.queue.findIndex((x) => x.steer)) {
      const [x] = run.queue.splice(k, 1);
      const msg = await Run.log(run, x, true);
      if (msg !== null) {
        says.push(run.kind.say(x.q, msg));
      }
      changed = true;
    }
    if (changed) {
      Run.safe(run, () => run.kind.queued(run));
    }
    return says;
  }

  export async function log<Q, M>(run: Run<Q, M>, { q, done }: Queued<Q>, steer: boolean): Promise<M | null> {
    try {
      const got = run.kind.log(run, q);
      const msg = got instanceof Promise ? await got : got;
      run.sent.push({ q, m: msg, steer });
      done(null);
      return msg;
    } catch (err) {
      const why = "a message couldn't be logged: " + err_why(err);
      done(why);
      Run.safe(run, () => run.kind.failed(run, why));
      return null;
    }
  }

  export function heard<Q, M>(run: Run<Q, M>, ev: Event): void {
    if (run.sent.length > 0 && AskAI.answers(ev)) {
      run.sent = [];
      Run.safe(run, run.kind.change);
    }
    run.kind.on(run, ev);
  }

  // anything it hasn't answered yet: queued, or logged and sent to a model
  // that hasn't started answering
  export function waiting<Q, M>(run: Run<Q, M>): boolean {
    return run.queue.length + run.sent.length > 0;
  }

  export function safe<Q, M>(run: Run<Q, M>, step: () => void): void {
    try {
      step();
    } catch (err) {
      console.error("unii: " + run.name + ": " + err_stack(err));
    }
  }

  // an idle run's messages that nothing will answer now (Stop while parked)
  export function drop<Q, M>(run: Run<Q, M>): void {
    run.wait = [];
    run.sent = [];
  }

  export function stop<Q, M>(run: Run<Q, M>, why: string | null): void {
    run.halt.abort(why);
    run.call?.stop();
  }

}
