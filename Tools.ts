import type { Ask, Block, Kind, Say } from "./AskAI.ts";
import type { Out } from "./Agent.ts";
import { report_text } from "./Call.ts";
import { clip_page } from "./Clip.ts";
import * as config from "./Config.ts";
import { Limit } from "./Limit.ts";
import { INT, STR, TOOLS, spec, type Job, type Skill, type Spec } from "./Machine.ts";
import { Mcp, type Server, type Servers } from "./Mcp.ts";
import { Memory } from "./Memory.ts";
import PROMPT from "./prompt.txt" with { type: "text" };
import COMPACT_PROMPT from "./compact.txt" with { type: "text" };
import { EFFORTS, Pick } from "./Pick.ts";
import { Run, type CallHooks, type Heard, type InboxHooks, type LoopHooks } from "./Run.ts";
import type { Msg } from "./Server.ts";
import * as Timer from "./Timer.ts";
import { PING, limit_show, type Pending } from "./View.ts";
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
};

type Running = { term: string; job: Job; out: Promise<Out>; end: (out: Out) => void };

type Link = { send: (msg: object) => void; live: () => boolean; work: string; scratch: string | null; shell: string | null };

type Spawn = { task: string; role: Agent["role"] };

type Agent = {
  name    : string;
  role    : { effort: string | null; model: string | null };
  why     : string | null;
  view    : Block[];
  replies : string[];
  run     : Run<Say, Say>;
};

type Log = {
  push   : (run: Run<Say, Say>, kind: Kind, text: string) => void;
  note   : (text: string) => void;
  on     : (run: Run<Say, Say>, ev: Heard) => void;
  report : (text: string, take: boolean) => void;
  change : () => void;
  timed  : () => void;
};

export type Tools = {
  mem     : Memory;
  devices : Map<string, Device>;
  agents  : Map<string, Agent>;
  mcp     : Servers;
  next    : config.McpServer[] | null;
  left    : boolean;
  key     : string;
  url     : string;
  main    : Run<Pending, Msg>;
  log     : Log;
};

export const SEARCHES = 10;

const HALT = 5000;

const GRACE = 3 * PING;

const CHATS = new Map<string, Tools>();
let HTTP: ReturnType<typeof Bun.serve> | null = null;

const RUNNING = new Map<string, Set<AbortController>>();
const SESSION = "mcp-session-id";

// the two prompts: the user prompt, every turn's (prompt.txt), and the
// compaction prompt, every summary's and nothing else (compact.txt, after
// upstream #37 by @tinqr: with one prompt for both, a turn sometimes came
// back a summary). Each is replaced by its file in the server's dir,
// written by hand or on the Settings page (Server.ts)
export const PROMPTS = {
  prompt  : { def: PROMPT.trim(), file: config.DIR + "/prompt.md" },
  compact : { def: COMPACT_PROMPT.trim(), file: config.DIR + "/compact.md" },
};

const SUB_HEAD = `You are a subagent of Unii, an AI agent that works for one user in a
single chat that never ends. Unii gave you a task. Do it yourself, with
your tools, following the user's instructions at the end of this
prompt: they say who the user is, how their files are organized and how
they want work done.

Your first message holds the view below, then your chat with Unii so far,
its lines as "i|kind: text": what you are (note), your task (user), and
later all you did and were told. The view shows you what Unii knows: what the user wants,
decided and taught. Use it as context only, and do what your task says,
not what the user's last message says, since Unii may have given you
just part of the work. Your final reply is your report to Unii. Unii may
send you more messages; one sent while you work reaches you once your
current reply is done, as a new message: answer the last.`;

const VIEW_DOC = `The view: the whole chat between Unii and the user, oldest first, inside
<chat> tags, as one-line summaries. Each line is

  id+n|text   the n messages from id on, summarized (newlines shown as spaces)

A summary tags each item with its kind: user (the user's words), unii
(Unii's replies), tool (Unii's tool calls), echo (their results), note
(memories from before this chat), or work (the report of a subagent,
starting "[Name]", or a scheduled message from the timer, starting "[Timer id]"). A short message is its own line, word for word. Recent lines
cover one message each; the older the messages, the more a line covers.
A message not summarized yet shows as "(not summarized yet: zoom it)".
No message appears in full, not even the last ones. A text too long for
one message is split over several in a row.

Navigating: zoom(id, n) opens line id+n into the two lines of n/2
messages it was made from; zoom(id, 1) gives message id in full, with
the images its "[image <file>]" lines name. Zoom whenever a summary
only mentions something you need, such as what your last reply said, a
decision, a past attempt or where a file is, before you act, guess or
ask. date(id) gives the date and time of message id. zoom("Name") gives
an agent's whole chat.`;

const SUB_NOTE   = "subagent";
const SUB_ON     = " on ";
const SUB_AT     = " at effort ";
const SUB_ROLE   = new RegExp("^" + SUB_NOTE + "(?:" + SUB_ON + "(\\S+))?(?:" + SUB_AT + "(\\S+))?$");

const MODELS = [...new Set(Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label))];

const TASK = { type: "object", properties: {
  task   : STR,
  model  : { type: "string", enum: MODELS, description: "Its model; by default, the one it'd run on. Set it ONLY when the user asks for that model or vendor in this chat, since another vendor may come with additional costs." },
  effort : { type: "string", enum: EFFORTS, description: "How hard it thinks; by default, as hard as you." },
}, required: ["task"] };

const DEVICES = `Devices: the user's computers that run unii's device now, by name, listed
at the start of each message. Your shell, read, write, edit, view_video and
show tools run on the one their \`device\` field names. A computer is listed only
while its device runs, and leaves the list when it stops: a task that needs
one not listed can't be done now, so tell the user it isn't available. Each
names its work dir, where the user's projects are, and its scratch dir, which
holds your own folder: put your scratch files and git worktrees there, never
among the user's projects. When you start work in a folder or repository, read
its AGENTS.md if it has one, and check its \`.agents/skills/\` for a SKILL.md
that fits the task.`;
const DEVICES_NONE = "(None is open now.)";
const MEDIA_AT = "Media and files in the chat, /media/<name>, are the files {dir}<name> on the server's computer.";

const SKILLS = "Skills on the devices open now, by device: when a task matches one's description, load it with the skill tool first, then follow it.";

const LOOK = 3000;

const SUB = SUB_HEAD + "\n\n" + VIEW_DOC + "\n\n" + DEVICES;
const AGENT_PROMPT = "Unii's own prompt follows, for the user's instructions in it. Where it speaks to Unii, it speaks of the agent you work for, not of you.";

const OWN: Spec[] = [
  spec("zoom", "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. With an agent's name as id, give that agent's whole chat. A long text comes in pages from character at, saying where to go on.", { id: { type: ["integer", "string"] }, n: INT, at: INT }, ["id"]),
  spec("date", "The date and time of message id.", { id: INT }, ["id"]),
];
const BOSS: Spec[] = [
  spec("spawn", "Start one subagent per task, in parallel, and return their names at once. Each one's report reaches you as a message \"[Name] report\" when it finishes. One that hits an AI service's usage limit waits for the reset and goes on by itself, as you do (Agents at work shows it waiting); stop ends it. A subagent sees the view and the user's instructions, but knows what you want only from its task. Each task names its own model and effort, if any.", { tasks: { type: "array", items: TASK } }, ["tasks"]),
  spec("tell", "Send a message to a subagent, by name. One at work gets it once its current reply is done (it waits, queued, as the user's messages do for you), and its report answers it; an idle one goes on from its chat, and its reply reaches you as a message \"[Name] reply\". To change what one at work is doing now, stop it, then tell it.", { name: STR, message: STR }, ["name", "message"]),
  spec("schedule", "Schedule a message to yourself: at its time it reaches you as a message \"[Timer id]\" from the timer, not the user, starting a turn as a report does, whether or not the user is online. Give `at` to send it once, or `cron` to send it again and again, and the time zone both are read in (the user's). Write the message as the task to do then, whole: by then this turn is far back in the view.", {
    message : STR,
    at      : { type: "string", description: "Once: YYYY-MM-DD HH:MM, in zone." },
    cron    : { type: "string", description: "Again and again: minute hour day month weekday, as cron, in zone (\"0 8 * * mon-fri\": weekdays at 08:00); its times at least 5 minutes apart." },
    zone    : { type: "string", description: "An IANA time zone, such as Europe/Amsterdam or UTC." },
  }, ["message", "zone"]),
  spec("schedules", "List the chat's schedules: id, when each comes next, its message.", {}, []),
  spec("unschedule", "Cancel a schedule, by its id.", { id: STR }, ["id"]),
  spec("stop", "Stop a subagent at once, by name, whatever it is doing (mid-call, waiting on a usage limit, running a tool on a device: that job is cancelled). Others keep running. Its report says it was stopped; its chat and scratch folder stay, so a later tell resumes it.", { name: STR, why: { type: "string", description: "Why, for its report." } }, ["name"]),
  spec("resume", "Wake every call on this server waiting for an AI service's usage limit (subagents, summaries), when the user says a limit was reset early. Each asks again once; one still limited waits again.", {}, []),
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

  export function serve(mem: Memory, main: Run<Pending, Msg>, log: Log): Tools {
    const key = crypto.randomUUID();
    const url = Tools.base() + key + "/";
    const run = (device: string, job: Job, signal: AbortSignal) => Tools.job(tools, device, job, signal, crypto.randomUUID());
    const mcp = Mcp.servers((text) => log.note(text), run, (device) => Tools.live(tools.devices.get(device)));
    const tools: Tools = { mem, devices: new Map(), agents: new Map(), mcp, next: null, left: false, key, url, main, log };
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

  export function prompt(which: keyof typeof PROMPTS): string {
    return Memory.file_text(PROMPTS[which].file) || PROMPTS[which].def;
  }

  export function devices(tools: Tools): Block {
    const work  = (d: Device) => [...d.terms.values()][0]?.work;
    const temp  = (d: Device) => [...d.terms.values()][0]?.scratch ?? work(d);
    const shell = (d: Device) => [...d.terms.values()][0]?.shell;
    const line  = ([name, d]: [string, Device]) => "- " + name + ", work dir " + work(d) + " (the user's projects), scratch dir " + temp(d) + (shell(d) ? ", shell " + shell(d) + " (stopping the device does not kill a process a call left running after its shell ended)" : "");
    const lines = Tools.opened(tools).map(line);
    return { text: "Devices open now:\n" + (lines.length === 0 ? DEVICES_NONE : lines.join("\n")) + "\n" + MEDIA_AT.replace("{dir}", tools.mem.dir + "/docs/media/") + "\n\n", mark: false };
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

  export function at_work(tools: Tools): Block {
    const names = Tools.working(tools).map(({ name, run }) => (run.limit === null ? name : name + " (" + limit_show(run.limit) + ")"));
    return { text: "Agents at work now: " + (names.length === 0 ? "none." : names.join(", ") + ".") + "\n\n", mark: false };
  }

  export async function fetch(req: Request): Promise<Response> {
    const [, key, who, ...rest] = new URL(req.url).pathname.split("/");
    const tools = CHATS.get(key);
    const caller = who === "main" || tools?.agents.has(who);
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
        const plugged = Tools.plugged(tools, who);
        const theirs = plugged ? await Mcp.list(tools.mcp, () => Tools.off(tools)) : [];
        const notes = plugged ? Mcp.heard(tools.mcp, Tools.off(tools), who) : [];
        const agent = tools.agents.get(who);
        notes.forEach((text) => agent !== undefined && tools.log.push(agent.run, "note", text));
        return { tools: [...Tools.list(who), ...theirs].map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema })), notes };
      }
      case "tools/call": {
        const name = String(params.name);
        const args = rec(params.arguments) ? params.arguments : {};
        const has = Tools.list(who).some((t) => t.name === name);
        const mcp = has ? null : Tools.mcp(tools, who, name);
        if (Tools.plugged(tools, who)) {
          Mcp.used(tools.mcp);
        }
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
    return who === "main" ? [...OWN, ...BOSS, ...kit(who), SKILL] : [...OWN, ...kit(who), SKILL];
  }

  export function plugged(tools: Tools, who: string): boolean {
    return who === "main" || tools.agents.has(who);
  }

  export function off(tools: Tools): string[] {
    return tools.mem.off ?? [];
  }

  export function mcp(tools: Tools, who: string, name: string): Server | null {
    return Tools.plugged(tools, who) ? Mcp.find(tools.mcp, Tools.off(tools), name) : null;
  }

  export function unplug(tools: Tools, name: string): void {
    const s = tools.mcp.all.get(name);
    if (s !== undefined) {
      Mcp.close(s);
    }
  }

  export async function call(tools: Tools, who: string, name: string, args: Record<string, unknown>, signal: AbortSignal, id: string): Promise<Out> {
    const mem = tools.mem;
    switch (name) {
      case "zoom": {
        const id = String(args.id);
        const n = Number(args.n ?? 1);
        const at = Number(args.at ?? 0);
        if (/^[A-Za-z]/.test(id)) {
          return { text: clip_page(Memory.agent_show(mem, id), at), fail: false };
        }
        const imgs = n === 1 && at === 0 ? Memory.images(mem, Number(id)) : [];
        return { text: Memory.zoom(mem, Number(id), n, at), fail: false, imgs };
      }
      case "date": {
        return { text: Memory.date(mem, Number(args.id)), fail: false };
      }
      case "spawn": {
        const tasks = Tools.spawns(args);
        return typeof tasks === "string" ? { text: tasks, fail: true } : { text: await Tools.spawn(tools, tasks), fail: false };
      }
      case "tell": {
        return { text: await Tools.tell(tools, String(args.name), String(args.message)), fail: false };
      }
      case "schedule": {
        return Tools.schedule(tools, Timer.timer_new(args, Date.now()));
      }
      case "schedules": {
        const lines = mem.timers.map(Timer.timer_line);
        return { text: lines.length === 0 ? "No schedules." : lines.join("\n"), fail: false };
      }
      case "unschedule": {
        const id = String(args.id);
        return Tools.unschedule(tools, id) ? { text: "Cancelled " + id + ".", fail: false } : { text: "No schedule " + id + ".", fail: true };
      }
      case "stop": {
        return await Tools.halt(tools, String(args.name), args.why === undefined ? "" : text_of(args.why, "null"));
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

  export function schedule(tools: Tools, timer: Timer.Timer | string): Out {
    const mem = tools.mem;
    if (typeof timer !== "string" && mem.timers.length >= Timer.TIMERS) {
      timer = "The chat has " + Timer.TIMERS + " schedules, the most it keeps: cancel one first.";
    }
    if (typeof timer === "string") {
      return { text: timer, fail: true };
    }
    mem.timers = [...mem.timers, timer];
    Memory.save(mem);
    tools.log.timed();
    return { text: "Scheduled " + timer.id + ": " + Timer.timer_when(timer) + ".", fail: false };
  }

  export function unschedule(tools: Tools, id: string): boolean {
    const mem = tools.mem;
    const left = mem.timers.filter((t) => t.id !== id);
    if (left.length === mem.timers.length) {
      return false;
    }
    mem.timers = left;
    Memory.save(mem);
    tools.log.timed();
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
    const d: Device = tools.devices.get(name) ?? { who, host, terms: new Map(), jobs: new Map(), skills: [], mcp: [], why: "", clash: "" };
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
    Tools.plug(tools);
  }

  export function detach_unless_back(tools: Tools, term: string, device: string, link: Link): void {
    if (tools.devices.get(device)?.terms.get(term) === link && !link.live()) {
      Tools.detach(tools, term, device);
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
        tools.log.note("The device " + device + "'s MCP servers: " + why + ".");
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
          tools.log.note(clash);
        }
      }
      if (d.mcp.length > 0 && other === undefined) {
        prefix_owner.set(prefix, name);
        next.push(...d.mcp);
      }
    }
    tools.next = next;
    tools.log.change();
  }

  export function left(tools: Tools): void {
    if (!tools.left && config.MCP_ENV_NOTE !== null) {
      tools.left = true;
      tools.log.note(config.MCP_ENV_NOTE);
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

  export function spawns(args: Record<string, unknown>): Spawn[] | string {
    if (args.model !== undefined || args.effort !== undefined) {
      return "Give model and effort per task, in each of tasks: { task, model?, effort? }. Nothing started.";
    }
    const out: Spawn[] = [];
    for (const [k, t] of items(args.tasks).entries()) {
      const x: Record<string, unknown> = typeof t === "string" ? { task: t } : rec(t) ? t : {};
      const task = typeof x.task === "string" ? x.task : "";
      const model = x.model === undefined ? null : text_of(x.model, "null");
      const effort = x.effort === undefined ? null : text_of(x.effort, "null");
      const bad = task === "" ? "no task text" : model !== null && !MODELS.includes(model) ? "no model " + model + "; one of " + MODELS.join(", ") : effort !== null && !EFFORTS.includes(effort) ? "no effort " + effort + "; one of " + EFFORTS.join(", ") : null;
      if (bad !== null) {
        return "Task " + (k + 1) + (task === "" ? "" : " (" + JSON.stringify(task.length > 60 ? task.slice(0, 60) + "…" : task) + ")") + ": " + bad + ". Nothing started.";
      }
      out.push({ task, role: { model, effort } });
    }
    return out;
  }

  export async function spawn(tools: Tools, tasks: Spawn[]): Promise<string> {
    const view = tasks.length === 0 ? "No tasks." : await Tools.view(tools);
    if (typeof view === "string") {
      return view;
    }
    const names = tasks.map(({ task, role }) => {
      const knobs = [role.model, role.effort === null ? null : "effort " + role.effort].filter((k) => k !== null);
      return Tools.start(tools, role, task, view) + (knobs.length === 0 ? "" : " (" + knobs.join(", ") + ")");
    });
    return "Started " + names.join(", ") + ". Each one's report will reach you as a message when it finishes.";
  }

  export function restarted(work: string[]): string {
    return "The server restarted, cutting " + work.join(", ") + "; nothing was lost: go on.";
  }

  export async function tell(tools: Tools, name: string, message: string, before: string[] = []): Promise<string> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      if (name in tools.mem.tells) {
        delete tools.mem.tells[name];
        Memory.save_queue(tools.mem);
      }
      return "No agent " + name + " to tell.";
    }
    const run = agent.run;
    if (run.busy && run.halt.signal.aborted) {
      await run.going.catch(() => {});
    }
    const idle = !run.busy;
    if (idle) {
      const view = await Tools.view(tools);
      if (typeof view === "string") {
        return view;
      }
      if (!run.busy) {
        Object.assign(agent, { view, replies: [], why: null });
      }
    }
    void Run.takes(run, [...before, message].map((text) => ({ text, imgs: [] })));
    return idle ? "Sent. " + name + "'s reply will reach you as a message." : "Sent. " + name + " gets it once its current reply is done, and its report answers it.";
  }

  export function start(tools: Tools, role: Agent["role"], task: string, view: Block[]): string {
    const name = Memory.agent_new(tools.mem);
    const agent = Tools.made(tools, name, role, view);
    tools.agents.set(name, agent);
    tools.log.push(agent.run, "note", SUB_NOTE + (role.model === null ? "" : SUB_ON + role.model) + (role.effort === null ? "" : SUB_AT + role.effort));
    void Run.take(agent.run, { text: task, imgs: [] });
    return name;
  }

  export function made(tools: Tools, name: string, role: Agent["role"], view: Block[]): Agent {
    const agent: Agent = { name, role, why: null, view, replies: [], run: Run.make<Say, Say>(name, Tools.kind(tools, () => agent)) };
    return agent;
  }

  export function agent(tools: Tools, name: string): Agent | null {
    const found = tools.agents.get(name) ?? Tools.logged(tools, name);
    if (found !== null) {
      tools.agents.set(name, found);
    }
    return found;
  }

  export function logged(tools: Tools, name: string): Agent | null {
    const log = Memory.agent(tools.mem, name);
    const note = log !== null && log.length > 0 && log[0].kind === "note" ? log[0].text : "";
    const sub = SUB_ROLE.exec(note);
    return sub === null ? null : Tools.made(tools, name, { effort: sub[2] ?? null, model: sub[1] ?? null }, []);
  }

  export function kind(tools: Tools, agent: () => Agent): Run<Say, Say>["kind"] {
    return { ...Tools.agent_inbox(tools), ...Tools.agent_calls(tools, agent), ...Tools.agent_loop(tools, agent), change: () => tools.log.change() };
  }

  export function agent_inbox(tools: Tools): InboxHooks<Say, Say> {
    const log = tools.log;
    return {
      log    : (run, say) => {
        log.push(run, "user", say.text);
        return say;
      },
      queued : (run) => {
        Tools.queued(tools, run);
        log.change();
      },
      again  : () => false,
    };
  }

  export function agent_calls(tools: Tools, agent: () => Agent): CallHooks<Say, Say> {
    return {
      pick   : () => Tools.pick(tools, agent()),
      ask    : (_, take) => {
        take();
        return Tools.ask(tools, agent());
      },
      ended  : (_, end) => {
        const a = agent();
        a.replies.push(end.ok ? end.text : a.why ?? "failed: " + end.text);
        return end.ok;
      },
      on     : (run, ev) => tools.log.on(run, ev),
    };
  }

  export function agent_loop(tools: Tools, agent: () => Agent): LoopHooks<Say, Say> {
    return {
      begin  : () => {},
      failed : (_, why) => {
        agent().replies.push("failed: " + why);
      },
      ending : () => {},
      finish : (run) => {
        const a = agent();
        run.fell = null;
        tools.log.report(report_text(a.name, a.replies.join("\n\n")), !run.halt.signal.aborted);
      },
    };
  }

  export function queued(tools: Tools, run: Run<Say, Say>): void {
    const texts = run.queue.map((x) => x.q.text);
    if (texts.length === 0 && !(run.name in tools.mem.tells)) {
      return;
    }
    if (texts.length === 0) {
      delete tools.mem.tells[run.name];
    } else {
      tools.mem.tells[run.name] = texts;
    }
    Memory.save_queue(tools.mem);
  }

  export function ask(tools: Tools, agent: Agent): Ask {
    const log = { text: Memory.agent_show(tools.mem, agent.name), mark: true };
    const server = Tools.at(tools, agent.name);
    const run = Pick.ask(Tools.pick(tools, agent));
    const own = Memory.file_text(PROMPTS.prompt.file);
    const system = own === "" ? SUB : SUB + "\n\n" + AGENT_PROMPT + "\n\n" + own;
    const blocks = [...agent.view, Tools.devices(tools), Tools.skills(tools), log];
    return { ...run, system, blocks, searches: SEARCHES, server, agent: true, who: agent.name };
  }

  export function pick(tools: Tools, agent: Agent): Pick {
    const base = config.AGENTS ?? tools.main.kind.pick();
    const { model, effort } = agent.role;
    const given = model === null ? base : Pick.to_model(base, model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(agent.name + "'s model " + model + " is no longer offered; spawn another subagent.");
    }
    return { ...given, effort: effort ?? given.effort };
  }

  export function shown(tools: Tools, agent: Agent): Pick | null {
    try {
      const { profile, ...pick } = Tools.pick(tools, agent);
      return agent.role.model === null && profile !== undefined ? { ...pick, profile } : pick;
    } catch {
      return null;
    }
  }

  export async function view(tools: Tools): Promise<Block[] | string> {
    const why = await Memory.settle(tools.mem, tools.mem.count, tools.main.halt.signal);
    return why ?? Memory.view(tools.mem, tools.mem.count, Memory.fitted(tools.mem));
  }

  export function working(tools: Tools): Agent[] {
    return [...tools.agents.values()].filter((a) => a.run.busy);
  }

  export function holding(tools: Tools): Agent[] {
    return Tools.working(tools).filter((a) => a.run.limit === null);
  }

  export async function halt(tools: Tools, name: string, why: string): Promise<Out> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return { text: "No agent " + name + ".", fail: true };
    }
    const run = agent.run;
    const working = run.busy;
    let ended = true;
    if (working) {
      const live = run.live.at(-1);
      const last = [...run.calls.values()].at(-1)?.text ?? (live && live.kind + ": " + live.text);
      const doing = last === undefined ? "" : " It was last at " + last.replace(/\s+/g, " ").slice(0, 300);
      agent.why = "Stopped by Unii" + (why.trim() === "" ? "." : ": " + why.trim().replace(/\.?$/, ".")) + doing;
      Tools.stop(tools, name);
      ended = await Promise.race([run.going.then(() => true, () => true), Bun.sleep(HALT).then(() => false)]);
    }
    const left = await Tools.sweep(tools, name);
    const runs = left.length === 0 ? "" : " Still running: " + left.join("; ") + ".";
    const text = !working ? name + " isn't working: nothing to stop." + (left.length === 0 ? "" : runs) : ended ? "Stopped " + name + "." + runs : "Stopping " + name + ": it hasn't ended yet." + runs;
    return { text, fail: !ended || left.length > 0 };
  }

  export async function sweep(tools: Tools, name: string): Promise<string[]> {
    const live = Tools.opened(tools).filter(([, d]) => [...d.terms.values()].some((t) => t.live()));
    const outs = await Promise.all(live.map(async ([device]) => {
      const run = Tools.start_job(tools, device, { name: "halt", input: { agent: name }, cwd: "main" }, crypto.randomUUID());
      if (typeof run === "string") {
        return null;
      }
      const timer = setTimeout(() => run.end({ text: "no answer", fail: true }), HALT);
      const out = await run.out;
      clearTimeout(timer);
      return out.fail ? device + ": " + out.text : null;
    }));
    return outs.filter((o) => o !== null);
  }

  export function stop(tools: Tools, name: string | null): void {
    for (const agent of Tools.working(tools).filter((a) => name === null || a.name === name)) {
      Run.stop(agent.run, null);
    }
  }

}
