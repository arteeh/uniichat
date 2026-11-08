import type { Block } from "./AskAI.ts";
import type { Out } from "./Agent.ts";
import * as config from "./Config.ts";
import { Limit } from "./Limit.ts";
import { INT, JOB, STR, TOOLS, spec, type Bg, type Job, type Skill, type Spec } from "./Machine.ts";
import { Mcp, type Servers } from "./Mcp.ts";
import { Memory } from "./Memory.ts";
import { Team, UNII } from "./Team.ts";
import * as Timer from "./Timer.ts";
import { PING } from "./View.ts";
import { err_why } from "./Err.ts";
import { get, list as items, rec, text_of } from "./Json.ts";

type Device = {
  who    : string;
  host   : string;
  terms  : Map<string, Link>;
  jobs   : Map<string, Running>;
  skills : Skill[];
  mcp    : config.McpServer[];
  why    : string;
  clash  : string;
  bg     : { term: string; jobs: Bg[] };
};

type Running = { term: string; job: Job; out: Promise<Out>; end: (out: Out) => void };

type Link = { send: (msg: object) => void; live: () => boolean; work: string; scratch: string | null; shell: string | null };

// an agent's place at the tools: its memory, and its chat's hooks
export type Seat = {
  mem    : Memory;
  note   : (text: string) => void;
  report : (text: string) => void;
  timed  : () => void;
  message: (to: string, text: string) => Promise<Out>;
};

// what the agents share: their notes on devices and MCP servers go to Unii
type Hub = {
  note   : (text: string) => void;
  change : () => void;
  off    : () => string[];
  docs   : string;
};

export type Tools = {
  devices : Map<string, Device>;
  seats   : Map<string, Seat>;
  mcp     : Servers;
  next    : config.McpServer[] | null;
  left    : boolean;
  key     : string;
  url     : string;
  hub     : Hub;
};

export const SEARCHES = 10;

const GRACE = 3 * PING;

const CHATS = new Map<string, Tools>();
let HTTP: ReturnType<typeof Bun.serve> | null = null;

const RUNNING = new Map<string, Set<AbortController>>();
const SESSION = "mcp-session-id";

const DEVICES_NONE = "(None is open now.)";
const MEDIA_AT = "Media and files in the chat, /media/<name>, are the files {dir}<name> on the server's computer.";

const SKILLS = "Skills on the devices open now, by device: when a task matches one's description, load it with the skill tool first, then follow it.";

const LOOK = 3000;

const ZOOM = "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. A long text comes in pages from character at, saying where to go on.";
const ZOOM_TEAM: Spec = spec("zoom", ZOOM + " With agent, a line of that agent's memory, from the team view.", { id: INT, n: INT, at: INT, agent: STR }, ["id"]);
const OWN: Spec[] = [
  spec("zoom", ZOOM, { id: INT, n: INT, at: INT }, ["id"]),
  spec("date", "The date and time of message id.", { id: INT }, ["id"]),
];
const BOSS: Spec[] = [
  spec("schedule", "Schedule a message to yourself: at its time it reaches you as a new message from the timer, starting \"[Timer id]\", and starts a turn as a report does, whether or not the user is online. Give `at` to send it once, or `cron` to send it again and again, and the time zone both are read in (the user's). Write the message as the task to do then, whole: by then this turn is far back in the view.", {
    message : STR,
    at      : { type: "string", description: "Once: YYYY-MM-DD HH:MM, in zone." },
    cron    : { type: "string", description: "Again and again: minute hour day month weekday, as cron, in zone (\"0 8 * * mon-fri\": weekdays at 08:00); its times at least 5 minutes apart." },
    zone    : { type: "string", description: "An IANA time zone, such as Europe/Amsterdam or UTC." },
  }, ["message", "zone"]),
  spec("schedules", "List the chat's schedules: id, when each comes next, its message.", {}, []),
  spec("unschedule", "Cancel a schedule, by its id.", { id: STR }, ["id"]),
  spec("message", "Send a message to another agent of the team, by name. It lands in their chat as a new message from you, starting \"[your name]\", and starts a turn there; one at work gets it right after its current tool calls. No one answers by itself: the only way to answer an agent is to call message to it, and your plain reply stays in your own chat, for the user.", { agent: STR, text: STR }, ["agent", "text"]),
  spec("resume", "Wake every call on this server waiting for an AI service's usage limit (other turns, summaries), when the user says a limit was reset early. Each asks again once; one still limited waits again.", {}, []),
];
const DEVICE = { device: { type: "string", description: "The name of the device to run on, one listed under Devices." } };
function kit(who: string): Spec[] {
  return TOOLS.map((t) => {
    const schema = t.schema as { properties: object; required: string[] };
    const info = t.info + " It runs on the device named; a relative path is in <scratch>/" + who + ", your scratch folder there, <scratch> being the scratch dir Devices lists for it.";
    return spec(t.name, info, { ...DEVICE, ...schema.properties }, ["device", ...schema.required]);
  });
}
const SKILL: Spec = spec("skill", "Load a skill listed under Skills: its SKILL.md, with the folder its other files are in on that device (read or run them there with your other tools).", { ...DEVICE, name: STR }, ["device", "name"]);

export namespace Tools {

  export function serve(hub: Hub): Tools {
    const key = crypto.randomUUID();
    const url = Tools.base() + key + "/";
    const run = (device: string, job: Job, signal: AbortSignal) => Tools.job(tools, device, job, signal, crypto.randomUUID());
    const mcp = Mcp.servers((text) => hub.note(text), run, (device) => Tools.live(tools.devices.get(device)));
    const tools: Tools = { devices: new Map(), seats: new Map(), mcp, next: null, left: false, key, url, hub };
    CHATS.set(key, tools);
    return tools;
  }

  export function base(): string {
    HTTP ??= Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: Tools.fetch });
    return "http://127.0.0.1:" + HTTP.port + "/";
  }

  export function at(tools: Tools, who: string): string {
    return tools.url + who;
  }

  export function devices(tools: Tools): Block {
    const work  = (d: Device) => [...d.terms.values()][0]?.work;
    const temp  = (d: Device) => [...d.terms.values()][0]?.scratch ?? work(d);
    const shell = (d: Device) => [...d.terms.values()][0]?.shell;
    const line  = ([name, d]: [string, Device]) => "- " + name + ", work dir " + work(d) + " (the user's projects), scratch dir " + temp(d) + (shell(d) ? ", shell " + shell(d) + " (stopping the device does not kill a process a call left running after its shell ended)" : "");
    const lines = Tools.opened(tools).map(line);
    return { text: "Devices open now:\n" + (lines.length === 0 ? DEVICES_NONE : lines.join("\n")) + "\n" + MEDIA_AT.replace("{dir}", tools.hub.docs + "/docs/media/") + "\n\n", mark: false };
  }

  export function skills(tools: Tools): Block {
    const lines = Tools.opened(tools).flatMap(([name, d]) => d.skills.toSorted((a, b) => Mcp.by_name(a.name, b.name)).map((s) => "- " + name + ": " + s.name + ": " + s.description.replace(/\s+/g, " ")));
    return { text: lines.length === 0 ? "" : SKILLS + "\n" + lines.join("\n") + "\n\n", mark: false };
  }

  export async function look(tools: Tools, only: string | null = null): Promise<void> {
    const live = Tools.opened(tools).filter(([name, d]) => (only === null || name === only) && [...d.terms.values()].some((t) => t.live()));
    await Promise.all(live.map(async ([name, d]) => {
      const run = Tools.start_job(tools, name, { name: "skills", input: {}, cwd: "main" }, crypto.randomUUID());
      if (typeof run === "string") {
        return;
      }
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        run.end({ text: "Late.", fail: true });
      }, LOOK);
      const out = await run.out;
      clearTimeout(timer);
      if (!late) {
        try {
          d.skills = out.fail ? [] : (JSON.parse(out.text) as Skill[]);
        } catch {
          d.skills = [];
        }
      }
    }));
  }

  export function at_work(tools: Tools, who: string): Block {
    const jobs = [...tools.devices].flatMap(([device, d]) => d.bg.jobs.filter((j) => j.agent === who).map((j) => j.id + " (" + [device, j.command.replace(/\s+/g, " ").trim().slice(0, 60), Math.round((Date.now() - j.since) / 60e3) + " min"].join(", ") + ")"));
    return { text: jobs.length === 0 ? "" : "Jobs running: " + jobs.join(", ") + ".\n\n", mark: false };
  }

  export async function fetch(req: Request): Promise<Response> {
    const [, key, who, ...rest] = new URL(req.url).pathname.split("/");
    const tools = CHATS.get(key);
    const caller = tools?.seats.has(who) === true;
    const msg: unknown = await req.json().catch(() => ({}));
    const [asked, method, params] = [get(msg, "id"), get(msg, "method"), get(msg, "params")];
    const id = crypto.randomUUID();
    const session = req.headers.get(SESSION) ?? "";
    const scope = [key, who, session].join("/") + "/";
    if (asked === undefined && method === "notifications/cancelled" && get(params, "requestId") !== undefined) {
      RUNNING.get(scope + JSON.stringify(get(params, "requestId")))?.forEach((c) => c.abort());
    }
    const cancel = new AbortController();
    const signal = AbortSignal.any([req.signal, cancel.signal]);
    const name = scope + JSON.stringify(asked);
    if (asked !== undefined) {
      RUNNING.set(name, (RUNNING.get(name) ?? new Set()).add(cancel));
    }
    try {
      if (tools === undefined || rest.length > 0 || !caller) {
        return new Response(null, { status: 404 });
      }
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      if (asked === undefined) {
        return new Response(null, { status: 202 });
      }
      const no = { error: { code: -32601, message: "no method " + String(method) } };
      const out = await Tools.answer(tools, who, String(method), rec(params) ? params : {}, signal, id).then(
        (result) => (result === null ? no : { result }),
        (err: unknown) => ({ error: { code: -32603, message: err_why(err) } }),
      );
      return Response.json({ jsonrpc: "2.0", id: asked, ...out });
    } finally {
      const set = RUNNING.get(name);
      if (set?.delete(cancel) && set.size === 0) {
        RUNNING.delete(name);
      }
    }
  }

  export async function answer(tools: Tools, who: string, method: string, params: Record<string, unknown>, signal: AbortSignal, id: string): Promise<object | null> {
    switch (method) {
      case "initialize": {
        const protocolVersion = params.protocolVersion ?? "2025-06-18";
        return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "unii", version: "1" } };
      }
      case "tools/list": {
        const theirs = await Mcp.list(tools.mcp, () => Tools.off(tools));
        const notes = Mcp.heard(tools.mcp, Tools.off(tools), who);
        return { tools: [...Tools.list(who), ...theirs].map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema })), notes };
      }
      case "tools/call": {
        const name = String(params.name);
        const args = rec(params.arguments) ? params.arguments : {};
        const has = Tools.list(who).some((t) => t.name === name);
        const mcp = has ? null : Mcp.find(tools.mcp, Tools.off(tools), name);
        Mcp.used(tools.mcp);
        const no: Out = { text: "No tool " + name + ".", fail: true };
        const out = has ? await Tools.call(tools, who, name, args, signal, id) : mcp !== null ? await Mcp.call(tools.mcp, mcp, name, args, signal) : no;
        const imgs = (out.imgs ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.type }));
        return { content: [{ type: "text", text: out.text }, ...imgs], isError: out.fail };
      }
      case "ping": {
        return {};
      }
    }
    return null;
  }

  export function list(who: string): Spec[] {
    return [...(who === "main" ? [ZOOM_TEAM, ...OWN.slice(1)] : OWN), ...BOSS, ...kit(who), SKILL];
  }

  export function off(tools: Tools): string[] {
    return tools.hub.off();
  }

  export function unplug(tools: Tools, name: string): void {
    const s = tools.mcp.all.get(name);
    if (s !== undefined) {
      Mcp.close(s);
    }
  }

  export async function call(tools: Tools, who: string, name: string, args: Record<string, unknown>, signal: AbortSignal, id: string): Promise<Out> {
    const seat = tools.seats.get(who);
    if (seat === undefined) {
      return { text: "No agent " + who + ".", fail: true };
    }
    const mem = seat.mem;
    switch (name) {
      case "zoom": {
        if (args.agent !== undefined && who === "main") {
          const them = Team.by_name(text_of(args.agent));
          const there = them === null || them.archived !== 0 ? undefined : tools.seats.get(them.id === UNII ? "main" : them.id);
          if (there === undefined) {
            return { text: "No agent " + text_of(args.agent) + " in the team.", fail: true };
          }
          return { text: Memory.zoom(there.mem, Number(args.id), Number(args.n ?? 1), Number(args.at ?? 0)), fail: false };
        }
        const id = Number(args.id);
        const n = Number(args.n ?? 1);
        const at = Number(args.at ?? 0);
        const imgs = n === 1 && at === 0 ? Memory.images(mem, id) : [];
        return { text: Memory.zoom(mem, id, n, at), fail: false, imgs };
      }
      case "date": {
        return { text: Memory.date(mem, Number(args.id)), fail: false };
      }
      case "schedule": {
        return Tools.schedule(seat, Timer.timer_new(args, Date.now()));
      }
      case "schedules": {
        const lines = mem.timers.map(Timer.timer_line);
        return { text: lines.length === 0 ? "No schedules." : lines.join("\n"), fail: false };
      }
      case "unschedule": {
        const id = String(args.id);
        return Tools.unschedule(seat, id) ? { text: "Cancelled " + id + ".", fail: false } : { text: "No schedule " + id + ".", fail: true };
      }
      case "message": {
        return await seat.message(text_of(args.agent), text_of(args.text));
      }
      case "resume": {
        const n = Limit.resume();
        return { text: n === 0 ? "No call was waiting for a usage limit." : "Woke " + n + " call" + (n === 1 ? "" : "s") + " waiting for a usage limit; any still limited waits again.", fail: false };
      }
      case "skill": {
        return Tools.job(tools, String(args.device), { name, input: { name: String(args.name) }, cwd: "main" }, signal, id);
      }
      default: {
        const { device, ...input } = args;
        return Tools.job(tools, String(device), { name, input, cwd: who }, signal, id);
      }
    }
  }

  export function schedule(seat: Seat, timer: Timer.Timer | string): Out {
    const mem = seat.mem;
    if (typeof timer !== "string" && mem.timers.length >= Timer.TIMERS) {
      timer = "The chat has " + Timer.TIMERS + " schedules, the most it keeps: cancel one first.";
    }
    if (typeof timer === "string") {
      return { text: timer, fail: true };
    }
    mem.timers = [...mem.timers, timer];
    Memory.save(mem);
    seat.timed();
    return { text: "Scheduled " + timer.id + ": " + Timer.timer_when(timer) + ".", fail: false };
  }

  export function unschedule(seat: Pick<Seat, "mem" | "timed">, id: string): boolean {
    const mem = seat.mem;
    const left = mem.timers.filter((t) => t.id !== id);
    if (left.length === mem.timers.length) {
      return false;
    }
    mem.timers = left;
    Memory.save(mem);
    seat.timed();
    return true;
  }

  export function device_name(tools: Tools, host: string, who: string, kept: Set<string>): { name: string; rejoined: boolean } {
    const own = [...tools.devices].find(([, d]) => d.who === who && d.host === host)?.[0];
    if (own !== undefined) {
      return { name: own, rejoined: true };
    }
    const held = (d: Device | undefined) => d !== undefined && (d.who === who || kept.has(d.who) || [...d.terms.values()].some((t) => t.live()));
    let name = host;
    for (let k = 2; held(tools.devices.get(name)); k++) {
      name = host + "-" + k;
    }
    return { name, rejoined: false };
  }

  export function attach(tools: Tools, term: string, host: string, who: string, link: Link, kept: Set<string>): string {
    const { name, rejoined } = Tools.device_name(tools, host, who, kept);
    if (!rejoined) {
      Tools.forget(tools, name);
    }
    const d: Device = tools.devices.get(name) ?? { who, host, terms: new Map(), jobs: new Map(), skills: [], mcp: [], why: "", clash: "", bg: { term: "", jobs: [] } };
    d.terms.set(term, link);
    tools.devices.set(name, d);
    for (const old of [...d.terms.keys()]) {
      if (old !== term) {
        Tools.detach(tools, old, name, "restarted");
      }
    }
    Tools.sync(d, term, () => true);
    void Tools.look(tools, name);
    Tools.plug(tools);
    return name;
  }

  export function sync(d: Device, term: string, fresh: (id: string) => boolean): void {
    const send = d.terms.get(term)?.send ?? (() => {});
    const mine = [...d.jobs].filter(([, j]) => j.term === term);
    send({ $: "jobs", ids: mine.map(([id]) => id) });
    mine.filter(([id]) => fresh(id)).forEach(([id, j]) => send({ $: "job", id, job: j.job }));
  }

  export function detach(tools: Tools, term: string, device: string, how = "stopped"): void {
    const d = tools.devices.get(device);
    if (d === undefined || !d.terms.delete(term)) {
      return;
    }
    for (const job of d.jobs.values()) {
      if (job.term === term) {
        job.end({ text: "The device " + device + " that ran this " + how + ".", fail: true });
      }
    }
    if (d.bg.term === term) {
      Tools.jobs_gone(tools, device, d, how);
    }
    Tools.plug(tools);
  }

  // only a device that stops kills its jobs; one gone otherwise may still
  // run them, and one that comes back reports them
  export function jobs_gone(tools: Tools, device: string, d: Device, how: string): void {
    const said = how === "stopped" ? "killed, the device stopped" : "no word on it: the device " + how + " while it ran" + (how === "went away" ? "; its report follows if the device comes back" : "");
    for (const job of d.bg.jobs) {
      Tools.report(tools, job.agent, JOB + job.id + "] " + device + ": " + said);
    }
    d.bg = { term: "", jobs: [] };
  }

  export function running(tools: Tools, device: string, term: string, jobs: unknown): void {
    const d = tools.devices.get(device);
    if (d !== undefined) {
      d.bg = { term, jobs: items(jobs).map((j) => ({ id: text_of(get(j, "id")), agent: text_of(get(j, "agent")), command: text_of(get(j, "command")), since: Number(get(j, "since")) })) };
    }
  }

  export function detach_unless_back(tools: Tools, term: string, device: string, link: Link): void {
    if (tools.devices.get(device)?.terms.get(term) === link && !link.live()) {
      Tools.detach(tools, term, device, "went away");
    }
  }

  export function lost(tools: Tools, term: string, device: string): void {
    const link = tools.devices.get(device)?.terms.get(term);
    if (link === undefined || link.live()) {
      return;
    }
    setTimeout(() => Tools.detach_unless_back(tools, term, device, link), GRACE).unref?.();
    Tools.plug(tools);
  }

  export function forget(tools: Tools, device: string): void {
    const d = tools.devices.get(device);
    if (d === undefined) {
      return;
    }
    tools.devices.delete(device);
    d.terms.clear();
    for (const job of [...d.jobs.values()]) {
      job.end({ text: "The device " + device + " that ran this was signed out.", fail: true });
    }
    Tools.jobs_gone(tools, device, d, "was signed out");
    Tools.plug(tools);
  }

  export function servers(tools: Tools, device: string, mcp: unknown): void {
    const d = tools.devices.get(device);
    if (d === undefined) {
      return;
    }
    const notes: string[] = [];
    try {
      d.mcp = config.config_mcp(mcp, device, notes);
    } catch (err) {
      d.mcp = [];
      notes.push(err_why(err).replace(/^config: /, ""));
    }
    const why = notes.join("; ");
    if (why !== d.why) {
      d.why = why;
      if (why !== "") {
        console.error("unii: device " + device + ": " + why);
        tools.hub.note("The device " + device + "'s MCP servers: " + why + ".");
      }
    }
    Tools.plug(tools);
  }

  export function same_prefix_note(name: string, prefix: string, other: string): string {
    return "The device " + name + "'s MCP servers are left out: their tools would be named " + prefix + "_…, as the device " + other + "'s are. Rename one of the two (name in its ~/.config/unii/device.json).";
  }

  export function plug(tools: Tools): void {
    const prefix_owner = new Map<string, string>();
    const next: config.McpServer[] = [];
    for (const [name, d] of tools.devices) {
      const prefix = config.config_mcp_prefix(name);
      const other = d.mcp.length === 0 ? undefined : prefix_owner.get(prefix);
      const clash = other === undefined ? "" : Tools.same_prefix_note(name, prefix, other);
      if (clash !== d.clash) {
        d.clash = clash;
        if (clash !== "") {
          console.error("unii: " + clash);
          tools.hub.note(clash);
        }
      }
      if (d.mcp.length > 0 && other === undefined) {
        prefix_owner.set(prefix, name);
        next.push(...d.mcp);
      }
    }
    tools.next = next;
    tools.hub.change();
  }

  export function left(tools: Tools): void {
    if (!tools.left && config.MCP_ENV_NOTE !== null) {
      tools.left = true;
      tools.hub.note(config.MCP_ENV_NOTE);
    }
  }

  export function live(d: Device | undefined): boolean {
    return d !== undefined && [...d.terms.values()].some((t) => t.live());
  }

  export function apply(tools: Tools): void {
    if (tools.next !== null) {
      Mcp.sync(tools.mcp, tools.next);
      tools.next = null;
    }
  }

  export function prune(tools: Tools, kept: Set<string>): void {
    for (const [name, d] of [...tools.devices]) {
      if (!kept.has(d.who)) {
        Tools.forget(tools, name);
      }
    }
  }

  export function opened(tools: Tools): [string, Device][] {
    return [...tools.devices].filter(([, d]) => d.terms.size > 0).sort(([a], [b]) => Mcp.by_name(a, b));
  }

  export function open(tools: Tools, device: string): Device | string {
    const d = tools.devices.get(device);
    const open = Tools.opened(tools).map(([name]) => name).join(", ") || "none";
    if (d === undefined || d.terms.size === 0) {
      return "No device " + device + " is open (its unii device isn't running). Open: " + open + ". Only the user starts it, so don't retry or wait: end your turn, saying what is left.";
    }
    return d;
  }

  export function job(tools: Tools, device: string, job: Job, signal: AbortSignal, id: string): Promise<Out> {
    const run = tools.devices.get(device)?.jobs.get(id) ?? Tools.start_job(tools, device, job, id);
    if (typeof run === "string") {
      return Promise.resolve({ text: run, fail: true });
    }
    const stop = () => run.end({ text: "Stopped.", fail: true });
    signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    return run.out;
  }

  export function start_job(tools: Tools, device: string, job: Job, id: string): Running | string {
    const d = Tools.open(tools, device);
    if (typeof d === "string") {
      return d;
    }
    const terms = [...d.terms];
    const [term] = terms.filter(([, t]) => t.live()).at(-1) ?? terms[terms.length - 1];
    const run = Tools.track(d, id, term, job);
    Tools.sync(d, term, (x) => x === id);
    return run;
  }

  export function track(d: Device, id: string, term: string, job: Job): Running {
    const { promise, resolve } = Promise.withResolvers<Out>();
    const end = (out: Out) => {
      if (d.jobs.delete(id)) {
        Tools.sync(d, term, () => false);
        resolve(out);
      }
    };
    const run = { term, job, out: promise, end };
    d.jobs.set(id, run);
    return run;
  }

  export function out(x: unknown): Out {
    const imgs = items(get(x, "imgs")).flatMap((img) => {
      const [type, data] = [get(img, "type"), get(img, "data")];
      return typeof type === "string" && typeof data === "string" ? [{ type, data }] : [];
    });
    return { text: text_of(get(x, "text")), fail: get(x, "fail") === true, ...(get(x, "imgs") === undefined ? {} : { imgs }) };
  }

  export function done(tools: Tools, device: string, id: string, out: Out): void {
    tools.devices.get(device)?.jobs.get(id)?.end(out);
  }

  // a job's report goes to the agent that started it, or to Unii if that one is gone
  export function report(tools: Tools, who: string, text: string): void {
    (tools.seats.get(who) ?? tools.seats.get("main"))?.report(text);
  }

}
