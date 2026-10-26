// Agent
// =====
// claude-api, openai-api and openai-sub in Unii's own loop; a Wire
// (Anthropic.ts, OpenAI.ts, ChatGPT.ts) shapes requests and reads
// streams. Each step sends every
// item and streams one output; tool calls run in order, a message sent
// mid-run follows the next results, and the call ends at a step with no
// tools and nothing sent. A request goes again, TRIES times at most (a
// probe's first once: AskAI.ts DOWN), after its retry-after or a
// doubling wait, for a passing reason (`busy`: no connection, a retry
// status unless SPENT, a stream error, cut short or silent for the
// wire's `idle`), dropping what it streamed. A request that yields
// (an import's summary, AskAI.ts) sends nothing while one that doesn't
// (a turn's, a chat's summary, which a turn waits on) waits on its busy
// model: the room a busy vendor has goes to the chats first, and many
// imports never starve every chat of the summaries its next turn needs.
// An import asks a busy model again by one request at a time, the rest
// waiting on it, so imports share what room is left alike, however many
// requests each runs.
// A usage limit (a 429 but OpenAI's insufficient_quota, or a rate-limit
// stream error) is counted and handed to Limit.ts, which waits (then the
// request asks again) or ends the call, as it does for every vendor.
// A busy model is logged as its first request asks again and as its
// last is done, never each try (a storm logged ~600 lines a second).
// A call ends answered
// (`fail`: the model's answer failed, a refusal or a stop reason: its
// input's doing) or not: `down`, the vendor's (a refusal of the request,
// as when the API key's credit is gone, or busy past TRIES; `off` if
// every call's would be: busy past TRIES, a status of OFF, SPENT); `lost`,
// ours (a stop), saying why. A vendor's why
// (`busy`, `down`) goes to the log; the user reads only that the AI
// service is busy, as the call's end, each retry's thought and where a
// call is cut (a vendor's errors speak of the server's account, not the
// user's). A stop ends the call at once, its request cut. A request takes
// its place in single flight (AskAI.wait).

import { AskAI, type Ask, type Block, type Flight, type Try, type End, type Event, type Img, type Kind, type Say } from "./AskAI.ts";
import { Anthropic } from "./Anthropic.ts";
import { OpenAI } from "./OpenAI.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { Limit } from "./Limit.ts";
import { live_push } from "./View.ts";
import { Machine, type Spec } from "./Machine.ts";
import * as config from "./Config.ts";

// Types
// =====

export type Out = { text: string; fail: boolean; imgs?: Img[] };

export type Tool = Spec;

// a running call: the messages sent mid-run not taken yet, its usage
// limits (Limit.ts)
type Doing = {
  ask   : Ask;
  on    : (ev: Event) => void;
  sent  : Say[];
  abort : AbortController;
  end   : End;
  limit : Limit;
};

export type Back = { id: string; out: Out };

// a room at a busy model, a model's or an import's (AskAI.ts `yields`):
// the requests asking again that hold it (a model's: those that don't
// yield; an import's: the one asking for all its requests), and those
// waiting till none does; a model's counts all its requests asking
// again too, logged as they go from none to some and back
type Room = { busy: number; asking: number; wait: Array<() => void> };

export type Item =
  | { $: "User"; parts: Block[]; imgs: Img[] } // user text, images
  | { $: "Turn"; out: unknown[] }             // the model's output, as its API gave it
  | { $: "Back"; backs: Back[] };             // tool results

// a tool call: its input (null: not JSON)
export type Use = { id: string; name: string; input: unknown };

export type Entry = { kind: Kind; text: string; of?: string };

// note: what it did other than asked; off: down for every call (End.off);
// refusal: the vendor's, if down by one; until: a plan's usage limit's
// reset, as told (Wire `reset`); limits: ended at a usage limit
// (Limit.off), the usage limits in a row (End.limits)
export type Step = {
  out      : unknown[];
  uses     : Use[];
  entries  : Entry[];
  stop     : "done" | "tools" | "again" | "busy" | "limit" | "down" | "lost" | "fail";
  why      : string;
  note     : string;
  off?     : boolean;
  refusal? : Refusal;
  until?   : number;
  limits?  : number;
};

// a refusal asking again soon won't change (a ChatGPT plan without this
// use; a long usage limit a fallback goes on past: Limit.off): why
// (logged), what the user reads, and when it lifts, if told (ms since
// 1970)
export type Refusal = { why: string; say: string; until?: number };

export type Emit = (kind: Kind, text: string, fresh?: boolean) => void;

// an API: its key's name in config.KEYS (or `auth`: a signed-in
// account's token for each try, refused: the one a 401 refused, which it
// refreshes; an error with `busy` set: none for now), a body's input
// tokens as it counts them (null: not told), how its stream reads into a
// step (S: what it read so far), which error responses are refusals
// (null: not one), and when a plan's usage limit resets, as an error
// response tells it (null: not told)
export type Wire<S> = {
  key     : string;
  auth?   : (refused: string | undefined) => Promise<string>;
  refusal?: (res: Response, body: string) => Refusal | null;
  reset?  : (res: Response, body: string) => number | null;
  idle    : number;
  url     : string;
  headers : (key: string, ask: Ask) => Record<string, string>;
  body    : (ask: Ask, items: Item[], tools: Tool[], max: number) => unknown;
  start   : (ask: Ask) => S;
  read    : (st: S, ev: any, on: Emit) => boolean;
  begun   : (ev: any) => boolean;
  step    : (st: S, ask: Ask) => Step;
};

// Constants
// =========

// a request's most output tokens: the models' own cap
const MAX   = 128000;
export const TRIES = 8;

// a request refused for the vendor account, not for what it asks: by its
// status (a bad key, billing, no access, no such model) or its error
// (the credit or quota gone, Anthropic's a 400, OpenAI's a 429)
const OFF   = [401, 402, 403, 404];
const SPENT = /insufficient_quota|billing_hard_limit_reached|credit balance is too low/i;

// what a call the vendor never answered says
export const BUSY  = "the AI service is busy or unavailable right now";

// a refusal of a request too long for the model (Anthropic's, OpenAI's,
// Claude Code's words), or Anthropic's stop at the window's end:
// conversation mode ends on it (Server.ts)
export const TOO_LONG = /prompt is too long|context.length|context (limit|window)|model_context_window_exceeded|too many (input )?tokens/i;

// the rooms held or waited on, by model, or model and import (Agent.step)
const ROOMS = new Map<string, Room>();

// Agent
// =====

export namespace Agent {

  // a request's cache use as its vendor tells it (tokens; write null: not
  // told, as OpenAI's), logged for each call but summaries' and imports'
  export function cached(ask: Ask, read: number, write: number | null, input: number): void {
    if (ask.patient !== true) {
      console.error("cache " + ask.vendor + " " + ask.model + ": read " + read + (write === null ? "" : ", write " + write) + ", uncached " + input);
    }
  }

  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const abort = new AbortController();
    const run: Doing = { ask, on, sent: [], abort, end, limit: Limit.make(ask, on, abort.signal) };
    const send = (say: Say) => {
      run.sent.push(say);
      run.limit.poke();
    };
    const stop = () => {
      end.text = "stopped";
      run.abort.abort();
    };
    const done = (async () => {
      try {
        if (ask.vendor === "claude-api") {
          await Agent.loop(Anthropic.wire, run);
        } else if (ask.vendor === "openai-sub") {
          await Agent.loop(ChatGPT.wire, run);
        } else {
          await Agent.loop(OpenAI.wire, run);
        }
      } catch (err: any) {
        end.text ||= err.message;
      }
      end.ok   = end.ok && !run.abort.signal.aborted;
      end.left = run.sent;
      return end;
    })();
    return { send, stop, done };
  }

  export async function loop<S>(wire: Wire<S>, run: Doing): Promise<void> {
    const { ask, on, end } = run;
    const signal = run.abort.signal;
    const key = wire.auth ? "" : config.KEYS[wire.key];
    if (!key && !wire.auth) {
      throw new Error("no API key: set " + wire.key.toUpperCase() + "_API_KEY");
    }
    const { tools, notes } = await Agent.server(run);
    const noted = notes.length === 0 ? [] : [{ text: notes.map((note) => "Note: " + note + "\n").join("") + "\n", mark: false }];
    const parts = [...ask.blocks.slice(0, -1), ...noted, ...ask.blocks.slice(-1)].filter((b) => b.text !== "");
    const items: Item[] = [{ $: "User", parts, imgs: ask.imgs ?? [] }];
    while (!signal.aborted) {
      const step = await Agent.step(wire, run, key, (max) => wire.body(ask, items, tools, max), items);
      // our tools' calls run one by one below: each queued till it starts
      // (its Start), so none is logged as begun before the ones ahead end
      const ours = new Set(step.uses.map((use) => use.id));
      for (const entry of step.entries) {
        on({ $: "Entry", ...entry, ...(entry.kind === "tool" && entry.of !== undefined && ours.has(entry.of) ? { queued: true } : {}) });
      }
      if (step.stop === "down" || step.stop === "lost" || step.stop === "fail") {
        end.text ||= step.stop === "down" ? step.refusal?.say ?? BUSY : step.why;
        end.why = step.why;
        end.long = step.stop !== "lost" && TOO_LONG.test(step.why);
        end.stop = step.stop;
        end.off = step.off;
        end.until = step.refusal?.until;
        end.limits = step.limits;
        return;
      }
      items.push({ $: "Turn", out: step.out });
      end.note = step.note || end.note;
      if (step.stop === "again") {
        continue;
      }
      const backs: Back[] = [];
      for (const use of step.uses) {
        if (signal.aborted) {
          return;
        }
        end.acted = true;
        on({ $: "Start", of: use.id });
        const out = await Agent.use(run, tools, use);
        on({ $: "Entry", kind: "echo", text: (out.fail ? "error: " : "") + out.text, of: use.id });
        backs.push({ id: use.id, out });
      }
      if (signal.aborted) {
        return;
      }
      const says = run.sent.splice(0);
      const replies = step.entries.filter((e) => e.kind === "unii");
      const text = replies.map((e) => e.text).join("\n\n");
      if (backs.length === 0 && says.length === 0) {
        end.ok   = true;
        end.text = text;
        return;
      }
      end.acted ||= says.length > 0;
      for (const say of says) {
        on({ $: "Entry", kind: "user", text: say.text });
      }
      if (backs.length > 0) {
        items.push({ $: "Back", backs });
      }
      if (says.length > 0) {
        const parts = says.filter((say) => say.text !== "").map((say) => ({ text: say.text, mark: false }));
        const imgs = says.flatMap((say) => say.imgs);
        items.push({ $: "User", parts, imgs });
      }
    }
  }

  // make: the request's body, writing `max` tokens at most. Asking again,
  // it holds its room (Room): its model's, or its import's, which one
  // request holds at a time while the rest wait on it, so each import
  // has one request at a busy model however many it runs, and imports
  // share its room alike. k: its busy tries; its usage-limit ones in a
  // row are the Limit's `n` (a patient call's try going on from those its
  // last try ended at: Ask `limits`). A patient call's failures are
  // logged as it waits to ask again (Memory.heard), not here
  export async function step<S>(wire: Wire<S>, run: Doing, key: string, make: (max: number) => unknown, items: Item[]): Promise<Step> {
    const signal = run.abort.signal;
    const model = run.ask.model;
    const own = run.ask.yields === undefined ? model : model + " " + run.ask.yields;
    const tries = run.ask.probe === true && items.length === 1 ? 1 : TRIES;
    let asking = false;
    let refused: string | undefined;
    try {
      run.limit.n = run.ask.limits ?? 0;
      for (let k = 0; !signal.aborted; ) {
        await Agent.yielded(run, own, asking);
        const seen: Entry[] = [];
        const token = await Agent.race(Agent.token(wire, key, refused), signal);
        if (token === null) {
          return Agent.fail("stopped", seen);
        }
        const sent = typeof token === "string" ? Agent.request(wire, run, token, make(MAX), seen) : Promise.resolve({ res: null, step: token });
        const got = await Agent.race(sent, signal);
        if (got === null) {
          return Agent.fail("stopped", seen);
        }
        const { res, step } = got;
        if (res?.status === 401 && wire.auth && refused === undefined) {
          refused = token as string;
          continue;
        }
        const limit = step.stop === "limit";
        k += step.stop === "busy" ? 1 : 0;
        run.limit.n += limit ? 1 : 0;
        if (step.stop === "down" && run.ask.patient !== true) {
          console.error(model + ": " + step.why.slice(0, 300));
        }
        if (!limit && (step.stop !== "busy" || k >= tries)) {
          return step.stop === "busy" ? { ...step, stop: "down", off: true } : step;
        }
        if (!asking && own !== model && (ROOMS.get(own)?.busy ?? 0) > 0) {
          continue;
        }
        if (!asking) {
          Agent.hold(model, own, step.why);
          asking = true;
        }
        if (limit) {
          const off = await Limit.hit(run.limit, step.until ?? Agent.reset(res, Date.now()), run.end.acted === true, step.why);
          if (off !== null) {
            return { ...step, stop: "down", off: true, refusal: { why: off.why, say: off.say, until: off.until }, limits: off.limits };
          }
          continue;
        }
        const after = Number(res?.headers.get("retry-after") ?? "");
        const ms = (after > 0 ? after : 2 ** k) * 1e3;
        run.on({ $: "Entry", kind: "mind", text: "The AI service is busy: asking again in " + Math.ceil(ms / 1e3) + " s." });
        await Machine.nap(ms, signal);
      }
      return Agent.fail("stopped", []);
    } finally {
      if (asking) {
        Agent.free(model, own);
      }
    }
  }

  // a promise's value, or null once `signal` aborts (or had); its
  // listener gone either way (a call at a usage limit asks again without
  // end), and its failure after that ignored
  export function race<T>(go: Promise<T>, signal: AbortSignal): Promise<T | null> {
    go.catch(() => {});
    let drop = () => {};
    const stopped = new Promise<null>((done) => {
      const stop = () => done(null);
      signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
      drop = () => signal.removeEventListener("abort", stop);
    });
    return Promise.race([go, stopped]).finally(drop);
  }

  // Usage limits
  // ------------

  // when a usage limit resets, as the vendor tells it (ms since the epoch;
  // null: not told, past, or too far for a timer): its retry-after
  // (seconds or a date), else the latest of its ratelimit headers' resets
  // (Anthropic's anthropic-ratelimit-*-reset, a date or epoch seconds;
  // OpenAI's x-ratelimit-reset-*, a span like "6m0s")
  export function reset(res: Response | null, now: number): number | null {
    const UNIT: Record<string, number> = { h: 3600e3, m: 60e3, s: 1e3, ms: 1 };
    const at = (name: string, v: string): number =>
      name.startsWith("x-") ? now + [...v.matchAll(/([\d.]+)(ms|h|m|s)/g)].reduce((t, m) => t + Number(m[1]) * UNIT[m[2]], 0)
      : /^\d+(\.\d+)?$/.test(v.trim()) ? (name === "retry-after" ? now : 0) + Number(v) * 1e3
      : Date.parse(v);
    const ok = (t: number) => t > now && t - now < 2 ** 31;
    const told = [...(res?.headers ?? [])].filter(([name]) => /^(retry-after|anthropic-ratelimit-.+-reset|x-ratelimit-reset-.+)$/.test(name)).map(([name, v]) => [name, at(name, v)] as const).filter(([, t]) => ok(t));
    const after = told.find(([name]) => name === "retry-after");
    return after?.[1] ?? (told.length > 0 ? Math.max(...told.map(([, t]) => t)) : null);
  }

  // a try's key, or a signed-in wire's token (refused: the one a 401
  // refused); one it can't get for now, a busy step
  export async function token<S>(wire: Wire<S>, key: string, refused: string | undefined): Promise<string | Step> {
    if (wire.auth === undefined) {
      return key;
    }
    try {
      return await wire.auth(refused);
    } catch (err: any) {
      if (err?.busy !== true) {
        throw err;
      }
      return Agent.fail(err.message, [], "busy");
    }
  }

  export function room(key: string): Room {
    const room = ROOMS.get(key) ?? { busy: 0, asking: 0, wait: [] };
    ROOMS.set(key, room);
    return room;
  }

  // a request asks `model` again, holding `own`, its model's room or its
  // import's; the model's first says why
  export function hold(model: string, own: string, why: string): void {
    if (Agent.room(model).asking++ === 0) {
      console.error(model + ": " + why.slice(0, 300) + ": its requests ask again");
    }
    Agent.room(own).busy += 1;
  }

  // ... and lets go of it, answered or not: the last frees those waiting
  export function free(model: string, own: string): void {
    const room = Agent.room(own);
    room.busy -= 1;
    if (room.busy === 0) {
      room.wait.splice(0).forEach((ok) => ok());
    }
    if (--Agent.room(model).asking === 0) {
      console.error(model + ": none asks again");
    }
    for (const key of [own, model]) {
      if (ROOMS.get(key)?.busy === 0 && ROOMS.get(key)?.asking === 0) {
        ROOMS.delete(key);
      }
    }
  }

  // a request that yields waits while a request that doesn't holds its
  // model's room, and while another holds its import's
  export async function yielded(run: Doing, own: string, asking: boolean): Promise<void> {
    const keys = run.ask.yields === undefined ? [] : asking ? [run.ask.model] : [run.ask.model, own];
    for (;;) {
      const room = keys.map((key) => ROOMS.get(key)).find((room) => (room?.busy ?? 0) > 0);
      if (room === undefined || run.abort.signal.aborted) {
        return;
      }
      await Agent.race(new Promise<void>((ok) => room.wait.push(ok)), run.abort.signal);
    }
  }

  // one request, in single flight (AskAI.wait): its response, if any,
  // and step
  export async function request<S>(wire: Wire<S>, run: Doing, key: string, body: unknown, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
    const flight = await AskAI.wait(run.ask);
    if (run.abort.signal.aborted) {
      flight.end();
      return { res: null, step: Agent.fail("stopped", []) };
    }
    return Agent.send(wire, run, key, body, flight, seen);
  }

  export async function send<S>(wire: Wire<S>, run: Doing, key: string, body: unknown, flight: Flight, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
    const idle = new AbortController();
    const timer = setTimeout(() => idle.abort(new Error("no word from the API in " + wire.idle / 1e3 + " s")), wire.idle);
    const st = wire.start(run.ask);
    const json = JSON.stringify(body);
    let res: Response | null = null;
    let step: Step;
    try {
      res = await fetch(wire.url, {
        method  : "POST",
        headers : wire.headers(key, run.ask),
        body    : json,
        signal  : AbortSignal.any([run.abort.signal, idle.signal]),
        timeout : false,
      } as RequestInit);
      const text = res.ok && res.body ? null : await res.text();
      const refusal = text === null ? null : wire.refusal?.(res, text) ?? null;
      const spent = text !== null && SPENT.test(text);
      const why = refusal?.why ?? "HTTP " + res.status + ": " + Agent.reason(text ?? "");
      const off = spent || OFF.includes(res.status) || refusal !== null;
      const stop = refusal !== null ? "down" : text !== null && Agent.limited(res, text) && !spent ? "limit" : text !== null && Agent.passing(res) && !spent ? "busy" : "down";
      const until = text !== null && stop === "limit" ? wire.reset?.(res, text) ?? undefined : undefined;
      step = text !== null ? { ...Agent.fail(why, [], stop), off, refusal: refusal ?? undefined, until } : await Agent.stream(wire, run, res.body!, timer, seen, st, flight.begun);
    } catch (err: any) {
      step = Agent.fail(err.message, [], "busy");
    }
    clearTimeout(timer);
    flight.end();
    return { res, step };
  }

  // a failed request's why: the API's message (Anthropic's and OpenAI's
  // errors are {error: {message}}, the ChatGPT backend's some {detail}),
  // else the start of its body
  export function reason(body: string): string {
    try {
      const json = JSON.parse(body);
      const why = json?.error?.message ?? json?.detail;
      return typeof why === "string" ? why : body.slice(0, 2000);
    } catch {
      return body.slice(0, 2000);
    }
  }

  // a refusal a usage limit's reset ends: a 429, but OpenAI's
  // insufficient_quota (credit gone)
  export function limited(res: Response, body: string): boolean {
    return res.status === 429 && !body.includes("insufficient_quota");
  }

  export function passing(res: Response): boolean {
    const should = res.headers.get("x-should-retry");
    const busy = [408, 409, 429].includes(res.status) || res.status >= 500;
    return should === "true" || (should !== "false" && busy);
  }

  // seen: what streamed, as told to the call (none once it stopped); st:
  // what it read; begun: its response began (Flight)
  export async function stream<S>(wire: Wire<S>, run: Doing, body: ReadableStream<Uint8Array>, timer: Timer, seen: Entry[], st: S, begun: () => void): Promise<Step> {
    const ask = run.ask;
    const on: Emit = (kind, text, fresh) => {
      if (!run.abort.signal.aborted) {
        live_push(seen, kind, text, fresh);
        run.on({ $: "Delta", kind, text, fresh });
      }
    };
    try {
      for await (const ev of Agent.events(body)) {
        timer.refresh();
        if (wire.begun(ev)) {
          begun();
        }
        if (wire.read(st, ev, on)) {
          const step = wire.step(st, ask);
          return step.stop === "fail" || step.stop === "busy" || step.stop === "limit" ? Agent.fail(step.why, seen, step.stop) : step;
        }
      }
      return Agent.fail("the stream ended early", seen, "busy");
    } catch (err: any) {
      return Agent.fail(err.message, seen, "busy");
    }
  }

  export function fail(why: string, seen: Entry[], stop: Step["stop"] = "lost"): Step {
    const mark = "\n[cut off: " + (stop === "busy" || stop === "limit" ? BUSY : why).slice(0, 300) + "]";
    const entries = seen.filter((e) => e.text.trim()).map((e) => ({ kind: e.kind, text: e.text.trim() + mark }));
    return { out: [], uses: [], entries, stop, why, note: "" };
  }

  export async function* events(stream: ReadableStream<Uint8Array>) {
    for await (const line of AskAI.lines(stream)) {
      if (line.startsWith("data:") && line.slice(5).trim() !== "[DONE]") {
        yield JSON.parse(line.slice(5));
      }
    }
  }

  // null: not JSON
  export function parse(json: string): unknown {
    try {
      return JSON.parse(json || "{}");
    } catch {
      return null;
    }
  }

  // Tools
  // -----

  export async function use(run: Doing, tools: Tool[], use: Use): Promise<Out> {
    if (!tools.some((t) => t.name === use.name)) {
      return { text: "No tool " + use.name + ".", fail: true };
    }
    if (use.input === null || typeof use.input !== "object") {
      return { text: "The input is not a JSON object.", fail: true };
    }
    try {
      const out = await Agent.call(run, use.name, use.input);
      return { ...out, text: out.text || "(no output)" };
    } catch (err: any) {
      const why = run.abort.signal.aborted ? "(stopped)" : err.message;
      return { text: why, fail: true };
    }
  }

  // the call's tools, and the notes their listing gave it (Tools.answer)
  export async function server(run: Doing): Promise<{ tools: Tool[]; notes: string[] }> {
    if (!run.ask.server) {
      return { tools: [], notes: [] };
    }
    const list = await Agent.rpc(run, "tools/list", {});
    const tools = list.tools.map((t: any) => ({ name: t.name, info: t.description, schema: t.inputSchema }));
    return { tools, notes: Array.isArray(list.notes) ? list.notes.map(String) : [] };
  }

  export async function call(run: Doing, name: string, input: unknown): Promise<Out> {
    const res = await Agent.rpc(run, "tools/call", { name, arguments: input });
    const pics = res.content.filter((part: any) => part.type === "image");
    const imgs = pics.map((part: any) => ({ type: part.mimeType, data: part.data }));
    return { text: AskAI.show(res.content), fail: res.isError === true, imgs };
  }

  export async function rpc(run: Doing, method: string, params: unknown): Promise<any> {
    const res = await fetch(run.ask.server, {
      method  : "POST",
      headers : { "content-type": "application/json" },
      body    : JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal  : run.abort.signal,
      timeout : false,
    } as RequestInit);
    const msg = await res.json();
    if (msg.error) {
      throw new Error(method + ": " + msg.error.message);
    }
    return msg.result;
  }

}
