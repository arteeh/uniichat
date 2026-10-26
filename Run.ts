// Run
// ===
// One conversation that calls a model: Unii's turn (named TURN) or a
// subagent's (by its name), with one way in (Run.take) and one loop.
// A message for it is queued, never handed to a running call; the loop
// logs what is queued (so it sits right before the reply to it), makes
// one call taking it all, and goes again while more came meanwhile. A
// stop cuts the call and ends the loop. What differs between the two is
// their Kind.

import { AskAI, type Ask, type Call, type End, type Event, type Parked } from "./AskAI.ts";
import type { Pick } from "./Pick.ts";
import type { Live } from "./View.ts";

// Types
// =====

// a tool call awaiting its result (Server.ts Chat.on): its text as logged,
// its tool's name, whether it is logged yet (something written while it
// ran wrote it first: Chat.flush), whether it started (one queued behind
// another of its step hasn't: AskAI.ts Start)
export type Waiting = { text: string; tool: string; logged: boolean; started: boolean };

// what a run hears: its call's events, and the end of each of its calls
// (logged as such: the tool calls left unanswered written, live cleared)
export type Heard = Event | { $: "Ended" };

// a message queued, not logged yet (Q), and what tells its taker it is
// queued or logged, or why it couldn't be logged (Run.take)
export type Queued<Q> = { q: Q; done: (why: string | null) => void };

// a conversation (Q: a message for it as it comes, M: as logged: main's
// are logged messages, a subagent's what it is told). busy: its loop runs
// (going); queue: those waiting to be logged as its next call starts;
// wait: logged, for the next call; halt: its stop (renewed as its loop
// starts); calls: its tool calls awaiting their
// results, by id, in the order they started (Chat.on); limit: its call
// waits for a usage limit (Limit.park); fell: the fallback its calls run
// on (Chat.ran), forgotten as a pick is picked
export type Run<Q, M> = {
  name  : string;
  kind  : Kind<Q, M>;
  busy  : boolean;
  going : Promise<void>;
  call  : Call | null;
  queue : Queued<Q>[];
  wait  : M[];
  halt  : AbortController;
  live  : Live[];
  calls : Map<string, Waiting>;
  limit : Parked | null;
  fell  : string | null;
};

// what only one kind of run does:
// - pick: what its calls run on;
// - begin: its loop starts;
// - log: a message queued logged, as its call starts;
// - ask: its next call (take() hands it the messages waiting), at once
//   or once ready (main waits for summaries); null: the loop ends;
// - queued: its queue changed (the views told; main's kept);
// - again: a message left queued as its loop ends goes on as a turn;
// - ended: a call's end; false: the loop ends;
// - failed: the loop threw (why);
// - ending: the loop ends, still busy; finish: it ended, idle;
// - on: what its calls tell (Server.ts Chat.on), change: the views told
export type Kind<Q, M> = {
  pick   : () => Pick;
  begin  : (run: Run<Q, M>) => void;
  log    : (run: Run<Q, M>, q: Q) => M | Promise<M>;
  ask    : (run: Run<Q, M>, take: () => M[]) => Ask | null | Promise<Ask | null>;
  queued : (run: Run<Q, M>) => void;
  again  : (q: Q) => boolean;
  ended  : (run: Run<Q, M>, end: End) => boolean | Promise<boolean>;
  failed : (run: Run<Q, M>, why: string) => void;
  ending : (run: Run<Q, M>) => void;
  finish : (run: Run<Q, M>) => void;
  on     : (run: Run<Q, M>, ev: Heard) => void;
  change : () => void;
};

// Run
// ===

export namespace Run {

  export function make<Q, M>(name: string, kind: Kind<Q, M>): Run<Q, M> {
    return { name, kind, busy: false, going: Promise.resolve(), call: null, queue: [], wait: [], halt: new AbortController(), live: [], calls: new Map(), limit: null, fell: null };
  }

  // THE way in: a message queued, the loop started if it doesn't run
  // (which logs it at once). Done as it is queued behind a running loop
  // (the views told: kind.queued; a call waiting for a usage limit
  // woken), or as its loop logged it
  export function take<Q, M>(run: Run<Q, M>, q: Q): Promise<string | null> {
    return Run.takes(run, [q]).then(([why]) => why);
  }

  // several taken at once, in order (one loop logs them all)
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

  // THE loop: what is queued logged, a call taking it all, and again
  // while more was queued meanwhile. A throw ends it (kind.failed); what
  // is left queued as it ends is logged, and starts it again if its kind
  // says so
  export async function loop<Q, M>(run: Run<Q, M>): Promise<void> {
    const kind = run.kind;
    run.busy = true;
    run.halt = new AbortController();
    let again = false;
    try {
      await Run.logs(run);
      kind.begin(run);
      for (let go = true; go && run.wait.length > 0; ) {
        // one asked at once is started at once: nothing comes between
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
    } catch (err: any) {
      Run.safe(run, () => kind.failed(run, String(err?.message ?? err)));
    } finally {
      Run.safe(run, () => kind.ending(run));
      run.call = null;
      const left = await Run.logs(run);
      again = left.some(kind.again);
      run.wait = again ? run.wait : [];
      run.busy = false;
      Run.safe(run, () => kind.finish(run));
    }
    // one taken as the last logging yielded found the loop still busy
    if ((again || run.queue.length > 0) && !run.busy) {
      run.going = Run.loop(run);
    }
  }

  // what is queued logged, one by one in order, to wait for the next
  // call; those logged. One that can't be (a write failing) is dropped,
  // its taker told why, and noted
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
      } catch (err: any) {
        const why = "a message couldn't be logged: " + String(err?.message ?? err);
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

  // a step of a run's that may throw (a write failing) doesn't wedge it
  export function safe<Q, M>(run: Run<Q, M>, step: () => void): void {
    try {
      step();
    } catch (err: any) {
      console.error("unii: " + run.name + ": " + (err?.stack ?? err));
    }
  }

  // the run stopped: its call cut, its loop ended (why: main's note of
  // it, Chat.ending)
  export function stop<Q, M>(run: Run<Q, M>, why: string | null): void {
    run.halt.abort(why);
    run.call?.stop();
  }

}
