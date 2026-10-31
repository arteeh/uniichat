import { Agent } from "./Agent.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import { stream_lines } from "./Clip.ts";
import { Limit } from "./Limit.ts";
import { Machine } from "./Machine.ts";
import { OpenAI } from "./OpenAI.ts";
import { Pick } from "./Pick.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get, text_of } from "./Json.ts";

export type Kind = "user" | "work" | "mind" | "unii" | "tool" | "echo" | "note";

export type Vendor = "claude-api" | "openai-api" | "openai-sub" | "claude-sub";

export type Img = { type: string; data: string };

export type Say = { text: string; imgs: Img[] };

export type Block = { text: string; mark: boolean; back?: boolean };

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
  no_wait?  : boolean;
  talk?     : boolean;
  repick?   : () => Pick;
  used?     : (tokens: number) => void;
  steers?   : () => Promise<Say[]>;
  limits?   : number;
  who?      : string;
};

type Prefix = { warm_until: number; writing: Promise<void> | null };

export type Flight = { begun: () => void; end: () => void };

export type Parked = { until: number; known: boolean; vendor: Vendor };

export type Again = { why: string; until: number; limit: boolean };

export type Event =
  | { $: "Delta"; kind: Kind; text: string; fresh?: boolean }
  | { $: "Entry"; kind: Kind; text: string; of?: string; queued?: boolean }
  | { $: "Start"; of: string }
  | { $: "Limit"; limit: Parked | null }
  | { $: "Again"; again: Again | null }
  | { $: "Run"; run: Pick; from: Pick | null; why: string };

export type End = {
  ok     : boolean;
  text   : string;
  why?   : string;
  note?  : string;
  stop?  : "fail" | "lost" | "down";
  off?   : boolean;
  acted? : boolean;
  until? : number;
  long?  : boolean;
  limits?: number;
  vendor?: Vendor;
};

export type Try = {
  wake : () => void;
  stop : () => void;
  done : Promise<End>;
};

export type Call = Try;

export const AGAIN = 60e3;

// the longest a patient call waits for a refusal to lift (a ChatGPT
// plan's limits last a week at most)
const WEEK = 7 * 86400e3;

// how long a vendor keeps a cache entry unused, in ms, as single flight
// counts it: claude-api's and claude-sub's marks are all an hour's
// (Anthropic.ts HOUR; Claude Code's own by ClaudeSub.ts ENV); OpenAI's
// default is 30 minutes, and openai-sub's backend tells none
const TTL: Record<Vendor, number> = {
  "claude-api" : 3600e3,
  "openai-api" : 1800e3,
  "openai-sub" : 1800e3,
  "claude-sub" : 3600e3,
};

const PREFIXES = new Map<string, Prefix>();

const UNLED: Flight = { begun: () => {}, end: () => {} };

const COOL = 60e3;

const DOWN = new Map<string, { until: number; why: string }>();

export namespace AskAI {

  export function ask(ask: Ask, on: (ev: Event) => void): Call {
    const halt = new AbortController();
    const wake = () => call.wake();
    const stop = () => {
      halt.abort();
      call.stop();
    };
    const { promise, resolve } = Promise.withResolvers<End>();
    const out: Call = { wake, stop, done: promise };
    let picks = AskAI.falls(ask);
    let whys: (string | null)[] = picks.map(() => null);
    const skip = (from: number): number => {
      const to = AskAI.up(picks, from);
      for (let i = from; i < to; i++) {
        whys[i] = (DOWN.get(AskAI.down_key(picks[i]))?.why ?? "") + " (skipped for a minute)";
      }
      return to;
    };
    let k = skip(0);
    let limits = ask.limits ?? 0;
    let reset: { until: number; vendor: Vendor } | undefined;
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
      return AskAI.start({ ...ask, ...run, probe, fallback, limits }, hear);
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
        const left = picks[k];
        const limited = wait && end.limits !== undefined;
        if (end.limits !== undefined && end.until !== undefined && end.until < (reset?.until ?? Infinity)) {
          reset = { until: end.until, vendor: left.vendor };
        }
        if (wait) {
          const ms = Math.min(WEEK, Math.max(AGAIN, (end.until ?? 0) - Date.now()));
          const why = left.vendor + ":" + Pick.named(left).model + ": " + (limited ? "usage limit" : end.why ?? end.text);
          on({ $: "Again", again: { why, until: Date.now() + ms, limit: limited } });
          await AskAI.nap_till_woken(ask, picks, limited ? left.vendor : null, ms, halt.signal);
          const now = ask.repick === undefined || halt.signal.aborted ? picks : AskAI.falls(ask.repick());
          if (!AskAI.same(now, picks)) {
            picks = now;
            whys = picks.map(() => null);
          }
          if (!halt.signal.aborted) {
            on({ $: "Again", again: null });
          }
        }
        if (halt.signal.aborted || (!next && !wait)) {
          const all = whys.flatMap((why, i) => (why === null ? [] : [picks[i].vendor + ":" + Pick.named(picks[i]).model + ": " + why]));
          const until = end.limits === undefined ? end.until : reset?.until;
          const vendor = end.limits === undefined ? undefined : reset?.vendor ?? left.vendor;
          return failed && all.length > 1 ? { ...end, until, vendor, text: "no model answered; " + all.join("; ") } : { ...end, vendor };
        }
        k = skip(next ? k + 1 : 0);
        limits = limited && picks[k] === left ? end.limits ?? 0 : 0;
        call = go();
        end = await call.done;
      }
    };
    run().then(resolve, (err: unknown) => resolve(AskAI.end(err_why(err))));
    return out;
  }

  export function falls(pick: Pick): Pick[] {
    return Pick.falls(pick, pick.profile === undefined ? [] : config.OFFER.profiles?.[pick.profile] ?? []);
  }

  export function same(a: Pick[], b: Pick[]): boolean {
    return a.map(Pick.label).join() === b.map(Pick.label).join();
  }

  export async function nap_till_woken(ask: Ask, picks: Pick[], vendor: Vendor | null, ms: number, stopped: AbortSignal): Promise<void> {
    const repicked = AskAI.repicked(ask, picks);
    try {
      const woken = AbortSignal.any([stopped, repicked.signal]);
      await (vendor === null ? Machine.nap(ms, woken) : Limit.wait(vendor, ms, woken));
    } finally {
      repicked.done();
    }
  }

  export function repicked(ask: Ask, picks: Pick[]): { signal: AbortSignal; done: () => void } {
    const moved = new AbortController();
    const reread = () => {
      if (ask.repick !== undefined && !AskAI.same(AskAI.falls(ask.repick()), picks)) {
        moved.abort();
      }
    };
    config.RELOADED.add(reread);
    return { signal: moved.signal, done: () => config.RELOADED.delete(reread) };
  }

  export function start(ask: Ask, on: (ev: Event) => void): Try {
    try {
      return ask.vendor === "claude-sub" ? ClaudeSub.ask(ask, on) : Agent.ask(ask, on);
    } catch (err) {
      return { wake: () => {}, stop: () => {}, done: Promise.resolve(AskAI.end(err_why(err))) };
    }
  }

  export function end(text: string): End {
    return { ok: false, text };
  }

  export function up(picks: Pick[], k: number): number {
    while (k < picks.length - 1 && (DOWN.get(AskAI.down_key(picks[k]))?.until ?? 0) > Date.now()) {
      k += 1;
    }
    return k;
  }

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

  export function prefix_keys(ask: Ask): string[] {
    const last = ask.blocks.slice(0, -1).findLastIndex((b) => b.mark);
    // OpenAI caches per session (OpenAI.session)
    const head = [ask.vendor, ask.model, ask.effort, ask.speed, ask.system, ask.searches > 0, ask.vendor.startsWith("openai") ? OpenAI.sharer(ask) : null];
    let key = Bun.hash(JSON.stringify(head));
    return ask.blocks.slice(0, last + 1).map((b) => String((key = Bun.hash(b.text, key))));
  }

  export async function single_flight(ask: Ask): Promise<Flight> {
    const keys = AskAI.prefix_keys(ask);
    const ttl = TTL[ask.vendor];
    for (;;) {
      const now = Date.now();
      const k = keys.findLastIndex((key) => AskAI.warm_or_writing(key, now));
      const got = k < 0 ? null : PREFIXES.get(keys[k]) ?? null;
      if (got !== null && got.writing !== null) {
        await got.writing;
        continue;
      }
      if (got !== null) {
        AskAI.rewarm(keys[k], got, now + ttl);
      }
      return k === keys.length - 1 ? UNLED : AskAI.lead_flight(keys[keys.length - 1], ttl, now);
    }
  }

  export function warm_or_writing(key: string, now: number): boolean {
    const got = PREFIXES.get(key);
    return got !== undefined && (got.writing !== null || got.warm_until > now);
  }

  export function rewarm(key: string, prefix: Prefix, until: number): void {
    prefix.warm_until = until;
    PREFIXES.delete(key);
    PREFIXES.set(key, prefix);
  }

  export function drop_cold(now: number): void {
    for (const [k, c] of PREFIXES) {
      if (c.writing !== null || c.warm_until >= now) {
        break;
      }
      PREFIXES.delete(k);
    }
  }

  export function lead_flight(key: string, ttl: number, now: number): Flight {
    AskAI.drop_cold(now);
    let written = () => {};
    const own: Prefix = { warm_until: 0, writing: new Promise((ok) => (written = ok)) };
    PREFIXES.set(key, own);
    const begun = () => {
      if (own.writing !== null) {
        own.writing = null;
        own.warm_until = Date.now() + ttl;
        written();
      }
    };
    const end = () => {
      if (own.writing !== null) {
        PREFIXES.delete(key);
        own.writing = null;
        written();
      }
    };
    return { begun, end };
  }

  export async function* lines(stream: ReadableStream<Uint8Array>) {
    for await (const lines of stream_lines(stream)) {
      yield* lines.map((line) => line.trim()).filter((line) => line !== "");
    }
  }

  export function show(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }
    return (Array.isArray(content) ? content : []).map((part: unknown) => text_of(get(part, "text"), "[" + text_of(get(part, "type"), "undefined") + "]")).join("\n");
  }

}
