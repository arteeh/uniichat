import * as fs from "node:fs";
import * as path from "node:path";
import type { Ask } from "./AskAI.ts";
import type { Emit, Item, Refusal, Tool, Wire } from "./Agent.ts";
import { OpenAI, type Event, type Output, type State } from "./OpenAI.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get, str, text_of } from "./Json.ts";
import { write_whole } from "./Write.ts";

export type Tokens = { id_token: string; access_token: string; refresh_token: string; account_id: string };

export type Auth = { auth_mode: "chatgpt"; OPENAI_API_KEY: null; tokens: Tokens; last_refresh: string };

type Sub = State & { items: Output[] };

type Claims = { exp?: unknown; email?: string; "https://api.openai.com/auth"?: { chatgpt_account_id?: string; chatgpt_plan_type?: string } };

type Got = { id_token?: string; access_token?: string; refresh_token?: string };

const CODEX_CLIENT = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER    = config.config_get("chatgpt_issuer", "https://auth.openai.com").replace(/\/$/, "");
const CODEX     = config.config_get("chatgpt_url", "https://chatgpt.com/backend-api/codex").replace(/\/$/, "");
const RESPONSES = CODEX + "/responses";
const USAGE     = CODEX.replace(/\/codex$/, "") + "/wham/usage";

const EARLY   = 5 * 60e3;
const OLD     = 8 * 86400e3;
const REQUEST = 20e3;
const DEVICE  = 15 * 60e3;
const SETTLE  = 2e3;

const CLAIMS = "https://api.openai.com/auth";

const GONE = ["refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated", "invalid_grant"];

const LIMITS: Record<string, string> = {
  usage_not_included  : "doesn't include this use",
  insufficient_quota  : "is out of quota",
};

const SIGN_IN = "run `unii serve chatgpt` on the server";

let REFRESHING: Promise<Auth> | null = null;

export namespace ChatGPT {

  export function claims(jwt: string): Claims {
    try {
      return (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Claims | null) ?? {};
    } catch {
      return {};
    }
  }

  export function json(text: string): unknown {
    try {
      return (JSON.parse(text) as unknown) ?? {};
    } catch {
      return {};
    }
  }

  export function load(): Auth | null {
    if (!fs.existsSync(config.CHATGPT)) {
      return null;
    }
    const auth: unknown = JSON.parse(fs.readFileSync(config.CHATGPT, "utf8"));
    const tokens = get(auth, "tokens");
    if (typeof get(tokens, "access_token") !== "string" || typeof get(tokens, "refresh_token") !== "string") {
      throw new Error(config.CHATGPT + " holds no ChatGPT sign-in");
    }
    return auth as Auth;
  }

  export function save(auth: Auth): void {
    fs.mkdirSync(path.dirname(config.CHATGPT), { recursive: true, mode: 0o700 });
    write_whole(config.CHATGPT, JSON.stringify(auth, null, 2) + "\n");
  }

  export function got(x: unknown): Got {
    return { id_token: str(get(x, "id_token")), access_token: str(get(x, "access_token")), refresh_token: str(get(x, "refresh_token")) };
  }

  export function auth(got: Got, old?: Tokens): Auth {
    const id_token = got.id_token ?? old?.id_token ?? "";
    const tokens: Tokens = {
      id_token,
      access_token  : got.access_token ?? "",
      refresh_token : got.refresh_token ?? old?.refresh_token ?? "",
      account_id    : ChatGPT.claims(id_token)[CLAIMS]?.chatgpt_account_id ?? old?.account_id ?? "",
    };
    return { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens, last_refresh: new Date().toISOString() };
  }

  export function due(auth: Auth, now = Date.now()): boolean {
    const exp = ChatGPT.claims(auth.tokens.access_token).exp;
    return typeof exp === "number" ? exp * 1000 <= now + EARLY : !(Date.parse(auth.last_refresh) > now - OLD);
  }

  export async function token(refused?: string): Promise<string> {
    const auth = ChatGPT.load();
    if (auth === null) {
      throw new Error("openai-sub is not signed in: " + SIGN_IN);
    }
    if (auth.tokens.access_token !== refused && !ChatGPT.due(auth)) {
      return auth.tokens.access_token;
    }
    REFRESHING ??= ChatGPT.refresh(auth).finally(() => (REFRESHING = null));
    return (await REFRESHING).tokens.access_token;
  }

  export function busy(why: string): Error {
    return Object.assign(new Error("ChatGPT token refresh failed: " + why), { busy: true });
  }

  export function refreshed_elsewhere(old: Auth): Auth | null {
    const now = ChatGPT.load();
    if (now === null) {
      throw new Error("openai-sub was signed out: " + SIGN_IN);
    }
    return now.tokens.refresh_token !== old.tokens.refresh_token ? now : null;
  }

  export async function refreshed_elsewhere_soon(old: Auth): Promise<Auth | null> {
    for (const end = Date.now() + SETTLE; ; await Bun.sleep(250)) {
      const now = ChatGPT.refreshed_elsewhere(old);
      if (now !== null || Date.now() >= end) {
        return now;
      }
    }
  }

  export function save_unless_refreshed_elsewhere(old: Auth, auth: Auth): Auth {
    const now = ChatGPT.refreshed_elsewhere(old);
    if (now !== null) {
      return now;
    }
    ChatGPT.save(auth);
    return auth;
  }

  export async function refresh(old: Auth): Promise<Auth> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(ISSUER + "/oauth/token", {
        method  : "POST",
        headers : { "content-type": "application/json" },
        body    : JSON.stringify({ client_id: CODEX_CLIENT, grant_type: "refresh_token", refresh_token: old.tokens.refresh_token }),
        signal  : AbortSignal.timeout(REQUEST),
      });
      text = await res.text();
    } catch (err) {
      throw ChatGPT.busy(err_why(err));
    }
    const body = ChatGPT.json(text);
    if (!res.ok) {
      const error = get(body, "error");
      const code = (typeof error === "string" ? error : text_of(get(error, "code") ?? get(body, "code"))).toLowerCase();
      if (res.status !== 401 && !GONE.includes(code)) {
        throw ChatGPT.busy("HTTP " + res.status);
      }
      const now = await ChatGPT.refreshed_elsewhere_soon(old);
      if (now !== null) {
        return now;
      }
      throw new Error("openai-sub's sign-in has expired or was revoked (" + (code || "HTTP " + res.status) + "): " + SIGN_IN);
    }
    if (typeof get(body, "access_token") !== "string") {
      throw ChatGPT.busy("no access token");
    }
    return ChatGPT.save_unless_refreshed_elsewhere(old, ChatGPT.auth(ChatGPT.got(body), old.tokens));
  }

  export async function exchange(code: string, redirect: string, verifier: string): Promise<Auth> {
    const form = new URLSearchParams({ grant_type: "authorization_code", client_id: CODEX_CLIENT, code, redirect_uri: redirect, code_verifier: verifier });
    const res = await fetch(ISSUER + "/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(REQUEST) });
    const text = await res.text();
    if (!res.ok) {
      throw new Error("ChatGPT sign-in failed: HTTP " + res.status + ": " + text.slice(0, 300));
    }
    const auth = ChatGPT.auth(ChatGPT.got(JSON.parse(text)));
    ChatGPT.save(auth);
    return auth;
  }

  export async function device(show: (url: string, code: string) => void, wait = DEVICE): Promise<Auth> {
    const api = ISSUER + "/api/accounts/deviceauth";
    const post = (path: string, body: object) =>
      fetch(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST) });
    const res = await post("/usercode", { client_id: CODEX_CLIENT });
    if (!res.ok) {
      const off = res.status === 404 ? " (device code sign-in is off for this account: allow it in ChatGPT's security settings)" : "";
      throw new Error("ChatGPT device code request failed: HTTP " + res.status + off);
    }
    const got: unknown = await res.json();
    const code = String(get(got, "user_code") ?? get(got, "usercode"));
    const every = Math.max(1, Number(get(got, "interval")) || 5) * 1000;
    show(ISSUER + "/codex/device", code);
    for (const end = Date.now() + wait; Date.now() < end; await Bun.sleep(Math.min(every, end - Date.now()))) {
      const poll = await post("/token", { device_auth_id: get(got, "device_auth_id"), user_code: code }).catch(() => null);
      if (poll?.ok) {
        const ok: unknown = await poll.json();
        return ChatGPT.exchange(String(get(ok, "authorization_code")), ISSUER + "/deviceauth/callback", String(get(ok, "code_verifier")));
      }
      if (poll !== null && poll.status !== 403 && poll.status !== 404 && poll.status < 500) {
        throw new Error("ChatGPT device sign-in failed: HTTP " + poll.status);
      }
    }
    throw new Error("ChatGPT device sign-in timed out after " + Math.round(wait / 60e3) + " minutes");
  }

  export async function logout(): Promise<string> {
    const auth = ChatGPT.load();
    if (auth === null) {
      return "Not signed in to ChatGPT.";
    }
    const res = await fetch(ISSUER + "/oauth/revoke", {
      method  : "POST",
      headers : { "content-type": "application/json" },
      body    : JSON.stringify({ token: auth.tokens.refresh_token, token_type_hint: "refresh_token", client_id: CODEX_CLIENT }),
      signal  : AbortSignal.timeout(REQUEST),
    }).catch(() => null);
    fs.rmSync(config.CHATGPT, { force: true });
    return "Signed out of ChatGPT" + (res?.ok ? "." : " (its token wasn't revoked: " + (res ? "HTTP " + res.status : "offline") + ").");
  }

  export function who(auth: Auth): string {
    const id = ChatGPT.claims(auth.tokens.id_token);
    const plan = id[CLAIMS]?.chatgpt_plan_type;
    return (id.email ?? "an account") + (plan ? " (" + plan + " plan)" : "");
  }

  export async function cli(args: string[]): Promise<void> {
    if (args.includes("logout")) {
      console.log(await ChatGPT.logout());
      return;
    }
    if (args.includes("status")) {
      const auth = ChatGPT.load();
      console.log(auth === null ? "Not signed in to ChatGPT." : "Signed in to ChatGPT as " + ChatGPT.who(auth) + "; tokens in " + config.CHATGPT + ".");
      process.exitCode = auth === null ? 1 : 0;
      return;
    }
    const auth = await ChatGPT.device((url, code) => console.log("To sign this server in to ChatGPT, open\n\n  " + url + "\n\nand enter the code\n\n  " + code + "\n\n(it expires in 15 minutes; enter it only if you started this sign-in)"));
    console.log("\nSigned in to ChatGPT as " + ChatGPT.who(auth) + "; tokens in " + config.CHATGPT + ".\nOffer it with the config vendors=openai-sub (README).");
  }

  // the body Codex sends, its fields in its order, of openai-api's parts:
  // the system prompt as `instructions` (the backend requires it), no
  // max_output_tokens, cache breakpoints nor tool-call cap
  export function body(ask: Ask, items: Item[], tools: Tool[], max: number): unknown {
    const api = OpenAI.body({ ...ask, speed: "slow" }, items, tools, max);
    return {
      model               : api.model,
      instructions        : ask.system,
      input               : api.input.slice(1).map(ChatGPT.unmark),
      tools               : api.tools,
      tool_choice         : "auto",
      parallel_tool_calls : true,
      reasoning           : api.reasoning,
      store               : false,
      stream              : true,
      include             : ["reasoning.encrypted_content"],
      service_tier        : ask.speed === "fast" ? "priority" : undefined,
      prompt_cache_key    : api.prompt_cache_key,
    };
  }

  export function unmark(item: unknown): unknown {
    const content = get(item, "content");
    if (get(item, "role") !== "user" || !Array.isArray(content)) {
      return item;
    }
    return Object.assign({}, item, { content: content.map((part: unknown) => {
      const unmarked: Record<string, unknown> = Object.assign({}, part);
      delete unmarked.prompt_cache_breakpoint;
      return unmarked;
    }) });
  }

  export function headers(token: string): Record<string, string> {
    return {
      authorization        : "Bearer " + token,
      "chatgpt-account-id" : ChatGPT.claims(token)[CLAIMS]?.chatgpt_account_id ?? ChatGPT.load()?.tokens.account_id ?? "",
      "openai-beta"        : "responses=experimental",
      "content-type"       : "application/json",
      accept               : "text/event-stream",
      originator           : "uniichat",
    };
  }

  // one stream event, as OpenAI.read takes it; the backend's last
  // response holds no output, so its output is the items streamed
  export function read(st: Sub, ev: Event, on: Emit): boolean {
    if (ev.type === "response.output_item.done" && ev.item !== undefined) {
      st.items[ev.output_index ?? st.items.length] = ev.item;
    }
    const end = OpenAI.read(st, ev, on);
    if (end && st.res !== null && !((st.res.output?.length ?? 0) > 0)) {
      st.res = { ...st.res, output: st.items.filter(Boolean) };
    }
    return end;
  }

  export function refusal(res: Response, text: string): Refusal | null {
    const err = get(ChatGPT.json(text), "error") ?? {};
    const kind = [get(err, "type"), get(err, "code")].find((k) => typeof k === "string" && Object.hasOwn(LIMITS, k));
    if (res.status !== 429 || typeof kind !== "string") {
      return null;
    }
    const type = get(err, "plan_type");
    const plan = typeof type === "string" && /^[a-z0-9_]{1,20}$/.test(type) ? " (" + type + ")" : "";
    const why = "ChatGPT " + kind + plan + ": " + text_of(get(err, "message")).slice(0, 300);
    return { why, say: "the ChatGPT plan" + plan + " this server runs on " + LIMITS[kind] };
  }

  export function reset(res: Response, text: string): number | null {
    const err = get(ChatGPT.json(text), "error") ?? {};
    if (res.status !== 429 || ![get(err, "type"), get(err, "code")].includes("usage_limit_reached")) {
      return null;
    }
    const resets_at = get(err, "resets_at");
    const resets_in = get(err, "resets_in_seconds");
    const at = typeof resets_at === "number" ? resets_at * 1000 : typeof resets_in === "number" ? Date.now() + resets_in * 1000 : 0;
    return at > Date.now() && at - Date.now() < 2 ** 31 ? at : null;
  }

  // whether the plan's usage limit cleared, as Codex reads it for its
  // /status (codex-rs backend-client: GET wham/usage, its rate_limit's
  // `allowed`); null: can't tell
  export async function clear(): Promise<boolean | null> {
    const { authorization, "chatgpt-account-id": account, originator } = ChatGPT.headers(await ChatGPT.token());
    const res = await fetch(USAGE, { headers: { authorization, "chatgpt-account-id": account, originator }, signal: AbortSignal.timeout(REQUEST) });
    const limit = res.ok ? get(ChatGPT.json(await res.text()), "rate_limit") : null;
    const allowed = get(limit, "allowed");
    return typeof allowed === "boolean" ? allowed && get(limit, "limit_reached") !== true : null;
  }

  export const wire: Wire<Sub, Event> = {
    key     : "",
    idle    : 1200e3,
    url     : RESPONSES,
    auth    : (refused) => ChatGPT.token(refused),
    // the backend routes its cache by the session-id header
    headers : (token, ask) => ({ ...ChatGPT.headers(token), "session-id": OpenAI.session(ask), "thread-id": OpenAI.session(ask) }),
    body    : (ask, items, tools, max) => ChatGPT.body(ask, items, tools, max),
    start   : (ask) => ({ ...OpenAI.wire.start(ask), items: [] }),
    read    : (st, ev, on) => ChatGPT.read(st, ev, on),
    begun   : (ev) => ev.type === "response.output_item.added",
    step    : (st, ask) => ({ ...OpenAI.step(st, ask), note: "" }),
    refusal : (res, text) => ChatGPT.refusal(res, text),
    reset   : (res, text) => ChatGPT.reset(res, text),
  };

}

if (import.meta.main) {
  await ChatGPT.cli(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err_why(err));
    process.exit(1);
  });
}
