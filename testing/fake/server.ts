import * as crypto from "node:crypto";
import { get, list, str } from "../../Json.ts";
import { CASES, type Kind, type Vendor } from "./cases.ts";

export type Order =
  | { what: "reply"; text: string }
  | { what: "tool"; calls: Array<[string, unknown]> }
  | { what: "error"; kind: Kind; reset: number }
  | { what: "stall"; ms: number }
  | { what: "cut" };

type Said = { role: string; text: string; marked: boolean };

type Seen = { n: number; at: string; vendor: string; path: string; model: string; answer: string; system: string; tools: string[]; said: Said[]; latest: string; body: unknown };

type Used = { input: number; read: number; write: number };

type Sent = { blocks: Array<{ text: string } | { id: string; name: string; json: string }>; stall: number; cut: boolean };

export const CONTROL = 9999;

const QUEUE: Array<Order & { match: string }> = [];
const LOG: Seen[] = [];
const CACHED = new Set<string>();
const LIMITED: Partial<Record<Vendor, number>> = {};
const REFUSE = new Set<string>();
const EMAIL = "tester@example.com";
const ACCOUNT = crypto.randomUUID();
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const id = (prefix: string, n = 24, abc = B62) => prefix + Array.from(crypto.randomBytes(n), (b) => abc[b % abc.length]).join("");
const hex = (prefix: string) => prefix + crypto.randomBytes(25).toString("hex");
const tokens = (s: string) => Math.ceil(s.length / 4);
const secs = () => Math.floor(Date.now() / 1e3);

function text_of(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return list(content).map((b) => str(get(b, "text")) ?? text_of(get(b, "content")) ?? str(get(b, "output")) ?? "").join("\n");
}

function said(vendor: Vendor, body: unknown): { system: string; said: Said[]; segs: string[]; marks: number[] } {
  const segs: string[] = [];
  const marks: number[] = [];
  const add = (x: unknown, marked: boolean) => {
    segs.push(JSON.stringify(x, (k, v: unknown) => (k === "cache_control" || k === "prompt_cache_breakpoint" ? undefined : v)));
    if (marked) {
      marks.push(segs.length - 1);
    }
  };
  const out: Said[] = [];
  if (vendor.startsWith("claude")) {
    add(get(body, "tools") ?? [], false);
    const system = list(get(body, "system"));
    system.forEach((b) => add(b, get(b, "cache_control") !== undefined));
    for (const m of list(get(body, "messages"))) {
      const blocks = typeof get(m, "content") === "string" ? [{ type: "text", text: get(m, "content") }] : list(get(m, "content"));
      blocks.forEach((b) => add(b, get(b, "cache_control") !== undefined));
      out.push({ role: String(get(m, "role")), text: text_of(blocks), marked: blocks.some((b) => get(b, "cache_control") !== undefined) });
    }
    if (get(body, "cache_control") !== undefined && segs.length > 0) {
      marks.push(segs.length - 1);
    }
    return { system: text_of(system), said: out, segs, marks };
  }
  const items = list(get(body, "input"));
  const explicit = items.some((i) => list(get(i, "content")).some((p) => get(p, "prompt_cache_breakpoint") !== undefined));
  add([get(body, "instructions") ?? "", get(body, "tools") ?? []], !explicit);
  for (const i of items) {
    const marked = list(get(i, "content")).some((p) => get(p, "prompt_cache_breakpoint") !== undefined);
    add(i, explicit ? marked : true);
    const role = str(get(i, "role")) ?? str(get(i, "type")) ?? "item";
    out.push({ role, text: text_of(get(i, "content")) || str(get(i, "arguments")) || text_of(get(i, "output")), marked });
  }
  const system = str(get(body, "instructions")) ?? (out[0]?.role === "developer" ? out.shift()?.text ?? "" : "");
  return { system, said: out, segs, marks };
}

// a prompt cache by prefix: each mark caches the request up to it; a later
// request reads its longest cached prefix, and writes from there to its last mark
function cache(segs: string[], marks: number[]): Used {
  const at: number[] = [];
  const keys: string[] = [];
  let h = "";
  let chars = 0;
  for (const s of segs) {
    h = crypto.createHash("sha1").update(h + s).digest("hex");
    chars += s.length;
    keys.push(h);
    at.push(Math.ceil(chars / 4));
  }
  const total = at.at(-1) ?? 0;
  const read = Math.max(0, ...keys.map((k, i) => (CACHED.has(k) ? at[i] : 0)));
  const last = marks.at(-1);
  const write = last === undefined || CACHED.has(keys[last]) ? 0 : at[last] - read;
  marks.forEach((m) => CACHED.add(keys[m]));
  return { input: Math.max(1, total - read - write), read, write };
}

function pick(latest: string, compaction: boolean): Order {
  const k = QUEUE.findIndex((o) => (o.match === "" ? !compaction : latest.includes(o.match)));
  if (k >= 0) {
    return QUEUE.splice(k, 1)[0];
  }
  return { what: "reply", text: compaction ? "Summary: " + latest.slice(0, 80).replace(/\s+/g, " ").trim() : "ok" };
}

function chunks(text: string): string[] {
  return text.match(/(\S+\s*){1,3}|\s+/g) ?? [""];
}

function sse(events: Array<[string, object]>, stall: number, cut: boolean, headers: Record<string, string>): Response {
  const keep = cut ? Math.ceil(events.length / 2) : events.length;
  const stream = new ReadableStream<string>({
    async pull(c) {
      for (const [k, [name, data]] of events.slice(0, keep).entries()) {
        c.enqueue("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n");
        await Bun.sleep(k === 1 && stall > 0 ? stall : 15);
      }
      if (cut) {
        c.error(new Error("cut"));
        return;
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", ...headers } });
}

function limits(vendor: Vendor): Record<string, string> {
  const hours = String(secs() + 3 * 3600);
  const days = String(secs() + 4 * 86400);
  const minute = new Date(Date.now() + 60e3).toISOString().replace(/\.\d+Z$/, "Z");
  switch (vendor) {
    case "claude-sub":
      return {
        "anthropic-ratelimit-unified-status": "allowed", "anthropic-ratelimit-unified-reset": hours, "anthropic-ratelimit-unified-representative-claim": "five_hour",
        "anthropic-ratelimit-unified-5h-status": "allowed", "anthropic-ratelimit-unified-5h-reset": hours, "anthropic-ratelimit-unified-5h-utilization": "0.12",
        "anthropic-ratelimit-unified-7d-status": "allowed", "anthropic-ratelimit-unified-7d-reset": days, "anthropic-ratelimit-unified-7d-utilization": "0.31",
        "anthropic-ratelimit-unified-fallback-percentage": "0.5", "anthropic-ratelimit-unified-overage-status": "rejected", "anthropic-ratelimit-unified-overage-disabled-reason": "org_level_disabled",
      };
    case "claude-api":
      return Object.fromEntries(["requests", "tokens", "input-tokens", "output-tokens"].flatMap((k) => [
        ["anthropic-ratelimit-" + k + "-limit", k === "requests" ? "4000" : "2000000"], ["anthropic-ratelimit-" + k + "-remaining", k === "requests" ? "3999" : "1990000"], ["anthropic-ratelimit-" + k + "-reset", minute],
      ]));
    case "openai-api":
      return { "x-ratelimit-limit-requests": "10000", "x-ratelimit-remaining-requests": "9999", "x-ratelimit-reset-requests": "6ms", "x-ratelimit-limit-tokens": "30000000", "x-ratelimit-remaining-tokens": "29990000", "x-ratelimit-reset-tokens": "20ms" };
    case "openai-sub":
      return {
        "x-codex-primary-used-percent": "12", "x-codex-primary-window-minutes": "300", "x-codex-primary-reset-after-seconds": String(3 * 3600),
        "x-codex-secondary-used-percent": "31", "x-codex-secondary-window-minutes": "10080", "x-codex-secondary-reset-after-seconds": String(4 * 86400),
      };
  }
}

function json(status: number, body: object, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

function anthropic(vendor: Vendor, model: string, sent: Sent, used: Used): Response {
  const events: Array<[string, object]> = [];
  const usage = { input_tokens: used.input, cache_creation_input_tokens: used.write, cache_read_input_tokens: used.read, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: used.write }, output_tokens: 1, service_tier: "standard" };
  events.push(["message_start", { type: "message_start", message: { model, id: id("msg_01"), type: "message", role: "assistant", content: [], stop_reason: null, stop_sequence: null, usage } }]);
  let out = 0;
  sent.blocks.forEach((b, index) => {
    if ("text" in b) {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["ping", { type: "ping" }]);
      chunks(b.text).forEach((text) => events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } }]));
      out += tokens(b.text);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {}, caller: { type: "direct" } } }]);
      events.push(["ping", { type: "ping" }]);
      (b.json.match(/.{1,12}/gs) ?? [""]).forEach((partial_json) => events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } }]));
      out += tokens(b.json);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  const stop_reason = sent.blocks.some((b) => "id" in b) ? "tool_use" : "end_turn";
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { input_tokens: used.input, cache_creation_input_tokens: used.write, cache_read_input_tokens: used.read, output_tokens: out + 1 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return sse(events, sent.stall, sent.cut, { "request-id": id("req_011C"), ...limits(vendor) });
}

function failure(vendor: Vendor, model: string, kind: Kind, reset: number): Response {
  const c = CASES[kind][vendor];
  const at = { model, reset };
  const claude = vendor.startsWith("claude");
  const request = claude ? id("req_011C") : id("req_", 32, "0123456789abcdef");
  const headers: Record<string, string> = { [claude ? "request-id" : "x-request-id"]: request, ...limits(vendor), ...c.headers?.(at) };
  const body = c.body(at);
  if (c.stream === true) {
    return sse([
      ["response.created", { type: "response.created", sequence_number: 0, response: response(model, "in_progress", [], null) }],
      ["response.failed", { type: "response.failed", sequence_number: 1, response: { ...response(model, "failed", [], null), error: body } }],
    ], 0, false, headers);
  }
  return typeof body === "string" ? new Response(body, { status: c.status, headers }) : json(c.status, claude ? { ...body, request_id: request } : body, headers);
}

function response(model: string, status: string, output: object[], usage: object | null): object {
  return { id: hex("resp_"), object: "response", created_at: secs(), status, background: false, error: null, incomplete_details: null, model, output, parallel_tool_calls: true, service_tier: "default", store: false, usage };
}

function openai(vendor: Vendor, model: string, sent: Sent, used: Used): Response {
  const events: Array<[string, object]> = [];
  const ev = (type: string, data: object) => events.push([type, { type, sequence_number: events.length, ...data }]);
  ev("response.created", { response: response(model, "in_progress", [], null) });
  ev("response.in_progress", { response: response(model, "in_progress", [], null) });
  const done: object[] = [];
  let out = 0;
  sent.blocks.forEach((b, output_index) => {
    if ("text" in b) {
      const item_id = hex("msg_");
      const part = { type: "output_text", annotations: [], logprobs: [], text: "" };
      ev("response.output_item.added", { output_index, item: { id: item_id, type: "message", status: "in_progress", content: [], role: "assistant" } });
      ev("response.content_part.added", { item_id, output_index, content_index: 0, part });
      chunks(b.text).forEach((delta) => ev("response.output_text.delta", { item_id, output_index, content_index: 0, delta, logprobs: [], obfuscation: id("", 8) }));
      ev("response.output_text.done", { item_id, output_index, content_index: 0, text: b.text, logprobs: [] });
      ev("response.content_part.done", { item_id, output_index, content_index: 0, part: { ...part, text: b.text } });
      const item = { id: item_id, type: "message", status: "completed", content: [{ ...part, text: b.text }], role: "assistant" };
      ev("response.output_item.done", { output_index, item });
      done.push(item);
      out += tokens(b.text);
    } else {
      const item_id = hex("fc_");
      const item = { id: item_id, type: "function_call", status: "in_progress", arguments: "", call_id: b.id, name: b.name };
      ev("response.output_item.added", { output_index, item });
      (b.json.match(/.{1,12}/gs) ?? [""]).forEach((delta) => ev("response.function_call_arguments.delta", { item_id, output_index, delta, obfuscation: id("", 8) }));
      ev("response.function_call_arguments.done", { item_id, output_index, arguments: b.json });
      const whole = { ...item, status: "completed", arguments: b.json };
      ev("response.output_item.done", { output_index, item: whole });
      done.push(whole);
      out += tokens(b.json);
    }
  });
  const details = vendor === "openai-api" ? { cached_tokens: used.read, cache_write_tokens: used.write } : { cached_tokens: used.read };
  const input = used.input + used.read + used.write;
  const usage = { input_tokens: input, input_tokens_details: details, output_tokens: out, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: input + out };
  ev("response.completed", { response: response(model, "completed", vendor === "openai-sub" ? [] : done, usage) });
  return sse(events, sent.stall, sent.cut, limits(vendor));
}

function vendor_of(req: Request, url: URL): Vendor | null {
  if (url.hostname === "api.anthropic.com" && url.pathname === "/v1/messages") {
    return req.headers.get("x-api-key") !== null ? "claude-api" : "claude-sub";
  }
  if (url.hostname === "api.openai.com" && url.pathname === "/v1/responses") {
    return "openai-api";
  }
  return url.hostname === "chatgpt.com" && url.pathname === "/backend-api/codex/responses" ? "openai-sub" : null;
}

function jwt(claims: object): string {
  const b64 = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
  return b64({ alg: "RS256", typ: "JWT" }) + "." + b64({ exp: secs() + 10 * 86400, iat: secs(), ...claims }) + ".fake";
}

function chatgpt_tokens(): object {
  const auth = { "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT, chatgpt_plan_type: "plus" } };
  return { id_token: jwt({ email: EMAIL, ...auth }), access_token: jwt(auth), refresh_token: id("rt_", 40), token_type: "Bearer", expires_in: 864000 };
}

async function sign_in(url: URL, req: Request): Promise<Response | null> {
  const text = await req.clone().text();
  const field = (k: string) => str(get(JSON.parse(text.startsWith("{") ? text : "{}"), k)) ?? new URLSearchParams(text).get(k);
  switch (url.pathname) {
    case "/api/accounts/deviceauth/usercode":
      return json(200, { device_auth_id: id("deviceauth_", 32), user_code: "FAKE-" + id("", 5, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"), interval: "1" });
    case "/api/accounts/deviceauth/token":
      return json(200, { authorization_code: id("ac_", 40), code_challenge: id("", 43), code_verifier: id("", 43) });
    case "/oauth/revoke":
      return json(200, {});
    case "/oauth/token":
    case "/v1/oauth/token": {
      const claude = url.pathname === "/v1/oauth/token";
      if (field("grant_type") === "refresh_token" && REFUSE.delete(claude ? "claude-sub" : "openai-sub")) {
        return claude
          ? json(400, { error: "invalid_grant", error_description: "Refresh token not found or invalid" })
          : json(401, { error: { message: "Your refresh token has expired. Please log out and sign in again.", type: "invalid_request_error", code: "refresh_token_expired", param: null } });
      }
      return json(200, claude ? { token_type: "Bearer", access_token: id("sk-ant-oat01-", 80), refresh_token: id("sk-ant-ort01-", 80), expires_in: 28800, scope: "user:inference user:profile user:sessions:claude_code", account: { uuid: ACCOUNT, email_address: EMAIL }, organization: { uuid: ACCOUNT, name: EMAIL + "'s Organization" } } : chatgpt_tokens());
    }
    case "/cai/oauth/authorize": {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      back.search = new URLSearchParams({ code: id("", 40), state: url.searchParams.get("state") ?? "" }).toString();
      return Response.redirect(back.toString(), 302);
    }
    case "/oauth/code/callback":
      return new Response("<!doctype html><title>Authentication code</title><p>Paste this into Claude Code:</p><code>" + (url.searchParams.get("code") ?? "") + "#" + (url.searchParams.get("state") ?? "") + "</code>", { headers: { "content-type": "text/html" } });
    case "/api/oauth/profile":
      return json(200, { account: { uuid: ACCOUNT, email: EMAIL, full_name: "Tester", display_name: "Tester", has_claude_max: true, has_claude_pro: false }, organization: { uuid: ACCOUNT, name: EMAIL + "'s Organization", organization_type: "claude_max", rate_limit_tier: "default_claude_max_20x", billing_type: "stripe_subscription" } });
    case "/backend-api/wham/usage": {
      const until = LIMITED["openai-sub"] ?? 0;
      const window = (used: number, seconds: number, after: number) => ({ used_percent: used, limit_window_seconds: seconds, reset_after_seconds: after, reset_at: secs() + after });
      return json(200, { plan_type: "plus", rate_limit: { allowed: until <= Date.now(), limit_reached: until > Date.now(), primary_window: window(until > Date.now() ? 100 : 12, 18000, until > Date.now() ? Math.ceil((until - Date.now()) / 1e3) : 3 * 3600), secondary_window: window(31, 604800, 4 * 86400) }, credits: null });
    }
  }
  return null;
}

async function model(req: Request, vendor: Vendor, url: URL): Promise<Response> {
  const raw = await req.text();
  let body: unknown = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: { message: "body is not JSON" } });
  }
  const name = str(get(body, "model")) ?? "";
  const got = said(vendor, body);
  const last = (got.said.findLast((m) => m.role !== "system")?.text ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  const latest = (last.split(/^A new message from [^:\n]+:$/m).pop() ?? "").trim();
  const compaction = last.includes("Compaction:");
  const until = LIMITED[vendor] ?? 0;
  const order: Order = until > Date.now() ? { what: "error", kind: "usage-limit", reset: until } : pick(latest, compaction);
  const tools = list(get(body, "tools")).map((t) => str(get(t, "name")) ?? str(get(t, "type")) ?? "");
  LOG.push({ n: LOG.length + 1, at: new Date().toISOString(), vendor, path: url.pathname, model: name, answer: JSON.stringify(order), system: got.system, tools, said: got.said, latest, body });
  LOG.splice(0, LOG.length - 200);
  const claude = vendor.startsWith("claude");
  if (order.what === "error") {
    if (order.kind === "usage-limit") {
      LIMITED[vendor] = order.reset;
    }
    if (order.kind === "auth-expired") {
      REFUSE.add(vendor);
    }
    return failure(vendor, name, order.kind, order.reset);
  }
  const named = (n: string) => tools.find((t) => t === n || t.endsWith("__" + n)) ?? n;
  const blocks: Sent["blocks"] = order.what === "tool"
    ? order.calls.map(([n, input]) => ({ id: claude ? id("toolu_01") : id("call_"), name: named(n), json: JSON.stringify(input) }))
    : [{ text: order.what === "reply" ? order.text : "ok" }];
  const sent: Sent = { blocks, stall: order.what === "stall" ? order.ms : 0, cut: order.what === "cut" };
  const used = cache(got.segs, got.marks);
  return claude ? anthropic(vendor, name, sent, used) : openai(vendor, name, sent, used);
}

async function control(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/queue") {
    QUEUE.push((await req.json()) as Order & { match: string });
    return json(200, { queued: QUEUE.length });
  }
  if (url.pathname === "/clear") {
    QUEUE.length = 0;
    REFUSE.clear();
    Object.keys(LIMITED).forEach((k) => delete LIMITED[k as Vendor]);
    return json(200, {});
  }
  const match = url.searchParams.get("match") ?? "";
  const seen = LOG.filter((s) => s.latest.includes(match));
  const brief = (s: Seen) => ({ ...s, body: undefined, said: undefined, system: undefined, latest: s.latest.slice(0, 120) });
  return json(200, { queue: QUEUE, log: url.pathname === "/last" ? seen.slice(-1) : seen.map(brief) });
}

if (import.meta.main) {
  const dir = process.argv[2] ?? "/rig/certs";
  Bun.serve({
    port: 443, idleTimeout: 0, tls: { cert: Bun.file(dir + "/server.pem"), key: Bun.file(dir + "/server.key") },
    async fetch(req) {
      const url = new URL(req.url);
      const vendor = vendor_of(req, url);
      if (vendor !== null && req.method === "POST") {
        return model(req, vendor, url);
      }
      if (url.pathname === "/v1/messages/count_tokens") {
        return json(200, { input_tokens: tokens(await req.text()) });
      }
      const answer = await sign_in(url, req);
      LOG.push({ n: LOG.length + 1, at: new Date().toISOString(), vendor: url.hostname, path: url.pathname, model: "", answer: answer === null ? "{}" : String(answer.status), system: "", tools: [], said: [], latest: "", body: null });
      return answer ?? json(200, {});
    },
  });
  Bun.serve({ port: CONTROL, hostname: "127.0.0.1", fetch: control });
  console.log("fake up: https :443, control http://127.0.0.1:" + CONTROL);
}
