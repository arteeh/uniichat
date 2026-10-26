// AskAI
// =====
// One way to call a model: a system prompt and a user message in;
// Deltas (live pieces) and an Entry per finished message out. send()
// hands the agent a message at its next chance, stop() aborts, wake()
// ends a wait for a usage limit (Agent.park), `left` holds those never
// taken. Every vendor is an API run in our loop (Agent.ts) but
// claude-sub, run in Claude Code's (ClaudeSub.ts). A patient call (a
// summary's) asks again, AGAIN after each try nothing answered (the
// vendor down or refusing it, as when the API key's credit is gone; our
// setup failing) or, if the vendor said when its refusal lifts (`until`:
// a usage limit a fallback went past: Agent.limit_off), then (a week at
// most), till
// one is answered or we end it (a stop): an outage only delays it, and no summary is made of a failure that isn't
// its input's (Memory.ts). Each wait is told (an Again event: why, and
// when it asks again), and it starts over on its pick as `repick` reads
// it then, if given (a summary's: the compactor setting, changed
// meanwhile). A call that yields (an import's summary, naming its
// import) sends nothing while one that doesn't waits on its busy model,
// nor while another of its import's does (Agent.ts).
//
// Fallback: a call on a profile (Pick.ts) runs on its pick, then on each
// of the profile's models (Pick.falls); one on a model alone has none.
// A try whose vendor is out for every call (End.off: busy past its
// tries, the account refused) and that ran no tool nor took a message
// (End.acted) goes on with the next pick, as does one its vendor can't
// be asked for here (no stop: no key, not signed in); a patient one, out
// of picks, asks again from the first after AGAIN. A pick out is skipped
// for COOL (the last one is asked anyway), then asked by one request till
// it answers; one not set up isn't skipped, so a sign-in counts at once.
// A call no pick answered says why each failed, in order. As a try's
// answer begins it tells its sink what it runs on (Run).
//
// Cache: a marked block ends a prefix the vendor caches. Single flight
// (AskAI.wait), as a request is sent: one whose prefix no call cached
// within TTL leads; one whose prefix a leader is writing waits until the
// leader's response begins (only then can it read the entry). So a
// leader is always a request being sent, never one yielding (Agent.ts),
// which every call of its prefix would wait on.

import { Agent } from "./Agent.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import { stream_lines } from "./Clip.ts";
import { Machine } from "./Machine.ts";
import { Pick } from "./Pick.ts";
import * as config from "./Config.ts";

// Types
// =====

// the user's, an agent's report ("[Name]\n...", a user turn to the
// model), a thought (shown, never logged), a reply, a tool call, its
// result, a note from before the chat (imported)
export type Kind = "user" | "work" | "mind" | "unii" | "tool" | "echo" | "note";

export type Vendor = "claude-api" | "openai-api" | "openai-sub" | "claude-sub";

// an image: its mime type, its bytes in base64
export type Img = { type: string; data: string };

// a message for the agent
export type Say = { text: string; imgs: Img[] };

// a text block of a call's message; `mark`: a cache entry ends after it;
// `back`: one too, further back, at claude-api in conversation mode
// (Memory.view)
export type Block = { text: string; mark: boolean; back?: boolean };

// searches: the most web searches it runs (0: no web tools); probe: its
// first request goes once (its pick is DOWN); fallback: a pick follows
// its own, which a long usage-limit wait goes on with instead (Agent.step);
// agent: a subagent's, which a long usage limit ends (after its
// fallbacks) instead of parking it, its report saying so; talk: a turn's
// in conversation mode (claude-api caches it an hour: Anthropic.ts);
// repick: a patient call's pick as it starts over (AskAI.ask)
export type Ask = Pick & {
  system    : string;
  blocks    : Block[];
  imgs?     : Img[];
  searches  : number;
  server    : string;
  patient?  : boolean;
  yields?   : string;
  probe?    : boolean;
  agent?    : boolean;
  fallback? : boolean;
  talk?     : boolean;
  repick?   : () => Pick;
};

// a prefix cached: until when; while its leader's response has not
// begun, what its waiters wait on
type Cached = { until: number; ready: Promise<void> | null };

// a request's place in single flight: its response began; it ended
export type Flight = { begun: () => void; end: () => void };

// a call waiting for its vendor's usage limit: till when (ms since the
// epoch), and whether the vendor told it (else it only asks again then)
export type Parked = { until: number; known: boolean };

// a patient call failing: why (the vendor's words, if it said any), when
// it asks again (ms since the epoch), whether it waits for a usage limit
export type Again = { why: string; until: number; limit: boolean };

// Run: a call with fallbacks answers on `run` (by its model's label),
// having left `from` (null: none, its own pick) as it failed, saying why
export type Event =
  | { $: "Delta"; kind: Kind; text: string; fresh?: boolean }
  | { $: "Entry"; kind: Kind; text: string; of?: string; queued?: boolean } // of: the tool call it is or answers; queued: a call that runs later, once its Start comes
  | { $: "Start"; of: string }                            // a queued tool call begins (Agent.ts runs a step's calls one by one)
  | { $: "Limit"; limit: Parked | null }                  // waiting for a usage limit, or no longer
  | { $: "Again"; again: Again }                          // a patient call failed, waiting to ask again
  | { $: "Run"; run: Pick; from: Pick | null; why: string };

// stop: who ended a call that failed (Agent.ts): the model (`fail`: it
// answered, so the failure is its input's doing, a refusal or a stop
// reason; asked again, it fails alike), we (`lost`: a stop), the vendor
// (`down`; off: out for every call, not this request alone), or none
// (our setup threw); acted: it ran a tool or took a message sent mid-run,
// which another try would do again; until: when the vendor's refusal lifts, if it said (ms since 1970);
// long: the vendor refused it as too long for the model (Agent.TOO_LONG);
// why: the vendor's own words for a failure `text` says only as BUSY
export type End = {
  ok     : boolean;
  text   : string;
  why?   : string;
  left   : Say[];
  note?  : string;
  stop?  : "fail" | "lost" | "down";
  off?   : boolean;
  acted? : boolean;
  until? : number;
  long?  : boolean;
};

// one try at a vendor
export type Try = {
  send : (say: Say) => void;
  stop : () => void;
  wake : () => void;
  done : Promise<End>;
};

// a call: its tries, one after another (AskAI.ask)
export type Call = Try;

// Constants
// =========

// how long a patient call waits to ask again: short enough that summaries
// go on within a minute of an outage's end, long enough not to flood the
// vendor meanwhile (its JOBS a side per chat each asking once a minute)
export const AGAIN = 60e3;

// the longest a patient call waits for a refusal to lift (a ChatGPT
// plan's limits last a week at most)
const WEEK = 7 * 86400e3;

// how long a vendor keeps a cache entry unused, in ms (openai-sub's
// backend tells none: the shorter guess)
export const TTL: Record<Vendor, number> = {
  "claude-api" : 300e3,
  "openai-api" : 1800e3,
  "openai-sub" : 300e3,
  "claude-sub" : 300e3,
};

// the prefixes cached, by key (AskAI.keys)
const CACHE = new Map<string, Cached>();

// how long a pick out (AskAI.down) is skipped
const COOL = 60e3;

// the picks out (vendor:model, as called): till when, why
const DOWN = new Map<string, { until: number; why: string }>();

// AskAI
// =====

export namespace AskAI {

  // a call: its tries, one after another (a patient one's, a fallback's)
  export function ask(ask: Ask, on: (ev: Event) => void): Call {
    const halt = new AbortController();
    const send = (say: Say) => call.send(say);
    const stop = () => {
      halt.abort();
      call.stop();
    };
    const { promise, resolve } = Promise.withResolvers<End>();
    const out: Call = { send, stop, wake: () => call.wake(), done: promise };
    const falls = (pick: Pick) => Pick.falls(pick, pick.profile === undefined ? [] : config.OFFER.profiles?.[pick.profile] ?? []);
    let picks = falls(ask);
    // why each pick failed or was skipped, this call
    let whys: (string | null)[] = picks.map(() => null);
    const skip = (from: number): number => {
      const to = AskAI.up(picks, from);
      for (let i = from; i < to; i++) {
        whys[i] = (DOWN.get(AskAI.down_key(picks[i]))?.why ?? "") + " (skipped for a minute)";
      }
      return to;
    };
    let k = skip(0);
    // a try on picks[k], having left the one before it if any
    const go = (): Try => {
      const run = picks[k];
      const from = k > 0 ? picks[k - 1] : null;
      const why = from === null ? "" : whys[k - 1] ?? DOWN.get(AskAI.down_key(from))?.why ?? "";
      let heard = picks.length === 1;
      const hear = (ev: Event) => {
        if (!heard && (ev.$ === "Delta" || (ev.$ === "Entry" && ev.kind !== "mind"))) {
          heard = true;
          on({ $: "Run", run: Pick.named(run), from: from && Pick.named(from), why });
        }
        on(ev);
      };
      const probe = picks.length > 1 && DOWN.has(AskAI.down_key(run));
      const fallback = k < picks.length - 1;
      return AskAI.start({ ...ask, ...run, probe, fallback }, hear);
    };
    let call = go();
    const run = async (): Promise<End> => {
      let end = await call.done;
      for (;;) {
        const failed = !end.ok && end.stop !== "fail" && end.stop !== "lost" && !halt.signal.aborted;
        const off = failed && end.off === true;
        const unset = failed && end.stop === undefined;
        const up = !halt.signal.aborted && (end.ok || end.stop === "fail" || (end.stop === "down" && !off));
        if (picks.length > 1 && (off || up)) {
          AskAI.down(picks[k], off ? end.text : null);
        }
        whys[k] = failed ? end.text : null;
        const next = (off || unset) && end.acted !== true && k < picks.length - 1;
        const wait = failed && !next && ask.patient === true;
        if (wait) {
          const ms = Math.min(WEEK, Math.max(AGAIN, (end.until ?? 0) - Date.now()));
          on({ $: "Again", again: { why: end.why ?? end.text, until: Date.now() + ms, limit: false } });
          await Machine.nap(ms, halt.signal);
          if (ask.repick !== undefined && !halt.signal.aborted) {
            picks = falls(ask.repick());
            whys = picks.map(() => null);
          }
        }
        if (halt.signal.aborted || (!next && !wait)) {
          const all = whys.flatMap((why, i) => (why === null ? [] : [picks[i].vendor + ":" + Pick.named(picks[i]).model + ": " + why]));
          return failed && all.length > 1 ? { ...end, text: "no model answered; " + all.join("; ") } : end;
        }
        k = skip(next ? k + 1 : 0);
        call = go();
        end.left.forEach(send);
        end = await call.done;
      }
    };
    run().then(resolve, (err) => resolve(AskAI.end(String(err?.message ?? err))));
    return out;
  }

  // one try; a vendor that throws gives a failed one
  export function start(ask: Ask, on: (ev: Event) => void): Try {
    try {
      return ask.vendor === "claude-sub" ? ClaudeSub.ask(ask, on) : Agent.ask(ask, on);
    } catch (err: any) {
      const end = AskAI.end(err.message);
      const send = (say: Say) => end.left.push(say);
      return { send, stop: () => {}, wake: () => {}, done: Promise.resolve(end) };
    }
  }

  // a call's end, before it ends: failed, saying `text`
  export function end(text: string): End {
    return { ok: false, text, left: [] };
  }

  // the first of picks from k on not skipped (DOWN), else the last
  export function up(picks: Pick[], k: number): number {
    while (k < picks.length - 1 && (DOWN.get(AskAI.down_key(picks[k]))?.until ?? 0) > Date.now()) {
      k += 1;
    }
    return k;
  }

  // a pick out, saying why (skipped for COOL), or answering (why null),
  // logged as that changes
  export function down(run: Pick, why: string | null): void {
    const key = AskAI.down_key(run);
    if ((why !== null) !== DOWN.has(key)) {
      console.error(Pick.label(Pick.named(run)) + (why !== null ? ": failed; calls go on with their fallbacks" : ": answers again"));
    }
    if (why !== null) {
      DOWN.set(key, { until: Date.now() + COOL, why });
    } else {
      DOWN.delete(key);
    }
  }

  export function down_key(run: Pick): string {
    return run.vendor + ":" + run.model;
  }

  // Cache
  // -----

  // the keys of a call's prefix at each block end through its last mark
  // before its end: what it runs on, its system prompt, tools and blocks,
  // each block's hash seeded by the one before (64 bits)
  export function keys(ask: Ask): string[] {
    const last = ask.blocks.slice(0, -1).findLastIndex((b) => b.mark);
    const head = [ask.vendor, ask.model, ask.effort, ask.speed, ask.system, ask.searches > 0];
    let key = Bun.hash(JSON.stringify(head));
    return ask.blocks.slice(0, last + 1).map((b) => String((key = Bun.hash(b.text, key))));
  }

  // single flight: waits while a leader writes the longest cached part of
  // the call's prefix; then leads, unless its whole prefix is cached
  export async function wait(ask: Ask): Promise<Flight> {
    const keys = AskAI.keys(ask);
    const ttl = TTL[ask.vendor];
    for (;;) {
      const now = Date.now();
      const live = (key: string) => CACHE.get(key)?.ready || (CACHE.get(key)?.until ?? 0) > now;
      const k = keys.findLastIndex(live);
      const got = k < 0 ? null : CACHE.get(keys[k])!;
      if (got?.ready) {
        await got.ready;
        continue;
      }
      if (got !== null) {
        got.until = now + ttl;
        CACHE.delete(keys[k]);
        CACHE.set(keys[k], got);
      }
      if (k === keys.length - 1) {
        return { begun: () => {}, end: () => {} };
      }
      return AskAI.lead(keys[keys.length - 1], ttl, now);
    }
  }

  // the call writing `key`; old entries go as a new one comes, the least
  // lately used first, up to the first still live (a process's calls of
  // all its chats share CACHE)
  export function lead(key: string, ttl: number, now: number): Flight {
    for (const [k, c] of CACHE) {
      if (c.ready !== null || c.until >= now) {
        break;
      }
      CACHE.delete(k);
    }
    let free = () => {};
    const own: Cached = { until: 0, ready: new Promise((ok) => (free = ok)) };
    CACHE.set(key, own);
    const begun = () => {
      if (own.ready !== null) {
        own.ready = null;
        own.until = Date.now() + ttl;
        free();
      }
    };
    const end = () => {
      if (own.ready !== null) {
        CACHE.delete(key);
        own.ready = null;
        free();
      }
    };
    return { begun, end };
  }

  // the non-empty lines of a byte stream
  export async function* lines(stream: ReadableStream<Uint8Array>) {
    for await (const lines of stream_lines(stream)) {
      yield* lines.map((line) => line.trim()).filter((line) => line !== "");
    }
  }

  // a tool result's content (a string, or MCP parts) as text
  export function show(content: any): string {
    if (typeof content === "string") {
      return content;
    }
    return (content ?? []).map((part: any) => part.text ?? "[" + part.type + "]").join("\n");
  }

}
