import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Client from "./Client.ts";
import { Machine, SCRATCH, WIN, type Job } from "./Machine.ts";
import { Mcp } from "./Mcp.ts";
import * as Service from "./Service.ts";
import { FRAME, media_kind, PING, QUIT, RETRY, TICK, WIRE } from "./View.ts";

const LOCAL = process.platform === "darwin" ? child.spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const HOST  = LOCAL || os.hostname();
const WORK  = "~/.unii/work";
const FILE  = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=[\\/]|$)/, os.homedir()) + "/config.json";

const LOOK = 2000;

const BYE = 2000;

export async function signin(given: string | undefined): Promise<{ url: string; token: string; name: string; work: string }> {
  const conf = Client.read("device");
  const url = Client.server(given, conf);
  const name = String(conf.name ?? HOST);
  const work = String(conf.work ?? WORK);
  let token: string | undefined = conf.url === url ? conf.token : undefined;
  if (!await Client.signed(url, token)) {
    token = await Client.login(url, "the device " + name);
  }
  Client.write("device", { ...conf, url, token, name, work });
  return { url, token: token!, name, work };
}

export async function run(given: string | undefined): Promise<void> {
  const { url, token, name, work } = await signin(given);
  console.log("unii device " + name + " on " + url + ", work dir " + work);
  const query = "?tab=" + crypto.randomUUID() + "&wire=" + WIRE + "&device=" + encodeURIComponent(name) + "&work=" + encodeURIComponent(work) + "&scratch=" + encodeURIComponent(SCRATCH) + (WIN ? "&shell=PowerShell" : "");
  const jobs = new Map<string, AbortController>();
  const outs = new Map<string, object>();
  let ws: WebSocket | null = null;
  let quitting = false;
  const send = (msg: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  let told = "";
  const tell = () => {
    const mcp = servers();
    if (mcp !== null && mcp !== told && ws?.readyState === WebSocket.OPEN) {
      told = mcp;
      send({ $: "servers", id: crypto.randomUUID(), mcp: JSON.parse(mcp) });
    }
  };
  setInterval(tell, LOOK);
  const open = () => {
    const sock = (ws = new WebSocket(url.replace(/^http/, "ws") + "/ws" + query, { headers: Client.auth(token) } as any));
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
      const msg = JSON.parse(String(ev.data));
      if (msg.$ === "job" && !jobs.has(msg.id) && ![...outs.values()].some((o: any) => o.job === msg.id)) {
        job(msg.id, msg.job);
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
    const out  = job.name === "show" ? await show(job, url, token, abort.signal) : await Machine.run(job, abort.signal);
    const size = Buffer.byteLength(JSON.stringify(out));
    const most = FRAME - 1024;
    const big  = { text: "The output, " + size + " bytes, is over the " + most + " a tool may send.", fail: true };
    jobs.delete(id);
    const act = { $: "out", id: crypto.randomUUID(), job: id, out: size > most ? big : out };
    outs.set(act.id, act);
    send(act);
  };
  process.on("exit", Machine.end);
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
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
  }
  open();
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
    const file = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : {};
    let mcp = file?.mcp || {};
    if (typeof mcp === "string") {
      mcp = JSON.parse(mcp.trim().startsWith("{") ? mcp : fs.readFileSync(mcp.trim().replace(/^~(?=[\\/]|$)/, os.homedir()), "utf8"));
    }
    said = "";
    return JSON.stringify(mcp);
  } catch (err: any) {
    // not the parser's why: it may quote a secret
    const why = err instanceof SyntaxError ? "isn't JSON" : "can't be read (" + (err?.code ?? err) + ")";
    if (why !== said) {
      said = why;
      console.error("unii: " + FILE + " or its mcp " + why + ": the MCP servers told stay as they were");
    }
    return null;
  }
}
