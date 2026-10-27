import { AskAI, type Ask, type Block, type Flight, type Try, type End, type Event, type Img, type Kind } from "./AskAI.ts";
import { Anthropic } from "./Anthropic.ts";
import { OpenAI } from "./OpenAI.ts";
import { ChatGPT } from "./ChatGPT.ts";
import { Limit } from "./Limit.ts";
import { live_push } from "./View.ts";
import { Machine, type Spec } from "./Machine.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get } from "./Json.ts";

export type Out = { text: string; fail: boolean; imgs?: Img[] };

export type Tool = Spec;

type Doing = {
  ask   : Ask;
  on    : (ev: Event) => void;
  abort : AbortController;
  end   : End;
  limit : Limit;
};

type Back = { id: string; out: Out };

type Room = { holders: number; retrying: number; wait: Array<() => void> };

type Seat = { model: string; room: string; yields: boolean; held: boolean };

export type Item =
  | { $: "User"; parts: Block[]; imgs: Img[] }
  | { $: "Turn"; out: unknown[] }
  | { $: "Back"; backs: Back[] };

export type Use = { id: string; name: string; input: unknown };

export type Entry = { kind: Kind; text: string; of?: string };

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

export type Refusal = { why: string; say: string; until?: number };

export type Emit = (kind: Kind, text: string, fresh?: boolean) => void;

type Part = { type: string; text?: string; mimeType?: string; data?: string };

type Listed = { tools: { name: string; description: string; inputSchema: object }[]; notes?: unknown };

type Called = { content: Part[]; isError?: boolean };

type Rpc = { "tools/list": Listed; "tools/call": Called };

export type Wire<S, E> = {
  key     : string;
  auth?   : (refused: string | undefined) => Promise<string>;
  refusal?: (res: Response, body: string) => Refusal | null;
  reset?  : (res: Response, body: string) => number | null;
  idle    : number;
  url     : string;
  headers : (key: string, ask: Ask) => Record<string, string>;
  body    : (ask: Ask, items: Item[], tools: Tool[], max: number) => unknown;
  start   : (ask: Ask) => S;
  read    : (st: S, ev: E, on: Emit) => boolean;
  begun   : (ev: E) => boolean;
  step    : (st: S, ask: Ask) => Step;
};

const MAX   = 128000;
export const TRIES = 8;

// a request refused for the vendor account, not for what it asks: by its
// status (a bad key, billing, no access, no such model) or its error
// (the credit or quota gone, Anthropic's a 400, OpenAI's a 429)
const OFF   = [401, 402, 403, 404];
const SPENT = /insufficient_quota|billing_hard_limit_reached|credit balance is too low/i;

export const BUSY  = "the AI service is busy or unavailable right now";

export const TOO_LONG = /prompt is too long|context.length|context (limit|window)|model_context_window_exceeded|too many (input )?tokens/i;

const ROOMS = new Map<string, Room>();

export namespace Agent {

  export function cached(ask: Ask, read: number, write: number | null, input: number): void {
    console.error("cache " + ask.vendor + " " + ask.model + " " + (ask.who ?? "main") + ": read " + read + (write === null ? "" : ", write " + write) + ", uncached " + input);
  }

  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const abort = new AbortController();
    const run: Doing = { ask, on, abort, end, limit: Limit.make(ask, on, abort.signal) };
    const wake = () => run.limit.poke();
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
      } catch (err) {
        end.text ||= err_why(err);
      }
      end.ok = end.ok && !run.abort.signal.aborted;
      return end;
    })();
    return { wake, stop, done };
  }

  export async function loop<S, E>(wire: Wire<S, E>, run: Doing): Promise<void> {
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
      Agent.entries_queued_till_started(step).forEach(on);
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
      if (backs.length === 0) {
        end.ok   = true;
        end.text = step.entries.filter((e) => e.kind === "unii").map((e) => e.text).join("\n\n");
        return;
      }
      items.push({ $: "Back", backs });
    }
  }

  export async function step<S, E>(wire: Wire<S, E>, run: Doing, key: string, make: (max: number) => unknown, items: Item[]): Promise<Step> {
    const signal = run.abort.signal;
    const model = run.ask.model;
    const seat = Agent.seat(run.ask);
    const tries = run.ask.probe === true && items.length === 1 ? 1 : TRIES;
    let refused: string | undefined;
    try {
      run.limit.n = run.ask.limits ?? 0;
      for (let k = 0; !signal.aborted; ) {
        await Agent.give_way(seat, signal);
        const seen: Entry[] = [];
        const token = await Agent.unless_stopped(Agent.token(wire, key, refused), signal);
        if (token === null) {
          return Agent.fail("stopped", seen);
        }
        const sent = typeof token === "string" ? Agent.request(wire, run, token, make(MAX), seen) : Promise.resolve({ res: null, step: token });
        const got = await Agent.unless_stopped(sent, signal);
        if (got === null) {
          return Agent.fail("stopped", seen);
        }
        const { res, step } = got;
        if (res?.status === 401 && wire.auth && refused === undefined && typeof token === "string") {
          refused = token;
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
        if (Agent.import_seated_elsewhere(seat)) {
          continue;
        }
        Agent.take_seat(seat, step.why);
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
      Agent.leave_seat(seat);
    }
  }

  export function entries_queued_till_started(step: Step): Event[] {
    const ours = new Set(step.uses.map((use) => use.id));
    return step.entries.map((entry) => ({ $: "Entry", ...entry, ...(entry.kind === "tool" && entry.of !== undefined && ours.has(entry.of) ? { queued: true } : {}) }));
  }

  export function unless_stopped<T>(go: Promise<T>, signal: AbortSignal): Promise<T | null> {
    go.catch(() => {});
    let drop = () => {};
    const stopped = new Promise<null>((done) => {
      const stop = () => done(null);
      signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
      drop = () => signal.removeEventListener("abort", stop);
    });
    return Promise.race([go, stopped]).finally(drop);
  }

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

  export async function token<S, E>(wire: Wire<S, E>, key: string, refused: string | undefined): Promise<string | Step> {
    if (wire.auth === undefined) {
      return key;
    }
    try {
      return await wire.auth(refused);
    } catch (err) {
      if (!(err instanceof Error && "busy" in err && err.busy === true)) {
        throw err;
      }
      return Agent.fail(err.message, [], "busy");
    }
  }

  export function room(key: string): Room {
    const room = ROOMS.get(key) ?? { holders: 0, retrying: 0, wait: [] };
    ROOMS.set(key, room);
    return room;
  }

  export function seat(ask: Ask): Seat {
    const yields = ask.yields !== undefined;
    return { model: ask.model, room: yields ? ask.model + " " + ask.yields : ask.model, yields, held: false };
  }

  export function import_seated_elsewhere(seat: Seat): boolean {
    return seat.yields && !seat.held && (ROOMS.get(seat.room)?.holders ?? 0) > 0;
  }

  export function take_seat(seat: Seat, why: string): void {
    if (seat.held) {
      return;
    }
    seat.held = true;
    if (Agent.room(seat.model).retrying++ === 0) {
      console.error(seat.model + ": " + why.slice(0, 300) + ": its requests ask again");
    }
    Agent.room(seat.room).holders += 1;
  }

  export function leave_seat(seat: Seat): void {
    if (!seat.held) {
      return;
    }
    seat.held = false;
    const room = Agent.room(seat.room);
    room.holders -= 1;
    if (room.holders === 0) {
      room.wait.splice(0).forEach((ok) => ok());
    }
    if (--Agent.room(seat.model).retrying === 0) {
      console.error(seat.model + ": none asks again");
    }
    for (const key of [seat.room, seat.model]) {
      if (ROOMS.get(key)?.holders === 0 && ROOMS.get(key)?.retrying === 0) {
        ROOMS.delete(key);
      }
    }
  }

  export async function give_way(seat: Seat, signal: AbortSignal): Promise<void> {
    const before = !seat.yields ? [] : seat.held ? [seat.model] : [seat.model, seat.room];
    for (;;) {
      const room = before.map((key) => ROOMS.get(key)).find((room) => (room?.holders ?? 0) > 0);
      if (room === undefined || signal.aborted) {
        return;
      }
      await Agent.unless_stopped(new Promise<void>((ok) => room.wait.push(ok)), signal);
    }
  }

  export async function request<S, E>(wire: Wire<S, E>, run: Doing, key: string, body: unknown, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
    const flight = await AskAI.single_flight(run.ask);
    if (run.abort.signal.aborted) {
      flight.end();
      return { res: null, step: Agent.fail("stopped", []) };
    }
    return Agent.send(wire, run, key, body, flight, seen);
  }

  export async function send<S, E>(wire: Wire<S, E>, run: Doing, key: string, body: unknown, flight: Flight, seen: Entry[]): Promise<{ res: Response | null; step: Step }> {
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
      step = text !== null || res.body === null ? { ...Agent.fail(why, [], stop), off, refusal: refusal ?? undefined, until } : await Agent.stream(wire, run, res.body, timer, seen, st, flight.begun);
    } catch (err) {
      step = Agent.fail(err_why(err), [], "busy");
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
      const json: unknown = JSON.parse(body);
      const why = get(get(json, "error"), "message") ?? get(json, "detail");
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

  export async function stream<S, E>(wire: Wire<S, E>, run: Doing, body: ReadableStream<Uint8Array>, timer: Timer, seen: Entry[], st: S, begun: () => void): Promise<Step> {
    const ask = run.ask;
    const on: Emit = (kind, text, fresh) => {
      if (!run.abort.signal.aborted) {
        live_push(seen, kind, text, fresh);
        run.on({ $: "Delta", kind, text, fresh });
      }
    };
    try {
      for await (const data of Agent.events(body)) {
        const ev = JSON.parse(data) as E;
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
    } catch (err) {
      return Agent.fail(err_why(err), seen, "busy");
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
        yield line.slice(5);
      }
    }
  }

  export function parse(json: string): unknown {
    try {
      return JSON.parse(json || "{}") as unknown;
    } catch {
      return null;
    }
  }

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
    } catch (err) {
      const why = run.abort.signal.aborted ? "(stopped)" : err_why(err);
      return { text: why, fail: true };
    }
  }

  export async function server(run: Doing): Promise<{ tools: Tool[]; notes: string[] }> {
    if (!run.ask.server) {
      return { tools: [], notes: [] };
    }
    const list = await Agent.rpc(run, "tools/list", {});
    const tools = list.tools.map((t) => ({ name: t.name, info: t.description, schema: t.inputSchema }));
    return { tools, notes: Array.isArray(list.notes) ? list.notes.map(String) : [] };
  }

  export async function call(run: Doing, name: string, input: unknown): Promise<Out> {
    const res = await Agent.rpc(run, "tools/call", { name, arguments: input });
    const imgs = res.content.flatMap((part) => (part.type === "image" ? [{ type: part.mimeType ?? "", data: part.data ?? "" }] : []));
    return { text: AskAI.show(res.content), fail: res.isError === true, imgs };
  }

  export async function rpc<M extends keyof Rpc>(run: Doing, method: M, params: unknown): Promise<Rpc[M]> {
    const res = await fetch(run.ask.server, {
      method  : "POST",
      headers : { "content-type": "application/json" },
      body    : JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal  : run.abort.signal,
      timeout : false,
    } as RequestInit);
    const msg = (await res.json()) as { result: Rpc[M]; error?: { message: string } };
    if (msg.error) {
      throw new Error(method + ": " + msg.error.message);
    }
    return msg.result;
  }

}
