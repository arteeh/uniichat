import { AskAI, type Ask, type Call, type End, type Event, type Parked } from "./AskAI.ts";
import type { Pick } from "./Pick.ts";
import type { Live } from "./View.ts";
import { err_stack, err_why } from "./Err.ts";

type Waiting = { text: string; tool: string; logged: boolean; started: boolean };

export type Heard = Event | { $: "Ended" };

type Queued<Q> = { q: Q; done: (why: string | null) => void };

type Loop = {
  busy  : boolean;
  going : Promise<void>;
  halt  : AbortController;
};

type Inbox<Q, M> = {
  queue : Queued<Q>[];
  wait  : M[];
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
};

export type InboxHooks<Q, M> = {
  log    : (run: Run<Q, M>, q: Q) => M | Promise<M>;
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
    return { name, kind, busy: false, going: Promise.resolve(), call: null, queue: [], wait: [], halt: new AbortController(), live: [], calls: new Map(), limit: null, fell: null };
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
        const call = (run.call = AskAI.ask(ask, (ev) => kind.on(run, ev)));
        kind.change();
        const end = await call.done;
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
      const left = await Run.logs(run);
      again = left.some(kind.again);
      run.wait = again ? run.wait : [];
      run.busy = false;
      Run.safe(run, () => kind.finish(run));
    }
    if ((again || run.queue.length > 0) && !run.busy) {
      run.going = Run.loop(run);
    }
  }

  export async function logs<Q, M>(run: Run<Q, M>): Promise<Q[]> {
    const logged: Q[] = [];
    let changed = false;
    while (run.queue.length > 0) {
      const { q, done } = run.queue[0];
      try {
        const got = run.kind.log(run, q);
        const msg = got instanceof Promise ? await got : got;
        run.wait.push(msg);
        logged.push(q);
        done(null);
      } catch (err) {
        const why = "a message couldn't be logged: " + err_why(err);
        done(why);
        Run.safe(run, () => run.kind.failed(run, why));
      } finally {
        run.queue.shift();
        changed = true;
      }
    }
    if (changed) {
      Run.safe(run, () => run.kind.queued(run));
    }
    return logged;
  }

  export function safe<Q, M>(run: Run<Q, M>, step: () => void): void {
    try {
      step();
    } catch (err) {
      console.error("unii: " + run.name + ": " + err_stack(err));
    }
  }

  export function stop<Q, M>(run: Run<Q, M>, why: string | null): void {
    run.halt.abort(why);
    run.call?.stop();
  }

}
