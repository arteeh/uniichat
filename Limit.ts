// Limit
// =====
// Usage limits, for every vendor, in one place. A usage limit is the
// plan's or the account's quota running out: a 429 from an API (but
// OpenAI's insufficient_quota, which is credit gone), a rate-limit stream
// error, or Claude Code's rate_limit_event "rejected". The vendors only
// detect one and count it (Limit `n`), and say how a call goes on after
// it: Agent.ts asks again; ClaudeSub.ts starts a new Claude Code, or tells
// the idle one to go on. What a call does at the limit is decided here.
//
// A limit never fails a call by itself. The call waits for the reset the
// vendor told, else for a doubling wait up to LIMIT (a patient call's, a
// summary's: up to AskAI's AGAIN). From TRIES limits in a row on it waits
// at least that doubling, so a limit that never clears is never asked
// fast. The count goes on across a patient call's tries (Ask `limits`).
//
// A wait of LONG or more parks the call: a Limit event tells the views
// till when, their live line while it lasts (no thought, no note: #49).
// A shorter wait reads as the service being busy, each time. A stop, a message sent mid-run or a
// resume ends the wait: the call asks once more and, still limited, waits
// again, saying nothing more.
//
// At a long limit a call ends instead of waiting (an Off, which its vendor
// turns into a `down` end):
// - a subagent's (Ask `agent`), whether it ran tools or not: its report
//   names the vendor, the model and the reset;
// - one that did nothing yet (ran no tool, took no message) and has a
//   fallback to go on to (AskAI.ts), or picks again as it asks again (a
//   summary's `repick`, so a compactor changed meanwhile counts).
//
// Every call asks the service: its answer is the truth, and a reset told
// only times the wait. The exception is a limit under which asking would
// bill (claude-sub's extra usage, one per account: LIMITS). A call under
// one waits for its reset before asking at all, and again after a resume
// or a message, so neither spends money (Limit.guard).
//
// Limits may lift early (the plan resets them, or its user spends a
// banked reset). While a call waits on a sub whose usage can be read
// without asking a model (USAGE: openai-sub's), it is read every POLL, and
// the calls waiting on it wake as it clears. claude-sub's is not polled:
// only Claude Code reads it, with a sign-in we never touch, so a limit
// lifted early wakes its calls by a resume or a message. A resume (the
// master's `resume` tool) wakes every call waiting.

import { AGAIN, type Ask, type Event, type Vendor } from "./AskAI.ts";
import { TRIES } from "./Agent.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { Machine } from "./Machine.ts";

// Types
// =====

// one call's usage limits: what it asks, where it tells what it does, its
// stop; n: the limits in a row (its vendor counts each one it hits);
// poke: ends its wait now (a message sent)
export type Limit = {
  ask    : Ask;
  on     : (ev: Event) => void;
  signal : AbortSignal;
  n      : number;
  poke   : () => void;
};

// a call ended at a long limit instead of waiting, for its fallback, its
// patient call's repick or its subagent's report: why (logged), what the
// user reads, when it resets if told (ms since 1970), and the limits in a
// row (End.limits)
export type Off = { why: string; say: string; until?: number; limits: number };

// Constants
// =========

// from how long a wait parks its call, and the longest wait between tries
// when no reset is told
export const LONG  = 60e3;
export const LIMIT = 1800e3;

// how often a sub's usage is read while a call waits on its limit
export const POLL = 300e3;

// the limits told under which asking would bill (claude-sub's extra
// usage, one per account: ClaudeSub.note), till their reset, by key: they
// keep a call from asking (Limit.guard)
const LIMITS = new Map<string, number>();

// the calls waiting for a usage limit, by vendor: what wakes each
const PARKED = new Set<{ vendor: Vendor; poke: () => void }>();

// the subs whose usage is read without asking a model: whether their
// limit cleared (null: can't tell now); the reads due, by vendor
const USAGE: Partial<Record<Vendor, () => Promise<boolean | null>>> = { "openai-sub": () => ChatGPT.clear() };
const POLLS = new Map<Vendor, Timer>();

// Limit
// =====

export namespace Limit {

  export function make(ask: Ask, on: (ev: Event) => void, signal: AbortSignal): Limit {
    return { ask, on, signal, n: ask.limits ?? 0, poke: () => {} };
  }

  // the call hit a limit, its `n`th in a row (counted by its vendor),
  // whose reset the vendor told (null: not told): the call ends (Off), or
  // it waits and goes on (null)
  export async function hit(l: Limit, told: number | null, acted: boolean, why: string): Promise<Off | null> {
    const { ms, known } = Limit.wait_for(told, l.n, l.ask.patient ? AGAIN : LIMIT);
    if (Limit.ends(l.ask, acted, ms)) {
      return Limit.off(why, told, l.ask, l.n);
    }
    await Limit.park(l, ms, known);
    return null;
  }

  // before asking: under a limit told whose asking would bill (`key`:
  // LIMITS), the call waits for its reset, again after a resume or a
  // message, or ends
  // (Off); null: ask now, or it was stopped
  export async function guard(l: Limit, key: string, acted: boolean): Promise<Off | null> {
    for (let until = Limit.under([key]); until !== null && !l.signal.aborted; until = Limit.under([key])) {
      const ms = until - Date.now();
      if (Limit.ends(l.ask, acted, ms)) {
        return Limit.off("usage limit", until, l.ask, l.n);
      }
      await Limit.park(l, ms, true);
    }
    return null;
  }

  // how long a call waits at its `n`th limit in a row: till the reset told
  // (from TRIES on, at least the doubling), else a doubling up to `pace`;
  // known: it waits for the reset told
  export function wait_for(told: number | null, n: number, pace: number, now = Date.now()): { ms: number; known: boolean } {
    const back = Math.min(2 ** n * 1e3, pace);
    const left = told === null ? 0 : told - now;
    const ms = Math.min(2 ** 31 - 1, left <= 0 ? back : n < TRIES ? left : Math.max(left, back));
    return { ms, known: left > 0 && ms === left };
  }

  // whether a call waiting `ms` ends instead: a subagent's, or one that
  // did nothing yet with a fallback or a repick; a wait under LONG never
  // ends one
  export function ends(ask: { agent?: boolean; fallback?: boolean; repick?: unknown }, acted: boolean, ms: number): boolean {
    return ms >= LONG && (ask.agent === true || ((ask.fallback === true || ask.repick !== undefined) && !acted));
  }

  // a call ended at a long limit, its `n`th in a row: on what, and when it
  // resets, if told
  export function off(why: string, until: number | null, ask: { vendor: Vendor; model: string }, n: number): Off {
    const when = until === null ? "reset time unknown" : "resets " + new Date(until).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    return { why: why + "; " + when, say: "usage limit on " + ask.vendor + " (" + ask.model + "), " + when, until: until ?? undefined, limits: n };
  }

  // the call waits `ms`: one of LONG or more parked (a Limit event: till
  // when, `known` if the vendor told it: the views' live line, gone as it
  // ends); a shorter one says it as when busy, each time. A stop, a poke
  // or a resume ends the wait
  export async function park(l: Limit, ms: number, known: boolean): Promise<void> {
    const wake = new AbortController();
    l.poke = () => wake.abort();
    const parked = ms >= LONG;
    if (parked) {
      l.on({ $: "Limit", limit: { until: Date.now() + ms, known } });
    }
    if (!parked) {
      l.on({ $: "Entry", kind: "mind", text: "The AI service is busy: asking again in " + Math.ceil(ms / 1e3) + " s." });
    }
    try {
      await Limit.wait(l.ask.vendor, ms, AbortSignal.any([l.signal, wake.signal]));
    } finally {
      l.poke = () => {};
      if (parked) {
        l.on({ $: "Limit", limit: null });
      }
    }
  }

  // a wait of `ms` for a usage limit of `vendor`'s, till `signal` aborts
  // or a resume wakes it (one the usage read clear does: USAGE, read every
  // POLL while one waits). A patient call waits here too (AskAI.nap)
  export async function wait(vendor: Vendor, ms: number, signal: AbortSignal): Promise<void> {
    const wake = new AbortController();
    const me = { vendor, poke: () => wake.abort() };
    PARKED.add(me);
    Limit.poll_soon(vendor);
    try {
      await Machine.nap(ms, AbortSignal.any([signal, wake.signal]));
    } finally {
      PARKED.delete(me);
      Limit.poll_off(vendor);
    }
  }

  // a limit told under which asking would bill (`key`: LIMITS), kept till
  // its reset, or lifted (null)
  export function note(key: string, until: number | null): void {
    if (until !== null && until > Date.now()) {
      LIMITS.set(key, until);
    } else {
      LIMITS.delete(key);
    }
  }

  // the latest reset of the limits kept of `keys` (null: none)
  export function under(keys: string[]): number | null {
    const now = Date.now();
    const told = keys.map((k) => LIMITS.get(k) ?? 0).filter((until) => until > now);
    return told.length > 0 ? Math.max(...told) : null;
  }

  // every call waiting for a usage limit (`vendor`'s, or any) woken; how
  // many. A call under a limit whose asking would bill waits on (guard)
  export function resume(vendor?: Vendor): number {
    const woken = [...PARKED].filter((p) => vendor === undefined || p.vendor === vendor);
    woken.forEach((p) => p.poke());
    return woken.length;
  }

  // `vendor`'s usage read in POLL, if it can be and no read is due
  export function poll_soon(vendor: Vendor): void {
    if (USAGE[vendor] === undefined || POLLS.has(vendor)) {
      return;
    }
    const timer = setTimeout(() => {
      POLLS.delete(vendor);
      void Limit.poll(vendor);
    }, POLL);
    timer.unref?.();
    POLLS.set(vendor, timer);
  }

  // `vendor`'s usage read due cancelled once no call waits for it
  export function poll_off(vendor: Vendor): void {
    if (![...PARKED].some((p) => p.vendor === vendor)) {
      clearTimeout(POLLS.get(vendor));
      POLLS.delete(vendor);
    }
  }

  // `vendor`'s usage read, if a call still waits for it: cleared, its
  // calls waiting wake (resume); else, while one waits, it is read again
  // in POLL
  export async function poll(vendor: Vendor): Promise<boolean> {
    if (![...PARKED].some((p) => p.vendor === vendor)) {
      return false;
    }
    const clear = await (USAGE[vendor]?.() ?? Promise.resolve(null)).catch(() => null);
    if (clear === true) {
      Limit.resume(vendor);
    } else if ([...PARKED].some((p) => p.vendor === vendor)) {
      Limit.poll_soon(vendor);
    }
    return clear === true;
  }

}
