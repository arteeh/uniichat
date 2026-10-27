#!/usr/bin/env bun

import * as fs from "node:fs";
import * as net from "node:net";
import type { ServerWebSocket } from "bun";
import { AskAI, type Ask, type Call, type End, type Event, type Kind, type Parked, type Say } from "./AskAI.ts";
import { clip_pages } from "./Clip.ts";
import { Disk } from "./Disk.ts";
import { Mcp } from "./Mcp.ts";
import * as Import from "./Import.ts";
import * as Md from "./Md.ts";
import { JOBS, Memory, type Msg as Log, type Pair, type Room, type Share } from "./Memory.ts";
import { OpenAI } from "./OpenAI.ts";
import { Owner } from "./Owner.ts";
import { Pick } from "./Pick.ts";
import { ACTIVE_MS, Push } from "./Push.ts";
import { Reap } from "./Reap.ts";
import { Settings } from "./Settings.ts";
import { INSTALL, INSTALL_PS1 } from "./Update.ts";
import { move_over, write_whole } from "./Write.ts";
import { Limit } from "./Limit.ts";
import { Run, type Heard } from "./Run.ts";
import * as Service from "./Service.ts";
import * as Timer from "./Timer.ts";
import { PROMPTS, SEARCHES, Tools } from "./Tools.ts";
import { ACTIVE, FRAME, IDLE, IMAGES, live_push, MEDIA, PING, QUIT, SUMMARIES, TICK, TURN, WIRE, type Answer, type Live, type Part, type Pending, type Queued, type Server as Out, type Sums, type Talk as Meter, TOKEN, type Wait } from "./View.ts";
import * as config from "./Config.ts";
import { err_code, err_stack, err_why } from "./Err.ts";
import { get, rec, text_of } from "./Json.ts";
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

type Sock = ServerWebSocket<{ who: string; tab: string; wire: string | null; host: string | null; work: string; scratch: string | null; shell: string | null; device: string | null; seen: Set<string>; active: number }>;

type Body = { fh: fs.promises.FileHandle; size: number };

export type Msg = { id: number; end: number };

type Talk = Run<Pending, Msg> | Run<Say, Say>;

type Eye = { parts: Part[]; from: number };

type Check = { call: Call; goal: string };

type Kept  = { a: number; b: number; said: number; spent: number };
type Batch = Kept & { micros: number[][]; open: number[]; left: number; all: number };

type Parts = {
  mem   : Memory;
  tools : Tools;
  socks : Set<Sock>;
  main  : Run<Pending, Msg>;
  pick  : Pick;
  eye   : Eye;
  batch : Batch | null;
};

type Doing = {
  acts  : Map<string, Promise<Answer>>;
  writes: Promise<unknown>;
  held  : Array<() => void> | null;
  after : Promise<void>;
};

type Turn = {
  model : string;
  asked : boolean;
  open  : number;
  check : Check | null;
  back  : number;
  sums  : { from: number; total: number } | null;
};

type Chat = Parts & Doing & Turn;

const LOCK       = config.DIR + "/lock";
const LOCK_PID   = LOCK + ".pid";
const LOCK_BEAT  = 5000;
const LOCK_DEAD  = 30000;
const WIN        = process.platform === "win32";
const PID        = config.DIR + "/server.pid";
const CHAT       = config.DIR + "/chat";
const HEAD       = "Turn: the user's new message:\n\n";
const GOAL       = "You check a goal. Below is a chat between a user and Unii, an AI agent: its older messages as summary lines (id+n|text), then its latest messages whole, then the goal the user set with /goal. Answer yes if the chat shows the goal fully satisfied now, else no. Write that one word, nothing else.";
const GOAL_ASK   = "\nThe goal:\n\n";
const GOAL_NO    = "The goal isn't satisfied yet: keep working.";
const TALK_FULL  = "Conversation mode switched itself off: it was full.";
const TALK_SMALL = "Conversation mode switched itself off: too long for {model}.";
const TALK_LONG  = "Conversation mode switched itself off: {model} refused the turn as too long.";
const TALK_BIG   = "Conversation mode can't start: the messages since message {id} already fill its space in Unii's view.";
const TALK_IMP   = "Conversation mode switched itself off: the import filled it.";
const FULL       = "UniiChat's disk is full; try again soon.";
const BATCH      = "/import.json";
const SPARE      = 2 ** 30;

const TIMER_TEXT = 200;
const RING       = 60000;
const WAKE       = 60000;

const QUEUED_TEXT = 4000;

const BODIES     = ["say", "import", "voice"];

const PAIR       = 200;

const PAGE_CSP   = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-popups";
const PAGE_BASE  = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>:root { color-scheme: light dark; } body { margin: 10px 12px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; color: #111111; background: #ffffff; } a { color: inherit; } @media (prefers-color-scheme: dark) { body { color: #e3e3e6; background: #171719; } }</style>\n`;

const PICTURED   = 20;

const READ       = 2 ** 20;

// what a socket may hold unsent (Bun's default, 16 MiB, drops the rest)
const BUFFER     = 2 ** 31 - 1;

const PIECE      = 2 ** 16;

const OWN        = ["/ws", "/export"];

const HELLO      = hello_md.trim().replace("{install}", config.SITE + "/install.sh");
const HELLO_LINE = "unii: hello: UniiChat, one endless chat kept in a memory tree, recent days in more detail; build anything for years; recalls the past (ad2cat.py); a chatbot with a memory system; the user's terminal install.";

// the site's page, index.html: imported as a file, a path (Bun's types
// take any .html for an HTML bundle)
const PAGE       = file_path(index_html);

const WEB: Record<string, string> = {
  "/"               : PAGE,
  "/account"        : PAGE,
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

WEB["/settings"] = WEB["/"];
WEB["/tree"]     = WEB["/"];

const HASHED_INTO_BUILD = [app_js, style_css, PAGE, sw_js, manifest];
const BUILD      = Bun.hash(HASHED_INTO_BUILD.map((f) => fs.readFileSync(f, "utf8")).join("\0")).toString(36);
const INDEX      = fs.readFileSync(PAGE, "utf8").replace("<html ", `<html data-build="${BUILD}" `);
const WORKER     = fs.readFileSync(sw_js, "utf8").replace("{build}", BUILD);
const STAMPED_WITH_BUILD = new Map([[PAGE, INDEX], [sw_js, WORKER]]);

let held = 0;

function stream_after(head: Uint8Array, tail: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = tail.getReader();
  let first = true;
  return new ReadableStream({
    async pull(out) {
      if (first) {
        first = false;
        return out.enqueue(head);
      }
      const got = await reader.read();
      return got.done ? out.close() : out.enqueue(got.value);
    },
    cancel() {
      return reader.cancel();
    },
  });
}

function file_path(x: unknown): string {
  if (typeof x !== "string") {
    throw new Error("an imported file is no path: " + String(x));
  }
  return x;
}

let bell: ReturnType<typeof setTimeout> | undefined;

export namespace Chat {

  export function open(): Chat {
    const mem = Memory.load(CHAT, () => ({ system: Tools.prompt("compact"), searches: 0, server: "" }), Owner.act_put);
    const cut = mem.work;
    Limit.answering(() => ({ queued: chat.main.queue.length > 0, busy: chat.main.busy }));
    const main = Run.make<Pending, Msg>(TURN, {
      pick   : () => chat.pick,
      begin  : () => Chat.begin(chat),
      log    : (_, post) => Chat.writing(chat, () => Promise.try(() => Chat.posted(chat, post))),
      ask    : (_, take) => Chat.call(chat, take),
      queued : (run) => Chat.queued(chat, run),
      again  : (post) => post.kind === "user",
      ended  : (_, end) => Chat.ended(chat, end),
      failed : (_, why) => Chat.failed(chat, why),
      ending : () => Chat.ending(chat),
      finish : () => Chat.finish(chat),
      on     : (run, ev) => Chat.on(chat, run, ev),
      change : () => Chat.change(chat),
    });
    const tools = Tools.serve(mem, main, {
      push   : (run, kind, text) => Chat.push(chat, run, kind, text),
      note   : (text) => Chat.note(chat, text),
      on     : (run, ev) => Chat.on(chat, run, ev),
      report : (text, take) => Chat.report(chat, text, take),
      change : () => Chat.change(chat),
      timed  : () => Chat.timed(chat),
    });
    Chat.keep_pick(mem.pick);
    const pick = Pick.load(mem.pick, config.OFFER, config.PICK);
    const chat: Chat = {
      mem, tools, pick, socks: new Set(), acts: new Map(), main, model: "", check: null, asked: false, open: 0,
      eye: { parts: [], from: 0 }, after: Promise.resolve(), batch: null, writes: Promise.resolve(), held: null, back: -1, sums: null,
    };
    const saved = mem.pick === null ? null : Chat.pick_name(mem.pick as Pick);
    if (saved !== null && saved !== Chat.pick_name(pick)) {
      mem.pick = pick;
      Memory.save(mem);
      Chat.keep_pick(mem.pick);
      Chat.note(chat, saved + " isn't offered here, so the chat now runs on " + Chat.pick_name(pick) + ".");
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
    Chat.resume(chat, cut).finally(() => Chat.change(chat)).catch((err: unknown) => console.error("unii: resuming the chat: " + err_why(err)));
    return chat;
  }

  export function pick_name(pick: Pick): string {
    return pick.profile ?? Pick.label(pick);
  }

  export function keep_pick(pick: object | null): void {
    const vendor = pick === null ? undefined : (pick as Partial<Pick>).vendor;
    config.config_keep(typeof vendor === "string" ? [vendor] : []);
  }

  export function share(chat: Chat, system: string): Share {
    return { ...Pick.ask(chat.pick), system, searches: 0, server: "" };
  }

  export async function say(chat: Chat, id: string, sizes: number[], body: Body): Promise<Answer> {
    if (chat.main.queue.some((x) => x.q.act === id)) {
      return {};
    }
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
    const text = (await Chat.read(body, at, body.size - at)).toString("utf8");
    const pics = [...images, ...await Chat.pictured(chat, text, images)];
    const why = await Run.take(chat.main, { kind: "user", text, images: pics, act: id });
    return why === null ? {} : { error: why };
  }

  export async function read(body: Body, at: number, n: number): Promise<Buffer<ArrayBuffer>> {
    const buf = Buffer.alloc(n);
    const got = await body.fh.read(buf, 0, n, at);
    return buf.subarray(0, got.bytesRead);
  }

  export function posted(chat: Chat, post: Pending): Msg {
    const pages = post.kind === "user" ? clip_pages(post.text) : [post.text];
    let id = -1;
    pages.forEach((page, k) => {
      const last = k === pages.length - 1;
      const msg = Chat.push(chat, chat.main, post.kind, page, last ? post.images : [], !last, last ? post.act : undefined);
      id = id < 0 ? msg.id : id;
    });
    return { id, end: chat.mem.count };
  }

  export function queued(chat: Chat, run: Run<Pending, Msg>): void {
    chat.check?.call.stop();
    chat.mem.queue = run.queue.map((x) => x.q);
    Memory.save_queue(chat.mem);
    Chat.all(chat, Chat.state(chat));
  }

  export async function pictured(chat: Chat, text: string, had: string[]): Promise<string[]> {
    const names = Md.md_pasted(text).map(([, , , url]) => url.slice("/media/".length)).filter((name) => /\.(?:png|jpeg|gif|webp)$/.test(name));
    const out: string[] = [];
    for (const name of [...new Set(names)].filter((n) => !had.includes(n)).slice(0, PICTURED)) {
      const file = Memory.media_file(chat.mem, name);
      const added = file === null ? null : await Memory.image_add(chat.mem, fs.readFileSync(file));
      out.push(...(added === null ? [] : [added]));
    }
    return out;
  }

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

  export function hold(chat: Chat, step: () => void): void {
    if (chat.held === null) {
      step();
    } else {
      chat.held.push(step);
    }
  }

  export async function* pieces(body: Body, at: number, cut: (text: string) => string[]): AsyncGenerator<[string[], boolean]> {
    const dec = new TextDecoder();
    let rest = "";
    do {
      const buf = await Chat.read(body, at, READ);
      at += buf.length;
      const all = cut(rest + dec.decode(buf, { stream: at < body.size }));
      rest = at < body.size ? all.pop() ?? "" : "";
      if (rest.length > READ) {
        throw new Error("A line over " + READ + " characters: no import sends it.");
      }
      yield [all, at < body.size];
    } while (at < body.size);
  }

  export async function voice(chat: Chat, id: string, type: string, body: Body): Promise<Answer> {
    const got = await OpenAI.transcribe(new Blob([await Chat.read(body, 0, body.size)], { type })).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));
    if (got instanceof Error) {
      return { error: got.message };
    }
    Chat.mark(chat, id, { ans: { text: got.text } });
    return { text: got.text };
  }

  export function begin(chat: Chat): void {
    Tools.left(chat.tools);
    if (Tools.holding(chat.tools).length === 0) {
      Tools.apply(chat.tools);
    }
  }

  export function ending(chat: Chat): void {
    const halt = chat.main.halt.signal;
    const reason: unknown = halt.reason;
    const why = halt.aborted && typeof reason === "string" ? reason : null;
    if (why !== null) {
      Chat.note(chat, why);
    }
    chat.sums = null;
  }

  export function finish(chat: Chat): void {
    Chat.live(chat, chat.main, []);
    Chat.phone(chat);
    Chat.after(chat);
    Chat.change(chat);
  }

  export function from(chat: Chat): number {
    return Memory.whole(chat.mem, chat.main.wait[0].id);
  }

  export async function call(chat: Chat, take: () => Msg[]): Promise<Ask | null> {
    const mem = chat.mem;
    const halt = chat.main.halt;
    if (halt.signal.aborted) {
      return null;
    }
    Main.follow();
    const none = config.config_none();
    if (none !== null) {
      Chat.failed(chat, none);
      return null;
    }
    Chat.change(chat);
    await Tools.look(chat.tools);
    if (halt.signal.aborted) {
      return null;
    }
    let from = -1;
    while (from !== Chat.from(chat)) {
      from = Chat.from(chat);
      chat.sums = { from, total: (chat.sums?.total ?? 0) + Memory.unbuilt(mem, from) };
      if (chat.sums.total > 0) {
        Chat.all(chat, Chat.state(chat));
      }
      const why = await Memory.settle(mem, from, halt.signal);
      if (why !== null) {
        chat.sums = null;
        if (!halt.signal.aborted) {
          Chat.failed(chat, why);
        }
        return null;
      }
    }
    chat.sums = null;
    const msgs = take();
    const says = msgs.filter((m) => m.end > from).map((m) => Memory.say(mem, Math.max(m.id, from), m.end));
    const view = Memory.view(mem, from, mem.view.parts, mem.talk, mem.talk === null ? -1 : chat.back);
    chat.back = mem.talk === null ? -1 : view.length - 3;
    Mcp.heard(chat.tools.mcp, Tools.off(chat.tools), "main", true);
    const text = says.map((say) => say.text).join("\n\n");
    const imgs = says.flatMap((say) => say.imgs);
    const server = Tools.at(chat.tools, "main");
    chat.eye = Chat.eye(mem, from);
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    const blocks = [...view, Tools.devices(chat.tools), Tools.skills(chat.tools), Tools.at_work(chat.tools), { text: HEAD + text, mark: true }];
    const ask = { ...Chat.share(chat, Tools.prompt("prompt")), searches: SEARCHES, server, blocks, imgs, talk: mem.talk !== null, who: "main", used: (tokens: number) => Chat.used(chat, tokens) };
    chat.model = chat.pick.model;
    chat.asked = true;
    chat.open = 0;
    return ask;
  }

  export async function ended(chat: Chat, end: End): Promise<boolean> {
    const main = chat.main;
    const halt = main.halt;
    if (!end.ok && !halt.signal.aborted) {
      Chat.failed(chat, end.text);
    }
    if (end.long && chat.mem.talk !== null) {
      Chat.talk_off(chat, TALK_LONG);
    }
    if (end.note) {
      Chat.all(chat, { $: "note", text: end.note });
    }
    const goal = chat.mem.goal;
    if (end.ok && !halt.signal.aborted && main.queue.length === 0 && goal !== null) {
      return Chat.checked(chat, Chat.check(chat, goal), halt);
    }
    return !halt.signal.aborted;
  }

  export function check(chat: Chat, goal: string): Check {
    const mem  = chat.mem;
    const at   = Memory.whole(mem, 0);
    const tail = Array.from({ length: mem.count - at }, (_, k) => at + k).map((i) => {
      const msg = Memory.at(mem, i);
      return Memory.line({ l: 0, i }, msg.kind + ": " + msg.text) + "\n";
    });
    const blocks = [...Memory.view(mem, at, Memory.fitted(mem)), { text: tail.join("") + GOAL_ASK + goal, mark: true }];
    return { call: AskAI.ask({ ...Chat.share(chat, GOAL), blocks, who: "goal" }, (ev) => Chat.checking(chat, ev)), goal };
  }

  export function checking(chat: Chat, ev: Event): void {
    if (ev.$ === "Limit") {
      Chat.limit(chat, chat.main, ev.limit);
    }
  }

  export async function checked(chat: Chat, check: Check, halt: AbortController): Promise<boolean> {
    const { call, goal } = (chat.check = check);
    halt.signal.addEventListener("abort", () => call.stop(), { once: true });
    const end = await call.done;
    const mem = chat.mem;
    const on = !halt.signal.aborted && mem.goal === goal && chat.main.queue.length === 0;
    chat.check = null;
    chat.main.limit = null;
    if (on && !end.ok) {
      Chat.note(chat, "No goal check: " + end.text.replace(/\.$/, "") + ". The goal stays; /halt drops it.");
    } else if (on && /^\W*yes\b/i.test(end.text)) {
      mem.goal = null;
      Memory.save(mem);
      Chat.note(chat, "Goal met.");
    } else if (on) {
      void Run.take(chat.main, { kind: "user", text: GOAL_NO, images: [] });
    }
    return !halt.signal.aborted;
  }

  export function failed(chat: Chat, why: string): void {
    Chat.note(chat, "No reply: " + why.replace(/\.$/, "") + ". Send a message to try again.");
  }

  export function note(chat: Chat, text: string): void {
    Chat.hold(chat, () => Chat.push(chat, chat.main, "note", text));
  }

  export function push(chat: Chat, run: Talk, kind: Kind, text: string, images: string[] = [], more = false, act?: string, pair: Pair = {}): Msg {
    Chat.flush(chat, run, kind === "echo" ? pair.of : undefined);
    return Chat.put(chat, run, { kind, text, images, more, act, ...pair });
  }

  export function put(chat: Chat, run: Talk, msg: Log): Msg {
    if (run !== chat.main) {
      const { kind, text, of, tool } = msg;
      const id = Memory.agent_push(chat.mem, run.name, kind, text, { of, tool });
      Chat.all(chat, { $: "entry", agent: run.name, id, kind, text, of, tool });
      return { id, end: id + 1 };
    }
    const roots = Memory.push(chat.mem, [msg]);
    for (const { i, kind, text, date, images, of, tool } of roots) {
      Chat.all(chat, { $: "entry", id: i, kind, text, date, images, of, tool });
    }
    Chat.talked(chat);
    return { id: roots[0].i, end: chat.mem.count };
  }

  export function started_unlogged(run: Talk, upto?: string) {
    const ids = [...run.calls.keys()];
    const end = upto === undefined ? ids.length : ids.indexOf(upto) + 1 || ids.length;
    return [...run.calls].slice(0, end).filter(([, call]) => !call.logged && call.started);
  }

  export function mid_message(chat: Chat, run: Talk): boolean {
    return run === chat.main && chat.mem.open > 0;
  }

  export function flush(chat: Chat, run: Talk, upto?: string): void {
    const left = Chat.started_unlogged(run, upto);
    if (left.length === 0 || Chat.mid_message(chat, run)) {
      return;
    }
    for (const [of, call] of left) {
      call.logged = true;
      Chat.put(chat, run, { kind: "tool", text: call.text, of });
    }
    Chat.live(chat, run, Chat.waiting(run));
  }

  export function talked(chat: Chat, why = TALK_FULL): void {
    const mem = chat.mem;
    if (mem.talk === null) {
      return;
    }
    if (Memory.talk_size(mem) <= Chat.room(chat)) {
      return Chat.all(chat, Chat.state(chat));
    }
    Chat.talk_off(chat, why);
  }

  export function talk_off(chat: Chat, why: string): void {
    const from = chat.mem.talk;
    Chat.talk(chat, null);
    Chat.note(chat, why.replace("{id}", String(from)).replace("{model}", Chat.model_name(chat)));
  }

  export function used(chat: Chat, tokens: number): void {
    chat.mem.used = tokens;
    if (chat.mem.talk !== null) {
      Memory.save(chat.mem);
      Chat.all(chat, Chat.state(chat));
    }
  }

  export function meter(chat: Chat): Meter | null {
    const mem = chat.mem;
    if (mem.talk === null) {
      return null;
    }
    const window = Pick.window(chat.pick, config.OFFER);
    const tokens = mem.used ?? Chat.guess(chat);
    return { from: mem.talk, used: Math.min(1, tokens / window), tokens, window, model: Chat.model_name(chat), guess: mem.used === null };
  }

  export function guess(chat: Chat): number {
    const mem = chat.mem;
    const blocks = [...Memory.view(mem, mem.count, mem.view.parts, mem.talk), Tools.devices(chat.tools), Tools.skills(chat.tools), Tools.at_work(chat.tools)];
    const texts = [Tools.prompt("prompt"), JSON.stringify(Tools.list("main")), ...blocks.map((b) => b.text)];
    return Math.ceil(texts.reduce((n, text) => n + Memory.bytes(text), 0) / TOKEN);
  }

  export function room(chat: Chat): number {
    return Memory.talk_room(Pick.window(chat.pick, config.OFFER));
  }

  export function model_name(chat: Chat): string {
    return chat.pick.profile ?? chat.pick.model;
  }

  export function talk(chat: Chat, from: number | null): void {
    chat.mem.talk = from;
    chat.mem.talked.clear();
    Memory.save(chat.mem);
    Chat.change(chat);
  }

  export function on(chat: Chat, run: Talk, ev: Heard): void {
    const name = run === chat.main ? undefined : run.name;
    if (ev.$ === "Ended") {
      run.limit = null;
      Chat.unanswered(chat, run);
      Chat.live(chat, run, []);
      return;
    }
    if (ev.$ === "Limit") {
      return Chat.limit(chat, run, ev.limit);
    }
    if (ev.$ === "Again") {
      return;
    }
    if (ev.$ === "Run") {
      Chat.ran(chat, run, ev);
      return;
    }
    if (run === chat.main) {
      Chat.asks(chat, ev);
    }
    if (ev.$ === "Delta") {
      live_push(run.live, ev.kind, ev.text, ev.fresh);
      Chat.all(chat, { $: "delta", agent: name, kind: ev.kind, text: ev.text, fresh: ev.fresh });
      return;
    }
    if (ev.$ === "Start") {
      const call = run.calls.get(ev.of);
      if (call !== undefined) {
        call.started = true;
      }
      return;
    }
    if (ev.kind === "tool" && ev.of !== undefined) {
      run.calls.set(ev.of, { text: ev.text, tool: ev.text.split(" ", 1)[0], logged: false, started: ev.queued !== true });
    } else if (ev.kind === "mind") {
      Chat.all(chat, { $: "entry", agent: name, kind: ev.kind, text: ev.text });
    } else if (ev.kind !== "user") {
      const { kind, text, of } = ev;
      const call = of === undefined ? undefined : run.calls.get(of);
      if (call !== undefined) {
        call.started = true;
      }
      Chat.hold(chat, () => {
        Chat.push(chat, run, kind, text, [], false, undefined, of === undefined ? {} : { of, tool: run.calls.get(of)?.tool });
        if (of !== undefined && run.calls.delete(of)) {
          Chat.live(chat, run, Chat.waiting(run));
        }
      });
    }
    Chat.live(chat, run, Chat.waiting(run));
  }

  export function limit(chat: Chat, run: Talk, limit: Parked | null): void {
    run.limit = limit;
    Chat.change(chat);
  }

  export function ran(chat: Chat, run: Talk, ev: Extract<Event, { $: "Run" }>): void {
    const now = ev.from === null ? null : Pick.label(ev.run);
    if (run === chat.main) {
      chat.model = ev.run.model;
    }
    if (now === run.fell) {
      return;
    }
    run.fell = now;
    const text = ev.from === null ? "Back on " + Pick.label(ev.run) + "." : Pick.label(ev.from) + " failed: " + ev.why.replace(/\.$/, "") + ". Going on with " + now + ".";
    Chat.hold(chat, () => Chat.push(chat, run, "note", text));
  }

  export function waiting(run: Talk): Live[] {
    return [...run.calls.values()].filter((call) => !call.logged).map((call) => ({ kind: "tool", text: call.text }));
  }

  export function unanswered(chat: Chat, run: Talk): void {
    const ids = [...run.calls.keys()];
    Chat.hold(chat, () => {
      Chat.flush(chat, run);
      ids.forEach((id) => run.calls.delete(id));
    });
    Chat.live(chat, run, []);
  }

  export function asks(chat: Chat, ev: Event): void {
    const kind = ev.$ === "Entry" ? ev.kind : "";
    const step = kind === "tool" ? 1 : kind === "echo" ? -1 : 0;
    chat.open = ev.$ === "Delta" ? 0 : Math.max(0, chat.open + step);
    const asked = kind === "echo" && chat.open === 0;
    if (asked !== chat.asked) {
      chat.asked = asked;
      Chat.change(chat);
    }
  }

  export function live(chat: Chat, run: Talk, live: Live[]): void {
    run.live = live;
    Chat.all(chat, { $: "live", agent: run === chat.main ? undefined : run.name, live });
  }

  export function report(chat: Chat, text: string, take: boolean): void {
    if (take) {
      void Run.take(chat.main, { kind: "work", text, images: [] });
      return Chat.change(chat);
    }
    Chat.hold(chat, () => {
      Chat.push(chat, chat.main, "work", text);
      Chat.change(chat);
    });
  }

  export function phone(chat: Chat): void {
    const last = Memory.message(chat.mem, chat.mem.count - 1);
    const used = [...chat.socks].some((sock) => Date.now() - sock.data.active < ACTIVE_MS);
    if (!used && last !== null && (last.kind === "unii" || last.kind === "note")) {
      Push.notify(Owner.open(), last.text);
    }
  }

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
    }).catch((err: unknown) => console.error("after: " + err_why(err)));
  }

  export async function ingest(chat: Chat, id: string, body: Body): Promise<Answer> {
    if (chat.main.busy || chat.batch !== null) {
      return { error: (chat.main.busy ? "Unii is answering" : "An import is under way") + ": import again once it ends." };
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
    Chat.talked(chat, TALK_IMP);
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    Chat.progress(chat);
    return { going: chat.batch !== null };
  }

  export function batch(chat: Chat, { a, b, said, spent }: Kept): Batch {
    const sizes = Array.from({ length: b - a }, (_, k) => Memory.message(chat.mem, a + k)?.size ?? 0);
    const micros = Import.import_guess(a, sizes);
    const batch = { a, b, said, spent, micros, open: micros.map((level) => level.length), left: micros.flat().reduce((x, y) => x + y, 0), all: 0 };
    batch.all = Chat.time(batch);
    micros.forEach((level, l) => level.forEach((_, j) => Memory.node(chat.mem, { l, i: Math.floor(a / 2 ** l) + j }) !== null && Chat.built(batch, l, j)));
    return batch;
  }

  export function built(batch: Batch, l: number, j: number): void {
    const cost = batch.micros[l]?.[j];
    if (cost !== undefined) {
      batch.left -= cost;
      batch.open[l] -= 1;
    }
  }

  export function time(batch: Batch): number {
    return batch.left / JOBS + batch.micros.reduce((t, level, l) => t + (batch.open[l] > 0 ? level[level.length - 1] : 0), 0);
  }

  export function keep(batch: Batch, chat: Chat): void {
    const file = chat.mem.dir + BATCH;
    const { a, b, said, spent } = batch;
    fs.writeFileSync(file + ".new", JSON.stringify({ a, b, said, spent, why: chat.mem.hold[1] }));
    move_over(file + ".new", file);
    void Disk.wrote(file);
  }

  export function resumed(chat: Chat): Batch | null {
    const file = chat.mem.dir + BATCH;
    if (!fs.existsSync(file)) {
      return null;
    }
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Kept & { why?: string };
    chat.mem.hold[1] = saved.why === "paused" ? "paused" : null;
    return Chat.batch(chat, saved);
  }

  export async function* reads(body: Body): AsyncGenerator<Log[]> {
    for await (const [lines] of Chat.pieces(body, 0, (text) => text.split("\n"))) {
      yield lines.filter((line) => line !== "").map((line) => Chat.imported(JSON.parse(line)));
    }
  }

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

  export function done(chat: Chat): Import.Done {
    const done: Import.Done = {};
    let key = "";
    for (let i = 0; i < chat.mem.count; i++) {
      const m = Memory.at(chat.mem, i);
      if (m.imported && m.kind === "note") {
        key = Import.import_key(m);
      } else if (m.imported && m.date > (done[key] ?? "")) {
        done[key] = m.date;
      }
    }
    return done;
  }

  export function imported(x: unknown): Log {
    const kinds: Kind[] = ["user", "unii", "tool", "echo", "note"];
    const kind = kinds.find((k) => k === get(x, "kind"));
    if (kind === undefined) {
      throw new Error("An import has no kind " + String(get(x, "kind")) + ".");
    }
    const [text, when, of, tool] = [get(x, "text"), String(get(x, "date")), get(x, "of"), get(x, "tool")];
    if (typeof text !== "string") {
      throw new Error("An import has a " + kind + " message with no text.");
    }
    const date = Number.isNaN(Date.parse(when)) ? undefined : new Date(when).toISOString();
    const pair = (y: unknown) => (typeof y === "string" && y.length <= PAIR ? y : undefined);
    return { kind, text, date, more: get(x, "more") === true, of: pair(of), tool: pair(tool) };
  }

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

  export function progress(chat: Chat): void {
    const batch = chat.batch;
    if (batch === null || chat.mem.done) {
      if (!chat.mem.done && Chat.waits(chat) === SUMMARIES) {
        Chat.all(chat, Chat.state(chat));
      }
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

  export async function resume(chat: Chat, work: string[]): Promise<void> {
    const tells = chat.mem.tells;
    const agents = [...new Set([...work.filter((w) => w !== TURN), ...Object.keys(tells)])];
    const text = Tools.restarted([...(work.includes(TURN) ? [TURN] : []), ...agents]);
    if (agents.length > 0 && !work.includes(TURN)) {
      Chat.push(chat, chat.main, "note", text);
    }
    const queued = chat.mem.queue.filter((post) => post.act === undefined || Owner.act_get(post.act) === null);
    const posts: Pending[] = [...(work.includes(TURN) ? [{ kind: "note" as const, text, images: [] }] : []), ...queued];
    posts.forEach((post) => void Run.take(chat.main, post));
    await Promise.all(agents.map((w) => Tools.tell(chat.tools, w, text, tells[w] ?? [])));
  }

  export function timed(chat: Chat, retry = false): void {
    clearTimeout(bell);
    const first = retry ? Date.now() + RING : Math.min(...chat.mem.timers.map((t) => Date.parse(t.at)));
    if (first < Infinity) {
      bell = setTimeout(() => Chat.fire(chat, Date.now()), Math.min(WAKE, Math.max(0, first - Date.now())));
    }
    Chat.change(chat);
  }

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
          const act = (t: Timer.Timer) => "timer " + t.id + " " + t.at;
          const fresh = dues.filter((t) => Owner.act_get(act(t)) === null && !chat.main.queue.some((x) => x.q.act === act(t)));
          mem.timers = mem.timers.flatMap((t) => (dues.includes(t) ? (Timer.timer_after(t, at) ?? []) : [t]));
          fresh.forEach((t) => void Run.take(chat.main, { kind: "work", text: Timer.timer_say(t, at), images: [], act: act(t) }));
          mem.queue = chat.main.queue.map((x) => x.q);
          Memory.save_queue(mem);
          Memory.save(mem);
        }
        Chat.timed(chat);
      } catch (err) {
        console.error("unii: the schedules failed: " + err_stack(err));
        Chat.timed(chat, true);
      }
    });
  }

  export function full(): boolean {
    const disk = fs.statfsSync(config.DIR);
    return disk.bavail * disk.bsize < SPARE;
  }

  export function running(chat: Chat): string[] {
    return [...(chat.main.busy ? [TURN] : []), ...Tools.working(chat.tools).map((a) => a.name)];
  }

  export function interrupt(chat: Chat, why: string | null): void {
    Run.stop(chat.main, why);
  }

  export function stop(chat: Chat, why: string | null): void {
    const turn = chat.main.busy && !chat.main.halt.signal.aborted;
    Chat.interrupt(chat, turn ? why : null);
    Tools.stop(chat.tools, null);
    if (!turn && why !== null) {
      Chat.note(chat, why);
    }
  }

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
    const mcp = [...chat.tools.mcp.all.keys()].map((name) => ({ name, on: !chat.mem.off.includes(name) }));
    const talk = Chat.meter(chat);
    const limits: Record<string, Parked> = {};
    const queue: Record<string, Queued[]> = {};
    const shown = (text: string): string => (text.length > QUEUED_TEXT ? text.slice(0, QUEUED_TEXT) + "…" : text);
    for (const run of [chat.main, ...[...chat.tools.agents.values()].map((a) => a.run)]) {
      if (run.limit !== null) {
        limits[run.name] = run.limit;
      }
      if (run.queue.length > 0) {
        queue[run.name] = run.queue.map(({ q }) => ({ kind: "kind" in q ? q.kind : "user", text: shown(q.text) }));
      }
    }
    return { $: "state", busy: chat.main.busy, wait: Chat.waits(chat), agents, runs, pick: chat.pick, ...config.OFFER, importing, limits, queue, sums: Chat.sums(chat), again: chat.mem.again, timers, mcp, talk, build: BUILD, site: config.SITE };
  }

  export function sums(chat: Chat): Sums | null {
    const sums = chat.sums;
    return sums === null || sums.total === 0 ? null : { done: sums.total - Memory.unbuilt(chat.mem, sums.from), total: sums.total };
  }

  export function waits(chat: Chat): Wait {
    if (chat.main.call !== null) {
      return chat.asked ? chat.model : "";
    }
    const summing = chat.main.busy && chat.main.wait.length > 0 && Memory.first(chat.mem) < Chat.from(chat);
    return summing ? SUMMARIES : "";
  }

  export function offer(chat: Chat): void {
    const pick = Pick.load(chat.mem.pick, config.OFFER, config.PICK);
    const saved = chat.mem.pick === null ? null : Chat.pick_name(chat.mem.pick as Pick);
    chat.pick = pick;
    if (saved !== null && saved !== Chat.pick_name(pick)) {
      chat.mem.pick = pick;
      Memory.save(chat.mem);
      Chat.keep_pick(chat.mem.pick);
      Chat.note(chat, saved + " isn't offered here, so the chat now runs on " + Chat.pick_name(pick) + ".");
    }
    Chat.change(chat);
    Chat.talked(chat, TALK_SMALL);
  }

  export function change(chat: Chat): void {
    const work = Chat.running(chat);
    if ((!chat.main.busy || chat.main.limit !== null) && Tools.holding(chat.tools).length === 0) {
      Tools.apply(chat.tools);
    }
    if (String(work) !== String(chat.mem.work)) {
      chat.mem.work = work;
      Memory.save(chat.mem);
    }
    Chat.all(chat, Chat.state(chat));
  }

  export function join(chat: Chat, sock: Sock): void {
    const { tab, host, work, scratch, shell } = sock.data;
    chat.socks.add(sock);
    if (host === null) {
      Chat.send(sock, Chat.state(chat));
      Chat.show(chat, sock);
      Chat.send(sock, { $: "live", live: chat.main.live });
      return;
    }
    const link = { send: (msg: object) => Chat.send(sock, msg), live: () => chat.socks.has(sock), work, scratch, shell };
    sock.data.device = Tools.attach(chat.tools, tab, host, sock.data.who, link, Owner.kept());
    if (sock.data.device !== host) {
      Chat.send(sock, { $: "note", text: host + " was taken: Unii calls this computer " + sock.data.device + "." });
    }
  }

  export function leave(chat: Chat, sock: Sock, quit: boolean): void {
    chat.socks.delete(sock);
    if (quit && sock.data.device !== null) {
      Tools.detach(chat.tools, sock.data.tab, sock.data.device);
    } else if (sock.data.device !== null) {
      Tools.lost(chat.tools, sock.data.tab, sock.data.device);
    }
  }

  export async function answer(chat: Chat, sock: Sock, data: string): Promise<void> {
    let msg: unknown = null;
    const out = await Promise.try(() => {
      msg = JSON.parse(data);
      const got = rec(msg) ? msg : {};
      return Chat.ask(chat, sock, got) ?? Chat.apply(chat, got, sock.data.device ?? "");
    }).catch(Chat.fail);
    Chat.send(sock, { $: "ack", id: text_of(get(msg, "id")), ...out });
  }

  export function fail(err: unknown): Answer {
    return { error: err_why(err) };
  }

  export function ask(chat: Chat, sock: Sock, msg: Record<string, unknown>): Answer | null {
    switch (msg.$) {
      case "servers": {
        if (sock.data.device !== null) {
          Tools.servers(chat.tools, sock.data.device, msg.mcp);
        }
        return {};
      }
      case "zoom": {
        if (!Array.isArray(msg.part)) {
          throw new Error("A zoom has no part.");
        }
        const [id, n] = msg.part.map(Number);
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
        log?.forEach(({ kind, text, date, of, tool }) => Chat.send(sock, { $: "entry", agent: name, kind, text, date, of, tool }));
        Chat.send(sock, { $: "live", agent: name, live: chat.tools.agents.get(name)?.run.live ?? [] });
        return {};
      }
    }
    return null;
  }

  export function apply(chat: Chat, msg: Record<string, unknown>, device: string): Promise<Answer> {
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

  export async function act(chat: Chat, id: string, msg: Record<string, unknown>, device: string): Promise<Answer> {
    if (msg.req instanceof Request && typeof msg.$ === "string" && BODIES.includes(msg.$)) {
      return Chat.post(chat, id, msg.$, msg.req, msg);
    }
    if (msg.$ === "stop") {
      return Chat.stop_recorded(chat, id, msg.name === undefined ? null : text_of(msg.name, "null"));
    }
    return Chat.set_state(chat, msg, device);
  }

  export function stop_recorded(chat: Chat, id: string, name: string | null): Answer {
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

  export function set_state(chat: Chat, msg: Record<string, unknown>, device: string): Answer | Promise<Answer> {
    switch (msg.$) {
      case "goal": {
        const goal = msg.text === null ? null : text_of(msg.text, "undefined");
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
        chat.main.fell = null;
        chat.tools.agents.forEach((a) => (a.run.fell = null));
        Memory.save(chat.mem);
        Chat.keep_pick(pick);
        Chat.change(chat);
        Chat.talked(chat, TALK_SMALL);
        return {};
      }
      case "out": {
        Tools.done(chat.tools, device, String(msg.job), Tools.out(msg.out));
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
        const on = msg.on === true || msg.on === "true";
        const mem = chat.mem;
        if ((mem.talk !== null) === on) {
          return {};
        }
        const from = on ? Memory.talk_from(mem) : null;
        mem.talk = from;
        if (from !== null && Memory.talk_size(mem) > Chat.room(chat)) {
          mem.talk = null;
          mem.talked.clear();
          return { error: TALK_BIG.replace("{id}", String(from)) };
        }
        Chat.talk(chat, from);
        return {};
      }
      case "mcp": {
        const name = String(msg.name);
        const on = msg.on === true || msg.on === "true";
        if (!chat.tools.mcp.all.has(name)) {
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
    return { error: "No act " + String(msg.$) + "." };
  }

  export async function post(chat: Chat, id: string, what: string, req: Request, msg: Record<string, unknown>): Promise<Answer> {
    if (Chat.full()) {
      return { error: FULL, status: 507 };
    }
    const file = chat.mem.dir + "/up/" + crypto.randomUUID();
    fs.mkdirSync(chat.mem.dir + "/up", { recursive: true });
    const body = { fh: await fs.promises.open(file, "w+"), size: 0 };
    fs.rmSync(file);
    try {
      const reader = req.body?.getReader();
      for (let got = await reader?.read(); got !== undefined && !got.done; got = await reader?.read()) {
        await body.fh.write(got.value);
        body.size += got.value.length;
      }
      switch (what) {
        case "say": {
          if (typeof msg.sizes !== "string") {
            throw new Error("A say has no sizes.");
          }
          return await Chat.say(chat, id, msg.sizes.split(",").filter(Boolean).map(Number), body);
        }
        case "import": {
          return await Chat.writing(chat, () => Chat.ingest(chat, id, body));
        }
        case "voice": {
          return await Chat.voice(chat, id, String(msg.type), body);
        }
      }
      return { error: "No act " + what + "." };
    } finally {
      await body.fh.close();
    }
  }

  export function mark(chat: Chat, id: string, rec: object): void {
    Memory.log(chat.mem, "main", [{ act: id, ...rec }]);
  }

  export function eye(mem: Memory, from: number): Eye {
    const parts = Memory.before(mem.view.parts, from).map((part): Part => [Memory.span(part)[0], 2 ** part.l]);
    return { parts, from };
  }

  export function import_cover(chat: Chat, count: number): [number, number] {
    const [a, hi] = chat.batch === null ? [0, 0] : [chat.batch.a, chat.batch.b];
    const root = Memory.roots(count).find((part) => Memory.span(part)[1] >= a);
    const lo = root === undefined ? a : Memory.span(root)[0];
    const near = chat.eye.parts.filter(([id, n]) => id < hi && id + n > lo);
    return [Math.min(lo, ...near.map(([id]) => id)), Math.max(hi, ...near.map(([id, n]) => id + n))];
  }

  export function show(chat: Chat, sock: Sock): void {
    if (sock.data.host !== null) {
      return;
    }
    const [from, count] = [chat.eye.from, chat.mem.count];
    const cover = Chat.import_cover(chat, count);
    const eye = chat.eye.parts.filter(([id, n]) => id + n <= cover[0] || id >= cover[1]);
    const tree = Memory.roots(count).flatMap((part) => Chat.blocks(part, cover));
    const ids = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k): Part => [a + k, 1]);
    const raw = [...ids(from, cover[0]), ...ids(Math.max(from, cover[1]), count)];
    const parts = [...eye, ...tree, ...raw].sort((x, y) => x[0] - y[0]);
    Chat.teach(chat, sock, parts);
    Chat.send(sock, { $: "view", parts, turn: from });
  }

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

  export function teach(chat: Chat, sock: Sock, parts: Part[]): void {
    for (const [id, n] of parts.filter(([id, n]) => !sock.data.seen.has(id + "+" + n))) {
      sock.data.seen.add(id + "+" + n);
      if (n === 1) {
        const m = Memory.at(chat.mem, id);
        Chat.send(sock, { $: "know", whole: { [id]: { kind: m.kind, text: m.text, date: m.date, images: m.images, of: m.of, tool: m.tool } } });
      }
      Chat.know(chat, sock, id, n);
    }
  }

  export function know(chat: Chat, sock: Sock, id: number, n: number): void {
    const text = Memory.node(chat.mem, { l: Math.log2(n), i: id / n });
    if (text !== null) {
      Chat.send(sock, { $: "know", nodes: { [id + "+" + n]: { text, to: Memory.at(chat.mem, id + n - 1).date } } });
    }
  }

}

export namespace Main {

  export let chat: Chat;
  export let server: Bun.Server<Sock["data"]>;

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
      } catch (err) {
        if (err_code(err) !== "EEXIST") {
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
      } catch (err) {
        if (err_code(err) !== "EADDRINUSE") {
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
    } catch (err) {
      return err_code(err) === "EPERM";
    }
  }

  export function file(pathname: string, req: Request): Response {
    const file = WEB[pathname];
    if (file === undefined) {
      return new Response("not found", { status: 404 });
    }
    if (!HASHED_INTO_BUILD.includes(file)) {
      return new Response(Bun.file(file));
    }
    const headers = { "cache-control": "no-cache", etag: `"${BUILD}"` };
    if (req.headers.get("if-none-match") === headers.etag) {
      return new Response(null, { status: 304, headers });
    }
    const made = STAMPED_WITH_BUILD.get(file) ?? null;
    const type = file === PAGE ? "text/html;charset=utf-8" : "text/javascript;charset=utf-8";
    return made === null ? new Response(Bun.file(file), { headers }) : new Response(made, { headers: { ...headers, "content-type": type } });
  }

  export function stream(lines: Iterable<string>): ReadableStream<Uint8Array> {
    const it = lines[Symbol.iterator]();
    const utf8 = new TextEncoder();
    return new ReadableStream({
      async pull(out) {
        let piece = "";
        for (let next = it.next(); ; next = it.next()) {
          piece += next.done ? "" : next.value;
          if (next.done || piece.length >= PIECE) {
            out.enqueue(utf8.encode(piece));
            if (next.done) {
              out.close();
            }
            break;
          }
        }
        await new Promise((ok) => setImmediate(ok));
      },
      cancel() {
        it.return?.();
      },
    });
  }

  export async function page(chat: Chat, p: string, req: Request): Promise<Response> {
    const mem = chat.mem;
    switch (p) {
      case "/api/tree": {
        const q = new URL(req.url).searchParams.get("get");
        if (q === null) {
          return Response.json(Memory.meta(mem));
        }
        const get = q.split(",").slice(0, 200);
        return Response.json(get.map((key) => Memory.card(mem, ...(key.split(".").map(Number) as [number, number]))));
      }
      case "/export": {
        const name = "unii-memory-" + new Date().toISOString().slice(0, 10) + ".json";
        const json = { "content-type": "application/json", "content-disposition": 'attachment; filename="' + name + '"' };
        return new Response(Main.stream(Memory.dump(mem)), { headers: json });
      }
      case "/api/act": {
        const refused = Main.post_only(req);
        if (refused !== null) {
          return refused;
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
      case "/api/media": {
        if (req.method !== "POST" || req.body === null) {
          return new Response("a file is posted", { status: 405 });
        }
        const file = new URL(req.url).searchParams.get("name") ?? "";
        const size = req.headers.get("content-length");
        const room = Main.room(file, size === null ? null : Number(size));
        const out = typeof room === "string" ? { error: room } : await Memory.media_add(mem, req.body, file, room);
        return Response.json(out, { status: "error" in out ? 400 : 200 });
      }
    }
    if (p.startsWith("/media/")) {
      return Main.media(Memory.media_file(mem, p.slice("/media/".length)), req);
    }
    const file = Memory.image_file(mem, p.slice("/image/".length));
    const keep = { "cache-control": "private, max-age=31536000, immutable" };
    return file === null ? new Response("not found", { status: 404 }) : new Response(Bun.file(file), { headers: keep });
  }

  export function room(file: string, size: number | null): Room | string {
    const free = () => {
      const disk = fs.statfsSync(config.DIR);
      return disk.bavail * disk.bsize - SPARE - held;
    };
    const cap = file + " is over the media store's " + Math.round(config.MEDIA_MAX / 2 ** 20) + " MB (config media_mb).";
    if (size !== null && !(size >= 0)) {
      return "An upload says no size it can have.";
    }
    if (size !== null && size > config.MEDIA_MAX) {
      return cap;
    }
    if (size !== null && size > free()) {
      return FULL;
    }
    let [mine, got] = [size ?? 0, 0];
    held += mine;
    return {
      take(n) {
        if (got + n > (size ?? config.MEDIA_MAX)) {
          return size === null ? cap : file + " is longer than its upload said.";
        }
        if (size === null && n > free()) {
          return FULL;
        }
        held += size === null ? n : 0;
        mine += size === null ? n : 0;
        got += n;
        return null;
      },
      wrote(n) {
        held -= n;
        mine -= n;
      },
      end() {
        held -= mine;
        mine = 0;
      },
    };
  }

  export function media(file: string | null, req: Request): Response {
    if (file === null) {
      return new Response("not found", { status: 404 });
    }
    const type = MEDIA.get(file.split(".").pop() ?? "");
    const size = fs.statSync(file).size;
    const headers: Record<string, string> = { "content-type": type ?? "application/octet-stream", "cache-control": "private, max-age=31536000, immutable", "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
    if (type === undefined) {
      headers["content-disposition"] = "attachment";
      headers["content-security-policy"] = "default-src 'none'; sandbox";
    }
    if (type === "image/svg+xml") {
      headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    }
    if (type === "text/html") {
      headers["content-security-policy"] = PAGE_CSP;
      return new Response(stream_after(new TextEncoder().encode(PAGE_BASE), Bun.file(file).stream()), { headers });
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (range === null || range[1] + range[2] === "") {
      return new Response(Bun.file(file), { headers });
    }
    const [a, b] = range[1] === "" ? [Math.max(0, size - Number(range[2])), size - 1] : [Number(range[1]), Math.min(size - 1, range[2] === "" ? Infinity : Number(range[2]))];
    if (a > b) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": "bytes */" + size } });
    }
    return new Response(Bun.file(file).slice(a, b + 1), { status: 206, headers: { ...headers, "content-range": "bytes " + a + "-" + b + "/" + size } });
  }

  export async function prompts(req: Request): Promise<Response> {
    const read = () => Object.fromEntries(Object.entries(PROMPTS).map(([k, p]) => [k, { text: Tools.prompt(k as keyof typeof PROMPTS), def: p.def }]));
    if (req.method !== "POST") {
      return Response.json(read());
    }
    const msg: unknown = await req.json().catch(() => null);
    const which = (["prompt", "compact"] as const).find((k) => typeof get(msg, k) === "string");
    if (which === undefined) {
      return Response.json({ error: "Send { prompt } or { compact }, a text." }, { status: 400 });
    }
    const text = String(get(msg, which)).trim();
    if (Buffer.byteLength(text) > 64 * 1024) {
      return Response.json({ error: "A prompt holds at most 64 KB." }, { status: 413 });
    }
    const { file, def } = PROMPTS[which];
    write_whole(file, text === "" || text === def ? null : text + "\n");
    return Response.json(read());
  }

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
      if (!OWN.includes(p) && !p.startsWith("/image/") && !p.startsWith("/media/") && !p.startsWith("/api/")) {
        return Main.file(p, req);
      }
      if (!Owner.is(req)) {
        return new Response("sign in first", { status: 401 });
      }
      if (p === "/ws") {
        const q    = new URL(req.url).searchParams;
        const who  = Owner.hash(Owner.token(req));
        const data = { who, tab: q.get("tab") ?? "", wire: q.get("wire"), host: q.get("device"), work: q.get("work") ?? "~/.unii/work", scratch: q.get("scratch"), shell: q.get("shell") === "PowerShell" ? "PowerShell" : null, device: null, seen: new Set<string>(), active: 0 };
        return server.upgrade(req, { data }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      return await Main.page(Main.chat, p, req);
    } catch (err) {
      return Response.json({ error: err_why(err) }, { status: 500 });
    }
  }

  export function post_only(req: Request): Response | null {
    return req.method === "POST" ? null : new Response("an act is a POST", { status: 405 });
  }

  export function event(what: string, run: () => void, fail: () => void = () => {}): void {
    try {
      run();
    } catch (err) {
      console.error("unii: " + what + " failed: " + err_stack(err));
      fail();
    }
  }

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
          const text = String(data);
          if (text === ACTIVE || text === IDLE) {
            ws.data.active = text === ACTIVE ? Date.now() : 0;
          } else if (Main.chat.socks.has(ws)) {
            void Chat.answer(Main.chat, ws, text);
          }
        },
        close(ws: Sock, code) {
          Main.event("a socket", () => Chat.leave(Main.chat, ws, code === QUIT));
        },
      },
    });
    setInterval(() => {
      const kept = Owner.kept();
      Main.chat.socks.forEach((sock) => {
        if (kept.has(sock.data.who)) {
          sock.send(TICK);
          return;
        }
        Chat.leave(Main.chat, sock, true);
        sock.close(QUIT, "signed out");
      });
      Tools.prune(Main.chat.tools, kept);
      Main.follow();
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
    Service.ready("serve");
    for (const note of [config.MCP_ENV_NOTE, config.MCP_FILE_STARTUP_NOTE]) {
      if (note !== null) {
        console.error("unii: " + note);
      }
    }
  }

  export async function settings(req: Request): Promise<Response> {
    const fresh = { "cache-control": "no-store" };
    if (req.method === "GET") {
      Main.follow();
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

  export function follow(): void {
    if (config.config_follow()) {
      Chat.offer(Main.chat);
    }
  }

  export function unowned(err: unknown): void {
    console.error("unii: a failure no one owned: " + err_stack(err));
  }

}

export async function serve(port: number): Promise<void> {
  await Main.start(port);
}

if (import.meta.main) {
  await serve(Number(process.argv[2] ?? 8788));
}
