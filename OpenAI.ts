import type { Ask, Img } from "./AskAI.ts";
import { Agent, type Emit, type Entry, type Item, type Step, type Tool, type Use, type Wire } from "./Agent.ts";
import * as config from "./Config.ts";
import { get, str, text_of } from "./Json.ts";

type Content = { type: string; text?: string; refusal?: string; annotations?: { type: string; title?: string; url?: string }[] };

export type Output = { type: string; call_id?: string; name?: string; arguments?: string; summary?: { text: string }[]; content?: Content[]; action?: unknown };

type Fail = { code?: string; message?: string } | null;

type Usage = { input_tokens?: unknown; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: unknown } };

type Res = { status?: string; error?: Fail; output?: Output[]; usage?: Usage; service_tier?: string; incomplete_details?: { reason?: string } };

export type Event = { type: string; delta?: string; item?: Output; response?: Res; error?: Fail; code?: string; message?: string; summary_index?: number; output_index?: number };

export type State = { res: Res | null; error: Fail };

const TIERS: Record<string, string> = { slow: "default", fast: "fast", ultrafast: "ultrafast" };

const MARK = { mode: "explicit" };

const TRANSCRIBER = "gpt-transcribe";

export namespace OpenAI {

  export function body(ask: Ask, items: Item[], tools: Tool[], max: number) {
    const tier = TIERS[ask.speed];
    if (!tier) {
      throw new Error("OpenAI has no speed " + ask.speed);
    }
    const defs: object[] = tools.map((t) => ({ type: "function", name: t.name, description: t.info, parameters: t.schema }));
    if (ask.searches > 0) {
      defs.push({ type: "web_search" });
    }
    const system = { role: "developer", content: [{ type: "input_text", text: ask.system }] };
    const cache = ask.blocks[ask.blocks.length - 1]?.mark ? undefined : { mode: "explicit" };
    return {
      model                : ask.model,
      stream               : true,
      store                : false,
      tools                : defs,
      reasoning            : { effort: ask.effort, summary: "auto", context: "all_turns" },
      max_output_tokens    : max,
      max_tool_calls       : ask.searches || undefined,
      service_tier         : tier,
      prompt_cache_options : cache,
      prompt_cache_key     : OpenAI.session(ask),
      input                : [system, ...items.flatMap(OpenAI.input)],
    };
  }

  export function session(ask: Ask): string {
    return "unii-" + Bun.hash(JSON.stringify([OpenAI.sharer(ask), ask.model, ask.system])).toString(36);
  }

  export function sharer(ask: Ask): string {
    return ask.agent === true ? "sub" : ask.who ?? "main";
  }

  export function input(item: Item): unknown[] {
    switch (item.$) {
      case "User": {
        const texts = item.parts.map((p) => ({ type: "input_text", text: p.text, prompt_cache_breakpoint: p.mark ? MARK : undefined }));
        return [{ role: "user", content: [...texts, ...item.imgs.map(OpenAI.image)] }];
      }
      case "Turn": {
        return item.out;
      }
      case "Back": {
        return item.backs.map((b) => {
          const output = [{ type: "input_text", text: b.out.text }, ...(b.out.imgs ?? []).map(OpenAI.image)];
          return { type: "function_call_output", call_id: b.id, output };
        });
      }
    }
  }

  export function image(img: Img): unknown {
    return { type: "input_image", image_url: "data:" + img.type + ";base64," + img.data };
  }

  export function read(st: State, ev: Event, on: Emit): boolean {
    switch (ev.type) {
      case "response.output_text.delta": {
        on("unii", ev.delta ?? "");
        return false;
      }
      case "response.output_item.added": {
        OpenAI.live(ev.item ?? { type: "" }, on);
        return false;
      }
      // a search's query comes only with its item done
      case "response.output_item.done": {
        if (ev.item?.type === "web_search_call") {
          on("tool", JSON.stringify(ev.item.action ?? {}));
        }
        return false;
      }
      case "response.function_call_arguments.delta": {
        on("tool", ev.delta ?? "");
        return false;
      }
      case "response.reasoning_summary_text.delta": {
        on("mind", ev.delta ?? "");
        return false;
      }
      case "response.reasoning_summary_part.added": {
        if ((ev.summary_index ?? 0) > 0) {
          on("mind", "\n\n");
        }
        return false;
      }
      case "response.completed":
      case "response.incomplete":
      case "response.failed": {
        st.res = ev.response ?? null;
        return true;
      }
      case "error": {
        st.error = ev.error ?? ev;
        return true;
      }
    }
    return false;
  }

  export function live(item: Output, on: Emit): void {
    if (item.type === "function_call") {
      on("tool", (item.name ?? "") + " ", true);
    }
    if (item.type === "web_search_call") {
      on("tool", "web_search ", true);
    }
  }

  export function tier(res: Res): string {
    const tier = res.service_tier === "priority" ? "fast" : res.service_tier;
    return tier !== undefined && tier in TIERS ? tier : "slow";
  }

  export function step(st: State, ask: Ask): Step {
    const res: Res = st.res ?? { status: "failed", error: st.error, output: [] };
    const u = res.usage;
    if (typeof u?.input_tokens === "number") {
      const read = u.input_tokens_details?.cached_tokens ?? 0;
      const told = u.input_tokens_details?.cache_write_tokens;
      const write = typeof told === "number" ? told : null;
      Agent.cached(ask, read, write, Math.max(0, u.input_tokens - read - (write ?? 0)));
    }
    const out = res.output ?? [];
    const calls = out.filter((o) => o.type === "function_call");
    const uses: Use[] = calls.map((o) => ({ id: o.call_id ?? "", name: o.name ?? "", input: Agent.parse(o.arguments ?? "") }));
    const ran = OpenAI.tier(res);
    const note = ran !== ask.speed ? "ran at " + ran + " speed" : "";
    const refusals = out.flatMap((o) => (o.type === "message" ? o.content ?? [] : [])).filter((c) => c.type === "refusal");
    const step: Step = { out, uses, entries: out.flatMap(OpenAI.entries), stop: "done", why: "", note };
    if (res.status === "failed") {
      const stop = res.error?.code === "server_error" ? "busy" : res.error?.code === "rate_limit_exceeded" ? "limit" : "fail";
      return { ...step, stop, why: res.error?.message ?? "failed" };
    }
    if (res.status === "incomplete") {
      return { ...step, stop: "fail", why: "incomplete: " + String(res.incomplete_details?.reason) };
    }
    if (refusals.length > 0) {
      return { ...step, stop: "fail", why: "refused: " + refusals.map((c) => c.refusal).join(" ") };
    }
    return { ...step, stop: uses.length > 0 ? "tools" : "done" };
  }

  export function entries(o: Output): Entry[] {
    switch (o.type) {
      case "reasoning": {
        const text = (o.summary ?? []).map((s) => s.text).join("\n\n").trim();
        return text ? [{ kind: "mind", text }] : [];
      }
      case "message": {
        const content = o.content ?? [];
        const text = content.map((c) => c.text ?? "").join("").trim();
        const urls = content.flatMap((c) => c.annotations ?? []).filter((a) => a.type === "url_citation");
        const cited = [...new Set(urls.map((a) => String(a.title) + " " + String(a.url)))];
        const reply: Entry[] = text ? [{ kind: "unii", text }] : [];
        const sources: Entry[] = cited.length > 0 ? [{ kind: "echo", text: "sources:\n" + cited.join("\n") }] : [];
        return [...reply, ...sources];
      }
      case "function_call": {
        return [{ kind: "tool", text: String(o.name) + " " + String(o.arguments), of: o.call_id }];
      }
      case "web_search_call": {
        return [{ kind: "tool", text: "web_search " + JSON.stringify(o.action ?? {}) }];
      }
    }
    return [];
  }

  export async function transcribe(audio: Blob): Promise<{ text: string | undefined }> {
    if (!config.KEYS.openai) {
      throw new Error("Voice needs an OpenAI key");
    }
    const form = new FormData();
    form.append("model", TRANSCRIBER);
    form.append("file", audio, "voice." + audio.type.split(/[/;]/)[1]);
    const init = { method: "POST", headers: { authorization: "Bearer " + config.KEYS.openai }, body: form };
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", init);
    const out: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error("Transcription failed: " + text_of(get(get(out, "error"), "message"), "HTTP " + res.status));
    }
    return { text: str(get(out, "text")) };
  }

  export const wire: Wire<State, Event> = {
    key     : "openai",
    idle    : 1200e3,
    url     : "https://api.openai.com/v1/responses",
    headers : (key) => ({ authorization: "Bearer " + key, "content-type": "application/json" }),
    body    : OpenAI.body,
    start   : () => ({ res: null, error: null }),
    read    : OpenAI.read,
    begun   : (ev) => ev.type === "response.output_item.added",
    step    : OpenAI.step,
  };

}
