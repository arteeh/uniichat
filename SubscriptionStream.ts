import type { Emit, Entry, Step, Use } from "./Agent.ts";
import type { Ask } from "./AskAI.ts";
import type { SubscriptionApi } from "./SubscriptionModels.ts";
import { object, text, type Obj } from "./SubscriptionRequest.ts";

const CONTEXT = "Subscription context window exceeded";

export type State = {
  api: SubscriptionApi; allowed: Set<string>; done: boolean; error: string;
  finish: string; blocks: Map<number, Obj>; output: unknown[] | null;
  responseCalls: Set<string>; usage: Obj | null;
};
export function start(api: SubscriptionApi, allowed: Set<string>): State {
  return { api, allowed, done: false, error: "", finish: "", blocks: new Map(), output: null, responseCalls: new Set(), usage: null };
}
function fail(why: string): Step {
  // Native memory treats `fail` as a compressible context failure and clips it.
  // Protocol/auth/service failures must instead wait/stop, never create a summary.
  return { out: [], uses: [], entries: [], stop: why === CONTEXT ? "fail" : "down", off: why !== CONTEXT, why, note: "" };
}
function index(x: unknown): number {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0 || x > 1024) throw new Error("invalid subscription stream index");
  return x;
}
function ordered<T>(map: Map<number, T>): T[] {
  return [...map.entries()].sort(([a], [b]) => a - b).map(([k, value], i) => {
    if (k !== i) throw new Error("incomplete subscription output indices");
    return value;
  });
}
function responses(st: State, ev: Obj, on: Emit): void {
  switch (ev.type) {
    case "response.output_text.delta": on("unii", text(ev.delta)); break;
    case "response.reasoning_summary_text.delta": on("mind", text(ev.delta)); break;
    case "response.function_call_arguments.delta": on("tool", text(ev.delta)); break;
    case "response.output_item.added": {
      const item = object(ev.item);
      if (item.type === "function_call") {
        st.responseCalls.add(text(item.call_id));
        on("tool", text(item.name) + " ", true);
      }
      break;
    }
    case "response.output_item.done": {
      const item = object(ev.item);
      st.blocks.set(index(ev.output_index), item);
      break;
    }
    case "response.completed": {
      const res = object(ev.response);
      if (res.status !== "completed" || res.error) throw new Error("subscription response is not completed");
      if (res.output !== undefined && !Array.isArray(res.output)) throw new Error("invalid subscription response output");
      st.output = res.output === undefined ? ordered(st.blocks) : res.output as unknown[];
      st.usage = res.usage === undefined ? null : object(res.usage);
      st.finish = "completed";
      st.done = true;
      break;
    }
    case "response.incomplete": case "response.failed": case "error": {
      const body = ev.type === "error" ? ev : object(ev.response);
      const error = body.error === undefined ? body : object(body.error);
      if (typeof error.code === "string" && ["context_length_exceeded", "model_context_window_exceeded"].includes(error.code)) {
        st.error = CONTEXT;
        st.done = true;
        break;
      }
      throw new Error("subscription response incomplete or failed");
    }
  }
}
export function read(st: State, event: unknown, on: Emit): boolean {
  if (st.done) return true;
  try {
    const ev = object(event);
    if (typeof ev.type !== "string") throw new Error("invalid subscription event");
    responses(st, ev, on);
  } catch {
    // Never leak server-provided error bodies, opaque reasoning, arguments or
    // a credential echoed by the server into error messages/logs.
    st.error = "invalid, incomplete or unsupported subscription stream";
    st.done = true;
  }
  return st.done;
}
function use(st: State, ids: Set<string>, id: unknown, name: unknown, input: unknown): Use {
  const i = text(id), n = text(name);
  if (!i.trim() || !n.trim() || ids.has(i) || !st.allowed.has(n)) throw new Error("invalid subscription tool identity");
  const value = object(input); // Reject null, arrays, primitives, malformed JSON.
  ids.add(i);
  return { id: i, name: n, input: value };
}
function finish(st: State): Step {
  if (!st.done || st.error) return fail(st.error || "subscription stream did not finish");
  const uses: Use[] = [], entries: Entry[] = [], ids = new Set<string>();
  if (st.finish !== "completed" || !st.output) throw new Error("incomplete subscription response");
  const out = st.output;
    for (const item of out) {
      const b = object(item);
      if (b.status !== undefined && b.status !== "completed") throw new Error("unfinished subscription output item");
      if (b.type === "function_call") {
        const input: unknown = JSON.parse(text(b.arguments));
        const u = use(st, ids, b.call_id, b.name, input);
        uses.push(u);
        entries.push({ kind: "tool", text: u.name + " " + text(b.arguments), of: u.id });
      } else if (b.type === "message") {
        if (b.role !== undefined && b.role !== "assistant") throw new Error("invalid subscription output role");
        if (!Array.isArray(b.content)) throw new Error("invalid subscription output content");
        let say = "";
        for (const c of b.content) {
          const part = object(c);
          if (part.type !== "output_text") throw new Error("unsupported or refused subscription output");
          say += text(part.text);
        }
        if (say.trim()) entries.push({ kind: "unii", text: say });
      } else if (b.type === "reasoning") {
        if (b.encrypted_content !== undefined) text(b.encrypted_content);
        if (b.summary !== undefined) {
          if (!Array.isArray(b.summary)) throw new Error("invalid subscription reasoning summary");
          const summary = b.summary.map((s) => text(object(s).text)).join("\n\n");
          if (summary.trim()) entries.push({ kind: "mind", text: summary });
        }
      } else throw new Error("unsupported subscription output item");
    }
    for (const id of st.responseCalls) if (!ids.has(id)) throw new Error("unfinished subscription tool call");
  if (!uses.length && !entries.some((e) => e.kind === "unii" && e.text.trim())) return fail("subscription returned no text or tool calls");
  return { out, uses, entries, stop: uses.length ? "tools" : "done", why: "", note: "" };
}
export function step(st: State, ask: Ask): Step {
  try {
    const result = finish(st);
    if ((result.stop === "done" || result.stop === "tools") && st.usage) {
      const input = st.usage.input_tokens;
      if (typeof input === "number" && Number.isFinite(input) && input >= 0) {
        const read = st.usage.cache_read_input_tokens, write = st.usage.cache_creation_input_tokens;
        ask.used?.(input + (typeof read === "number" ? read : 0) + (typeof write === "number" ? write : 0));
      }
    }
    return result;
  } catch {
    return fail("invalid, incomplete or unsupported subscription output");
  }
}
