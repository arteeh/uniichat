// Run
// ===
// One conversation that calls a model: Unii's turn (named TURN) or a
// subagent's (named by its name). Its record holds what both kinds keep
// while they run: the messages handed to its call and those waiting for
// the next, its call, its stop, what streams, its tool calls awaiting
// results, its usage-limit wait and the fallback it runs on.

import type { Call, Parked } from "./AskAI.ts";
import type { Live } from "./View.ts";

// Types
// =====

// a tool call awaiting its result (Server.ts Chat.on): its text as logged,
// its tool's name, whether it is logged yet (something written while it
// ran wrote it first: Chat.flush), whether it started (one queued behind
// another of its step hasn't: AskAI.ts Start)
export type Waiting = { text: string; tool: string; logged: boolean; started: boolean };

// a conversation (M: its messages: main's are logged messages, a
// subagent's what it is told). busy: it runs; sent: handed to the running
// call; wait: waiting for the next call; halt: its stop (main's renewed
// per call); calls: its tool calls awaiting their results, by id, in the
// order they started (Chat.on); limit: its call waits for a usage limit
// (Limit.park); fell: the fallback its calls run on (Chat.ran), forgotten
// as a pick is picked
export type Run<M> = {
  name  : string;
  busy  : boolean;
  call  : Call | null;
  sent  : M[];
  wait  : M[];
  halt  : AbortController;
  live  : Live[];
  calls : Map<string, Waiting>;
  limit : Parked | null;
  fell  : string | null;
};

// Run
// ===

export namespace Run {

  export function make<M>(name: string): Run<M> {
    return { name, busy: false, call: null, sent: [], wait: [], halt: new AbortController(), live: [], calls: new Map(), limit: null, fell: null };
  }

}
