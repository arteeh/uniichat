// Run
// ===
// One conversation that calls a model: Unii's turn (named TURN) or a
// subagent's (named by its name), with one way in and one loop for both.
//
// A message for it (the user's, a report, a timer's, a tell, a restart's
// note) goes in by Run.take: to the running call, if its kind lets the
// call take it now (between tool calls), else to `wait`. A run not
// running starts its loop, which makes one call after another while
// messages wait: each call takes all of them (`sent`); those its call
// never took (End.left) go back to wait for the next. A stop (Run.stop)
// cuts the running call and ends the loop.
//
// What differs between the two kinds is its Kind: how a call is asked
// (main: the view, summaries waited on, devices, the goal check;
// a subagent: its log), what an end means, and what is logged as the
// loop ends (main: why it was stopped; a subagent: its report).

import { AskAI, type Ask, type Call, type End, type Event, type Parked, type Say } from "./AskAI.ts";
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

// a conversation (M: its messages: main's are logged messages, a
// subagent's what it is told). busy: its loop runs (going); sent: handed
// to the running call; wait: waiting for the next call; halt: its stop
// (renewed as its loop starts, and main's per call); calls: its tool
// calls awaiting their results, by id, in the order they started
// (Chat.on); limit: its call waits for a usage limit (Limit.park); fell:
// the fallback its calls run on (Chat.ran), forgotten as a pick is picked
export type Run<M> = {
  name  : string;
  kind  : Kind<M>;
  busy  : boolean;
  going : Promise<void>;
  call  : Call | null;
  sent  : M[];
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
// - ask: its next call (take() hands it the messages waiting), at once
//   or once ready (main waits for summaries); null: the loop ends;
// - sends: what the running call takes of a message now (null: it waits
//   for the next call);
// - queued: a message waits for the next call;
// - ended: a call's end; false: the loop ends;
// - failed: the loop threw (why);
// - ending: the loop ends, still busy; finish: it ended, idle;
// - on: what its calls tell (Server.ts Chat.on), change: the views told
export type Kind<M> = {
  pick   : () => Pick;
  begin  : (run: Run<M>) => void;
  ask    : (run: Run<M>, take: () => M[]) => Ask | null | Promise<Ask | null>;
  sends  : (run: Run<M>, msg: M) => Say | null;
  queued : (run: Run<M>) => void;
  ended  : (run: Run<M>, end: End) => boolean | Promise<boolean>;
  failed : (run: Run<M>, why: string) => void;
  ending : (run: Run<M>) => void;
  finish : (run: Run<M>) => void;
  on     : (run: Run<M>, ev: Heard) => void;
  change : () => void;
};

// Run
// ===

export namespace Run {

  export function make<M>(name: string, kind: Kind<M>): Run<M> {
    return { name, kind, busy: false, going: Promise.resolve(), call: null, sent: [], wait: [], halt: new AbortController(), live: [], calls: new Map(), limit: null, fell: null };
  }

  // THE way in: a message to the running call, if it takes it now, else
  // waiting for the next, the loop started if it doesn't run
  export function take<M>(run: Run<M>, msg: M): void {
    const call = run.call;
    const say = call === null ? null : run.kind.sends(run, msg);
    if (call !== null && say !== null) {
      run.sent.push(msg);
      call.send(say);
      return;
    }
    run.wait.push(msg);
    run.kind.queued(run);
    if (!run.busy) {
      run.going = Run.loop(run);
    }
  }

  // THE loop: a call while messages wait, each taking all of them; those
  // its call didn't take wait for the next. A throw ends it (kind.failed)
  export async function loop<M>(run: Run<M>): Promise<void> {
    const kind = run.kind;
    run.busy = true;
    run.halt = new AbortController();
    kind.begin(run);
    try {
      for (let go = true; go && run.wait.length > 0; ) {
        // one asked at once is started at once: nothing comes between
        const asked = kind.ask(run, () => (run.sent = run.wait.splice(0)));
        const ask = asked instanceof Promise ? await asked : asked;
        if (ask === null || run.halt.signal.aborted) {
          break;
        }
        const call = (run.call = AskAI.ask(ask, (ev) => kind.on(run, ev)));
        kind.change();
        const end = await call.done;
        run.call = null;
        kind.on(run, { $: "Ended" });
        run.wait.unshift(...run.sent.slice(run.sent.length - end.left.length));
        go = await kind.ended(run, end);
      }
    } catch (err: any) {
      kind.failed(run, String(err?.message ?? err));
    } finally {
      kind.ending(run);
      run.call = null;
      run.sent = [];
      run.wait = [];
      run.busy = false;
      kind.finish(run);
    }
  }

  // the run stopped: its call cut, its loop ended (why: main's note of
  // it, Chat.ending)
  export function stop<M>(run: Run<M>, why: string | null): void {
    run.halt.abort(why);
    run.call?.stop();
  }

}
