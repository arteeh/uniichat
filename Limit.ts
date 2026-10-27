import { AGAIN, type Ask, type Event, type Vendor } from "./AskAI.ts";
import { TRIES } from "./Agent.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { Machine } from "./Machine.ts";

export type Limit = {
  ask    : Ask;
  on     : (ev: Event) => void;
  signal : AbortSignal;
  n      : number;
  poke   : () => void;
};

export type Off = { why: string; say: string; until?: number; limits: number };

const LONG  = 60e3;
export const LIMIT = 1800e3;

const POLL = 300e3;

const STAGGER      = 600e3;
const STAGGER_LOOK = 1e3;

let ANSWERING: () => { queued: boolean; busy: boolean } = () => ({ queued: false, busy: false });

const LIMITS = new Map<string, number>();

const PARKED = new Set<{ vendor: Vendor; poke: () => void }>();

const USAGE: Partial<Record<Vendor, () => Promise<boolean | null>>> = { "openai-sub": () => ChatGPT.clear() };
const POLLS = new Map<Vendor, Timer>();

export namespace Limit {

  export function make(ask: Ask, on: (ev: Event) => void, signal: AbortSignal): Limit {
    return { ask, on, signal, n: ask.limits ?? 0, poke: () => {} };
  }

  export async function hit(l: Limit, told: number | null, acted: boolean, why: string): Promise<Off | null> {
    const { ms, known } = Limit.wait_for(told, l.n, l.ask.patient ? AGAIN : LIMIT);
    if (Limit.ends(l.ask, acted, ms)) {
      return Limit.off(why, told, l.ask, l.n);
    }
    await Limit.park(l, ms, known);
    return null;
  }

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

  export function wait_for(told: number | null, n: number, pace: number, now = Date.now()): { ms: number; known: boolean } {
    const back = Math.min(2 ** n * 1e3, pace);
    const left = told === null ? 0 : told - now;
    const ms = Math.min(2 ** 31 - 1, left <= 0 ? back : n < TRIES ? left : Math.max(left, back));
    return { ms, known: left > 0 && ms === left };
  }

  export function ends(ask: { fallback?: boolean; repick?: unknown }, acted: boolean, ms: number): boolean {
    return ms >= LONG && (ask.fallback === true || ask.repick !== undefined) && !acted;
  }

  export function answering(turn: () => { queued: boolean; busy: boolean }): void {
    ANSWERING = turn;
  }

  export function off(why: string, until: number | null, ask: { vendor: Vendor; model: string }, n: number): Off {
    const when = until === null ? "reset time unknown" : "resets " + new Date(until).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    return { why: why + "; " + when, say: "usage limit on " + ask.vendor + " (" + ask.model + "), " + when, until: until ?? undefined, limits: n };
  }

  export async function park(l: Limit, ms: number, known: boolean): Promise<void> {
    const wake = new AbortController();
    l.poke = () => wake.abort();
    const parked = ms >= LONG;
    const vendor = l.ask.vendor;
    if (parked) {
      l.on({ $: "Limit", limit: { until: Date.now() + ms, known, vendor } });
    }
    if (!parked) {
      l.on({ $: "Entry", kind: "mind", text: "The AI service is busy: asking again in " + Math.ceil(ms / 1e3) + " s." });
    }
    const until = AbortSignal.any([l.signal, wake.signal]);
    try {
      await Limit.wait(vendor, ms, until);
      if (parked && l.ask.agent === true && !until.aborted && ANSWERING().queued) {
        await Limit.let_unii_answer_first(l, until);
      }
    } finally {
      l.poke = () => {};
      if (parked) {
        l.on({ $: "Limit", limit: null });
      }
    }
  }

  export async function let_unii_answer_first(l: Limit, until: AbortSignal): Promise<void> {
    const end = Date.now() + STAGGER;
    const answering = () => ANSWERING().queued || ANSWERING().busy;
    l.on({ $: "Limit", limit: { until: end, known: false, vendor: l.ask.vendor } });
    while (!until.aborted && answering() && Date.now() < end) {
      await Machine.nap(STAGGER_LOOK, until);
    }
  }

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

  export function note(key: string, until: number | null): void {
    if (until !== null && until > Date.now()) {
      LIMITS.set(key, until);
    } else {
      LIMITS.delete(key);
    }
  }

  export function under(keys: string[]): number | null {
    const now = Date.now();
    const told = keys.map((k) => LIMITS.get(k) ?? 0).filter((until) => until > now);
    return told.length > 0 ? Math.max(...told) : null;
  }

  export function resume(vendor?: Vendor): number {
    const woken = [...PARKED].filter((p) => vendor === undefined || p.vendor === vendor);
    woken.forEach((p) => p.poke());
    return woken.length;
  }

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

  export function poll_off(vendor: Vendor): void {
    if (![...PARKED].some((p) => p.vendor === vendor)) {
      clearTimeout(POLLS.get(vendor));
      POLLS.delete(vendor);
    }
  }

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
