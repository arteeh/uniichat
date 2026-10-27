import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Out } from "./Agent.ts";
import * as Client from "./Client.ts";
import { Machine, SCRATCH, WIN, type Job } from "./Machine.ts";
import { Mcp } from "./Mcp.ts";
import { err_code, err_why } from "./Err.ts";
import { get, text_of } from "./Json.ts";
import * as Service from "./Service.ts";
import { FRAME, media_kind, PING, QUIT, RETRY, TICK, WIRE, type Server } from "./View.ts";

const LOCAL = process.platform === "darwin" ? child.spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const HOST  = LOCAL || os.hostname();
const WORK  = "~/.unii/work";
const FILE  = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=[\\/]|$)/, os.homedir()) + "/config.json";

const LOOK = 2000;

const BYE = 2000;

const SENDABLE = FRAME - 1024;

export async function signin(given: string | undefined): Promise<{ url: string; token: string; name: string; work: string }> {
  const conf = Client.read("device");
  const url = Client.server(given, conf);
  const name = text_of(conf.name, HOST);
  const work = text_of(conf.work, WORK);
  const saved = conf.url === url && typeof conf.token === "string" ? conf.token : undefined;
  const token = saved !== undefined && await Client.signed(url, saved) ? saved : await Client.login(url, "the device " + name);
  Client.write("device", { ...conf, url, token, name, work });
  return { url, token, name, work };
}

export async function run(given: string | undefined): Promise<void> {
  const { url, token, name, work } = await signin(given);
  console.log("unii device " + name + " on " + url + ", work dir " + work);
  const query = "?tab=" + crypto.randomUUID() + "&wire=" + WIRE + "&device=" + encodeURIComponent(name) + "&work=" + encodeURIComponent(work) + "&scratch=" + encodeURIComponent(SCRATCH) + (WIN ? "&shell=PowerShell" : "");
  const jobs = new Map<string, AbortController>();
  const outs = new Map<string, { $: "out"; id: string; job: string; out: object }>();
  let ws: WebSocket | null = null;
  let quitting = false;
  const send = (msg: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  let told = "";
  const tell = () => {
    const mcp = servers();
    if (mcp !== null && mcp !== told && ws?.readyState === WebSocket.OPEN) {
      told = mcp;
      send({ $: "servers", id: crypto.randomUUID(), mcp: JSON.parse(mcp) as unknown });
    }
  };
  setInterval(tell, LOOK);
  const open = () => {
    const sock = (ws = new Client.Socket(url.replace(/^http/, "ws") + "/ws" + query, { headers: Client.auth(token) }));
    let heard = Date.now();
    let up = false;
    const tick = setInterval(() => Date.now() - heard > PING && sock.close(), PING / 2);
    sock.onopen = () => {
      up = true;
      Service.ready("device");
      outs.forEach((msg) => sock.send(JSON.stringify(msg)));
      told = "";
      tell();
    };
    sock.onmessage = (ev) => {
      heard = Date.now();
      if (ev.data === TICK) {
        return;
      }
      const msg = JSON.parse(String(ev.data)) as Server;
      if (msg.$ === "job" && !jobs.has(msg.id) && ![...outs.values()].some((o) => o.job === msg.id)) {
        void job(msg.id, msg.job);
      } else if (msg.$ === "jobs") {
        jobs.forEach((abort, id) => msg.ids.includes(id) || abort.abort());
      } else if (msg.$ === "ack") {
        outs.delete(msg.id);
      } else if (msg.$ === "note" || msg.$ === "error") {
        console.error("unii: " + msg.text);
      }
    };
    sock.onclose = async () => {
      if (quitting) {
        process.exit(0);
      }
      clearInterval(tick);
      ws = null;
      Mcp.lost();
      if (!up && !await Client.signed(url, token)) {
        Client.fail("this device is signed out: run unii device to sign it in again");
      }
      setTimeout(open, RETRY);
    };
  };
  const job = async (id: string, job: Job) => {
    const abort = new AbortController();
    jobs.set(id, abort);
    const out = await run_job(job, url, token, abort.signal);
    jobs.delete(id);
    const act = { $: "out" as const, id: crypto.randomUUID(), job: id, out: sendable_or_its_size(out) };
    outs.set(act.id, act);
    send(act);
  };
  process.on("exit", Machine.end);
  on_stop(() => {
    if (quitting) {
      return;
    }
    quitting = true;
    if (ws?.readyState !== WebSocket.OPEN) {
      process.exit(0);
    }
    ws.close(QUIT);
    setTimeout(() => process.exit(0), BYE);
  });
  open();
}

function run_job(job: Job, url: string, token: string, signal: AbortSignal): Promise<Out> {
  if (job.name === "show") {
    return show(job, url, token, signal);
  }
  if (job.name === "mcp") {
    return Mcp.here(job.input, signal).catch((err: unknown) => ({ text: err_why(err), fail: true }));
  }
  return Machine.run(job, signal);
}

function sendable_or_its_size(out: Out): Out {
  const size = Buffer.byteLength(JSON.stringify(out));
  return size <= SENDABLE ? out : { text: "The output, " + size + " bytes, is over the " + SENDABLE + " a tool may send.", fail: true };
}

function on_stop(stop: () => void): void {
  for (const sig of Service.STOP_SIGNALS) {
    process.on(sig, stop);
  }
}

async function show(job: Job, url: string, token: string, signal: AbortSignal): Promise<{ text: string; fail: boolean }> {
  const cwd = Machine.agent_dir(job.cwd);
  const lines: string[] = [];
  let fail = false;
  for (const p of [job.input.paths ?? []].flat().map(String)) {
    const out = await show_one(path.resolve(cwd, p), p, url, token, signal);
    fail ||= "error" in out;
    const stored = "error" in out ? "" : "/media/" + out.name;
    lines.push("error" in out ? out.error : (media_kind(stored) === null ? "" : "!") + "[" + path.basename(p).replace(/[[\]\\\n]/g, "") + "](" + stored + ")");
  }
  return { text: lines.join("\n"), fail };
}

async function show_one(file: string, shown: string, url: string, token: string, signal: AbortSignal): Promise<{ name: string } | { error: string }> {
  if (signal.aborted) {
    return { error: "Stopped." };
  }
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) {
    return { error: stat === undefined ? "No file " + shown + "." : shown + " is not a file." };
  }
  try {
    const res = await fetch(url + "/api/media?name=" + encodeURIComponent(path.basename(file)), { method: "POST", headers: Client.auth(token), body: Bun.file(file), signal });
    const out: unknown = await res.json().catch(() => null);
    if (typeof out === "object" && out !== null && "name" in out && typeof out.name === "string") {
      return { name: out.name };
    }
    return { error: typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : "HTTP " + res.status };
  } catch (err) {
    return { error: signal.aborted ? "Stopped." : "Can't reach the server: " + (err instanceof Error ? err.message : String(err)) };
  }
}

let said = "";
function servers(): string | null {
  try {
    const file: unknown = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
    let mcp: unknown = get(file, "mcp") || {};
    if (typeof mcp === "string") {
      mcp = JSON.parse(mcp.trim().startsWith("{") ? mcp : fs.readFileSync(mcp.trim().replace(/^~(?=[\\/]|$)/, os.homedir()), "utf8"));
    }
    said = "";
    return JSON.stringify(mcp);
  } catch (err) {
    // not the parser's why: it may quote a secret
    const why = err instanceof SyntaxError ? "isn't JSON" : "can't be read (" + (err_code(err) ?? String(err)) + ")";
    if (why !== said) {
      said = why;
      console.error("unii: " + FILE + " or its mcp " + why + ": the MCP servers told stay as they were");
    }
    return null;
  }
}
