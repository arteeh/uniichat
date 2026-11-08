import { AskAI, type Ask, type Call, type End, type Event, type Parked, type Said, type Steer } from "./AskAI.ts";
import type { Pick } from "./Pick.ts";
import type { Live } from "./View.ts";
import { err_stack, err_why } from "./Err.ts";

type Waiting = { text: string; tool: string; logged: boolean; started: boolean };

export type Heard = Event | { $: "Ended" };

type Queued<Q> = { q: Q; done: (why: string | null) => void };

// a message logged, not yet answered (taken: into a running call's request)
type Sent<Q, M> = { q: Q; m: M; taken: boolean };

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

type LoopHooks<Q, M> = {
  begin  : (run: Run<Q, M>) => void;
  failed : (run: Run<Q, M>, why: string) => void;
  ending : (run: Run<Q, M>) => void;
  finish : (run: Run<Q, M>) => void;
  parked : (run: Run<Q, M>) => boolean;
};

type InboxHooks<Q, M> = {
  log    : (run: Run<Q, M>, q: Q) => M | Promise<M>;
  say    : (q: Q, m: M) => Said;
  queued : (run: Run<Q, M>) => void;
  again  : (q: Q) => boolean;
};

type CallHooks<Q, M> = {
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

  export function take<Q, M>(run: Run<Q, M>, q: Q): Promise<string | null> {
    return Run.takes(run, [q]).then(([why]) => why);
  }

  export function takes<Q, M>(run: Run<Q, M>, qs: Q[]): Promise<(string | null)[]> {
    const dones = qs.map((q) => {
      const { promise, resolve } = Promise.withResolvers<string | null>();
      run.queue.push({ q, done: resolve });
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
        const steer: Steer = { pending: () => live && run.queue.length > 0, take: () => (live ? Run.steers(run) : Promise.resolve([])), taken: [] };
        const call = (run.call = AskAI.ask({ ...ask, steer }, (ev) => Run.heard(run, ev)));
        kind.change();
        const end = await call.done;
        live = false;
        run.call = null;
        kind.on(run, { $: "Ended" });
        go = await kind.ended(run, end);
        // messages a failed call took and didn't answer, of any kind, go into
        // the next call whole
        if (go && !kind.parked(run)) {
          const taken = run.sent.filter((s) => s.taken);
          taken.forEach((s) => (s.taken = false));
          run.wait.unshift(...taken.map((s) => s.m));
        }
        if (go) {
          await Run.logs(run);
        }
      }
    } catch (err) {
      Run.safe(run, () => kind.failed(run, err_why(err)));
    } finally {
      Run.safe(run, () => kind.ending(run));
      run.call = null;
      // unanswered, so the next call carries them whole: messages taken into
      // a call (a new turn for them, as for messages still queued), and every
      // message of a run parked at a usage limit (its go-on carries them)
      const parked = kind.parked(run);
      const taken = run.sent.filter((s) => s.taken);
      const missed = run.sent.filter((s) => parked || s.taken);
      taken.forEach((s) => (s.taken = false));
      const left = await Run.logs(run);
      again = [...(parked ? [] : taken.map((s) => s.q)), ...left].some(kind.again);
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

  // the messages queued, each taken off the queue before it is logged, for
  // the running call to put in its next request
  export async function steers<Q, M>(run: Run<Q, M>): Promise<Said[]> {
    const says: Said[] = [];
    let changed = false;
    for (let x = run.queue.shift(); x !== undefined; x = run.queue.shift()) {
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

  export async function log<Q, M>(run: Run<Q, M>, { q, done }: Queued<Q>, taken: boolean): Promise<M | null> {
    try {
      const got = run.kind.log(run, q);
      const msg = got instanceof Promise ? await got : got;
      run.sent.push({ q, m: msg, taken });
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
