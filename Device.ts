// Device
// ======
// `unii device [url]`: this computer as a device of a unii server, on
// its own, with no terminal open (`unii device -d` runs it as a
// background service: Service.ts). The agent's tools (Machine.ts) and the MCP programs a
// server runs on a device (Mcp.here) run here as jobs, each in its
// agent's dir under the work dir, till done or halted; all they left
// running dies as the device stops. Its file is device.json (Client.ts):
// the server, its sign-in, its name as the agent sees it (default: on
// macOS its local host name, Bonjour's, else the host's) and its work
// dir (default ~/.unii/work). It signs in once (the owner confirms it in
// a browser), then holds one socket to the server, opened again as one
// is lost. A job's output is an act ({ $: "out" }), kept till answered
// and sent again on the next socket, which the server does once.

import * as child from "node:child_process";
import * as os from "node:os";
import * as Client from "./Client.ts";
import { Machine, WIN, type Job } from "./Machine.ts";
import { Mcp } from "./Mcp.ts";
import { FRAME, PING, QUIT, RETRY, TICK, WIRE } from "./View.ts";

// Constants
// =========

const LOCAL = process.platform === "darwin" ? child.spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const HOST  = LOCAL || os.hostname();
const WORK  = "~/.unii/work";

// Device
// ======

// device.json, signed in to the server given (else its own: Client.server),
// the owner confirming it in a browser if it isn't yet: before `unii
// device -d` goes to the background too (Service.ts)
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
  const query = "?tab=" + crypto.randomUUID() + "&wire=" + WIRE + "&device=" + encodeURIComponent(name) + "&work=" + encodeURIComponent(work) + (WIN ? "&shell=PowerShell" : "");
  const jobs = new Map<string, AbortController>();
  const outs = new Map<string, object>();
  let ws: WebSocket | null = null;
  const send = (msg: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const open = () => {
    const sock = (ws = new WebSocket(url.replace(/^http/, "ws") + "/ws" + query, { headers: Client.auth(token) } as any));
    let heard = Date.now();
    let up = false;
    const tick = setInterval(() => Date.now() - heard > PING && sock.close(), PING / 2);
    sock.onopen = () => {
      up = true;
      outs.forEach((msg) => sock.send(JSON.stringify(msg)));
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
      clearInterval(tick);
      ws = null;
      Mcp.lost();
      if (!up && !await Client.signed(url, token)) {
        Client.fail("this device is signed out: run unii device to sign it in again");
      }
      setTimeout(open, RETRY);
    };
  };
  // a job run here, its output answered; one too large for a socket
  // message (FRAME, less 1 KiB for the act around it) answers its size
  // instead, failed (sent, it would close the socket at every try)
  const job = async (id: string, job: Job) => {
    const abort = new AbortController();
    jobs.set(id, abort);
    const out  = await Machine.run(job, work, abort.signal);
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
      ws?.close(QUIT);
      process.exit(0);
    });
  }
  open();
}
