// ChatGPT test
// ============
// `bun test ChatGPT.test.ts`. The openai-sub vendor's seams, against a
// fake auth.openai.com and ChatGPT backend (one local server) that takes
// only the fields Codex sends and requires `instructions`: the body,
// refreshes (refresh tokens rotate), the sign-in file, usage limits (as
// every vendor's: waits, the fallback, limits remembered, the plan's
// usage read while one waits, resume), the sign-ins, logout, which
// vendor a pick bills, and a billing server.

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// Fake
// ====

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-chatgpt-");

const now = () => Math.floor(Date.now() / 1000);

function jwt(claims: object): string {
  return "e30." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".sig";
}

// an access token of the fake's, valid till exp (s)
function access(n: number, exp = now() + 3600): string {
  return jwt({ exp, n, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } });
}

const ID = jwt({ email: "tester@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_plan_type: "plus" } });

// the fields of the body Codex sends (codex-rs ResponsesApiRequest), and
// of its refresh
const CODEX = ["model", "instructions", "input", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "store", "stream", "include", "service_tier", "prompt_cache_key", "text"];
const REFRESH = ["client_id", "grant_type", "refresh_token"];

// what the fake saw and does: a refresh waits `slow` ms, then runs
// `before`; `down` polls answer 5xx first; `limited`: a usage limit, reset
// at `resets`, which wham/usage tells (`usages`: its reads); a system
// prompt "TOOL" calls our tool `date` first (`tools`: its runs)
const fake = {
  valid     : new Set<string>(),
  spent     : new Set<string>(),
  issued    : 0,
  refreshes : [] as any[],
  requests  : [] as Array<{ headers: Record<string, string>; body: any }>,
  limited   : false,
  resets    : 1793082856,
  usages    : [] as Array<Record<string, string>>,
  tools     : 0,
  polls     : 0,
  exchanges : [] as Array<Record<string, string>>,
  revoked   : [] as any[],
  slow      : 0,
  down      : 0,
  before    : null as (() => void) | null,
};

function sse(events: any[]): Response {
  const body = events.map((ev) => "event: " + ev.type + "\ndata: " + JSON.stringify(ev) + "\n\n").join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

// new tokens (a refresh token works once)
function tokens(): object {
  fake.issued += 1;
  const token = access(100 + fake.issued);
  fake.valid.add(token);
  return { id_token: ID, access_token: token, refresh_token: "refresh-" + fake.issued };
}

const server = Bun.serve({
  port  : 0,
  fetch : async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/oauth/token" && req.headers.get("content-type")?.includes("json")) {
      const body = await req.json();
      fake.refreshes.push(body);
      await Bun.sleep(fake.slow);
      fake.before?.();
      if (body.client_id !== "app_EMoamEEZ73f0CkXaXp7hrann" || Object.keys(body).sort().join() !== REFRESH.join()) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      if (fake.spent.has(body.refresh_token)) {
        return Response.json({ error: "refresh_token_reused" }, { status: 401 });
      }
      fake.spent.add(body.refresh_token);
      return Response.json(tokens());
    }
    if (url.pathname === "/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(await req.text()));
      fake.exchanges.push(form);
      return form.code === "code-ok" ? Response.json(tokens()) : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.pathname === "/oauth/revoke") {
      fake.revoked.push(await req.json());
      return new Response("{}");
    }
    if (url.pathname === "/api/accounts/deviceauth/usercode") {
      return Response.json({ device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "1" });
    }
    if (url.pathname === "/api/accounts/deviceauth/token") {
      const body = await req.json();
      fake.polls += 1;
      if (fake.down > 0) {
        fake.down -= 1;
        return new Response("", { status: 502 });
      }
      if (body.device_auth_id !== "dev-1" || body.user_code !== "ABCD-1234" || fake.polls < 2) {
        return new Response("", { status: 403 });
      }
      return Response.json({ authorization_code: "code-ok", code_verifier: "verifier-dev" });
    }
    if (url.pathname === "/wham/usage") {
      fake.usages.push(Object.fromEntries(req.headers));
      const window = { used_percent: fake.limited ? 100 : 40, limit_window_seconds: 18000, reset_after_seconds: 600, reset_at: fake.resets };
      return Response.json({ plan_type: "plus", rate_limit: { allowed: !fake.limited, limit_reached: fake.limited, primary_window: window, secondary_window: null } });
    }
    if (url.pathname === "/mcp") {
      const msg = await req.json();
      if (msg.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "date", description: "The date.", inputSchema: { type: "object", properties: {} } }] } });
      }
      fake.tools += 1;
      return Response.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Tue" }] } });
    }
    if (url.pathname === "/codex/responses") {
      const headers = Object.fromEntries(req.headers);
      const body = await req.json();
      fake.requests.push({ headers, body });
      const odd = Object.keys(body).find((k) => !CODEX.includes(k));
      if (odd !== undefined) {
        return Response.json({ detail: "Unsupported parameter: " + odd }, { status: 400 });
      }
      if (typeof body.instructions !== "string" || body.instructions === "") {
        return Response.json({ detail: "Instructions are required" }, { status: 400 });
      }
      if (body.input.some((i: any) => i.role === "system")) {
        return Response.json({ detail: "System messages are not allowed" }, { status: 400 });
      }
      if (!fake.valid.has((headers.authorization ?? "").replace(/^Bearer /, ""))) {
        return Response.json({ error: { message: "Your authentication token has expired." } }, { status: 401 });
      }
      if (body.instructions === "TOOL" && !body.input.some((i: any) => i.type === "function_call_output")) {
        const call = { type: "function_call", call_id: "c1", name: "date", arguments: "{}" };
        const response = { status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 2 } };
        return sse([{ type: "response.output_item.added", output_index: 0, item: { type: "function_call" } }, { type: "response.output_item.done", output_index: 0, item: call }, { type: "response.completed", response }]);
      }
      if (fake.limited) {
        const error = { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "plus", resets_at: fake.resets };
        return Response.json({ error }, { status: 429 });
      }
      // as the backend streams it: the items whole as each ends, none in the last response
      const thought = { type: "reasoning", summary: [{ type: "summary_text", text: "Thinking." }], encrypted_content: "enc" };
      const item = { type: "message", role: "assistant", content: [{ type: "output_text", text: "pong" }] };
      const response = { status: "completed", service_tier: "default", output: [], usage: { input_tokens: 10, output_tokens: 2 } };
      return sse([
        { type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } },
        { type: "response.output_item.done", output_index: 0, item: thought },
        { type: "response.output_item.added", output_index: 1, item: { type: "message" } },
        { type: "response.output_text.delta", delta: "pong" },
        { type: "response.output_item.done", output_index: 1, item },
        { type: "response.completed", response },
      ]);
    }
    return new Response("not found", { status: 404 });
  },
});

process.env.UNII_DIR = DIR;
process.env.UNII_CHATGPT_ISSUER = "http://127.0.0.1:" + server.port;
process.env.UNII_CHATGPT_URL = "http://127.0.0.1:" + server.port + "/codex";
process.env.UNII_VENDORS = "claude-api,openai-sub";

const config = await import("./Config.ts");
const { ChatGPT } = await import("./ChatGPT.ts");
const { AskAI } = await import("./AskAI.ts");
const { Agent } = await import("./Agent.ts");
const { Pick } = await import("./Pick.ts");
const { Machine } = await import("./Machine.ts");
const { Billing } = await import("./Billing.ts");
const { Cloud } = await import("./Cloud.ts");

const FILE = DIR + "/chatgpt.json";

// FILE signed in with this access token (and refresh token)
function sign_in(token: string, refresh = "refresh-0", last = new Date().toISOString()): void {
  const auth = { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: ID, access_token: token, refresh_token: refresh, account_id: "acct-1" }, last_refresh: last };
  fs.writeFileSync(FILE, JSON.stringify(auth), { mode: 0o600 });
}

function file(): any {
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

function call(speed = "slow", text = "Say pong.", patient = false, on = (_: any) => {}) {
  const ask = { vendor: "openai-sub" as const, model: "gpt-6-luna", effort: "low", speed, system: "Be brief.", blocks: [{ text, mark: true }], searches: 0, server: "", patient };
  return AskAI.ask(ask, on);
}

// a turn on openai-sub: its end
function turn(speed = "slow", text = "Say pong.") {
  return call(speed, text).done;
}

// a try on openai-sub alone (AskAI.start: `fallback` as a profile sets
// it), its events kept: its Limits, its thoughts on waiting
function tried(more: object = {}) {
  const evs: any[] = [];
  const ask = { vendor: "openai-sub" as const, model: "gpt-6-luna", effort: "low", speed: "slow", system: "Be brief.", blocks: [{ text: "Say pong.", mark: true }], searches: 0, server: "", ...more };
  const t = AskAI.start(ask, (ev) => evs.push(ev));
  const limits = () => evs.filter((e) => e.$ === "Limit").map((e) => e.limit);
  const minds = () => evs.filter((e) => e.$ === "Entry" && e.kind === "mind" && e.text.startsWith("The AI service")).map((e) => e.text);
  return { t, limits, minds };
}

// waits pass at once, the clock moved on past each, `then` run as a
// parked one (a minute or more) ends; `held`: a parked one never ends
// but by a wake or a stop
function clock(held = false, then = () => {}) {
  const real = Date.now.bind(Date);
  let skew = 0;
  const naps: number[] = [];
  const now = spyOn(Date, "now").mockImplementation(() => real() + skew);
  const nap = spyOn(Machine, "nap").mockImplementation((ms: number, signal: AbortSignal) => {
    naps.push(ms);
    if (held && ms >= 60e3) {
      return new Promise<void>((ok) => (signal.aborted ? ok() : signal.addEventListener("abort", () => ok(), { once: true })));
    }
    skew += ms + 1;
    if (ms >= 60e3) {
      then();
    }
    return Promise.resolve();
  });
  return { naps, restore: () => (now.mockRestore(), nap.mockRestore()) };
}

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) {
    await Bun.sleep(10);
  }
}

// a valid sign-in, its token
function signed(): string {
  const token = access(1);
  fake.valid.add(token);
  sign_in(token);
  return token;
}

beforeEach(() => {
  fs.rmSync(FILE, { force: true });
  Object.assign(fake, { issued: 0, refreshes: [], requests: [], limited: false, resets: 1793082856, usages: [], tools: 0, polls: 0, exchanges: [], revoked: [], slow: 0, down: 0, before: null });
  fake.valid.clear();
  fake.spent.clear();
  Agent.forget();
});

// Tests
// =====

test("the body is Codex's: the system prompt as instructions, its fields only", () => {
  const ask = { vendor: "openai-sub" as const, model: "gpt-6-astra", effort: "high", speed: "fast", system: "S", blocks: [{ text: "a", mark: true }, { text: "b", mark: true }], searches: 2, server: "" };
  const items: any[] = [{ $: "User", parts: ask.blocks, imgs: [] }];
  const body: any = JSON.parse(JSON.stringify(ChatGPT.body(ask, items, [], 1000)));
  expect(Object.keys(body).filter((k) => !CODEX.includes(k))).toEqual([]);
  expect(body.instructions).toBe("S");
  expect(body.input.some((i: any) => i.role === "system")).toBe(false);
  expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
});

test("a turn runs on the signed-in account, its output the items streamed", async () => {
  const token = access(1);
  fake.valid.add(token);
  sign_in(token);
  const end = await turn();
  expect(end.ok).toBe(true);
  expect(end.text).toBe("pong");
  expect(fake.requests[0].headers.authorization).toBe("Bearer " + token);
  expect(fake.requests[0].headers["chatgpt-account-id"]).toBe("acct-1");
  expect(fake.refreshes).toHaveLength(0);
});

test("a token about to expire is refreshed first and the new tokens saved", async () => {
  sign_in(access(1, now() + 60));
  expect((await turn()).ok).toBe(true);
  expect(fake.refreshes).toHaveLength(1);
  const saved = file();
  expect(saved.tokens.refresh_token).toBe("refresh-1");
  expect(saved.tokens.access_token).toBe(fake.requests[0].headers.authorization.slice(7));
  expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
});

test("a 401 refreshes the token and sends again, once", async () => {
  sign_in(access(1));
  expect((await turn()).ok).toBe(true);
  expect(fake.requests).toHaveLength(2);
  const valid = fake.valid;
  fake.valid = { has: () => false, add: () => {}, clear: () => {} } as any;
  const end = await turn();
  fake.valid = valid;
  expect(end.ok).toBe(false);
  expect(fake.requests).toHaveLength(4);
  expect(fake.refreshes).toHaveLength(2);
});

test("calls at once refresh once: the rest take its tokens", async () => {
  sign_in(access(1, now() + 10));
  fake.slow = 200;
  const ends = await Promise.all([turn("slow", "a"), turn("slow", "b"), turn("slow", "c")]);
  expect(ends.every((e) => e.ok)).toBe(true);
  expect(fake.refreshes).toHaveLength(1);
});

test("a refresh refused as used reads the file again: another process's tokens, saved just after", async () => {
  sign_in(access(1, now() + 10), "refresh-0");
  const theirs = access(9);
  fake.valid.add(theirs);
  fake.before = () => {
    fake.spent.add("refresh-0");
    setTimeout(() => sign_in(theirs, "refresh-9"), 300);
  };
  expect(await ChatGPT.token()).toBe(theirs);
  expect(file().tokens.refresh_token).toBe("refresh-9");
});

test("a refresh under way when another process signs out doesn't sign back in", async () => {
  sign_in(access(1, now() + 10), "refresh-0");
  fake.before = () => fs.rmSync(FILE);
  await expect(ChatGPT.token()).rejects.toThrow("signed out");
  expect(fs.existsSync(FILE)).toBe(false);
});

test("a call stopped mid-refresh keeps the process alive till the new tokens are saved", async () => {
  const { READING } = await import("./Agent.ts");
  sign_in(access(1, now() + 10), "refresh-0");
  fake.slow = 300;
  const c = call();
  for (let i = 0; i < 100 && fake.refreshes.length === 0; i++) {
    await Bun.sleep(10);
  }
  c.stop();
  await c.done;
  expect(READING.n).toBeGreaterThan(0);
  for (let i = 0; i < 100 && READING.n > 0; i++) {
    await Bun.sleep(20);
  }
  expect(READING.n).toBe(0);
  expect(file().tokens.refresh_token).toBe("refresh-1");
});

test("a refresh refused for good fails the call, keeping the file", async () => {
  sign_in(access(1, now() + 10), "refresh-0");
  fake.spent.add("refresh-0");
  expect((await turn()).ok).toBe(false);
  expect(file().tokens.refresh_token).toBe("refresh-0");
});

test("a first sign-in makes the file's missing dir, owner only", async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  await ChatGPT.exchange("code-ok", "https://auth.openai.com/deviceauth/callback", "v");
  expect(fs.statSync(DIR).mode & 0o777).toBe(0o700);
  expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
});

test("a usage limit after a tool ran (a turn's, a subagent's): it waits for the reset told, parked, then goes on; the tool doesn't run again", async () => {
  signed();
  fake.limited = true;
  fake.resets = now() + 600;
  const c = clock(false, () => (fake.limited = false));
  try {
    const { t, limits, minds } = tried({ system: "TOOL", server: "http://127.0.0.1:" + server.port + "/mcp", fallback: true });
    expect(await t.done).toMatchObject({ ok: true, text: "pong" });
    expect(fake.tools).toBe(1);
    expect(fake.requests).toHaveLength(3);
    expect(c.naps.filter((ms) => ms >= 60e3)).toEqual([expect.any(Number)]);
    expect(c.naps[0]).toBeGreaterThan(590e3);
    expect(limits()).toEqual([{ until: expect.any(Number), known: true }, null]);
    expect(minds()).toEqual(["The AI service reached a usage limit: asking again in 10 min."]);
  } finally {
    c.restore();
  }
});

test("a usage limit, no tool run, with a fallback: it ends at once (off) for the fallback; a call after waits under the limit remembered, asking nothing", async () => {
  signed();
  fake.limited = true;
  fake.resets = now() + 7200;
  const end = await tried({ fallback: true }).t.done;
  expect(end).toMatchObject({ ok: false, stop: "down", off: true, until: fake.resets * 1000 });
  expect(end.acted).not.toBe(true);
  expect(end.text).toContain("usage limit");
  const c = clock(true);
  try {
    const { t, limits } = tried();
    await until(() => limits().length > 0);
    expect(limits()).toEqual([{ until: fake.resets * 1000, known: true }]);
    expect(fake.requests).toHaveLength(1);
    t.stop();
    expect(await t.done).toMatchObject({ ok: false, text: "stopped" });
  } finally {
    c.restore();
  }
});

test("a message sent ends the wait; still limited, it waits again saying nothing more; a stop ends it at once", async () => {
  signed();
  fake.limited = true;
  fake.resets = now() + 7200;
  const c = clock(true);
  try {
    const { t, limits, minds } = tried();
    await until(() => limits().length === 1);
    t.send({ text: "still there?", imgs: [] });
    await until(() => limits().length === 3);
    expect(fake.requests).toHaveLength(2);
    expect(limits()).toEqual([expect.anything(), null, expect.anything()]);
    expect(minds()).toHaveLength(1);
    t.stop();
    expect(await t.done).toMatchObject({ ok: false, text: "stopped" });
    expect(limits().at(-1)).toBeNull();
  } finally {
    c.restore();
  }
});

test("while a call waits, the plan's usage is read: a limit lifted early (a banked reset) wakes it, and it goes on", async () => {
  const token = signed();
  fake.limited = true;
  fake.resets = now() + 7200;
  const c = clock(true);
  try {
    const { t, limits } = tried();
    await until(() => limits().length === 1);
    expect(await Agent.poll("openai-sub")).toBe(false);
    expect(fake.requests).toHaveLength(1);
    expect(fake.usages[0].authorization).toBe("Bearer " + token);
    expect(fake.usages[0]["chatgpt-account-id"]).toBe("acct-1");
    fake.limited = false;
    expect(await Agent.poll("openai-sub")).toBe(true);
    expect(await t.done).toMatchObject({ ok: true, text: "pong" });
    expect(fake.requests).toHaveLength(2);
    expect(fake.refreshes).toHaveLength(0);
  } finally {
    c.restore();
  }
});

test("resume wakes every call waiting (a turn's, a summary's); still limited, each waits again; lifted, each goes on", async () => {
  signed();
  fake.limited = true;
  fake.resets = now() + 7200;
  const c = clock(true);
  try {
    const a = tried();
    const b = tried({ patient: true });
    await until(() => a.limits().length === 1 && b.limits().length === 1);
    expect(Agent.resume()).toBe(2);
    await until(() => a.limits().length === 3 && b.limits().length === 3);
    expect(fake.requests).toHaveLength(4);
    expect([a.minds().length, b.minds().length]).toEqual([1, 1]);
    fake.limited = false;
    expect(Agent.resume()).toBe(2);
    expect(await a.t.done).toMatchObject({ ok: true, text: "pong" });
    expect(await b.t.done).toMatchObject({ ok: true, text: "pong" });
  } finally {
    c.restore();
  }
});

test("a patient call (a summary's) at a usage limit waits for the reset, not asking again", async () => {
  const token = access(1);
  fake.valid.add(token);
  sign_in(token);
  fake.limited = true;
  fake.resets = now() + 7200;
  const naps: number[] = [];
  const nap = spyOn(Machine, "nap").mockImplementation((ms: number, signal: AbortSignal) => {
    naps.push(ms);
    return new Promise<void>((ok) => signal.addEventListener("abort", () => ok(), { once: true }));
  });
  try {
    const c = call("slow", "Summarize.", true);
    for (let i = 0; i < 100 && naps.length === 0; i++) {
      await Bun.sleep(20);
    }
    c.stop();
    await c.done;
  } finally {
    nap.mockRestore();
  }
  expect(naps[0]).toBeGreaterThan(3600e3);
  expect(fake.requests).toHaveLength(1);
});

test("device sign-in: polled till entered, past the issuer's 5xx, and saved", async () => {
  fake.down = 1;
  const auth = await ChatGPT.device(() => {});
  expect(fake.exchanges[0]).toMatchObject({ code: "code-ok", code_verifier: "verifier-dev" });
  expect(auth.tokens.access_token).toBe(file().tokens.access_token);
});

test("logout revokes the refresh token and deletes the file", async () => {
  sign_in(access(1), "refresh-7");
  await ChatGPT.logout();
  expect(fake.revoked[0].token).toBe("refresh-7");
  expect(fs.existsSync(FILE)).toBe(false);
});

test("offered with openai-api, a model picked by name runs on the vendor it names", () => {
  const offer = { vendors: ["openai-api" as const, "openai-sub" as const], models: ["gpt-6-luna", "gpt-6.1-sol"] };
  const sub = { vendor: "openai-sub" as const, model: "gpt-6-luna", effort: "high", speed: "slow" };
  expect(Pick.move(sub, "model", offer, "gpt-6.1-sol")?.vendor).toBe("openai-sub");
  expect(Pick.move(sub, "model", offer, "openai-api:gpt-6.1-sol")?.vendor).toBe("openai-api");
});

test("a server that bills won't start offering openai-sub", () => {
  const vendors = [...config.OFFER.vendors];
  const open = spyOn(Billing, "open").mockImplementation(() => ({ bills: true }) as any);
  try {
    config.OFFER.vendors.splice(0, Infinity, "claude-api", "openai-sub");
    expect(() => Cloud.open(() => {}, () => {}, async () => null)).toThrow("can't offer openai-sub");
  } finally {
    open.mockRestore();
    config.OFFER.vendors.splice(0, Infinity, ...vendors);
  }
});
