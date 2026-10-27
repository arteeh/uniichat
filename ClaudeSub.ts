import * as child from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Options, Query, SDKMessage, SDKRateLimitInfo, SDKUserMessage, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { AskAI, type Ask, type End, type Event, type Img, type Try } from "./AskAI.ts";
import { Agent, BUSY, TOO_LONG, type Emit } from "./Agent.ts";
import { Anthropic } from "./Anthropic.ts";
import { LIMIT, Limit, type Off } from "./Limit.ts";
import { Machine } from "./Machine.ts";
import { live_push, type Live } from "./View.ts";
import * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get, text_of } from "./Json.ts";

const DIR = config.CLAUDE_SUB;

export const SUMS = 4;

const FRESH = 60e3;

export const ON = "(The AI service's usage limit cut your last step short. It has reset: go on.)";

const WEB = ["WebSearch"];

const MORE = ["Task", "DesignSync"];

// what turns off what Claude Code does beyond calling the model; its
// prompt cache pinned to an hour (CLAUDE_CODE_PROMPT_CACHE_TTL comes
// before its own choice, which is an hour on a plan but 5 minutes under
// extra usage), as is our mark (ClaudeSub.inbox): the API refuses a 1h
// mark after a 5m one
const ENV = {
  CLAUDE_CODE_PROMPT_CACHE_TTL             : "1h",
  CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL    : "1h", // its side requests too
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC : "1", // updates, telemetry, error reports
  CLAUDE_CODE_DISABLE_AUTO_MEMORY          : "1",
  CLAUDE_CODE_DISABLE_ATTACHMENTS          : "1", // "@path" in a message stays text
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS     : "1",
  DISABLE_AUTO_COMPACT                     : "1",
  CLAUDE_AGENT_SDK_CLIENT_APP              : "uniichat",
};

const HOUR = { type: "ephemeral", ttl: "1h" };

const SIGN_IN = "claude-sub is not signed in, or its sign-in expired: run `unii serve claude` on the server";

const OFF = ["server_error", "overloaded", "billing_error", "account_on_hold", "oauth_org_not_allowed", "verification_required", "model_not_found"];

const NO_BIN = "claude-sub needs Claude Code: `bun install` in uniichat's folder, or set `claude` to a Claude Code executable";

const DIED = "Claude Code ended early";


type Sdk = typeof import("@anthropic-ai/claude-agent-sdk");

type Code = {
  q    : Query;
  box  : ReturnType<typeof ClaudeSub.inbox>;
  proc : child.ChildProcess | null;
  exit : Promise<void>;
  gone : () => void;
};

type Out = Partial<End> & { limit?: { until: number | null; text: string } };

type Wait = { imp: boolean; n: number; go: () => void };

class Died extends Error {}

const LOADED = { bin: null as Promise<string> | null, sdk: null as Promise<Sdk> | null };

const SLOTS = { busy: 0, waits: [] as Wait[], n: 0 };

export namespace ClaudeSub {

  export function bin(): Promise<string> {
    LOADED.bin ??= ClaudeSub.find().catch((err: unknown) => {
      LOADED.bin = null;
      throw err;
    });
    return LOADED.bin;
  }

  export async function find(): Promise<string> {
    if (config.CLAUDE) {
      return config.CLAUDE;
    }
    const inside = Bun.embeddedFiles.map((f) => (f as Blob & { name: string }).name).find((name) => /^claude(-|\.|$)/.test(name));
    if (inside !== undefined) {
      return ClaudeSub.extract((process.platform === "win32" ? "B:\\~BUN\\root\\" : "/$bunfs/root/") + inside);
    }
    try {
      return Bun.fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk-" + ClaudeSub.platform() + (process.platform === "win32" ? "/claude.exe" : "/claude")));
    } catch {
      throw new Error(NO_BIN);
    }
  }

  export function platform(): string {
    const musl = process.platform === "linux" && fs.existsSync("/lib") && fs.readdirSync("/lib").some((f) => f.startsWith("ld-musl-"));
    return process.platform + "-" + process.arch + (musl ? "-musl" : "");
  }

  export async function extract(inside: string): Promise<string> {
    const { extractFromBunfs } = await import("@anthropic-ai/claude-agent-sdk/extract");
    const was = process.env.CLAUDE_CODE_TMPDIR;
    process.env.CLAUDE_CODE_TMPDIR = config.DIR;
    try {
      const out = extractFromBunfs(inside);
      ClaudeSub.claim(path.dirname(out));
      ClaudeSub.prune(path.dirname(path.dirname(out)), path.basename(path.dirname(out)));
      return out;
    } finally {
      if (was === undefined) {
        delete process.env.CLAUDE_CODE_TMPDIR;
      } else {
        process.env.CLAUDE_CODE_TMPDIR = was;
      }
    }
  }

  export function claim(dir: string): void {
    const mine = path.join(dir, "users", String(process.pid));
    fs.mkdirSync(path.dirname(mine), { recursive: true, mode: 0o700 });
    fs.writeFileSync(mine, "");
    process.once("exit", () => fs.rmSync(mine, { force: true }));
  }

  export function prune(home: string, keep: string): void {
    for (const old of fs.readdirSync(home)) {
      const dir = path.join(home, old);
      if (old.startsWith("claude-agent-sdk-") && old !== keep && !ClaudeSub.used(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  export function used(dir: string): boolean {
    const users = path.join(dir, "users");
    const times = [dir, users].map((p) => fs.statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    if (Date.now() - Math.max(...times) < FRESH) {
      return true;
    }
    const pids = fs.existsSync(users) ? fs.readdirSync(users).map(Number) : [];
    return pids.some((pid) => pid > 0 && Machine.alive(pid));
  }

  export function sdk(): Promise<Sdk> {
    LOADED.sdk ??= import("@anthropic-ai/claude-agent-sdk").catch((err: unknown) => {
      LOADED.sdk = null;
      throw err;
    });
    return LOADED.sdk;
  }

  export function env(): Record<string, string | undefined> {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(DIR, 0o700);
    const ours = Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_|FORCE_PROMPT_CACHING)/.test(k));
    return { ...Object.fromEntries(ours), ...ENV, CLAUDE_CONFIG_DIR: DIR };
  }


  export async function cli(args: string[]): Promise<void> {
    if (args.includes("status")) {
      const run = Bun.spawn([await ClaudeSub.bin(), "auth", "status"], { env: ClaudeSub.env(), stdio: ["ignore", "pipe", "inherit"] });
      const out = await new Response(run.stdout).text();
      await run.exited;
      let st: unknown = null;
      try {
        st = JSON.parse(out);
      } catch {
        console.log(out.trim());
        process.exitCode = run.exitCode ?? 1;
        return;
      }
      const type = get(st, "subscriptionType");
      const plan = type ? " (" + text_of(type) + " plan)" : "";
      console.log(get(st, "loggedIn") ? "Signed in to Claude as " + text_of(get(st, "email"), "an account") + plan + "; sign-in in " + DIR + "." : "Not signed in to Claude.");
      process.exitCode = get(st, "loggedIn") ? 0 : 1;
      return;
    }
    const cmd = args.includes("logout") ? ["logout"] : ["login", "--claudeai"];
    const run = Bun.spawn([await ClaudeSub.bin(), "auth", ...cmd], { env: ClaudeSub.env(), stdio: ["inherit", "inherit", "inherit"] });
    process.exitCode = await run.exited;
  }

  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const abort = new AbortController();
    const limit = Limit.make(ask, on, abort.signal);
    const wake = () => limit.poke();
    const stop = () => {
      end.text = "stopped";
      abort.abort();
    };
    const done = ClaudeSub.run(ask, on, abort.signal, limit).then(
      (out) => abort.signal.aborted || Object.assign(end, out),
      (err: unknown) => (end.text ||= err_why(err)),
    ).then(() => {
      end.ok = end.ok && !abort.signal.aborted;
      return end;
    });
    return { wake, stop, done };
  }

  export function options(ask: Ask, abort: AbortController, builtin: readonly string[], boundary: string): Options {
    const tools = WEB;
    const deny = [...builtin, ...MORE].filter((t) => !tools.includes(t));
    return {
      abortController        : abort,
      env                    : ClaudeSub.env(),
      cwd                    : DIR,
      model                  : ask.model,
      effort                 : ask.effort as Options["effort"],
      thinking               : { type: "adaptive", display: "summarized" },
      systemPrompt           : [boundary, ask.system],
      tools,
      allowedTools           : [...tools, "mcp__unii"],
      disallowedTools        : deny,
      permissionMode         : "dontAsk",
      mcpServers             : {},
      strictMcpConfig        : true,
      settingSources         : [],
      plugins                : [],
      skills                 : [],
      persistSession         : false,
      includePartialMessages : true,
      settings               : {
        disableBundledSkills      : true,
        disableWorkflows          : true,
        disableRemoteControl      : true,
        disableClaudeAiConnectors : true,
        enableArtifact            : false,
        permissions               : { deny },
      },
    };
  }

  export function mcp(server: string): Parameters<Query["setMcpServers"]>[0] {
    return server ? { unii: { type: "http", url: server, alwaysLoad: true, timeout: 1e8 } } : {};
  }


  export function slot(ask: Ask, signal: AbortSignal): Promise<boolean> {
    return new Promise((ok) => {
      if (signal.aborted) {
        return ok(false);
      }
      const off = () => {
        SLOTS.waits = SLOTS.waits.filter((w) => w !== wait);
        ok(false);
      };
      const wait: Wait = { imp: ask.yields !== undefined, n: SLOTS.n++, go: () => (signal.removeEventListener("abort", off), ok(true)) };
      signal.addEventListener("abort", off, { once: true });
      SLOTS.waits.push(wait);
      ClaudeSub.grant();
    });
  }

  export function grant(): void {
    SLOTS.waits.sort((a, b) => Number(a.imp) - Number(b.imp) || a.n - b.n);
    while (SLOTS.busy < SUMS) {
      const wait = SLOTS.waits.shift();
      if (wait === undefined) {
        return;
      }
      SLOTS.busy += 1;
      wait.go();
    }
  }

  export function free(): void {
    SLOTS.busy -= 1;
    ClaudeSub.grant();
  }

  export function start(sdk: Sdk, bin: string, ask: Ask, held: boolean): Code {
    const box = ClaudeSub.inbox();
    let gone = () => {};
    const exit = new Promise<void>((ok) => (gone = ok));
    if (held) {
      void exit.then(ClaudeSub.free);
    }
    const code = { box, proc: null, exit, gone } as Omit<Code, "q"> as Code;
    const spawn = (o: SpawnOptions) => {
      const proc = child.spawn(o.command, o.args, { cwd: o.cwd, env: o.env, signal: o.signal, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
      code.proc = proc;
      proc.once("exit", gone);
      proc.once("error", () => proc.pid === undefined && gone());
      return proc;
    };
    const options = { ...ClaudeSub.options(ask, new AbortController(), sdk.BUILTIN_TOOL_NAMES, sdk.SYSTEM_PROMPT_DYNAMIC_BOUNDARY), pathToClaudeCodeExecutable: bin, spawnClaudeCodeProcess: spawn };
    try {
      code.q = sdk.query({ prompt: box.read(), options });
    } catch (err) {
      gone();
      throw err;
    }
    return code;
  }

  export function close(code: Code): Promise<void> {
    code.box.close();
    try {
      code.q.close();
    } catch {}
    if (code.proc === null || code.proc.exitCode !== null || code.proc.signalCode !== null) {
      code.gone();
    }
    return code.exit;
  }

  export function read(code: Code): Promise<IteratorResult<SDKMessage>> {
    const next = code.q.next().catch((err: unknown) => {
      throw new Died(err_why(err));
    });
    next.catch(() => {});
    return next;
  }

  export async function connect(code: Code, server: string, signal: AbortSignal): Promise<string | null> {
    if (server === "") {
      return null;
    }
    const out = await Agent.race(code.q.setMcpServers(ClaudeSub.mcp(server)), signal);
    const err = out?.errors?.unii;
    return err === undefined ? null : "claude-sub couldn't reach UniiChat's tools: " + err;
  }

  // when a limit Claude Code told resets (ms since 1970; null: not told).
  // It tells seconds
  export function reset(info: SDKRateLimitInfo): number | null {
    const at = info.resetsAt;
    return typeof at === "number" && at > 0 ? (at < 1e12 ? at * 1e3 : at) : null;
  }

  export function note(info: SDKRateLimitInfo): void {
    const bills = info.isUsingOverage === true || info.overageStatus === "allowed" || info.overageStatus === "allowed_warning";
    const on = info.status === "rejected" || info.isUsingOverage === true;
    Limit.note("claude-sub", on && bills ? ClaudeSub.reset(info) ?? Date.now() + LIMIT : null);
  }

  export function off(ask: Ask, off: Off, acted: boolean): Partial<End> {
    if (ask.patient !== true) {
      console.error(ask.model + ": " + off.why.slice(0, 300));
    }
    return { text: off.say, why: off.why, stop: "down", off: true, acted, until: off.until, limits: off.limits };
  }

  export async function run(ask: Ask, on: (ev: Event) => void, signal: AbortSignal, limit: Limit): Promise<Partial<End>> {
    let bin = await ClaudeSub.bin();
    if (!fs.existsSync(bin)) {
      LOADED.bin = null;
      bin = await ClaudeSub.bin();
    }
    const sdk = await ClaudeSub.sdk();
    let seen: Live[] = [];
    let said = false;
    const emit: Emit = (kind, text, fresh) => {
      said = true;
      live_push(seen, kind, text, fresh);
      on({ $: "Delta", kind, text, fresh });
    };
    const log = (ev: Event) => {
      said = true;
      on(ev);
    };
    const acted = { v: false };
    let code: Code | null = null;
    try {
      for (let tries = 0; !signal.aborted; ) {
        const guarded = await Limit.guard(limit, "claude-sub", acted.v);
        if (guarded !== null) {
          return ClaudeSub.off(ask, guarded, acted.v);
        }
        if (signal.aborted) {
          continue;
        }
        if (code === null) {
          const held = ask.patient === true;
          if (held && !(await ClaudeSub.slot(ask, signal))) {
            return {};
          }
          code = ClaudeSub.start(sdk, bin, ask, held);
          const fail = await ClaudeSub.connect(code, ask.server, signal);
          if (fail !== null) {
            return { text: fail, stop: "down" };
          }
          if (signal.aborted) {
            return {};
          }
          const blocks = ask.blocks.filter((b) => b.text !== "");
          code.box.put(blocks.map((b) => b.text), ask.imgs ?? [], blocks.slice(0, -1).findLastIndex((b) => b.mark));
        } else if (limit.n > 0) {
          code.box.put([ON], []);
        }
        let got: Out | null;
        try {
          got = await ClaudeSub.turn(code, ask, emit, log, signal, acted, () => (seen = []));
        } catch (err) {
          if (!(err instanceof Died) || said || signal.aborted || tries > 0) {
            throw err;
          }
          tries += 1;
          void ClaudeSub.close(code);
          code = null;
          continue;
        }
        if (got === null || got.limit === undefined) {
          return got === null ? {} : { ...got, acted: acted.v };
        }
        limit.n += 1;
        if (!acted.v) {
          void ClaudeSub.close(code);
          code = null;
        }
        const off = await Limit.hit(limit, got.limit.until, acted.v, got.limit.text);
        if (off !== null) {
          return ClaudeSub.off(ask, off, acted.v);
        }
      }
      return {};
    } finally {
      if (code !== null) {
        void ClaudeSub.close(code);
      }
      if (signal.aborted) {
        Agent.fail("stopped", seen).entries.forEach((e) => on({ $: "Entry", ...e }));
      }
    }
  }

  export async function turn(code: Code, ask: Ask, emit: Emit, log: (ev: Event) => void, signal: AbortSignal, acted: { v: boolean }, fresh: () => void): Promise<Out | null> {
    const stopped = new Promise<"stop">((ok) => (signal.aborted ? ok("stop") : signal.addEventListener("abort", () => ok("stop"), { once: true })));
    let info: SDKRateLimitInfo | null = null;
    let hit = false;
    let over = false;
    let err: string | undefined;
    for (;;) {
      const r = await Promise.race([ClaudeSub.read(code), stopped]);
      if (r === "stop") {
        return null;
      }
      if (r.done) {
        throw new Died(DIED);
      }
      const msg = r.value;
      if (msg.type === "stream_event" && msg.parent_tool_use_id === null) {
        Anthropic.live(msg.event, emit);
        const used = msg.event.type === "message_start" ? Anthropic.used(msg.event.message.usage ?? {}) : null;
        if (used !== null) {
          Agent.cached(ask, used.read, used.write, used.input);
        }
      }
      if (msg.type === "rate_limit_event") {
        info = msg.rate_limit_info;
        ClaudeSub.note(info);
        if (info.isUsingOverage === true && !over) {
          over = true;
          code.q.interrupt().catch(() => {});
        }
      }
      if (msg.type === "assistant" && msg.error === undefined) {
        Anthropic.entries(msg.message.content).forEach((e) => log({ $: "Entry", ...e }));
        acted.v ||= msg.message.content.some((b) => b.type === "tool_use" && !WEB.includes(b.name));
        fresh();
      }
      if (msg.type === "assistant" && msg.error === "authentication_failed") {
        await ClaudeSub.settle(code);
        return { text: SIGN_IN };
      }
      hit ||= msg.type === "assistant" && msg.error === "rate_limit";
      err = msg.type === "assistant" ? msg.error ?? err : err;
      if (msg.type === "user" && Array.isArray(msg.message.content)) {
        ClaudeSub.backs(msg.message.content).forEach((e) => log({ $: "Entry", ...e }));
      }
      if (msg.type !== "result") {
        continue;
      }
      const ok = msg.subtype === "success" && !msg.is_error;
      const why = msg.subtype === "success" ? msg.result : msg.errors.join("; ");
      if (!ok && (hit || over || info?.status === "rejected")) {
        return { limit: { until: info && ClaudeSub.reset(info), text: why } };
      }
      if (!ok) {
        const said = (err ? err + ": " : "") + (why || msg.subtype);
        if (ask.patient !== true) {
          console.error("claude-sub: " + said.slice(0, 300));
        }
        return { text: BUSY, why: said, stop: "down", off: err !== undefined && OFF.includes(err), long: TOO_LONG.test(why) };
      }
      return { ok: true, text: msg.result.trim() };
    }
  }

  export async function settle(code: Code): Promise<void> {
    for (;;) {
      const r = await ClaudeSub.read(code);
      if (r.done || r.value.type === "result") {
        return;
      }
    }
  }

  export function backs(content: unknown[]): Array<{ kind: "echo"; text: string; of: string }> {
    const results = content.filter((b) => get(b, "type") === "tool_result");
    return results.map((b) => ({ kind: "echo", text: (get(b, "is_error") ? "error: " : "") + (AskAI.show(get(b, "content")) || "(no output)"), of: text_of(get(b, "tool_use_id")) }));
  }

  // the messages Claude Code reads, as they come; closed: it ends. A put's
  // text `mark` (-1: none) ends a cache entry, an hour's (ENV): the view's
  // last whole block (Memory.view), so a turn reads the view the turn
  // before cached. One only: a request takes four, and Claude Code marks
  // two of its own (our system prompt, its last message), three if its
  // system prompt isn't split at the boundary (ClaudeSub.options)
  export function inbox() {
    const queue: SDKUserMessage[] = [];
    let wake = () => {};
    let shut = false;
    // the SDK's types take only four image types; MCP servers may send others, which the API refuses
    const push = (content: unknown[]) => {
      queue.push({ type: "user", message: { role: "user", content: content as Exclude<SDKUserMessage["message"]["content"], string> }, parent_tool_use_id: null });
      wake();
    };
    const put = (texts: string[], imgs: Img[], mark = -1) => push(Anthropic.content(texts, imgs).map((b, k) => (k === mark ? { ...b, cache_control: HOUR } : b)));
    const close = () => {
      shut = true;
      wake();
    };
    async function* read(): AsyncGenerator<SDKUserMessage> {
      for (;;) {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          yield next;
        }
        if (shut) {
          return;
        }
        await new Promise<void>((ok) => (wake = ok));
      }
    }
    return { put, close, read };
  }

}
