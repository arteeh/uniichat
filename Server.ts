#!/usr/bin/env bun
// Server
// ======
// The agent: one chat that never ends (Memory.ts), the owner's (Owner.ts),
// at config.DIR/chat, and its views, terminals (Term.ts) and browser tabs
// (web/), each one WebSocket (View.ts's Link) carrying the chat's events
// and its acts (one with a body: a post to /api/act), each done once
// (Chat.apply). A device (Device.ts) joins by a socket of its own, naming
// itself; the agent's tools reach it (Tools.ts) until it quits.
//
// One turn at a time. A message is logged as it arrives; the running call
// takes it between tool calls if it goes whole beside its view, else the
// next call does, on the chat's pick (Pick.ts). The chat stays open while
// the server runs. A stop or crash cuts all: a start resumes what ran
// (Chat.resume), told so. Its schedules come at their time, viewed or not
// (Chat.ring).
//
// Usage: Server.ts [port]   (127.0.0.1; default 8788)

import * as fs from "node:fs";
import * as net from "node:net";
import type { ServerWebSocket } from "bun";
import { AskAI, type Call, type Event, type Kind, type Parked } from "./AskAI.ts";
import { clip_pages } from "./Clip.ts";
import { Disk } from "./Disk.ts";
import { Mcp } from "./Mcp.ts";
import * as Import from "./Import.ts";
import { JOBS, Memory, TALK, type Msg as Log, type Share } from "./Memory.ts";
import { OpenAI } from "./OpenAI.ts";
import { Owner } from "./Owner.ts";
import { Pick } from "./Pick.ts";
import { Push } from "./Push.ts";
import { Reap } from "./Reap.ts";
import { Settings } from "./Settings.ts";
import { INSTALL, INSTALL_PS1 } from "./Update.ts";
import { move_over, write_whole } from "./Write.ts";
import * as Timer from "./Timer.ts";
import { PROMPTS, SEARCHES, Tools, type Agent, type Live } from "./Tools.ts";
import { FRAME, IMAGES, live_push, PING, QUIT, SUMMARIES, TICK, TURN, WIRE, type Answer, type Part, type Server as Out, type Wait } from "./View.ts";
import * as config from "./Config.ts";
import hello_md from "./hello.md" with { type: "text" };
import app_js from "./web/app.js" with { type: "file" };
import index_html from "./web/index.html" with { type: "file" };
import install_sh from "./web/install.sh" with { type: "file" };
import mark_svg from "./web/mark.svg" with { type: "file" };
import style_css from "./web/style.css" with { type: "file" };
import manifest from "./web/manifest.webmanifest" with { type: "file" };
import sw_js from "./web/sw.js" with { type: "file" };
import icon_192 from "./web/icon-192.png" with { type: "file" };
import icon_512 from "./web/icon-512.png" with { type: "file" };
import icon_mask_192 from "./web/icon-maskable-192.png" with { type: "file" };
import icon_mask from "./web/icon-maskable-512.png" with { type: "file" };
import icon_apple from "./web/apple-touch-icon.png" with { type: "file" };

// Types
// =====

// a socket: its sign-in (hashed), its query's fields, a device's name
// (null: a view), the parts it was shown (Chat.teach)
type Sock = ServerWebSocket<{ who: string; tab: string; wire: string | null; host: string | null; work: string; shell: string | null; device: string | null; seen: Set<string> }>;

// a body: its file, its size so far
type Body = { fh: fs.promises.FileHandle; size: number };

// a message logged: its pages [id, end)
type Msg = { id: number; end: number };

// what the agent saw at its last call: the view before message `from`,
// then every message from it on
type Eye = { parts: Part[]; from: number };

// a goal check (Chat.check): its call, the goal it asks of
type Check = { call: Call; goal: string };

// an import as kept: messages [a, b), those sent (not notes), what it
// spent (none: kept for an import a past version began); as run: by level
// what each node weighs (Import.import_guess) and how many are not built;
// their weight left; its time (Chat.time) in all
type Kept  = { a: number; b: number; said: number; spent: number };
type Batch = Kept & { micros: number[][]; open: number[]; left: number; all: number };

// the chat: acts being done (Chat.apply); model: what the turn's call
// runs on, as picked when it began (a /model since picks the next
// call's); asked: a request out, nothing back; open: tool calls without
// results; check: the turn's goal check running (Chat.check); sent,
// wait: messages given and waiting; writes, held: the posts logging, one
// after another, and the logging held meanwhile (null: none); limits:
// the calls waiting for a usage limit, by TURN or agent name; fell: the
// fallback its calls ("") or an agent's (by name, till it reports) run
// on (Chat.ran), forgotten as a pick is picked
type Chat = {
  mem   : Memory;
  tools : Tools;
  pick  : Pick;
  socks : Set<Sock>;
  acts  : Map<string, Promise<Answer>>;
  busy  : boolean;
  call  : Call | null;
  model : string;
  check : Check | null;
  asked : boolean;
  open  : number;
  sent  : Msg[];
  wait  : Msg[];
  halt  : AbortController;
  live  : Live[];
  calls : Record<string, string>; // its tool calls awaiting their results, by id (Chat.on)
  eye   : Eye;
  after : Promise<void>;
  batch : Batch | null;
  writes: Promise<unknown>;
  held  : Array<() => void> | null;
  limits: Record<string, Parked>;
  fell  : Map<string, string>;
};

// Constants
// =========

const LOCK       = config.DIR + "/lock";
// on Windows (no unix sockets to lock by): LOCK.pid, the server's pid,
// its time touched every LOCK_BEAT; one older than LOCK_DEAD, or whose
// process is gone, a crash's
const LOCK_PID   = LOCK + ".pid";
const LOCK_BEAT  = 5000;
const LOCK_DEAD  = 30000;
const WIN        = process.platform === "win32";
// the running server's pid, for the installer (it moves no data from
// under a server)
const PID        = config.DIR + "/server.pid";
// where the chat is
const CHAT       = config.DIR + "/chat";
// a turn's head
const HEAD       = "Turn: the user's new message:\n\n";
// a goal's check (Chat.check): its own system prompt, asked after the
// chat (the view, its latest messages whole) of its goal; unmet, the
// user's nudge
const GOAL       = "You check a goal. Below is a chat between a user and Unii, an AI agent: its older messages as summary lines (id+n|text), then its latest messages whole, then the goal the user set with /goal. Answer yes if the chat shows the goal fully satisfied now, else no. Write that one word, nothing else.";
const GOAL_ASK   = "\nThe goal:\n\n";
const GOAL_NO    = "The goal isn't satisfied yet: keep working.";
// conversation mode (Memory.ts) full: switched off, as the chat says;
// switched on with its first messages over its space already: refused
const TALK_FULL  = "Conversation mode switched itself off: the messages it kept word for word, from message {id} on, filled their space in Unii's view. They show as summaries again; switch it on to keep the next ones whole.";
const TALK_BIG   = "Conversation mode can't start: the messages since message {id} already fill its space in Unii's view.";
const FULL       = "UniiChat's disk is full; try again soon.";
// an import running: its batch's file in the chat's dir (Chat.keep)
const BATCH      = "/import.json";
// under SPARE free, the disk takes no more (Chat.post)
const SPARE      = 2 ** 30;

// a schedule's message as views get it (its head: Chat.state); a ring
// that failed (a full disk, a write that threw) tried again after RING
// ms; the longest the alarm waits before it looks at the clock again
// (one set forward, or a machine woken, rings schedules overdue)
const TIMER_TEXT = 200;
const RING       = 60000;
const WAKE       = 60000;

// the acts with a body (Chat.post)
const BODIES     = ["say", "import", "voice"];

// a read of a body: a buffer, no limit
const READ       = 2 ** 20;

// what a socket may hold unsent (Bun's default, 16 MiB, drops the rest)
const BUFFER     = 2 ** 31 - 1;

// a piece of a long answer (Main.stream)
const PIECE      = 2 ** 16;

// the paths of the owner's, but /api/'s (the rest: the site's files)
const OWN        = ["/ws", "/tree", "/export"];

// the chat's first message, ending in the installer of the terminal
// (Term.ts), and its line
const HELLO      = hello_md.trim().replace("{install}", config.SITE + "/install.sh");
const HELLO_LINE = "unii: hello: UniiChat, one endless chat kept in a memory tree, recent days in more detail; build anything for years; recalls the past (ad2cat.py); a chatbot with a memory system; the user's terminal install.";

// the site's files, by path (a new one is imported above)
const WEB: Record<string, string> = {
  "/"               : index_html,
  "/account"        : index_html,
  "/app.js"         : app_js,
  "/apple-touch-icon.png": icon_apple,
  "/favicon.svg"    : mark_svg,
  "/icon-192.png"   : icon_192,
  "/icon-512.png"   : icon_512,
  "/icon-maskable-192.png": icon_mask_192,
  "/icon-maskable-512.png": icon_mask,
  "/install.sh"     : install_sh,
  "/manifest.webmanifest": manifest,
  "/mark.svg"       : mark_svg,
  "/style.css"      : style_css,
  "/sw.js"          : sw_js,
};

// the settings page, drawn by the site's page
WEB["/settings"] = WEB["/"];

// Chat
// ====

// the server's timer for the chat's first schedule due (Chat.timed)
let bell: ReturnType<typeof setTimeout> | undefined;

export namespace Chat {

  // the chat, opened at the start (the one before, if any, resumed by
  // Main.start). One that fails to open throws, and the server ends
  export function open(): Chat {
    const mem = Memory.load(CHAT, () => Chat.share(chat, Tools.prompt("compact")), Owner.act_put);
    const tools = Tools.serve(mem, {
      push   : (agent, kind, text) => Chat.push(chat, agent, kind, text),
      note   : (text) => Chat.note(chat, text),
      on     : (agent, ev) => Chat.on(chat, agent, ev),
      report : (agent, text, stopped) => Chat.report(chat, agent, text, stopped),
      change : () => Chat.change(chat),
      timed  : () => Chat.timed(chat),
      pick   : () => chat.pick,
      halt   : () => chat.halt.signal,
    });
    const pick = Pick.load(mem.pick, config.OFFER, config.PICK);
    const chat: Chat = {
      mem, tools, pick, socks: new Set(), acts: new Map(), busy: false, call: null, model: "", check: null, asked: false, open: 0, sent: [], wait: [],
      halt: new AbortController(), live: [], calls: {}, eye: { parts: [], from: 0 }, after: Promise.resolve(), batch: null,
      writes: Promise.resolve(), held: null, limits: {}, fell: new Map(),
    };
    // a saved pick (a profile, by name) not offered gave way: told once
    const shown = (p: Pick) => p.profile ?? Pick.label(p);
    const saved = mem.pick === null ? null : shown(mem.pick as Pick);
    if (saved !== null && saved !== shown(pick)) {
      mem.pick = pick;
      Memory.save(mem);
      Chat.note(chat, saved + " isn't offered here, so the chat now runs on " + shown(pick) + ".");
    }
    if (mem.count === 0) {
      Memory.push(mem, [{ kind: "unii", text: HELLO, line: HELLO_LINE }]);
    }
    chat.eye = Chat.eye(mem, Memory.turn(mem));
    mem.made = (l, i) => Chat.made(chat, l, i);
    mem.wait.add(() => Chat.progress(chat));
    chat.batch = Chat.resumed(chat);
    Chat.timed(chat);
    Memory.pump(mem);
    Chat.progress(chat);
    Chat.resume(chat, mem.work).finally(() => Chat.change(chat)).catch((err) => console.error("unii: resuming the chat: " + (err?.message ?? err)));
    return chat;
  }

  // what a call of the chat starts with: its system prompt, the user
  // prompt (a turn's) or the compaction prompt (a summary's, which gets
  // nothing else). A summary gets no tools: one it called, ours or the
  // API's own (web search brings code execution), sent its whole input
  // again
  export function share(chat: Chat, system: string): Share {
    return { ...Pick.ask(chat.pick), system, searches: 0, server: "" };
  }

  // a message (its body: its images, sizes given, then its text), logged
  // and taken
  export async function say(chat: Chat, id: string, sizes: number[], body: Body): Promise<Answer> {
    const images: string[] = [];
    let at = 0;
    for (const size of sizes) {
      const name = await Memory.image_add(chat.mem, await Chat.read(body, at, size));
      if (name === null) {
        return { error: IMAGES };
      }
      images.push(name);
      at += size;
    }
    await Chat.writing(chat, async () => Chat.take(chat, await Chat.text(chat, body, at, images, id)));
    return {};
  }

  // up to n bytes of a body, from byte `at`
  export async function read(body: Body, at: number, n: number): Promise<Buffer> {
    const buf = Buffer.alloc(n);
    const got = await body.fh.read(buf, 0, n, at);
    return buf.subarray(0, got.bytesRead);
  }

  // a body's text from byte `at`, logged as the user's message, a read
  // at a time, the last with the images and the act's record
  export async function text(chat: Chat, body: Body, at: number, images: string[], act: string): Promise<Msg> {
    const id = chat.mem.count;
    for await (const [pages, more] of Chat.pieces(body, at, clip_pages)) {
      Chat.push(chat, null, "user", pages.join(""), more ? [] : images, more, more ? undefined : act);
    }
    return { id, end: chat.mem.count };
  }

  // a post's logging, after the chat's earlier ones, holding its other
  // logging (Chat.hold) till it ends, so a long post's pages stay together
  export function writing<T>(chat: Chat, write: () => Promise<T>): Promise<T> {
    const run = chat.writes.then(async () => {
      chat.held = [];
      try {
        return await write();
      } finally {
        const held = chat.held ?? [];
        chat.held = null;
        chat.mem.open = 0;
        held.forEach((step) => step());
      }
    });
    chat.writes = run.catch(() => {});
    return run;
  }

  // a step that logs to the chat: now, or once the post logging ends
  export function hold(chat: Chat, step: () => void): void {
    if (chat.held === null) {
      step();
    } else {
      chat.held.push(step);
    }
  }

  // a body's text from byte `at`, cut in pieces a READ at a time, and
  // whether more come; none over READ
  export async function* pieces(body: Body, at: number, cut: (text: string) => string[]): AsyncGenerator<[string[], boolean]> {
    const dec = new TextDecoder();
    let rest = "";
    do {
      const buf = await Chat.read(body, at, READ);
      at += buf.length;
      const all = cut(rest + dec.decode(buf, { stream: at < body.size }));
      rest = at < body.size ? all.pop()! : "";
      if (rest.length > READ) {
        throw new Error("A line over " + READ + " characters: no import sends it.");
      }
      yield [all, at < body.size];
    } while (at < body.size);
  }

  // a recording's words, logged as the act's answer
  export async function voice(chat: Chat, id: string, type: string, body: Body): Promise<Answer> {
    const got = await OpenAI.transcribe(new Blob([await Chat.read(body, 0, body.size)], { type })).catch((err: Error) => err);
    if (got instanceof Error) {
      return { error: got.message };
    }
    Chat.mark(chat, id, { ans: { text: got.text } });
    return { text: got.text };
  }

  // a message logged: to the running call if whole beside its view, else
  // to the next (a goal check running, whose answer it drops, stops)
  export function take(chat: Chat, msg: Msg): void {
    const mem = chat.mem;
    if (chat.call !== null && Memory.whole(mem, msg.id) === msg.id) {
      chat.sent.push(msg);
      chat.call.send(Memory.say(mem, msg.id, msg.end));
      return;
    }
    chat.wait.push(msg);
    chat.check?.call.stop();
    if (!chat.busy) {
      Chat.turn(chat);
    }
  }

  export async function turn(chat: Chat): Promise<void> {
    chat.busy = true;
    try {
      let go = true;
      while (go && chat.wait.length > 0) {
        go = await Chat.call(chat);
      }
    } catch (err: any) {
      Chat.failed(chat, String(err?.message ?? err));
    } finally {
      const why: string | null = chat.halt.signal.aborted ? chat.halt.signal.reason : null;
      if (why !== null) {
        Chat.note(chat, why);
      }
      chat.call = null;
      chat.sent = [];
      chat.wait = [];
      chat.busy = false;
      Chat.live(chat, null, []);
      Chat.phone(chat);
      Chat.after(chat);
      Chat.change(chat);
    }
  }

  // where a call's messages go whole from (a message meanwhile may move it)
  export function from(chat: Chat): number {
    return Memory.whole(chat.mem, chat.wait[0].id);
  }

  // false: the turn ends
  export async function call(chat: Chat): Promise<boolean> {
    const mem = chat.mem;
    const halt = (chat.halt = new AbortController());
    Chat.change(chat);
    await Tools.look(chat.tools);
    if (halt.signal.aborted) {
      return false;
    }
    let from = -1;
    while (from !== Chat.from(chat)) {
      from = Chat.from(chat);
      const why = await Memory.settle(mem, from, halt.signal);
      if (why !== null) {
        if (!halt.signal.aborted) {
          Chat.failed(chat, why);
        }
        return false;
      }
    }
    const msgs = (chat.sent = chat.wait.splice(0));
    const says = msgs.filter((m) => m.end > from).map((m) => Memory.say(mem, Math.max(m.id, from), m.end));
    const view = Memory.view(mem, from, mem.view.parts, mem.talk);
    // the MCP servers' notes the chat showed are in the view: the call's
    // listing gives the master the rest, and those made since (Mcp.heard)
    Mcp.heard(chat.tools.mcp, Tools.off(chat.tools), "main", true);
    const text = says.map((say) => say.text).join("\n\n");
    const imgs = says.flatMap((say) => say.imgs);
    const server = Tools.at(chat.tools, "main");
    chat.eye = Chat.eye(mem, from);
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    const blocks = [...view, Tools.devices(chat.tools), Tools.skills(chat.tools), Tools.at_work(chat.tools), { text: HEAD + text, mark: true }];
    const ask = { ...Chat.share(chat, Tools.prompt("prompt")), searches: SEARCHES, server, blocks, imgs };
    chat.model = chat.pick.model;
    chat.asked = true;
    chat.open = 0;
    const call = (chat.call = AskAI.ask(ask, (ev) => Chat.on(chat, null, ev)));
    Chat.change(chat);
    return Chat.ended(chat, call, halt);
  }

  // the turn's call ends; false: the turn ends
  export async function ended(chat: Chat, call: Call, halt: AbortController): Promise<boolean> {
    const end = await call.done;
    chat.call = null;
    delete chat.limits[TURN];
    Chat.unanswered(chat, null);
    Chat.live(chat, null, []);
    chat.wait.unshift(...chat.sent.slice(chat.sent.length - end.left.length));
    if (!end.ok && !halt.signal.aborted) {
      Chat.failed(chat, end.text);
    }
    if (end.note) {
      Chat.all(chat, { $: "note", text: end.note });
    }
    const goal = chat.mem.goal;
    if (end.ok && !halt.signal.aborted && chat.wait.length === 0 && goal !== null) {
      return Chat.checked(chat, Chat.check(chat, goal), halt);
    }
    return !halt.signal.aborted;
  }

  // the user's goal (/goal), asked of the chat's model, without tools, on
  // the chat as it is now
  export function check(chat: Chat, goal: string): Check {
    const mem  = chat.mem;
    const at   = Memory.whole(mem, 0);
    const tail = Array.from({ length: mem.count - at }, (_, k) => at + k).map((i) => {
      const msg = Memory.message(mem, i)!;
      return Memory.line({ l: 0, i }, msg.kind + ": " + msg.text) + "\n";
    });
    const blocks = [...Memory.view(mem, at), { text: tail.join("") + GOAL_ASK + goal, mark: true }];
    return { call: AskAI.ask({ ...Chat.share(chat, GOAL), blocks }, (ev) => Chat.checking(chat, ev)), goal };
  }

  // a goal check's events: only its waits for a usage limit show, as the
  // turn's
  export function checking(chat: Chat, ev: Event): void {
    if (ev.$ === "Limit") {
      Chat.limit(chat, TURN, ev.limit);
    }
  }

  // a goal check's answer, as the turn's call's is: unmet (any answer but
  // yes), the user's nudge goes to the turn as their message; met, the
  // goal ends. A check that fails, a stop, a message or a /halt
  // meanwhile end it with no nudge, so the turn ends; false: it ends
  export async function checked(chat: Chat, check: Check, halt: AbortController): Promise<boolean> {
    const { call, goal } = (chat.check = check);
    halt.signal.addEventListener("abort", () => call.stop(), { once: true });
    const end = await call.done;
    const mem = chat.mem;
    const on = !halt.signal.aborted && mem.goal === goal && chat.wait.length === 0;
    chat.check = null;
    delete chat.limits[TURN];
    if (on && !end.ok) {
      Chat.note(chat, "No goal check: " + end.text.replace(/\.$/, "") + ". The goal stays; /halt drops it.");
    } else if (on && /^\W*yes\b/i.test(end.text)) {
      mem.goal = null;
      Memory.save(mem);
      Chat.note(chat, "Goal met.");
    } else if (on) {
      await Chat.writing(chat, async () => Chat.take(chat, Chat.push(chat, null, "user", GOAL_NO)));
    }
    return !halt.signal.aborted;
  }

  // a failed turn's why, as a note
  export function failed(chat: Chat, why: string): void {
    Chat.note(chat, "No reply: " + why.replace(/\.$/, "") + ". Send a message to try again.");
  }

  // a note in the chat, why work ended as it did
  export function note(chat: Chat, text: string): void {
    Chat.hold(chat, () => Chat.push(chat, null, "note", text));
  }

  // to the chat (in pages), or an agent's log; each told to every view
  export function push(chat: Chat, agent: Agent | null, kind: Kind, text: string, images: string[] = [], more = false, act?: string): Msg {
    if (agent !== null) {
      const id = Memory.agent_push(chat.mem, agent.name, kind, text);
      Chat.all(chat, { $: "entry", agent: agent.name, id, kind, text });
      return { id, end: id + 1 };
    }
    const roots = Memory.push(chat.mem, [{ kind, text, images, more, act }]);
    for (const { i, kind, text, date, images } of roots) {
      Chat.all(chat, { $: "entry", id: i, kind, text, date, images });
    }
    Chat.talked(chat);
    return { id: roots[0].i, end: chat.mem.count };
  }

  // a message logged in conversation mode: the views see its space fill
  // (their meter); past it (TALK) it switches itself off, said in the
  // chat: never a message of it quietly summarized again
  export function talked(chat: Chat): void {
    const mem = chat.mem;
    if (mem.talk === null) {
      return;
    }
    if (Memory.talk_size(mem) <= TALK) {
      return Chat.all(chat, Chat.state(chat));
    }
    const from = mem.talk;
    Chat.talk(chat, null);
    Chat.note(chat, TALK_FULL.replace("{id}", String(from)));
  }

  // conversation mode from message `from` on, or off (null): saved, and
  // told to every view
  export function talk(chat: Chat, from: number | null): void {
    chat.mem.talk = from;
    chat.mem.talked.clear();
    Memory.save(chat.mem);
    Chat.change(chat);
  }

  // a message the call took was logged as it came
  export function on(chat: Chat, agent: Agent | null, ev: Event): void {
    const at = agent ?? chat;
    const name = agent?.name;
    if (ev.$ === "Limit") {
      return Chat.limit(chat, name ?? TURN, ev.limit);
    }
    if (ev.$ === "Run") {
      Chat.ran(chat, agent, ev);
      return;
    }
    if (agent === null) {
      Chat.asks(chat, ev);
    }
    if (ev.$ === "Delta") {
      live_push(at.live, ev.kind, ev.text, ev.fresh);
      Chat.all(chat, { $: "delta", agent: name, kind: ev.kind, text: ev.text, fresh: ev.fresh });
      return;
    }
    if (ev.kind === "tool" && ev.of !== undefined) {
      at.calls[ev.of] = ev.text;
    } else if (ev.kind === "mind") {
      Chat.all(chat, { $: "entry", agent: name, kind: ev.kind, text: ev.text });
    } else if (ev.kind !== "user") {
      const call = ev.of === undefined ? undefined : at.calls[ev.of];
      delete at.calls[ev.of ?? ""];
      Chat.hold(chat, () => {
        if (call !== undefined) {
          Chat.push(chat, agent, "tool", call);
        }
        Chat.push(chat, agent, ev.kind, ev.text);
      });
    }
    Chat.live(chat, agent, Chat.waiting(at));
  }

  // the turn (TURN) or agent named waits for a usage limit (Agent.park),
  // or no longer (null), told to every view
  export function limit(chat: Chat, name: string, limit: Parked | null): void {
    if (limit === null) {
      delete chat.limits[name];
    } else {
      chat.limits[name] = limit;
    }
    Chat.all(chat, Chat.state(chat));
  }

  // a call answers on a fallback, or back on its pick (AskAI.ts Run): a
  // note in the chat (an agent's log) as that changes; the turn's wait
  // names the model it runs on
  export function ran(chat: Chat, agent: Agent | null, ev: Extract<Event, { $: "Run" }>): void {
    const who = agent?.name ?? "";
    const was = chat.fell.get(who) ?? null;
    const now = ev.from === null ? null : Pick.label(ev.run);
    if (agent === null) {
      chat.model = ev.run.model;
    }
    if (now === was) {
      return;
    }
    if (now === null) {
      chat.fell.delete(who);
    } else {
      chat.fell.set(who, now);
    }
    const text = ev.from === null ? "Back on " + Pick.label(ev.run) + "." : Pick.label(ev.from) + " failed: " + ev.why.replace(/\.$/, "") + ". Going on with " + now + ".";
    Chat.hold(chat, () => Chat.push(chat, agent, "note", text));
  }

  // what streams once an entry came: the tool calls awaiting their
  // results, as they will be logged; what was drawn never vanishes
  // before it is printed
  export function waiting(at: { calls: Record<string, string> }): Live[] {
    return Object.values(at.calls).map((text) => ({ kind: "tool", text }));
  }

  // a call's tool calls left without a result (it was stopped), logged
  // as they are, once it ends
  export function unanswered(chat: Chat, agent: Agent | null): void {
    const at = agent ?? chat;
    const calls = Object.values(at.calls);
    at.calls = {};
    Chat.hold(chat, () => calls.forEach((call) => Chat.push(chat, agent, "tool", call)));
    Chat.live(chat, agent, []);
  }

  // the model is asked again once handed all it waits for, until its
  // answer starts
  export function asks(chat: Chat, ev: Event): void {
    const kind = ev.$ === "Entry" ? ev.kind : "";
    const step = kind === "tool" ? 1 : kind === "echo" ? -1 : 0;
    chat.open = ev.$ === "Delta" ? 0 : Math.max(0, chat.open + step);
    const asked = (kind === "echo" || kind === "user") && chat.open === 0;
    if (asked !== chat.asked) {
      chat.asked = asked;
      Chat.change(chat);
    }
  }

  // what streams for the chat (agent: null) or an agent, set and told
  export function live(chat: Chat, agent: Agent | null, live: Live[]): void {
    (agent ?? chat).live = live;
    Chat.all(chat, { $: "live", agent: agent?.name, live });
  }

  // an agent's report, once it ends: a turn of its own, unless stopped.
  // It is taken as a post is, between the chat's other logging
  export function report(chat: Chat, agent: Agent, text: string, stopped: boolean): void {
    delete chat.limits[agent.name];
    chat.fell.delete(agent.name);
    Chat.unanswered(chat, agent);
    Chat.live(chat, agent, []);
    Chat.hold(chat, () => {
      const msg = Chat.push(chat, null, "work", text);
      if (!stopped) {
        Chat.take(chat, msg);
      }
      Chat.change(chat);
    });
  }

  // a turn's last message, Unii's reply or why there was none, to the
  // owner's phones and browsers (Push.notify)
  export function phone(chat: Chat): void {
    const last = Memory.message(chat.mem, chat.mem.count - 1);
    if (last !== null && (last.kind === "unii" || last.kind === "note")) {
      Push.notify(Owner.open(), last.text);
    }
  }

  // config.AFTER, a shell command (sh's; on Windows PowerShell's, as a
  // device's shell is), after each turn
  export function after(chat: Chat): void {
    if (!config.AFTER) {
      return;
    }
    chat.after = chat.after.then(async () => {
      const shell = WIN ? [Bun.which("pwsh") ?? "powershell.exe", "-NoProfile", "-NonInteractive", "-Command"] : ["/bin/sh", "-c"];
      const proc = Bun.spawn([...shell, config.AFTER], { stdout: "ignore", stderr: "pipe", windowsHide: true });
      const err = await new Response(proc.stderr).text();
      if ((await proc.exited) !== 0) {
        Chat.all(chat, { $: "note", text: "after: " + err.trim() });
      }
    }).catch((err) => console.error("after: " + (err?.message ?? err)));
  }

  // Import
  // ------

  // an import (its body: messages as JSON lines), those new (fresh) logged
  // as one, summarized on the compactor; refused amid a turn or an
  // import
  export async function ingest(chat: Chat, id: string, body: Body): Promise<Answer> {
    if (chat.busy || chat.batch !== null) {
      return { error: (chat.busy ? "Unii is answering" : "An import is under way") + ": import again once it ends." };
    }
    const done = Chat.done(chat);
    let said = 0;
    let found = 0;
    for await (const msgs of Chat.fresh(body, done)) {
      found += msgs.length;
      said += msgs.filter((m) => m.kind !== "note").length;
    }
    const a = chat.mem.count;
    if (found === 0) {
      return { error: "Nothing to import: no new messages found." };
    }
    chat.mem.hold[1] = null;
    const tag = (m: Log, of: boolean): Log => ({ ...m, imported: true, ...(of ? { more: true } : { more: false, act: id }) });
    let held: Log[] = [];
    for await (const msgs of Chat.fresh(body, done)) {
      const all = [...held, ...msgs];
      held = all.splice(-1);
      Memory.push(chat.mem, all.map((m) => tag(m, true)));
    }
    Memory.push(chat.mem, held.map((m) => tag(m, false)));
    chat.batch = Chat.batch(chat, { a, b: chat.mem.count, said, spent: 0 });
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    Chat.progress(chat);
    return { going: chat.batch !== null };
  }

  // an import run: its estimate, of its messages' sizes as logged, timed
  // with none built, then its summaries built counted
  export function batch(chat: Chat, { a, b, said, spent }: Kept): Batch {
    const sizes = Array.from({ length: b - a }, (_, k) => Memory.message(chat.mem, a + k)?.size ?? 0);
    const micros = Import.import_guess(a, sizes);
    const batch = { a, b, said, spent, micros, open: micros.map((level) => level.length), left: micros.flat().reduce((x, y) => x + y, 0), all: 0 };
    batch.all = Chat.time(batch);
    micros.forEach((level, l) => level.forEach((_, j) => Memory.node(chat.mem, { l, i: Math.floor(a / 2 ** l) + j }) !== null && Chat.built(batch, l, j)));
    return batch;
  }

  // node j of level l built (none such: the chat's)
  export function built(batch: Batch, l: number, j: number): void {
    const cost = batch.micros[l]?.[j];
    if (cost !== undefined) {
      batch.left -= cost;
      batch.open[l] -= 1;
    }
  }

  // its time left in micro-USD (a call's, as its cost, is its thinking):
  // its cost left over JOBS, then each level not built's last call (the
  // tree's top builds a call a level)
  export function time(batch: Batch): number {
    return batch.left / JOBS + batch.micros.reduce((t, level, l) => t + (batch.open[l] > 0 ? level.at(-1)! : 0), 0);
  }

  // kept as it is till it ends (a restart changes nothing): written
  // whole, then moved in place
  export function keep(batch: Batch, chat: Chat): void {
    const file = chat.mem.dir + BATCH;
    const { a, b, said, spent } = batch;
    fs.writeFileSync(file + ".new", JSON.stringify({ a, b, said, spent, why: chat.mem.hold[1] }));
    move_over(file + ".new", file);
  }

  // the import a chat ran when let go (BATCH); null: none
  export function resumed(chat: Chat): Batch | null {
    const file = chat.mem.dir + BATCH;
    if (!fs.existsSync(file)) {
      return null;
    }
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    chat.mem.hold[1] = saved.why === "paused" ? "paused" : null;
    return Chat.batch(chat, saved);
  }

  // a body's JSON lines, as messages imported (a line is a page)
  export async function* reads(body: Body): AsyncGenerator<Log[]> {
    for await (const [lines] of Chat.pieces(body, 0, (text) => text.split("\n"))) {
      yield lines.filter((line) => line !== "").map((line) => Chat.imported(JSON.parse(line)));
    }
  }

  // a body's messages new to the chat (Import.import_new): a session
  // imported before brings only what came after, its note only then
  export async function* fresh(body: Body, done: Import.Done): AsyncGenerator<Log[]> {
    let note: Log | null = null;
    let last: string | undefined;
    for await (const msgs of Chat.reads(body)) {
      const out: Log[] = [];
      for (const m of msgs) {
        if (m.kind === "note") {
          [note, last] = [m, done[Import.import_key(m)]];
        } else if (Import.import_new(m, last)) {
          out.push(...(note === null ? [] : [note]), m);
          note = null;
        }
      }
      yield out;
    }
  }

  // the sessions the chat imported (Import.Done), read from its log
  export function done(chat: Chat): Import.Done {
    const done: Import.Done = {};
    let key = "";
    for (let i = 0; i < chat.mem.count; i++) {
      const m = Memory.message(chat.mem, i)!;
      if (m.imported && m.kind === "note") {
        key = Import.import_key(m);
      } else if (m.imported && m.date > (done[key] ?? "")) {
        done[key] = m.date;
      }
    }
    return done;
  }

  // a message imported (a page); a line with no kind or no text refuses
  // the import whole (ingest reads every line before it logs one)
  export function imported(x: any): Log {
    const kinds: Kind[] = ["user", "unii", "tool", "echo", "note"];
    if (!kinds.includes(x?.kind)) {
      throw new Error("An import has no kind " + x?.kind + ".");
    }
    if (typeof x.text !== "string") {
      throw new Error("An import has a " + x.kind + " message with no text.");
    }
    const date = Number.isNaN(Date.parse(x.date)) ? undefined : new Date(x.date).toISOString();
    return { kind: x.kind, text: x.text, date, more: x.more === true };
  }

  // a summary built (Memory's made): counted, if the import's; sent to
  // each view shown its block (Chat.teach)
  export function made(chat: Chat, l: number, i: number): void {
    if (chat.batch !== null) {
      Chat.built(chat.batch, l, i - Math.floor(chat.batch.a / 2 ** l));
    }
    const [a] = Memory.span({ l, i });
    for (const sock of chat.socks) {
      if (sock.data.seen.has(a + "+" + 2 ** l)) {
        Chat.know(chat, sock, a, 2 ** l);
      }
    }
  }

  // as the view changes (Memory's wait): the state; done when all are
  // built; not as the chat is let go (Chat.resumed)
  export function progress(chat: Chat): void {
    const batch = chat.batch;
    if (batch === null || chat.mem.done) {
      return;
    }
    if (batch.open.every((n) => n === 0)) {
      return Chat.digest(chat, batch);
    }
    Chat.keep(batch, chat);
    Chat.all(chat, Chat.state(chat));
  }

  export function digest(chat: Chat, batch: Batch): void {
    chat.batch = null;
    fs.rmSync(chat.mem.dir + BATCH, { force: true });
    chat.eye = Chat.eye(chat.mem, Math.max(chat.eye.from, batch.b));
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    const said = "Imported " + Import.import_count(batch.said, "") + ".";
    Chat.all(chat, { $: "note", text: said });
    Chat.change(chat);
  }

  // an import paused, at once (Memory.pause), or resumed
  export function go(chat: Chat, on: boolean): Answer {
    if (chat.batch === null) {
      return { error: "No import is running." };
    }
    if (on) {
      chat.mem.hold[1] = null;
    } else {
      Memory.pause(chat.mem);
    }
    Chat.keep(chat.batch, chat);
    Chat.all(chat, Chat.state(chat));
    Memory.pump(chat.mem);
    Chat.change(chat);
    return {};
  }

  // the work a restart cut goes on, told so: each agent, and Unii's turn
  // by a note (none for a chat ended meanwhile)
  export async function resume(chat: Chat, work: string[]): Promise<void> {
    if (work.length === 0) {
      return;
    }
    const text = Tools.restarted(work);
    const msg = Chat.push(chat, null, "note", text);
    await Promise.all(work.map((w) => (w === TURN ? Chat.take(chat, msg) : Tools.tell(chat.tools, w, text))));
  }

  // Timers
  // ------
  // The chat's schedules (Timer.ts) live in its view.json, so they
  // outlive a restart. One timer is set for the first due, at most WAKE
  // ahead; then each schedule due is logged as the timer's report "[Timer
  // id]", taken as an agent's is; then each moves on to its next time, or
  // ends, saved. Coming is an act (its id: the schedule's and its time),
  // recorded with the message, so a crash before the save brings it
  // again only to find it done: each time comes once. A time that passed
  // while no server ran comes as the next starts, late, saying when it
  // was due; a cron that passed many times comes once. Under SPARE free
  // disk, or a write failing, they wait, tried again after RING.

  // the chat's schedules changed (or a ring failed: `retry`): the alarm
  // set again, and the views told
  export function timed(chat: Chat, retry = false): void {
    clearTimeout(bell);
    const first = retry ? Date.now() + RING : Math.min(...chat.mem.timers.map((t) => Date.parse(t.at)));
    if (first < Infinity) {
      bell = setTimeout(() => Chat.fire(chat, Date.now()), Math.min(WAKE, Math.max(0, first - Date.now())));
    }
    Chat.change(chat);
  }

  // the schedules due by `now` (or by when the chat's logging lets them:
  // Chat.hold) come, each once, as the timer's reports, taken as
  // reports are; then each moves on, saved. Under SPARE free, or a
  // write throwing, they are tried again (Chat.timed)
  export function fire(chat: Chat, now: number): void {
    Chat.hold(chat, () => {
      const mem = chat.mem;
      const at = Math.max(now, Date.now());
      const dues = mem.timers.filter((t) => Date.parse(t.at) <= at);
      try {
        if (dues.length > 0 && Chat.full()) {
          console.error("unii: the schedules wait: " + FULL);
          return Chat.timed(chat, true);
        }
        if (dues.length > 0) {
          const fresh = dues.filter((t) => Owner.act_get("timer " + t.id + " " + t.at) === null);
          const msgs = fresh.map((t) => Chat.push(chat, null, "work", Timer.timer_say(t, at), [], false, "timer " + t.id + " " + t.at));
          mem.timers = mem.timers.flatMap((t) => (dues.includes(t) ? (Timer.timer_after(t, at) ?? []) : [t]));
          Memory.save(mem);
          msgs.forEach((msg) => Chat.take(chat, msg));
        }
        Chat.timed(chat);
      } catch (err: any) {
        console.error("unii: the schedules failed: " + (err?.stack ?? err));
        Chat.timed(chat, true);
      }
    });
  }

  // under SPARE free, the disk takes no more (Chat.post, Chat.fire)
  export function full(): boolean {
    const disk = fs.statfsSync(config.DIR);
    return disk.bavail * disk.bsize < SPARE;
  }

  // Work
  // ----

  // what runs: Unii's turn, the agents at work
  export function running(chat: Chat): string[] {
    return [...(chat.busy ? [TURN] : []), ...Tools.working(chat.tools).map((a) => a.name)];
  }

  // UniiChat's turn only, with the spawns and tells it waits on (for the
  // view: Tools.view, on chat.halt); agents go on. why: the note the turn's
  // end logs (Chat.turn), so after the reply the stop cut; null: none
  export function interrupt(chat: Chat, why: string | null): void {
    chat.halt.abort(why);
    chat.call?.stop();
  }

  // all work, agents too; its why noted at the turn's end, or at once if
  // no turn is left to end
  export function stop(chat: Chat, why: string | null): void {
    const turn = chat.busy && !chat.halt.signal.aborted;
    Chat.interrupt(chat, turn ? why : null);
    Tools.stop(chat.tools, null);
    if (!turn && why !== null) {
      Chat.note(chat, why);
    }
  }

  // Views
  // -----
  // A socket message carries at most one log entry, summary or job, so
  // none is too large to hear the next tick in time. A device's socket
  // gets only its jobs and its acts' answers.

  export function all(chat: Chat, msg: Out): void {
    chat.socks.forEach((sock) => sock.data.host === null && Chat.send(sock, msg));
  }

  export function send(sock: Sock, msg: object): void {
    sock.send(JSON.stringify(msg));
  }

  export function state(chat: Chat): Out {
    const working = Tools.working(chat.tools);
    const agents = working.map((a) => a.name);
    const runs = Object.fromEntries(working.flatMap((a) => {
      const pick = Tools.shown(chat.tools, a);
      return pick === null ? [] : [[a.name, pick]];
    }));
    const batch = chat.batch;
    const why = chat.mem.hold[1];
    const importing = batch && { done: batch.all - Chat.time(batch), total: batch.all, why, msgs: batch.b - batch.a, open: batch.open };
    const timers = chat.mem.timers.map((t) => ({ ...t, text: t.text.length > TIMER_TEXT ? t.text.slice(0, TIMER_TEXT) + "…" : t.text }));
    const mcp = config.MCP.map(({ name }) => ({ name, on: !chat.mem.off.includes(name) }));
    const talk = chat.mem.talk === null ? null : { from: chat.mem.talk, used: Math.min(1, Memory.talk_size(chat.mem) / TALK) };
    return { $: "state", busy: chat.busy, wait: Chat.waits(chat), agents, runs, pick: chat.pick, ...config.OFFER, importing, limits: chat.limits, timers, mcp, talk };
  }

  export function waits(chat: Chat): Wait {
    if (chat.call !== null) {
      return chat.asked ? chat.model : "";
    }
    const summing = chat.busy && chat.wait.length > 0 && Memory.first(chat.mem) < Chat.from(chat);
    return summing ? SUMMARIES : "";
  }

  // the settings changed (Settings.ts): the chat runs on its pick if
  // still offered, else on the default (told once, as Chat.open tells
  // it), and its views see the offer
  export function offer(chat: Chat): void {
    const pick = Pick.load(chat.mem.pick, config.OFFER, config.PICK);
    const saved = chat.mem.pick === null ? null : Pick.label(chat.mem.pick as Pick);
    chat.pick = pick;
    if (saved !== null && saved !== Pick.label(pick)) {
      chat.mem.pick = pick;
      Memory.save(chat.mem);
      Chat.note(chat, saved + " isn't offered here, so the chat now runs on " + Pick.label(pick) + ".");
    }
    Chat.change(chat);
  }

  // what runs is saved, and told to every view
  export function change(chat: Chat): void {
    const work = Chat.running(chat);
    if (String(work) !== String(chat.mem.work)) {
      chat.mem.work = work;
      Memory.save(chat.mem);
    }
    Chat.all(chat, Chat.state(chat));
  }

  // a view joins on the chat as it is now; a device is attached (told
  // its name if its host's was taken)
  export function join(chat: Chat, sock: Sock): void {
    const { tab, host, work, shell } = sock.data;
    chat.socks.add(sock);
    if (host === null) {
      Chat.send(sock, Chat.state(chat));
      Chat.show(chat, sock);
      Chat.send(sock, { $: "live", live: chat.live });
      return;
    }
    const link = { send: (msg: object) => Chat.send(sock, msg), live: () => chat.socks.has(sock), work, shell };
    sock.data.device = Tools.attach(chat.tools, tab, host, sock.data.who, link, Owner.kept());
    if (sock.data.device !== host) {
      Chat.send(sock, { $: "note", text: host + " was taken: Unii calls this computer " + sock.data.device + "." });
    }
  }

  // a socket closed; a device goes only if it quit (a link lost is no
  // quit)
  export function leave(chat: Chat, sock: Sock, quit: boolean): void {
    chat.socks.delete(sock);
    if (quit && sock.data.device !== null) {
      Tools.detach(chat.tools, sock.data.tab, sock.data.device);
    }
  }

  // a view's message answered (ack): a read at once, else as Chat.apply
  // does it. A client sends it, so it may be anything (not JSON, a field
  // missing): one that fails is answered its error, as a failed act is,
  // and never ends the process
  export async function answer(chat: Chat, sock: Sock, data: string): Promise<void> {
    let msg: any = null;
    const out = await Promise.try(() => {
      msg = JSON.parse(data);
      return Chat.ask(chat, sock, msg) ?? Chat.apply(chat, msg, sock.data.device ?? "");
    }).catch(Chat.fail);
    Chat.send(sock, { $: "ack", id: msg?.id, ...out });
  }

  // what a message or act that threw answers
  export function fail(err: any): Answer {
    return { error: String(err?.message ?? err) };
  }

  // a read, answered by what it sends; null: no read
  export function ask(chat: Chat, sock: Sock, msg: any): Answer | null {
    switch (msg.$) {
      case "zoom": {
        const [id, n] = [...msg.part].map(Number);
        if (n > 1 && Memory.part(chat.mem, id, n) !== null) {
          const parts: Part[] = [[id, n / 2], [id + n / 2, n / 2]];
          Chat.teach(chat, sock, parts);
          Chat.send(sock, { $: "zoom", id, n, parts });
        }
        return {};
      }
      case "root": {
        const parts = Memory.roots(chat.mem.count).map(({ l, i }): Part => [i * 2 ** l, 2 ** l]);
        Chat.teach(chat, sock, parts);
        Chat.send(sock, { $: "root", parts });
        return {};
      }
      case "agent": {
        const name = String(msg.name);
        const log = Memory.agent(chat.mem, name);
        const agent = log === null ? null : chat.tools.agents.get(name) ?? Tools.logged(chat.tools, name);
        const pick = agent === null ? null : Tools.shown(chat.tools, agent);
        Chat.send(sock, { $: "agent", name, found: log !== null, pick });
        log?.forEach(({ kind, text, date }) => Chat.send(sock, { $: "entry", agent: name, kind, text, date }));
        Chat.send(sock, { $: "live", agent: name, live: chat.tools.agents.get(name)?.live ?? [] });
        return {};
      }
    }
    return null;
  }

  // THE apply point: every change is done here once, however often it
  // comes. An act being done, or recorded done (its record's answer, kept
  // by Owner.act_put as the log indexes it), gets that answer; else
  // Chat.act does it, answered once on disk
  export function apply(chat: Chat, msg: any, device: string): Promise<Answer> {
    const id = String(msg.id);
    const was = chat.acts.get(id) ?? (Owner.act_get(id) as Answer | null);
    if (was !== null) {
      return Promise.resolve(was);
    }
    const run = Chat.act(chat, id, msg, device).catch(Chat.fail).then(async (out) => {
      await Disk.synced();
      chat.acts.delete(id);
      return out;
    });
    chat.acts.set(id, run);
    return run;
  }

  // an act changes the chat. One that would change it again if done again
  // (a post adds again; a stop ends what runs by then) is recorded: logged
  // (Chat.mark) before any effect off the log, or as the last page of
  // what it logs. The rest
  // set state (a pick: view.json; an import's hold: its file) or end a
  // job, so done again they change nothing, and only that state is kept,
  // written over; a stop with nothing to stop is one (so one a client
  // sends again, its answer lost, may end what runs by then)
  export async function act(chat: Chat, id: string, msg: any, device: string): Promise<Answer> {
    if ("req" in msg && BODIES.includes(msg.$)) {
      return Chat.post(chat, id, msg);
    }
    switch (msg.$) {
      case "stop": {
        const name = msg.name === undefined ? null : String(msg.name);
        const what = Chat.running(chat).filter((w) => name === null || w === name);
        const why = "Stopped by the user: " + what.join(", ") + ".";
        const turn = what.includes(TURN);
        if (what.length === 0) {
          return {};
        }
        Chat.mark(chat, id, {});
        if (turn) {
          Chat.interrupt(chat, why);
        }
        what.forEach((w) => Tools.stop(chat.tools, w));
        if (!turn) {
          Chat.note(chat, why);
        }
        return {};
      }
      case "goal": {
        const goal = msg.text === null ? null : String(msg.text);
        if (goal === chat.mem.goal) {
          return {};
        }
        chat.mem.goal = goal;
        Memory.save(chat.mem);
        chat.check?.call.stop();
        if (goal === null) {
          Chat.note(chat, "Goal halted by the user.");
        }
        return {};
      }
      case "go": {
        return Chat.go(chat, msg.on === true || msg.on === "true");
      }
      case "pick": {
        const pick = Pick.read(msg.to, config.OFFER);
        if (pick === null) {
          return { error: "No pick " + JSON.stringify(msg.to) + "." };
        }
        chat.pick = chat.mem.pick = pick;
        chat.fell.clear();
        Memory.save(chat.mem);
        Chat.change(chat);
        return {};
      }
      case "out": {
        Tools.done(chat.tools, device, String(msg.job), msg.out);
        return {};
      }
      case "unschedule": {
        const id = String(msg.id);
        if (Tools.unschedule(chat.tools, id)) {
          Chat.note(chat, "Schedule " + id + " cancelled by the user.");
        }
        return {};
      }
      case "talk": {
        // conversation mode on (from its last message whole: Memory.talk_from)
        // or off; one on already keeps where it started
        const on = msg.on === true || msg.on === "true";
        const mem = chat.mem;
        if ((mem.talk !== null) === on) {
          return {};
        }
        const from = on ? Memory.talk_from(mem) : null;
        mem.talk = from;
        if (from !== null && Memory.talk_size(mem) > TALK) {
          mem.talk = null;
          mem.talked.clear();
          return { error: TALK_BIG.replace("{id}", String(from)) };
        }
        Chat.talk(chat, from);
        return {};
      }
      case "mcp": {
        // an MCP server on or off in this chat: one off ends, its calls
        // running failed; the chat is told, so the AI knows its tools
        // changed
        const name = String(msg.name);
        const on = msg.on === true || msg.on === "true";
        if (!config.MCP.some((s) => s.name === name)) {
          return { error: "No MCP server " + name + "." };
        }
        if (chat.mem.off.includes(name) !== on) {
          return {};
        }
        chat.mem.off = on ? chat.mem.off.filter((n) => n !== name) : [...chat.mem.off, name];
        Memory.save(chat.mem);
        if (!on) {
          Tools.unplug(chat.tools, name);
        }
        Chat.note(chat, "MCP server " + name + " turned " + (on ? "on" : "off") + " by the user.");
        Chat.change(chat);
        return {};
      }
    }
    return { error: "No act " + msg.$ + "." };
  }

  // a post (msg.req) refused before a byte of its body is read under
  // SPARE free (507). Else its body goes to a file unlinked once open,
  // then its act is done
  export async function post(chat: Chat, id: string, msg: any): Promise<Answer> {
    if (Chat.full()) {
      return { error: FULL, status: 507 };
    }
    const file = chat.mem.dir + "/up/" + crypto.randomUUID();
    fs.mkdirSync(chat.mem.dir + "/up", { recursive: true });
    const body = { fh: await fs.promises.open(file, "w+"), size: 0 };
    fs.rmSync(file);
    try {
      for await (const data of msg.req.body ?? []) {
        await body.fh.write(data);
        body.size += data.length;
      }
      switch (msg.$) {
        case "say": {
          return await Chat.say(chat, id, msg.sizes.split(",").filter(Boolean).map(Number), body);
        }
        case "import": {
          return await Chat.writing(chat, () => Chat.ingest(chat, id, body));
        }
        case "voice": {
          return await Chat.voice(chat, id, String(msg.type), body);
        }
      }
      return { error: "No act " + msg.$ + "." };
    } finally {
      await body.fh.close();
    }
  }

  // an act's record, a line of its own (Memory.ts)
  export function mark(chat: Chat, id: string, rec: object): void {
    Memory.log(chat.mem, "main", [{ act: id, ...rec }]);
  }

  export function eye(mem: Memory, from: number): Eye {
    const parts = Memory.before(mem.view.parts, from).map((part): Part => [Memory.span(part)[0], 2 ** part.l]);
    return { parts, from };
  }

  // what the agent saw: the eye's parts, then each message after them;
  // a running import's messages, wherever they are, as the fewest blocks
  // of the tree that hold them, built or not (a summary not built comes
  // once built: Chat.made), so no view ever gets the raw history; a block
  // opened gets its halves (zoom); they start where the tree's root
  // holding the import's first message starts, so the oldest blocks are
  // the largest, as in the tree, not grown from an unaligned start. A
  // device's socket is no view: it gets none of it
  export function show(chat: Chat, sock: Sock): void {
    if (sock.data.host !== null) {
      return;
    }
    const [from, count] = [chat.eye.from, chat.mem.count];
    const [a, hi] = chat.batch === null ? [0, 0] : [chat.batch.a, chat.batch.b];
    const root = Memory.roots(count).find((part) => Memory.span(part)[1] >= a);
    const lo = root === undefined ? a : Memory.span(root)[0];
    const near = chat.eye.parts.filter(([id, n]) => id < hi && id + n > lo);
    const cover: [number, number] = [Math.min(lo, ...near.map(([id]) => id)), Math.max(hi, ...near.map(([id, n]) => id + n))];
    const eye = chat.eye.parts.filter(([id, n]) => id + n <= cover[0] || id >= cover[1]);
    const tree = Memory.roots(count).flatMap((part) => Chat.blocks(part, cover));
    const ids = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k): Part => [a + k, 1]);
    const raw = [...ids(from, cover[0]), ...ids(Math.max(from, cover[1]), count)];
    const parts = [...eye, ...tree, ...raw].sort((x, y) => x[0] - y[0]);
    Chat.teach(chat, sock, parts);
    Chat.send(sock, { $: "view", parts, turn: from });
  }

  // the fewest blocks under a tree part that tile messages [a, b)
  export function blocks(part: { l: number; i: number }, [a, b]: [number, number]): Part[] {
    const [first, last] = Memory.span(part);
    if (last < a || first >= b) {
      return [];
    }
    if (first >= a && last < b) {
      return [[first, 2 ** part.l]];
    }
    return Memory.halves(part).flatMap((half) => Chat.blocks(half, [a, b]));
  }

  // what a view lacks of parts, before the parts themselves: each
  // message or summary a message of its own (Views); a summary not built
  // yet, once built (Chat.made)
  export function teach(chat: Chat, sock: Sock, parts: Part[]): void {
    for (const [id, n] of parts.filter(([id, n]) => !sock.data.seen.has(id + "+" + n))) {
      sock.data.seen.add(id + "+" + n);
      if (n === 1) {
        const m = Memory.message(chat.mem, id)!;
        Chat.send(sock, { $: "know", whole: { [id]: { kind: m.kind, text: m.text, date: m.date, images: m.images } } });
      }
      Chat.know(chat, sock, id, n);
    }
  }

  // a summary, if built, to a view shown its block
  export function know(chat: Chat, sock: Sock, id: number, n: number): void {
    const text = Memory.node(chat.mem, { l: Math.log2(n), i: id / n });
    if (text !== null) {
      Chat.send(sock, { $: "know", nodes: { [id + "+" + n]: { text, to: Memory.message(chat.mem, id + n - 1)!.date } } });
    }
  }

}

// Main
// ====

export namespace Main {

  // the chat; the server
  export let chat: Chat;
  export let server: Bun.Server<Sock["data"]>;

  // a unix socket one process at a time listens on: one a crash left
  // refuses connections and is taken; one held is waited on. On Windows
  // LOCK_PID, made only where there is none
  export async function lock(): Promise<void> {
    fs.mkdirSync(config.DIR, { recursive: true });
    while (WIN) {
      try {
        fs.writeFileSync(LOCK_PID, String(process.pid), { flag: "wx" });
        setInterval(() => {
          try {
            fs.utimesSync(LOCK_PID, new Date(), new Date());
          } catch {}
        }, LOCK_BEAT).unref();
        process.on("exit", () => fs.rmSync(LOCK_PID, { force: true }));
        return;
      } catch (err: any) {
        if (err.code !== "EEXIST") {
          throw err;
        }
      }
      if (!Main.locked()) {
        fs.rmSync(LOCK_PID, { force: true });
        continue;
      }
      await Bun.sleep(1000);
    }
    while (true) {
      try {
        Bun.listen({ unix: LOCK, socket: { data() {} } });
        return;
      } catch (err: any) {
        if (err.code !== "EADDRINUSE") {
          throw err;
        }
      }
      const live = await new Promise<boolean>((done) => {
        const sock = net.connect(LOCK);
        sock.on("connect", () => sock.on("close", () => done(true)));
        sock.on("error", () => done(false));
      });
      if (!live) {
        fs.rmSync(LOCK, { force: true });
      }
    }
  }

  // whether LOCK_PID is a live server's: it beat lately (a pid Windows
  // gave another process since is no server) and its process runs; one
  // being made (empty yet) is
  export function locked(): boolean {
    try {
      const text = fs.readFileSync(LOCK_PID, "utf8");
      if (Date.now() - fs.statSync(LOCK_PID).mtimeMs > LOCK_DEAD || text === String(process.pid)) {
        return false;
      }
      if (text !== "") {
        process.kill(Number(text), 0);
      }
      return true;
    } catch (err: any) {
      return err?.code === "EPERM";
    }
  }

  // a site's file
  export function file(pathname: string): Response {
    const file = WEB[pathname];
    return file === undefined ? new Response("not found", { status: 404 }) : new Response(Bun.file(file));
  }

  // a long answer, sent as made, a PIECE at a time, the event loop
  // running between
  export async function* stream(lines: Iterable<string>): AsyncGenerator<string> {
    let piece = "";
    for (const line of lines) {
      piece += line;
      if (piece.length >= PIECE) {
        yield piece;
        piece = "";
        await new Promise((ok) => setImmediate(ok));
      }
    }
    yield piece;
  }

  // a page or post of the chat (/api/act: an act with a body, its fields
  // in the query; a POST only, since a GET is what another site may send
  // with the owner's cookie, by sending their browser here, from a
  // browser that doesn't say where it comes from: Main.http)
  export async function page(chat: Chat, p: string, req: Request): Promise<Response> {
    const mem = chat.mem;
    switch (p) {
      case "/tree": {
        return new Response(Main.stream(Memory.page(mem)), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      case "/api/tree": {
        const get = (new URL(req.url).searchParams.get("get") ?? "").split(",").slice(0, 200);
        return Response.json(get.map((key) => Memory.card(mem, ...(key.split(".").map(Number) as [number, number]))));
      }
      case "/export": {
        const name = "unii-memory-" + new Date().toISOString().slice(0, 10) + ".json";
        const json = { "content-type": "application/json", "content-disposition": 'attachment; filename="' + name + '"' };
        return new Response(Main.stream(Memory.dump(mem)), { headers: json });
      }
      case "/api/act": {
        if (req.method !== "POST") {
          return new Response("an act is a POST", { status: 405 });
        }
        const msg = { ...Object.fromEntries(new URL(req.url).searchParams), req };
        const out = await Chat.apply(chat, msg, "");
        return Response.json(out, { status: out.status ?? (out.error === undefined ? 200 : 400) });
      }
      case "/api/imported": {
        return Response.json(Chat.done(chat));
      }
      case "/api/prompts": {
        return await Main.prompts(req);
      }
      case "/api/settings": {
        return await Main.settings(req);
      }
    }
    const file = Memory.image_file(mem, p.slice("/image/".length));
    const keep = { "cache-control": "private, max-age=31536000, immutable" };
    return file === null ? new Response("not found", { status: 404 }) : new Response(Bun.file(file), { headers: keep });
  }

  // the two prompts (Tools.PROMPTS): a GET reads them, as used and as
  // built in; a POST sets the one its JSON names ({ prompt } or
  // { compact }), trimmed, at most 64 KB. Empty or the default deletes
  // its file, so a new default reaches it
  export async function prompts(req: Request): Promise<Response> {
    const read = () => Object.fromEntries(Object.entries(PROMPTS).map(([k, p]) => [k, { text: Tools.prompt(k as keyof typeof PROMPTS), def: p.def }]));
    if (req.method !== "POST") {
      return Response.json(read());
    }
    const msg = await req.json().catch(() => null);
    const which = (["prompt", "compact"] as const).find((k) => typeof msg?.[k] === "string");
    if (which === undefined) {
      return Response.json({ error: "Send { prompt } or { compact }, a text." }, { status: 400 });
    }
    const text: string = msg[which].trim();
    if (Buffer.byteLength(text) > 64 * 1024) {
      return Response.json({ error: "A prompt holds at most 64 KB." }, { status: 413 });
    }
    const { file, def } = PROMPTS[which];
    write_whole(file, text === "" || text === def ? null : text + "\n");
    return Response.json(read());
  }

  // a request. Another site's page (its browser says so: Sec-Fetch-Site)
  // only links here: it posts nothing, reaches no /api/ and opens no
  // socket, so no site acts for the owner's browser
  export async function http(req: Request, server: Bun.Server<Sock["data"]>): Promise<Response | undefined> {
    const p = new URL(req.url).pathname;
    const away = /^(cross|same)-site$/.test(req.headers.get("sec-fetch-site") ?? "");
    if (away && (req.method !== "GET" || p.startsWith("/api/") || p === "/ws")) {
      return new Response("not from another site", { status: 403 });
    }
    try {
      const own = await Owner.http(req);
      if (own !== null) {
        return own;
      }
      if (!OWN.includes(p) && !p.startsWith("/image/") && !p.startsWith("/api/")) {
        return Main.file(p);
      }
      if (!Owner.is(req)) {
        return new Response("sign in first", { status: 401 });
      }
      if (p === "/ws") {
        const q    = new URL(req.url).searchParams;
        const who  = Owner.hash(Owner.token(req));
        const data = { who, tab: q.get("tab") ?? "", wire: q.get("wire"), host: q.get("device"), work: q.get("work") ?? "~/.unii/work", shell: q.get("shell") === "PowerShell" ? "PowerShell" : null, device: null, seen: new Set<string>() };
        return server.upgrade(req, { data }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      return await Main.page(Main.chat, p, req);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  // work a socket asks (opened, closed): one that throws fails alone,
  // logged, then `fail`, never the server
  export function event(what: string, run: () => void, fail: () => void = () => {}): void {
    try {
      run();
    } catch (err: any) {
      console.error("unii: " + what + " failed: " + (err?.stack ?? err));
      fail();
    }
  }

  // the server: the chat open (a crash's work resumed), then listening.
  // Data an older unii left in the multi-user layout (users/) is moved by
  // the installer; till then, or while a move it began isn't done
  // (.migrating), this refuses to start, so no new chat starts beside
  // the old one
  export async function start(port: number): Promise<void> {
    Reap.start();
    await Main.lock();
    if ((fs.existsSync(config.DIR + "/users") && !fs.existsSync(CHAT)) || fs.existsSync(config.DIR + "/.migrating")) {
      const installer = WIN ? "irm " + INSTALL_PS1 + " | iex" : "curl -fsSL " + INSTALL + " | sh";
      throw new Error(config.DIR + " holds an older unii's data, not yet (or not all) moved to this version's layout: run the installer (" + installer + ") with no unii server running, then start again");
    }
    fs.writeFileSync(PID, String(process.pid));
    Owner.open();
    Push.keys();
    Main.chat = Chat.open();
    process.on("unhandledRejection", Main.unowned);
    Main.server = Bun.serve<Sock["data"]>({
      port               : port,
      hostname           : "127.0.0.1",
      idleTimeout        : 0,
      maxRequestBodySize : Infinity,
      fetch              : Main.http,
      websocket          : {
        maxPayloadLength         : FRAME,
        backpressureLimit        : BUFFER,
        closeOnBackpressureLimit : true,
        idleTimeout              : PING / 1000,
        open(ws: Sock) {
          Main.event("a socket", () => {
            if (ws.data.wire !== String(WIRE)) {
              ws.send(JSON.stringify({ $: "error", text: "This page or unii is older than the server: reload or reopen it (`unii update` for the latest)." }));
              return;
            }
            Chat.join(Main.chat, ws);
          }, () => ws.close(1011));
        },
        message(ws: Sock, data) {
          if (Main.chat.socks.has(ws)) {
            Chat.answer(Main.chat, ws, String(data));
          }
        },
        close(ws: Sock, code) {
          Main.event("a socket", () => Chat.leave(Main.chat, ws, code === QUIT));
        },
      },
    });
    // a tick to each socket; one whose session is gone (signed out,
    // `unii serve revoke`) closed, and that session's devices let go,
    // linked or not, so their names are free
    setInterval(() => {
      const kept = Owner.kept();
      Main.chat.socks.forEach((sock) => {
        if (kept.has(sock.data.who)) {
          return sock.send(TICK);
        }
        Chat.leave(Main.chat, sock, true);
        sock.close(QUIT, "signed out");
      });
      Tools.prune(Main.chat.tools, kept);
    }, PING / 2);
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      process.on(sig, () => process.exit(0));
    }
    process.on("exit", () => {
      fs.rmSync(PID, { force: true });
      Chat.stop(Main.chat, null);
      Memory.stop(Main.chat.mem);
    });
    console.log("unii: " + config.SITE + ", data in " + config.DIR + ", on 127.0.0.1:" + port);
  }

  // the settings page's (Settings.ts): a GET reads them, a POST saves
  export async function settings(req: Request): Promise<Response> {
    const fresh = { "cache-control": "no-store" };
    if (req.method === "GET") {
      return Response.json(Settings.page(), { headers: fresh });
    }
    if (req.method !== "POST") {
      return new Response("settings are read or saved", { status: 405 });
    }
    const out = await Settings.save(req);
    if (out.saved.length > 0) {
      console.log("unii: settings saved: " + out.saved.join(", "));
    }
    if (out.wrote) {
      Chat.offer(Main.chat);
    }
    return Response.json(out.body, { status: out.status, headers: fresh });
  }

  // a failure no owner took: every background promise has one that ends
  // it (a chat's note, a log line), so this is a bug, logged, never the
  // end of the server
  export function unowned(err: unknown): void {
    console.error("unii: a failure no one owned: " + ((err as any)?.stack ?? err));
  }

}

// `unii serve [port]`, `bun Server.ts [port]`
export async function serve(port: number): Promise<void> {
  await Main.start(port);
}

if (import.meta.main) {
  await serve(Number(process.argv[2] ?? 8788));
}
