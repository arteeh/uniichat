import * as os from "node:os";
import type { Out } from "./Agent.ts";
import type { Img } from "./AskAI.ts";
import { clip } from "./Clip.ts";
import type * as config from "./Config.ts";
import { err_why } from "./Err.ts";
import { get, list as items, rec, text_of } from "./Json.ts";
import { Machine, WIN, type Job, type Spec } from "./Machine.ts";

type Link = {
  ask   : (method: string, params: object, signal: AbortSignal) => Promise<unknown>;
  tell  : (method: string, params: object, signal?: AbortSignal) => Promise<void>;
  close : () => void;
  dead  : () => string | null;
};

type Started = {
  up    : Promise<Spec[] | string> | null;
  fail  : { why: string; till: number } | null;
  link  : Link | null;
  names : Map<string, string>;
  stale : boolean;
};

type Told = {
  said  : string | null;
  shown : boolean;
  heard : Map<string, string | null>;
  left  : string;
};

type Kept = {
  conf  : config.McpServer;
  calls : number;
  gone  : boolean;
};

export type Server = Kept & Started & Told;

type Run = (device: string, job: Job, signal: AbortSignal) => Promise<Out>;
export type Servers = { all: Map<string, Server>; note: (text: string) => void; run: Run; open: (device: string) => boolean };

const START_MS = 60e3;
const RETRY_FAILED_START_MS = 30e3;
const KILL_AFTER_TERM_MS = 3e3;
const MESSAGE_MAX_CHARS = 16 * 2 ** 20;
const IMAGE_MAX_BYTES = 5 * 2 ** 20;

const EXPIRED = "ended its session (HTTP 404)";

const VERSION = "2025-06-18";
const INIT    = { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: "unii", version: "1" } };

const TAIL = 1000;

const PASS = WIN
  ? ["APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PROCESSOR_ARCHITECTURE", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERNAME", "USERPROFILE", "PROGRAMFILES"]
  : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR"];

const HERE = new Map<string, { link: Link; changed: boolean }>();

export namespace Mcp {

  export function servers(note: (text: string) => void, run: Run, open: (device: string) => boolean): Servers {
    return { all: new Map(), note, run, open };
  }

  export function sync(servers: Servers, confs: config.McpServer[]): void {
    const want = new Map(confs.map((conf) => [conf.name, conf]));
    for (const [name, s] of servers.all) {
      if (JSON.stringify(want.get(name)) !== JSON.stringify(s.conf)) {
        s.gone = true;
        if (s.calls === 0) {
          Mcp.close(s);
        }
        servers.all.delete(name);
      }
    }
    for (const conf of want.values()) {
      if (!servers.all.has(conf.name)) {
        servers.all.set(conf.name, { conf, up: null, fail: null, link: null, names: new Map(), stale: false, said: null, shown: false, heard: new Map(), left: "", calls: 0, gone: false });
      }
    }
  }

  export async function list(servers: Servers, off: string[]): Promise<Spec[]> {
    const on = [...servers.all.values()].filter((s) => !s.gone && !off.includes(s.conf.name));
    const lists = await Promise.all(on.map((s) => Mcp.start(servers, s)));
    return lists.flatMap((list) => (typeof list === "string" ? [] : list));
  }

  export function heard(servers: Servers, off: string[], who: string, viewed = false): string[] {
    const notes: string[] = [];
    for (const s of servers.all.values()) {
      if (s.gone || off.includes(s.conf.name) || s.said === (s.heard.get(who) ?? null) || (viewed && !s.shown)) {
        continue;
      }
      s.heard.set(who, s.said);
      notes.push(s.said ?? "MCP server " + s.conf.name + " works again.");
    }
    return notes;
  }

  export async function start(servers: Servers, s: Server): Promise<Spec[] | string> {
    if (!servers.open(s.conf.device)) {
      Mcp.close(s);
      s.fail = null;
      const why = "can't run: device " + s.conf.device + " isn't open";
      Mcp.tell(servers, s, why + "; its tools are left out until it is", false);
      return why;
    }
    if (s.link !== null && s.link.dead() !== null) {
      Mcp.close(s);
    }
    if (s.up === null && s.fail !== null && Date.now() < s.fail.till) {
      return s.fail.why;
    }
    if (s.up === null) {
      s.up = Mcp.open(servers, s);
    } else if (s.stale) {
      s.stale = false;
      s.up = s.up.then(() => Mcp.listed(servers, s, AbortSignal.timeout(START_MS))).catch((err: unknown) => "failed to list its tools: " + Mcp.why(err));
    }
    const up = s.up;
    const got = await up;
    if (s.up !== up) {
      return got;
    }
    if (typeof got === "string") {
      Mcp.close(s);
      s.fail = { why: got, till: Date.now() + RETRY_FAILED_START_MS };
      Mcp.tell(servers, s, got + "; its tools are left out until it starts", true);
      return got;
    }
    s.fail = null;
    if (s.said !== null) {
      s.said = null;
      if (s.shown) {
        Mcp.say(servers, s, "MCP server " + s.conf.name + " works again.");
      }
    }
    return got;
  }

  export async function open(servers: Servers, s: Server): Promise<Spec[] | string> {
    const timer = AbortSignal.timeout(START_MS);
    const changed = () => (s.stale = true);
    let up = false;
    let link: Link | null = null;
    const died = (why: string) => up && s.link === link && Mcp.tell(servers, s, why + "; the next call starts it again", false);
    try {
      link = s.link = Mcp.device(s.conf, servers.run, changed, died);
      await link.ask("initialize", INIT, timer);
      await link.tell("notifications/initialized", {}, timer);
      const specs = await Mcp.listed(servers, s, timer);
      up = true;
      return specs;
    } catch (err) {
      return timer.aborted ? "didn't start within " + START_MS / 1e3 + " s" : "failed to start: " + Mcp.why(err);
    }
  }

  // its tools, named for the model; one whose name is over the vendors'
  // 64 characters or clashes with another's once made theirs, or whose
  // input schema they refuse, left out, logged and told the chat
  export async function listed(servers: Servers, s: Server, signal: AbortSignal): Promise<Spec[]> {
    const specs: Spec[] = [];
    const names = new Map<string, string>();
    const left: string[] = [];
    let cursor: string | undefined;
    do {
      if (s.link === null) {
        throw new Error("was closed");
      }
      const got = await s.link.ask("tools/list", cursor === undefined ? {} : { cursor }, signal);
      for (const tool of items(get(got, "tools"))) {
        const name = Mcp.name(s.conf.name, String(get(tool, "name")));
        const long = name.length > 64 ? "its name for the model, " + name + ", is over 64 characters" : null;
        const schema = long ?? (names.has(name) ? "its name is another's for the model" : Mcp.schema(get(tool, "inputSchema")));
        if (typeof schema === "string") {
          left.push(JSON.stringify(String(get(tool, "name"))) + " (" + schema + ")");
          continue;
        }
        names.set(name, String(get(tool, "name")));
        specs.push({ name, info: text_of(get(tool, "description")), schema });
      }
      const more = get(got, "nextCursor");
      cursor = typeof more === "string" ? more : undefined;
    } while (cursor !== undefined);
    if (left.join(", ") !== s.left) {
      s.left = left.join(", ");
      if (s.left !== "") {
        console.error("unii: MCP server " + s.conf.name + " has tools left out: " + s.left);
        Mcp.say(servers, s, "MCP server " + s.conf.name + " has tools left out: " + s.left + ".");
      }
    }
    s.names = names;
    return specs;
  }

  // an input schema the vendors take, else why none: an object's, with
  // properties (Anthropic refuses anyOf, oneOf and allOf at its top)
  export function schema(given: unknown): object | string {
    const obj = rec(given) ? given : {};
    if (obj.type !== undefined && obj.type !== "object") {
      return "its input isn't an object";
    }
    const top = ["anyOf", "oneOf", "allOf"].find((k) => k in obj);
    if (top !== undefined) {
      return "its input schema has " + top + " at its top, which the vendors refuse";
    }
    return { ...obj, type: "object", properties: rec(obj.properties) ? obj.properties : {} };
  }

  export function tell(servers: Servers, s: Server, why: string, show: boolean): void {
    const text = "MCP server " + s.conf.name + " " + why + ".";
    if (text !== s.said) {
      s.said = text;
      s.shown = show;
      if (show) {
        Mcp.say(servers, s, text);
      }
    }
  }

  export function say(servers: Servers, s: Server, text: string): void {
    if (!s.gone) {
      servers.note(text);
    }
  }

  export function find(servers: Servers, off: string[], name: string): Server | null {
    const at = name.indexOf("__");
    const s = at > 0 ? servers.all.get(name.slice(0, at)) : undefined;
    return s !== undefined && !s.gone && !off.includes(s.conf.name) ? s : null;
  }

  export async function call(servers: Servers, s: Server, name: string, args: object, signal: AbortSignal): Promise<Out> {
    const head = "MCP server " + s.conf.name + " ";
    const fail = (text: string): Out => ({ text, fail: true });
    s.calls += 1;
    try {
      for (let again = true; ; again = false) {
        if (s.link === null || s.link.dead() !== null || !s.names.has(name) || !servers.open(s.conf.device)) {
          const got = await Mcp.start(servers, s);
          if (typeof got === "string") {
            return fail(head + got + ".");
          }
        }
        const link = s.link;
        if (link === null || !s.names.has(name)) {
          return fail("No tool " + name + ".");
        }
        const timer = AbortSignal.timeout(s.conf.timeout * 1000);
        try {
          return Mcp.out(await link.ask("tools/call", { name: s.names.get(name), arguments: args }, AbortSignal.any([signal, timer])));
        } catch (err) {
          const why = link.dead();
          if (signal.aborted) {
            return fail("Stopped.");
          }
          if (timer.aborted) {
            return fail(head + "didn't answer within " + s.conf.timeout + " s; the call was cancelled.");
          }
          if (again && why?.startsWith(EXPIRED)) {
            continue;
          }
          const next = why === "was ended by unii" ? "." : "; the next call starts it again.";
          return fail(head + (why === null ? "failed: " + Mcp.why(err) + "." : why + next));
        }
      }
    } finally {
      s.calls -= 1;
      if (s.gone && s.calls === 0) {
        Mcp.close(s);
      }
    }
  }

  export function out(got: unknown): Out {
    const texts: string[] = [];
    const imgs: Img[] = [];
    for (const part of items(get(got, "content"))) {
      const res = get(part, "resource");
      const [type, data, mime, said] = [get(part, "type"), get(part, "data"), get(part, "mimeType"), get(res, "text")];
      const pic = type === "image" && typeof data === "string" && typeof mime === "string" && /^image\/(png|jpeg|gif|webp)$/.test(mime);
      if (type === "text") {
        texts.push(text_of(get(part, "text")));
      } else if (pic && data.length * 0.75 <= IMAGE_MAX_BYTES) {
        imgs.push({ type: mime, data });
      } else if (type === "resource" && typeof said === "string") {
        texts.push(said);
      } else {
        texts.push("[" + [type, mime ?? get(res, "mimeType"), get(part, "uri") ?? get(res, "uri")].filter((x) => typeof x === "string").join(" ") + "]");
      }
    }
    if (texts.length === 0 && imgs.length === 0 && get(got, "structuredContent") !== undefined) {
      texts.push(JSON.stringify(get(got, "structuredContent")));
    }
    const text = clip();
    text.add(texts.join("\n"));
    return { text: text.text(), fail: get(got, "isError") === true, imgs };
  }

  export function close(s: Server): void {
    const link = s.link;
    s.link = null;
    link?.close();
    s.up = null;
    s.stale = false;
    s.names = new Map();
  }

  export function name(server: string, tool: string): string {
    return (server + "__" + tool).replace(/[^A-Za-z0-9_-]/g, "_");
  }

  export function why(err: unknown): string {
    return err_why(err);
  }

  export function reason(signal: AbortSignal): Error {
    const why: unknown = signal.reason;
    return why instanceof Error ? why : new Error(why === undefined ? "stopped" : text_of(why));
  }

  export function answer(msg: unknown): object {
    const id = get(msg, "id");
    if (get(msg, "method") === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "unii offers no " + String(get(msg, "method")) } };
  }

  export async function* texts(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = stream.getReader();
    const text = new TextDecoder();
    try {
      for (let got = await reader.read(); !got.done; got = await reader.read()) {
        yield text.decode(got.value, { stream: true });
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  export function stdio(conf: config.McpServer, changed: () => void, died: (why: string) => void): Link {
    const env = Object.fromEntries(PASS.flatMap((k) => {
      const v = process.env[k];
      return v === undefined ? [] : [[k, v]];
    }));
    const proc = Bun.spawn([conf.command, ...conf.args], { cwd: conf.cwd || undefined, env: { ...env, ...conf.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe", detached: !WIN, windowsHide: true });
    const waits = new Map<number, { ok: (got: unknown) => void; no: (err: Error) => void }>();
    let next = 0;
    let dead: string | null = null;
    let tail = "";
    let ended = false;
    const fail = (why: string) => {
      if (dead === null) {
        dead = why;
        died(why);
      }
      const gone = dead;
      waits.forEach((w) => w.no(new Error(gone)));
      waits.clear();
    };
    const write = (msg: object) => {
      try {
        void proc.stdin.write(JSON.stringify(msg) + "\n");
        void proc.stdin.flush();
      } catch {}
    };
    const heard = (line: string) => {
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const [id, method, error] = [get(msg, "id"), get(msg, "method"), get(msg, "error")];
      const w = waits.get(Number(id));
      if (method !== undefined && id !== undefined) {
        write(Mcp.answer(msg));
      } else if (method === "notifications/tools/list_changed") {
        changed();
      } else if (w !== undefined) {
        waits.delete(Number(id));
        error === undefined ? w.ok(get(msg, "result")) : w.no(new Error(text_of(get(error, "message"), JSON.stringify(error))));
      }
    };
    const end = () => {
      if (!ended) {
        ended = true;
        try {
          void proc.stdin.end();
        } catch {}
        try {
          process.kill(-proc.pid, "SIGTERM");
        } catch {}
        setTimeout(() => Machine.kill(-proc.pid), KILL_AFTER_TERM_MS).unref();
      }
    };
    (async () => {
      let rest: string[] = [];
      let size = 0;
      for await (const chunk of Mcp.texts(proc.stdout)) {
        const parts = chunk.split("\n");
        rest.push(parts[0]);
        size += parts[0].length;
        const lines = parts.length === 1 ? [] : [rest.join(""), ...parts.slice(1, -1)];
        if (parts.length > 1) {
          const last = parts[parts.length - 1];
          [rest, size] = [[last], last.length];
        }
        if (size > MESSAGE_MAX_CHARS || lines.some((line) => line.length > MESSAGE_MAX_CHARS)) {
          throw new Error("sent a message over " + MESSAGE_MAX_CHARS + " characters");
        }
        lines.forEach((line) => line.trim() !== "" && heard(line));
      }
    })().catch((err: unknown) => {
      fail(Mcp.why(err) + "; unii ended it");
      end();
    });
    const err = (async () => {
      for await (const chunk of Mcp.texts(proc.stderr)) {
        tail = (tail + chunk).slice(-TAIL);
      }
    })().catch(() => {});
    void proc.exited.then(async (code) => {
      end();
      await Promise.race([err, Bun.sleep(200)]);
      const how = proc.signalCode ? "was killed by " + proc.signalCode : "exited with code " + code;
      const said = tail.trim();
      fail(how + (said === "" ? "" : ": " + said.split("\n").slice(-5).join(" / ")));
    });
    const tell = (method: string, params: object) => {
      write({ jsonrpc: "2.0", method, params });
      return Promise.resolve();
    };
    const ask = (method: string, params: object, signal: AbortSignal) => new Promise<unknown>((ok, no) => {
      if (dead !== null || signal.aborted) {
        no(dead !== null ? new Error(dead) : Mcp.reason(signal));
        return;
      }
      const id = ++next;
      const stop = () => {
        waits.delete(id);
        void tell("notifications/cancelled", { requestId: id, reason: "stopped" });
        no(Mcp.reason(signal));
      };
      signal.addEventListener("abort", stop, { once: true });
      const done = () => signal.removeEventListener("abort", stop);
      waits.set(id, {
        ok: (got) => {
          done();
          ok(got);
        },
        no: (err) => {
          done();
          no(err);
        },
      });
      write({ jsonrpc: "2.0", id, method, params });
    });
    const close = () => {
      fail(dead ?? "was ended by unii");
      end();
    };
    return { ask, tell, close, dead: () => dead };
  }

  export function device(conf: config.McpServer, run: Run, changed: () => void, died: (why: string) => void): Link {
    const key = crypto.randomUUID();
    const job = (input: object): Job => ({ name: "mcp", input: { key, ...input }, cwd: "" });
    let dead: string | null = null;
    const send = async (input: object, signal: AbortSignal) => {
      if (dead !== null) {
        throw new Error(dead);
      }
      const out = await run(conf.device, job(input), signal);
      if (signal.aborted) {
        throw Mcp.reason(signal);
      }
      if (out.fail) {
        throw new Error(out.text);
      }
      const got: unknown = JSON.parse(out.text);
      if (get(got, "changed")) {
        changed();
      }
      if (get(got, "dead") && dead === null) {
        dead = String(get(got, "dead")) + " (on " + conf.device + ")";
        died(dead);
      }
      if (dead !== null || get(got, "error") !== undefined) {
        throw new Error(dead ?? String(get(got, "error")));
      }
      return get(got, "result");
    };
    const ask = (method: string, params: object, signal: AbortSignal) => send({ conf: method === "initialize" ? conf : undefined, method, params }, signal);
    const tell = (method: string, params: object, signal = AbortSignal.timeout(START_MS)) => send({ method, params, tell: true }, signal).then(() => {});
    const close = () => {
      if (dead === null) {
        dead = "was ended by unii";
        run(conf.device, job({ method: "close" }), AbortSignal.timeout(START_MS)).catch(() => undefined);
      }
    };
    return { ask, tell, close, dead: () => dead };
  }

  export async function here(input: Record<string, unknown>, signal: AbortSignal): Promise<Out> {
    const [key, method, params] = [String(input.key), String(input.method), rec(input.params) ? input.params : {}];
    const answer = (got: object): Out => {
      const s = HERE.get(key);
      const changed = s?.changed ?? false;
      if (s) {
        s.changed = false;
      }
      return { text: JSON.stringify({ ...got, changed }), fail: false };
    };
    let s = HERE.get(key);
    if (method === "close") {
      s?.link.close();
      HERE.delete(key);
      return answer({});
    }
    if (method === "initialize") {
      s?.link.close();
      HERE.delete(key);
      const c = input.conf as config.McpServer;
      const vars = (text: string) => text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, v: string) => {
        const value = process.env[v];
        if (value === undefined) {
          throw new Error("uses ${" + v + "}, which isn't set");
        }
        return value;
      });
      let conf: config.McpServer;
      try {
        const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, vars(v)]));
        const headers = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, vars(v)]));
        conf = { ...c, command: vars(c.command), args: c.args.map(vars), env, cwd: vars(c.cwd).replace(/^~(?=[\\/]|$)/, os.homedir()), url: vars(c.url), headers };
        if (conf.url !== "" && !URL.canParse(conf.url)) {
          throw new Error("needs a url");
        }
      } catch (err) {
        return answer({ dead: Mcp.why(err) });
      }
      const run = { link: null as unknown as Link, changed: false };
      const changed = () => (run.changed = true);
      run.link = conf.url ? Mcp.http(conf, changed) : Mcp.stdio(conf, changed, () => {});
      HERE.set(key, (s = run));
    }
    if (s === undefined) {
      return answer({ dead: "isn't running: unii there restarted or lost the server" });
    }
    try {
      const result = input.tell ? await s.link.tell(method, params) : await s.link.ask(method, params, signal);
      return answer({ result });
    } catch (err) {
      const dead = s.link.dead();
      if (dead !== null) {
        HERE.delete(key);
      }
      return answer(dead !== null ? { dead } : { error: Mcp.why(err) });
    }
  }

  export function lost(): void {
    HERE.forEach((s) => s.link.close());
    HERE.clear();
  }

  export function http(conf: config.McpServer, changed: () => void): Link {
    let session: string | null = null;
    let version: string | null = null;
    let dead: string | null = null;
    let next = 0;
    const ender = new AbortController();
    const headers = (): Record<string, string> => ({
      "content-type" : "application/json",
      "accept"       : "application/json, text/event-stream",
      ...conf.headers,
      ...(session === null ? {} : { "mcp-session-id": session }),
      ...(version === null ? {} : { "mcp-protocol-version": version }),
    });
    const post = (msg: object, signal: AbortSignal) => {
      return fetch(conf.url, { method: "POST", headers: headers(), body: JSON.stringify(msg), signal: AbortSignal.any([signal, ender.signal]), timeout: false } as RequestInit);
    };
    const tell = async (method: string, params: object, signal = AbortSignal.timeout(START_MS)) => {
      const res = await post({ jsonrpc: "2.0", method, params }, signal);
      await res.body?.cancel();
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
    };
    const heard = (msg: unknown, id: number): unknown => {
      if (get(msg, "method") !== undefined && get(msg, "id") !== undefined) {
        post(Mcp.answer(msg), AbortSignal.timeout(START_MS)).then((res) => res.body?.cancel(), () => undefined);
      } else if (get(msg, "method") === "notifications/tools/list_changed") {
        changed();
      } else if (Number(get(msg, "id")) === id) {
        return msg;
      }
      return null;
    };
    const read = async (res: Response, id: number): Promise<unknown> => {
      const sse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      const event = (text: string) => {
        const data = text.split(/\r\n|\r|\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, ""));
        try {
          return data.length === 0 ? null : heard(JSON.parse(data.join("\n")), id);
        } catch {
          return null;
        }
      };
      if (res.body === null) {
        throw new Error("sent no body");
      }
      let text = "";
      for await (const chunk of Mcp.texts(res.body)) {
        text += chunk;
        if (text.length > MESSAGE_MAX_CHARS) {
          throw new Error("sent a message over " + MESSAGE_MAX_CHARS + " characters");
        }
        const events = sse ? text.split(/\r\n\r\n|\n\n|\r\r/) : [];
        text = sse ? events.pop() ?? "" : text;
        for (const msg of events.map(event)) {
          if (msg !== null) {
            return msg;
          }
        }
      }
      return sse ? event(text) : heard(JSON.parse(text), id);
    };
    const ask = async (method: string, params: object, signal: AbortSignal) => {
      if (dead !== null) {
        throw new Error(dead);
      }
      const id = ++next;
      const stop = () => {
        tell("notifications/cancelled", { requestId: id, reason: "stopped" }).catch(() => undefined);
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        const res = await post({ jsonrpc: "2.0", id, method, params }, signal);
        if (res.status === 404 && session !== null) {
          await res.body?.cancel();
          end(EXPIRED);
          throw new Error(EXPIRED);
        }
        if (!res.ok) {
          throw new Error("HTTP " + res.status + ": " + (await res.text()).slice(0, 300));
        }
        session = method === "initialize" ? res.headers.get("mcp-session-id") : session;
        const msg = await read(res, id);
        if (msg === null) {
          throw new Error("no answer to " + method);
        }
        const error = get(msg, "error");
        if (error !== undefined) {
          throw new Error(text_of(get(error, "message"), JSON.stringify(error)));
        }
        version = method === "initialize" ? text_of(get(get(msg, "result"), "protocolVersion"), VERSION) : version;
        return get(msg, "result");
      } catch (err) {
        if (Mcp.why(err).startsWith("sent a message over")) {
          end(Mcp.why(err) + "; unii ended it");
        }
        throw dead !== null ? new Error(dead) : err;
      } finally {
        signal.removeEventListener("abort", stop);
      }
    };
    const end = (why: string) => {
      if (dead === null) {
        dead = why;
        ender.abort(new Error(why));
        if (session !== null && why !== EXPIRED) {
          fetch(conf.url, { method: "DELETE", headers: headers(), signal: AbortSignal.timeout(KILL_AFTER_TERM_MS) }).then((res) => res.body?.cancel(), () => undefined);
        }
      }
    };
    return { ask, tell, close: () => end("was ended by unii"), dead: () => dead };
  }

}
