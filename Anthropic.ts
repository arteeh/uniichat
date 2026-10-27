import type { Ask, Block, Img } from "./AskAI.ts";
import { get } from "./Json.ts";
import { Agent, type Emit, type Entry, type Item, type Step, type Tool, type Use, type Wire } from "./Agent.ts";

type Content = {
  type         : string;
  text?        : string;
  thinking?    : string;
  signature?   : string | null;
  citations?   : unknown;
  id?          : string;
  name?        : string;
  input?       : unknown;
  content?     : unknown;
  tool_use_id? : string;
};

type Usage = { input_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown; speed?: unknown };

type Delta = { type: string; thinking?: string; text?: string; signature?: string; partial_json?: string; citation?: unknown };

type Event = {
  type           : string;
  index?         : number;
  message?       : { usage?: Usage };
  content_block? : Content;
  delta?         : Delta & { stop_reason?: string | null; stop_details?: { explanation?: string | null } | null };
  usage?         : Usage;
  error?         : { type: string; message: string };
};

type State = {
  blocks : Content[];
  json   : string[];
  stop   : string;
  why    : { explanation?: string | null } | null;
  speed  : string;
  error  : { type: string; message: string } | null;
  used   : { read: number; write: number; input: number } | null;
};

type Message = { role: string; content: unknown[] };

const HOUR  = { type: "ephemeral", ttl: "1h" };
const WEB   = { type: "web_search_20260318", name: "web_search" };
const FAST  = "fast-mode-2026-02-01";

export namespace Anthropic {

  export function headers(key: string, ask: Ask): Record<string, string> {
    const out: Record<string, string> = {
      "x-api-key"         : key,
      "anthropic-version" : "2023-06-01",
      "content-type"      : "application/json",
    };
    if (ask.speed === "fast") {
      out["anthropic-beta"] = FAST;
    }
    return out;
  }

  export function body(ask: Ask, items: Item[], tools: Tool[], max: number): unknown {
    const defs: object[] = tools.map((t) => ({ name: t.name, description: t.info, input_schema: t.schema, eager_input_streaming: true }));
    if (ask.searches > 0) {
      defs.push({ ...WEB, max_uses: ask.searches });
    }
    const messages: Message[] = [];
    for (const item of items) {
      const msg = Anthropic.message(item, ask.talk === true && item === items[0]);
      const top = messages[messages.length - 1];
      if (top?.role === msg.role) {
        top.content.push(...msg.content);
      } else {
        messages.push(msg);
      }
    }
    const cache = ask.blocks[ask.blocks.length - 1]?.mark ? HOUR : undefined;
    return {
      model         : ask.model,
      max_tokens    : max,
      stream        : true,
      system        : [{ type: "text", text: ask.system, cache_control: HOUR }],
      thinking      : { type: "adaptive", display: "summarized" },
      output_config : { effort: ask.effort },
      cache_control : cache,
      tools         : defs.length > 0 ? defs : undefined,
      speed         : ask.speed === "fast" ? "fast" : undefined,
      messages,
    };
  }

  export function message(item: Item, talk = false): Message {
    switch (item.$) {
      case "User": {
        const last = item.parts.length - 1;
        const marked = (p: Block, k: number) => (talk ? (p.mark && k < last) || p.back === true : p.mark);
        const texts = item.parts.map((p, k) => ({ type: "text", text: p.text, cache_control: marked(p, k) ? HOUR : undefined }));
        return { role: "user", content: [...texts, ...item.imgs.map(Anthropic.image)] };
      }
      case "Turn": {
        return { role: "assistant", content: [...item.out] };
      }
      case "Back": {
        const content = item.backs.map((b) => ({
          type         : "tool_result",
          tool_use_id : b.id,
          content     : Anthropic.content([b.out.text], b.out.imgs ?? []),
          is_error    : b.out.fail,
        }));
        return { role: "user", content };
      }
    }
  }

  export function content(texts: string[], imgs: Img[]): object[] {
    const blocks = texts.filter((text) => text !== "").map((text) => ({ type: "text", text }));
    return [...blocks, ...imgs.map(Anthropic.image)];
  }

  export function image(img: Img): object {
    return { type: "image", source: { type: "base64", media_type: img.type, data: img.data } };
  }

  export function read(st: State, ev: Event, on: Emit): boolean {
    switch (ev.type) {
      case "message_start": {
        Anthropic.usage(st, ev.message?.usage ?? {});
        st.used = Anthropic.used(ev.message?.usage ?? {});
        return false;
      }
      case "content_block_start": {
        st.blocks[ev.index ?? 0] = { type: "", ...ev.content_block };
        Anthropic.live(ev, on);
        return false;
      }
      case "content_block_delta": {
        Anthropic.delta(st, ev.index ?? 0, ev.delta ?? { type: "" });
        Anthropic.live(ev, on);
        return false;
      }
      case "message_delta": {
        st.stop = ev.delta?.stop_reason ?? st.stop;
        st.why  = ev.delta?.stop_details ?? st.why;
        Anthropic.usage(st, ev.usage ?? {});
        return false;
      }
      case "error": {
        st.error = ev.error ?? null;
        return true;
      }
    }
    return ev.type === "message_stop";
  }

  export function used(u: Usage): State["used"] {
    const n = (x: unknown) => (typeof x === "number" ? x : 0);
    return typeof u.input_tokens === "number" ? { read: n(u.cache_read_input_tokens), write: n(u.cache_creation_input_tokens), input: u.input_tokens } : null;
  }

  export function usage(st: State, u: Usage): void {
    st.speed = u.speed === undefined ? st.speed : u.speed === "fast" ? "fast" : "slow";
  }

  export function delta(st: State, k: number, delta: Delta): void {
    const block = st.blocks[k];
    switch (delta.type) {
      case "thinking_delta": {
        block.thinking = (block.thinking ?? "") + (delta.thinking ?? "");
        return;
      }
      case "text_delta": {
        block.text = (block.text ?? "") + (delta.text ?? "");
        return;
      }
      case "signature_delta": {
        block.signature = delta.signature;
        return;
      }
      case "input_json_delta": {
        st.json[k] = (st.json[k] ?? "") + (delta.partial_json ?? "");
        return;
      }
      case "citations_delta": {
        const had: unknown[] = Array.isArray(block.citations) ? block.citations : [];
        block.citations = [...had, delta.citation];
        return;
      }
    }
  }

  export function live(ev: { type: string; content_block?: { type: string; name?: string }; delta?: Partial<Delta> & { stop_reason?: unknown } }, on: Emit): void {
    const block = ev.content_block;
    const delta = ev.delta;
    if (ev.type === "content_block_start" && block?.type.endsWith("tool_use") === true) {
      on("tool", (block.name ?? "") + " ", true);
    }
    if (delta?.type === "thinking_delta") {
      on("mind", delta.thinking ?? "");
    }
    if (delta?.type === "text_delta") {
      on("unii", delta.text ?? "");
    }
    if (delta?.type === "input_json_delta") {
      on("tool", delta.partial_json ?? "");
    }
  }

  export function step(st: State, ask: Ask): Step {
    if (st.used !== null) {
      Agent.cached(ask, st.used.read, st.used.write, st.used.input);
    }
    const uses: Use[] = [];
    st.blocks.forEach((b, k) => {
      if (st.json[k] !== undefined) {
        b.input = Agent.parse(st.json[k]);
      }
      if (b.type === "tool_use") {
        uses.push({ id: b.id ?? "", name: b.name ?? "", input: b.input });
      }
      if (b.input === null) {
        b.input = {};
      }
    });
    const out = st.blocks.filter((b) => b.type !== "text" || b.text);
    const slow = ask.speed === "fast" && st.speed !== "fast";
    const note = slow ? "ran at " + st.speed + " speed" : "";
    const step: Step = { out, uses, entries: Anthropic.entries(out), stop: "done", why: "", note };
    if (st.error !== null) {
      return { ...step, stop: st.error.type === "rate_limit_error" ? "limit" : "busy", why: st.error.type + ": " + st.error.message };
    }
    switch (st.stop) {
      case "end_turn":
      case "tool_use": {
        return { ...step, stop: uses.length > 0 ? "tools" : "done" };
      }
      case "pause_turn": {
        return { ...step, stop: "again" };
      }
    }
    const why = st.why?.explanation;
    return { ...step, stop: "fail", why: "stopped: " + st.stop + (why ? " (" + why + ")" : "") };
  }

  export function entries(out: Content[]): Entry[] {
    const entries: Entry[] = [];
    for (const b of out) {
      const entry = Anthropic.entry(b);
      const top = entries[entries.length - 1];
      if (entry?.kind === "unii" && top?.kind === "unii") {
        top.text += entry.text;
      } else if (entry !== null) {
        entries.push(entry);
      }
    }
    return entries.map((e) => ({ ...e, text: e.text.trim() })).filter((e) => e.text);
  }

  export function entry(b: Content): Entry | null {
    const c = b.content;
    switch (b.type) {
      case "text": {
        return { kind: "unii", text: b.text ?? "" };
      }
      case "thinking": {
        return { kind: "mind", text: b.thinking ?? "" };
      }
      case "tool_use":
      case "server_tool_use": {
        return { kind: "tool", text: (b.name ?? "") + " " + JSON.stringify(b.input), of: b.id };
      }
    }
    return b.type.endsWith("_tool_result") ? Anthropic.server_echo(c, b.tool_use_id) : null;
  }

  export function server_echo(content: unknown, of: string | undefined): Entry {
    return { kind: "echo", text: Anthropic.result_text(content) || "(no output)", of };
  }

  export function result_text(c: unknown): string {
    if (Array.isArray(c)) {
      return c.map((r: unknown) => String(get(r, "title")) + " " + String(get(r, "url"))).join("\n");
    }
    const stderr = get(c, "stderr");
    const err = typeof stderr === "string" ? stderr : "";
    if (String(get(c, "type")).startsWith("encrypted")) {
      return ("(output encrypted by the API)\n" + err).trim();
    }
    const stdout = get(c, "stdout");
    if (typeof stdout === "string") {
      return (stdout + err).trim();
    }
    return JSON.stringify(c);
  }

  export const wire: Wire<State, Event> = {
    key     : "anthropic",
    idle    : 300e3,
    url     : "https://api.anthropic.com/v1/messages",
    headers : Anthropic.headers,
    body    : Anthropic.body,
    start   : () => ({ blocks: [], json: [], stop: "", why: null, speed: "slow", error: null, used: null }),
    read    : Anthropic.read,
    begun   : (ev) => ev.type === "message_start",
    step    : Anthropic.step,
  };

}
