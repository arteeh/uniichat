// Tools
// =====
// Unii's prompts, tools and agents. Calls get the tools as MCP over one
// local port, at a URL with the chat's secret and the caller ("main", an
// agent; a compaction has none).
// shell, read, write, edit and view_video run on the device their
// `device` field names: a computer running `unii device` (Device.ts), one
// per sign-in (host, host-2...), listed in each call's message. A name
// stays its sign-in's while the server runs, so a call meant for one
// computer never reaches another. A device's links are its sockets: one
// whose link is lost stays, its jobs waiting, until it quits. It is told its
// jobs' ids as they change, and each job new to it; a job's output is an
// act (Server.ts). A device's skills (Machine.skills), read as a job when
// it joins and as each turn starts, are listed in each call's message
// while it is open; the skill tool loads one, as a job too.
// A subagent has a name and a log; each call
// gets its context and its whole log, so a told agent goes on even after
// a restart; its replies reach the chat as one "[Name]" message.
// The master's schedules (schedule, schedules, unschedule) are kept with
// its chat, each coming as a "[Timer id]" message (Timer.ts). Its resume
// wakes every call waiting for a usage limit (Agent.resume), for a user
// who knows one lifted early.
// The user's MCP servers (Mcp.ts) add their tools to the master's and its
// subagents', but those of servers the chat turned off (Memory `off`).

import { AskAI, type Ask, type Block, type Call, type Event, type Kind } from "./AskAI.ts";
import { Agent, type Out } from "./Agent.ts";
import { report_text } from "./Call.ts";
import { clip_page } from "./Clip.ts";
import * as config from "./Config.ts";
import { INT, STR, TOOLS, spec, type Job, type Skill, type Spec } from "./Machine.ts";
import { Mcp, type Server, type Servers } from "./Mcp.ts";
import { Memory } from "./Memory.ts";
import PROMPT from "./prompt.txt" with { type: "text" };
import COMPACT_PROMPT from "./compact.txt" with { type: "text" };
import { EFFORTS, Pick } from "./Pick.ts";
import * as Timer from "./Timer.ts";
import type { Live } from "./View.ts";

export type { Live };

// Types
// =====

// a device: its sign-in (a session's hash), its links by tab (none:
// closed), jobs by id, and its skills as last looked at (Tools.look)
type Device = {
  who    : string;
  terms  : Map<string, Link>;
  jobs   : Map<string, Running>;
  skills : Skill[];
};

// a job: the link it runs on, what it runs, its output, what ends it
type Running = { term: string; job: Job; out: Promise<Out>; end: (out: Out) => void };

// a device's link: how to reach it, whether its socket is open now, its
// work dir, its shell if not a POSIX one
export type Link = { send: (msg: object) => void; live: () => boolean; work: string; shell: string | null };

// at work, the view its calls get and its replies so far
export type Agent = {
  name    : string;
  role    : { effort: string | null; model: string | null };
  call    : Call | null;
  live    : Live[];
  calls   : Record<string, string>; // its tool calls awaiting their results, by id (Chat.on)
  stop    : boolean; // its call was stopped: the report stays unanswered
  why     : string | null; // its report, if stopped by the stop tool
  view    : Block[];
  replies : string[];
};

// what the server does for agents (report: work stopped stays unanswered;
// pick: the chat's pick; halt: what stops its turn; note: a note to the
// chat, as of an MCP server failing), and as the chat's schedules change
// (timed)
type Hooks = {
  push   : (agent: Agent, kind: Kind, text: string) => void;
  note   : (text: string) => void;
  on     : (agent: Agent, ev: Event) => void;
  report : (agent: Agent, text: string, stopped: boolean) => void;
  change : () => void;
  timed  : () => void;
  pick   : () => Pick;
  halt   : () => AbortSignal;
};

// the tools: the chat's MCP servers
export type Tools = {
  mem     : Memory;
  devices : Map<string, Device>;
  agents  : Map<string, Agent>;
  mcp     : Servers;
  key     : string;
  url     : string;
  hooks   : Hooks;
};

// Constants
// =========

// the most web searches a request of a turn or a subagent runs
export const SEARCHES = 10;

// how long the stop tool waits for its agent to end (ms)
const HALT = 5000;

// the chats' tools, by their secret; the server, once one is
const CHATS = new Map<string, Tools>();
let HTTP: ReturnType<typeof Bun.serve> | null = null;

// the requests running, by chat, caller, MCP session and JSON-RPC id:
// what a `notifications/cancelled` for one stops
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
send you more messages, even while you work: answer the last.`;

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

// an agent's log starts with a note of what it is: SUB_NOTE, and its
// model and effort if not the configured ones
const SUB_NOTE   = "subagent";
const SUB_ON     = " on ";
const SUB_AT     = " at effort ";
const SUB_ROLE   = new RegExp("^" + SUB_NOTE + "(?:" + SUB_ON + "(\\S+))?(?:" + SUB_AT + "(\\S+))?$");

// the models a subagent may be given (Tools.call)
const MODELS = Pick.models(config.OFFER.vendors, config.OFFER.models).map(([, m]) => m.label);

// the devices: how they work, in the system prompt (DEVICES); those open
// now, at the start of each call's message (Tools.devices), so one
// joining or leaving changes a call's tail, never its cached prefix
const DEVICES = `Devices: the user's computers that run unii's device now, by name, listed
at the start of each message. Your shell, read, write, edit and view_video
tools run on the one their \`device\` field names. A computer is listed only
while its device runs, and leaves the list when it stops: a task that needs
one not listed can't be done now, so tell the user it isn't available.`;
const DEVICES_NONE = "(None is open now.)";

const SKILLS = "Skills on the devices open now, by device: when a task matches one's description, load it with the skill tool first, then follow it.";

// how long a device may take to list its skills, in ms: one that takes
// longer keeps those it listed last
const LOOK = 3000;

// a subagent's prompt: its part, then the view's and the devices' docs;
// then, after AGENT_PROMPT, the user prompt if the user wrote one (their
// instructions are in it; the built-in one holds none, only Unii's turns)
const SUB = SUB_HEAD + "\n\n" + VIEW_DOC + "\n\n" + DEVICES;
const AGENT_PROMPT = "Unii's own prompt follows, for the user's instructions in it. Where it speaks to Unii, it speaks of the agent you work for, not of you.";

// the tools of everyone (OWN), the master's (BOSS), those that run on a
// device (`kit`: Machine.ts's)
const OWN: Spec[] = [
  spec("zoom", "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. With an agent's name as id, give that agent's whole chat. A long text comes in pages from character at, saying where to go on.", { id: { type: ["integer", "string"] }, n: INT, at: INT }, ["id"]),
  spec("date", "The date and time of message id.", { id: INT }, ["id"]),
];
const BOSS: Spec[] = [
  spec("spawn", "Start one subagent per task, in parallel, and return their names at once. Each one's report reaches you as a message \"[Name] report\" when it finishes. A subagent sees the view and the user's instructions, but knows what you want only from its task.", { tasks: { type: "array", items: STR }, effort: { type: "string", enum: EFFORTS, description: "How hard they think; by default, as hard as you." }, model: { type: "string", enum: MODELS, description: "Their model; by default, the one they'd run on. Set it ONLY when the user asks for that model or vendor in this chat, since another vendor may come with additional costs." } }, ["tasks"]),
  spec("tell", "Send a message to a subagent, by name. One at work reads it between its tool calls, and its report answers it; an idle one goes on from its chat, and its reply reaches you as a message \"[Name] reply\".", { name: STR, message: STR }, ["name", "message"]),
  spec("schedule", "Schedule a message to yourself: at its time it reaches you as a message \"[Timer id]\" from the timer, not the user, starting a turn as a report does, whether or not the user is online. Give `at` to send it once, or `cron` to send it again and again, and the time zone both are read in (the user's). Write the message as the task to do then, whole: by then this turn is far back in the view.", {
    message : STR,
    at      : { type: "string", description: "Once: YYYY-MM-DD HH:MM, in zone." },
    cron    : { type: "string", description: "Again and again: minute hour day month weekday, as cron, in zone (\"0 8 * * mon-fri\": weekdays at 08:00); its times at least 5 minutes apart." },
    zone    : { type: "string", description: "An IANA time zone, such as Europe/Amsterdam or UTC." },
  }, ["message", "zone"]),
  spec("schedules", "List the chat's schedules: id, when each comes next, its message.", {}, []),
  spec("unschedule", "Cancel a schedule, by its id.", { id: STR }, ["id"]),
  spec("stop", "Stop a subagent at once, by name, whatever it is doing (mid-call, waiting on a usage limit, running a tool on a device: that job is cancelled). Others keep running. Its report says it was stopped; its chat and work dir stay, so a later tell resumes it.", { name: STR, why: { type: "string", description: "Why, for its report." } }, ["name"]),
  spec("resume", "Wake every call on this server waiting for an AI service's usage limit (your turn, summaries), when the user says a limit was reset early. Each asks again once; one still limited waits again. A subagent at a usage limit ends and reports it instead: tell it to go on.", {}, []),
];
const DEVICE = { device: { type: "string", description: "The name of the device to run on, one listed under Devices." } };
function kit(who: string): Spec[] {
  return TOOLS.map((t) => {
    const schema = t.schema as { properties: object; required: string[] };
    const info = t.info + " It runs on the device named, in <work>/" + who + ", <work> being the work dir Devices lists for it.";
    return spec(t.name, info, { ...DEVICE, ...schema.properties }, ["device", ...schema.required]);
  });
}
const SKILL: Spec = spec("skill", "Load a skill listed under Skills: its SKILL.md, with the folder its other files are in on that device (read or run them there with your other tools).", { ...DEVICE, name: STR }, ["device", "name"]);
// Tools
// =====

export namespace Tools {

  export function serve(mem: Memory, hooks: Hooks): Tools {
    const key = crypto.randomUUID();
    const url = Tools.base() + key + "/";
    const run = (device: string, job: Job, signal: AbortSignal) => Tools.job(tools, device, job, signal, crypto.randomUUID());
    const mcp = Mcp.servers((text) => hooks.note(text), config.MCP, run, (device) => typeof Tools.open(tools, device) !== "string");
    const tools: Tools = { mem, devices: new Map(), agents: new Map(), mcp, key, url, hooks };
    CHATS.set(key, tools);
    return tools;
  }

  // this process's tools URL
  export function base(): string {
    HTTP ??= Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: Tools.fetch });
    return "http://127.0.0.1:" + HTTP.port + "/";
  }

  export function close(tools: Tools): void {
    Tools.stop(tools, null);
    Mcp.end(tools.mcp);
    CHATS.delete(tools.key);
  }

  export function at(tools: Tools, who: string): string {
    return tools.url + who;
  }

  // a prompt as used: its file, else its default
  export function prompt(which: keyof typeof PROMPTS): string {
    return Memory.file_text(PROMPTS[which].file) || PROMPTS[which].def;
  }

  export function devices(tools: Tools): Block {
    const work  = (d: Device) => [...d.terms.values()][0]?.work;
    const shell = (d: Device) => [...d.terms.values()][0]?.shell;
    const line  = ([name, d]: [string, Device]) => "- " + name + ", work dir " + work(d) + (shell(d) ? ", shell " + shell(d) + " (stopping the device does not kill a process a call left running after its shell ended)" : "");
    const lines = Tools.opened(tools).map(line);
    return { text: "Devices open now:\n" + (lines.length === 0 ? DEVICES_NONE : lines.join("\n")) + "\n\n", mark: false };
  }

  // after the devices, so a change hits a call's tail, not its cached
  // prefix
  export function skills(tools: Tools): Block {
    const lines = Tools.opened(tools).flatMap(([name, d]) => d.skills.map((s) => "- " + name + ": " + s.name + ": " + s.description.replace(/\s+/g, " ")));
    return { text: lines.length === 0 ? "" : SKILLS + "\n" + lines.join("\n") + "\n\n", mark: false };
  }

  // each open device's skills, asked as a job; one that fails (a unii
  // from before skills) has none
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
          d.skills = out.fail ? [] : JSON.parse(out.text);
        } catch {
          d.skills = [];
        }
      }
    }));
  }

  // the master's agents at work now, at the start of each of its calls'
  // messages: read from their calls, so the list is never kept apart and
  // can't drift from the truth
  export function at_work(tools: Tools): Block {
    const names = Tools.working(tools).map((a) => a.name);
    return { text: "Agents at work now: " + (names.length === 0 ? "none." : names.join(", ") + ".") + "\n\n", mark: false };
  }

  // MCP
  // ---

  // a notification gets no answer; a request dropped, or cancelled (a
  // `notifications/cancelled` naming it), stops its job
  export async function fetch(req: Request): Promise<Response> {
    const [, key, who, ...rest] = new URL(req.url).pathname.split("/");
    const tools = CHATS.get(key);
    const caller = who === "main" || tools?.agents.has(who);
    const msg = await req.json().catch(() => ({}));
    const id = crypto.randomUUID();
    const session = req.headers.get(SESSION) ?? "";
    const scope = [key, who, session].join("/") + "/";
    if (msg.id === undefined && msg.method === "notifications/cancelled" && msg.params?.requestId !== undefined) {
      RUNNING.get(scope + JSON.stringify(msg.params.requestId))?.forEach((c) => c.abort());
    }
    const cancel = new AbortController();
    const signal = AbortSignal.any([req.signal, cancel.signal]);
    const name = scope + JSON.stringify(msg.id);
    if (msg.id !== undefined) {
      RUNNING.set(name, (RUNNING.get(name) ?? new Set()).add(cancel));
    }
    try {
      if (tools === undefined || rest.length > 0 || !caller) {
        return new Response(null, { status: 404 });
      }
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      if (msg.id === undefined) {
        return new Response(null, { status: 202 });
      }
      const no = { error: { code: -32601, message: "no method " + msg.method } };
      const out = await Tools.answer(tools, who, msg.method, msg.params ?? {}, signal, id).then(
        (result) => (result === null ? no : { result }),
        (err) => ({ error: { code: -32603, message: String(err?.message ?? err) } }),
      );
      return Response.json({ jsonrpc: "2.0", id: msg.id, ...out });
    } finally {
      const set = RUNNING.get(name);
      if (set?.delete(cancel) && set.size === 0) {
        RUNNING.delete(name);
      }
    }
  }

  // null: no such method
  export async function answer(tools: Tools, who: string, method: string, params: any, signal: AbortSignal, id: string): Promise<object | null> {
    switch (method) {
      case "initialize": {
        const protocolVersion = params.protocolVersion ?? "2025-06-18";
        return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "unii", version: "1" } };
      }
      case "tools/list": {
        const plugged = Tools.plugged(tools, who);
        const theirs = plugged ? await Mcp.list(tools.mcp, Tools.off(tools)) : [];
        // the servers' notes `who` hasn't heard, for the request it
        // builds (Agent.loop); a subagent's kept in its log for its next
        // ones (the master's are the chat's)
        const notes = plugged ? Mcp.heard(tools.mcp, Tools.off(tools), who) : [];
        const agent = tools.agents.get(who);
        notes.forEach((text) => agent !== undefined && tools.hooks.push(agent, "note", text));
        return { tools: [...Tools.list(tools, who), ...theirs].map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema })), notes };
      }
      case "tools/call": {
        const name = String(params.name);
        const args = params.arguments ?? {};
        const has = Tools.list(tools, who).some((t) => t.name === name);
        const mcp = has ? null : Tools.mcp(tools, who, name);
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

  export function list(tools: Tools, who: string): Spec[] {
    return who === "main" ? [...OWN, ...BOSS, ...kit(who), SKILL] : [...OWN, ...kit(who), SKILL];
  }

  // whether `who` gets the MCP servers' tools: the master and subagents
  export function plugged(tools: Tools, who: string): boolean {
    return who === "main" || tools.agents.has(who);
  }

  // the MCP servers the chat turned off
  export function off(tools: Tools): string[] {
    return tools.mem.off ?? [];
  }

  // the MCP server of `who`'s tool `name`, if it is on (named for it: it
  // need not have listed its tools since it crashed; Mcp.call starts it)
  export function mcp(tools: Tools, who: string, name: string): Server | null {
    return Tools.plugged(tools, who) ? Mcp.find(tools.mcp, Tools.off(tools), name) : null;
  }

  // an MCP server turned off: ended, its calls running failed
  export function unplug(tools: Tools, name: string): void {
    const s = tools.mcp.all.get(name);
    if (s !== undefined) {
      Mcp.close(s);
    }
  }

  // id: a job's, if it starts one
  export async function call(tools: Tools, who: string, name: string, args: any, signal: AbortSignal, id: string): Promise<Out> {
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
        const effort = args.effort === undefined ? null : String(args.effort);
        if (effort !== null && !EFFORTS.includes(effort)) {
          return { text: "No effort " + effort + "; one of " + EFFORTS.join(", ") + ".", fail: true };
        }
        const model = args.model === undefined ? null : String(args.model);
        if (model !== null && !MODELS.includes(model)) {
          return { text: "No model " + model + "; one of " + MODELS.join(", ") + ".", fail: true };
        }
        return { text: await Tools.spawn(tools, (args.tasks ?? []).map(String), effort, model), fail: false };
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
        return await Tools.halt(tools, String(args.name), args.why === undefined ? "" : String(args.why));
      }
      case "resume": {
        const n = Agent.resume();
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

  // Schedules
  // ---------

  // a schedule kept with the chat; else why not
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
    tools.hooks.timed();
    return { text: "Scheduled " + timer.id + ": " + Timer.timer_when(timer) + ".", fail: false };
  }

  // false: none such
  export function unschedule(tools: Tools, id: string): boolean {
    const mem = tools.mem;
    const left = mem.timers.filter((t) => t.id !== id);
    if (left.length === mem.timers.length) {
      return false;
    }
    mem.timers = left;
    Memory.save(mem);
    tools.hooks.timed();
    return true;
  }

  // Devices
  // -------

  // a device's link joins its sign-in's device on host, and is sent its
  // jobs; the device's name
  export function attach(tools: Tools, term: string, host: string, who: string, link: Link): string {
    let name = host;
    for (let k = 2; (tools.devices.get(name)?.who ?? who) !== who; k++) {
      name = host + "-" + k;
    }
    const d = tools.devices.get(name) ?? { who, terms: new Map(), jobs: new Map(), skills: [] };
    d.terms.set(term, link);
    tools.devices.set(name, d);
    Tools.sync(d, term, () => true);
    Tools.look(tools, name);
    return name;
  }

  // a link told its jobs' ids (it halts the rest), then each that `fresh`
  // picks, a message each
  export function sync(d: Device, term: string, fresh: (id: string) => boolean): void {
    const send = d.terms.get(term)?.send ?? (() => {});
    const mine = [...d.jobs].filter(([, j]) => j.term === term);
    send({ $: "jobs", ids: mine.map(([id]) => id) });
    mine.filter(([id]) => fresh(id)).forEach(([id, j]) => send({ $: "job", id, job: j.job }));
  }

  export function detach(tools: Tools, term: string, device: string): void {
    const d = tools.devices.get(device);
    if (d === undefined || !d.terms.delete(term)) {
      return;
    }
    for (const job of d.jobs.values()) {
      if (job.term === term) {
        job.end({ text: "The device " + device + " that ran this stopped.", fail: true });
      }
    }
  }

  export function opened(tools: Tools): [string, Device][] {
    return [...tools.devices].filter(([, d]) => d.terms.size > 0);
  }

  // else why not
  export function open(tools: Tools, device: string): Device | string {
    const d = tools.devices.get(device);
    const open = Tools.opened(tools).map(([name]) => name).join(", ") || "none";
    if (d === undefined || d.terms.size === 0) {
      // only the user opens one, so a retry in a loop only keeps the chat
      // busy: stop and say so instead
      return "No device " + device + " is open (its unii device isn't running). Open: " + open + ". Only the user starts it, so don't retry or wait: end your turn, saying what is left.";
    }
    return d;
  }

  // the job `id` on a device, waited on: started, unless it runs
  export function job(tools: Tools, device: string, job: Job, signal: AbortSignal, id: string): Promise<Out> {
    const run = tools.devices.get(device)?.jobs.get(id) ?? Tools.start_job(tools, device, job, id);
    if (typeof run === "string") {
      return Promise.resolve({ text: run, fail: true });
    }
    const stop = () => run.end({ text: "Stopped.", fail: true });
    signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    return run.out;
  }

  // a job started on a device's link (the last live one), told to it;
  // else why not
  export function start_job(tools: Tools, device: string, job: Job, id: string): Running | string {
    const d = Tools.open(tools, device);
    if (typeof d === "string") {
      return d;
    }
    const terms = [...d.terms];
    const [term] = terms.filter(([, t]) => t.live()).at(-1) ?? terms.at(-1)!;
    const run = Tools.track(d, id, term, job);
    Tools.sync(d, term, (x) => x === id);
    return run;
  }

  // a job kept until it ends, its link told then
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

  export function done(tools: Tools, device: string, id: string, out: Out): void {
    tools.devices.get(device)?.jobs.get(id)?.end(out);
  }

  // Agents
  // ------

  export async function spawn(tools: Tools, tasks: string[], effort: string | null, model: string | null = null): Promise<string> {
    const view = tasks.length === 0 ? "No tasks." : await Tools.view(tools);
    if (typeof view === "string") {
      return view;
    }
    const names = tasks.map((task) => Tools.start(tools, { effort, model }, task, view));
    return "Started " + names.join(", ") + ". Each one's report will reach you as a message when it finishes.";
  }

  // what the work a restart cut is told as it goes on (Server.ts
  // Chat.resume)
  export function restarted(work: string[]): string {
    return "The server restarted, cutting " + work.join(", ") + "; nothing was lost: go on.";
  }

  export async function tell(tools: Tools, name: string, message: string): Promise<string> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return "No agent " + name + " to tell.";
    }
    if (agent.call !== null) {
      tools.hooks.push(agent, "user", message);
      agent.call.send({ text: message, imgs: [] });
      return "Sent. " + name + " reads it between its tool calls, and its report answers it.";
    }
    const view = await Tools.view(tools);
    if (typeof view === "string") {
      return view;
    }
    tools.hooks.push(agent, "user", message);
    Tools.run(tools, Object.assign(agent, { view, replies: [], stop: false, why: null }));
    return "Sent. " + name + "'s reply will reach you as a message.";
  }

  export function start(tools: Tools, role: Agent["role"], task: string, view: Block[]): string {
    const name = Memory.agent_new(tools.mem);
    const agent = { name, role, call: null, live: [], calls: {}, stop: false, why: null, view, replies: [] };
    tools.agents.set(name, agent);
    tools.hooks.push(agent, "note", SUB_NOTE + (role.model === null ? "" : SUB_ON + role.model) + (role.effort === null ? "" : SUB_AT + role.effort));
    tools.hooks.push(agent, "user", task);
    Tools.run(tools, agent);
    return name;
  }

  // one not of this process is taken back from its log, idle
  export function agent(tools: Tools, name: string): Agent | null {
    const log = tools.agents.has(name) ? null : Memory.agent(tools.mem, name);
    const note = log !== null && log.length > 0 && log[0].kind === "note" ? log[0].text : "";
    const sub = SUB_ROLE.exec(note);
    if (sub !== null) {
      tools.agents.set(name, { name, role: { effort: sub[2] ?? null, model: sub[1] ?? null }, call: null, live: [], calls: {}, stop: false, why: null, view: [], replies: [] });
    }
    return tools.agents.get(name) ?? null;
  }

  // calls while a message waits in its log (told too late for the call
  // before); then its report. Detached: a throw ends it as a failed
  // reply, still reported
  export async function run(tools: Tools, agent: Agent): Promise<void> {
    try {
      for (let more = true; more; ) {
        agent.call = AskAI.ask(Tools.ask(tools, agent), (ev) => tools.hooks.on(agent, ev));
        tools.hooks.change();
        const end = await agent.call.done;
        agent.call = null;
        agent.replies.push(end.ok ? end.text : agent.why ?? "failed: " + end.text);
        more = end.ok && end.left.length > 0;
      }
    } catch (err: any) {
      agent.call = null;
      agent.replies.push("failed: " + String(err?.message ?? err));
    }
    tools.hooks.report(agent, report_text(agent.name, agent.replies.join("\n\n")), agent.stop);
  }

  // a call of an agent, on Tools.pick
  export function ask(tools: Tools, agent: Agent): Ask {
    const log = { text: Memory.agent_show(tools.mem, agent.name), mark: true };
    const server = Tools.at(tools, agent.name);
    const run = Pick.ask(Tools.pick(tools, agent));
    const own = Memory.file_text(PROMPTS.prompt.file);
    const system = own === "" ? SUB : SUB + "\n\n" + AGENT_PROMPT + "\n\n" + own;
    const blocks = [...agent.view, Tools.devices(tools), Tools.skills(tools), log];
    const effort = agent.role.effort ?? run.effort;
    return { ...run, effort, system, blocks, searches: SEARCHES, server, agent: true };
  }

  // what an agent runs on: config.AGENTS or else the chat's pick, with
  // the model it was spawned with, if any; a throw if no longer offered
  export function pick(tools: Tools, agent: Agent): Pick {
    const base = config.AGENTS ?? tools.hooks.pick();
    const model = agent.role.model;
    const given = model === null ? base : Pick.to_model(base, model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(agent.name + "'s model " + model + " is no longer offered; spawn another subagent.");
    }
    return given;
  }

  // a string: why there is none (Memory.settle)
  export async function view(tools: Tools): Promise<Block[] | string> {
    const why = await Memory.settle(tools.mem, tools.mem.count, tools.hooks.halt());
    return why ?? Memory.view(tools.mem);
  }

  export function working(tools: Tools): Agent[] {
    return [...tools.agents.values()].filter((a) => a.call !== null);
  }

  // the stop tool: the agent named stopped at once (Tools.stop), its
  // report saying why and what it was last doing; waited for (up to
  // HALT), so the answer says it ended
  export async function halt(tools: Tools, name: string, why: string): Promise<Out> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return { text: "No agent " + name + ".", fail: true };
    }
    const call = agent.call;
    if (call === null) {
      return { text: name + " isn't working: nothing to stop.", fail: false };
    }
    const log = (Memory.agent(tools.mem, name) ?? []).filter((e) => e.kind !== "note").at(-1);
    const last = Object.values(agent.calls).at(-1) ?? (log && log.kind + ": " + log.text);
    const doing = last === undefined ? "" : " It was last at " + last.replace(/\s+/g, " ").slice(0, 300);
    agent.why = "Stopped by Unii" + (why.trim() === "" ? "." : ": " + why.trim().replace(/\.?$/, ".")) + doing;
    Tools.stop(tools, name);
    const ended = await Promise.race([call.done.then(() => true), Bun.sleep(HALT).then(() => false)]);
    return { text: ended ? "Stopped " + name + "." : "Stopping " + name + ": it hasn't ended yet.", fail: false };
  }

  // every agent at work (name null), or the one named
  export function stop(tools: Tools, name: string | null): void {
    for (const agent of Tools.working(tools).filter((a) => name === null || a.name === name)) {
      agent.stop = true;
      agent.call?.stop();
    }
  }

}
