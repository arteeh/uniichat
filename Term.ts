// Term
// ====
// `unii [url]`: a terminal view of the agent (Server.ts). It feeds a View
// the server's messages and the person's acts, and prints what it says
// (Paint.ts, Screen.ts) into the terminal's own scrollback. Every act of
// the site is a command here (COMMANDS, /help). From a pipe, each line is
// a message. Its file is tui.json (Client.ts): the server it opens by
// default (the last one signed in to) and its sign-in to each, by host.

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Kind } from "./AskAI.ts";
import * as Client from "./Client.ts";
import * as Import from "./Import.ts";
import * as Paint from "./Paint.ts";
import { type Move, Pick } from "./Pick.ts";
import * as Screen from "./Screen.ts";
import * as View from "./View.ts";

// Types
// =====

// the terminal: its sign-in; ended: input's; pending: commands at
// work; last: UniiChat's message printed last (-1: none); wait: parts up
// to it not printed (term_settle); out: lines to print; wipe: first;
// due: a paint; settle: the page's print at a new size; imgs: for the
// next message; flow: how much of each message streaming is printed
// (Infinity: logged); logs: of each agent's page, the messages printed
type Term = {
  v       : View.View;
  scr     : Screen.Screen;
  url     : string;
  token   : string;
  ended   : boolean;
  pending : number;
  last    : number;
  wait    : View.Part[];
  out     : Paint.Line[];
  wipe    : boolean;
  due     : boolean;
  settle  : Timer | undefined;
  imgs    : Blob[];
  flow    : Map<View.Live, number>;
  logs    : Map<string, number>;
};

// a line of /help: how it is typed ("": keys only), its keys, what it
// does; it runs on its argument, or by a key on "" (or the key's name)
type Cmd = [use: string, keys: string, text: string, run: (t: Term, arg: string) => void | Promise<void>];

// Constants
// =========

// paths on Windows take \\, not /
const WIN = process.platform === "win32";

// the margin left of each line
const MARGIN = 2;

// a paint's frame: a stream's pieces come faster than a screen shows
// them (ms)
const FRAME = 16;

// a size held this long is settled: a drag's sizes come faster, and each
// would print the whole page again (ms)
const SETTLE = 100;

// where Claude Code and Codex keep their sessions
const CODEX   = process.env.CODEX_HOME ?? os.homedir() + "/.codex";
const IMPORTS = [
  (process.env.CLAUDE_CONFIG_DIR ?? os.homedir() + "/.claude") + "/projects",
  CODEX + "/sessions",
  CODEX + "/archived_sessions",
];

// what /import takes: its day; a site's export (its zip, or its
// conversations.json)
const SINCE  = /\bsince +(\d{4}-\d\d-\d\d)\b/;
const EXPORT = /\.(zip|json)$/i;
const HOW = "Pick with /import [claude] [chatgpt] [since 2026-06-01] [tools] [sessions] [-#n] [<export>.zip] [go] (-#n: not session n; go: import); /import pause or resume: the import running. Exports, on each website: " + Object.entries(Import.EXPORTS).map(([app, how]) => app + ": " + how).join("; ") + "; it emails you a zip.";

// the keys on an agent's page, which has no input: a tab back, quit,
// suspend and Esc (UniiChat's turn interrupted; agents go on); none that
// types, sends or moves the pick
const PAGE_KEYS = ["Tab", "Ctrl+D", "Ctrl+Z", "Esc"];

// the pick's moves by Shift and an arrow
const ARROWS: Record<string, Move> = { "Shift+Left": "prev", "Shift+Right": "next", "Shift+Up": "up", "Shift+Down": "down" };

// all a person can do here, by group (the editing keys are Screen's)
function term_groups(v: View.View): [group: string, cmds: Cmd[]][] {
  return [
    ["Chat", [
      ["",                  "Enter",                   "send; on an empty input, interrupt UniiChat",    term_enter],
      ["",                  "Esc",                     "interrupt UniiChat's turn; agents go on",        (t) => term_act(t, { $: "Send", text: "" })],
      ["",                  "Ctrl+C, Ctrl+D",          "clear; on an empty input, interrupt, quit",      term_clear],
      ["/goal <message>",   "",                        "send a message as the goal: at each turn's end, UniiChat asks itself if it is met, and goes on till it is", (t, a) => term_act(t, { $: "Send", text: "/goal " + a })],
      ["/halt",             "",                        "drop the goal; the turn running ends as it would", (t) => term_act(t, { $: "Send", text: "/halt" })],
      ["/image <path>",     "",                        "attach an image to the next message",            term_image],
      ["/open #id",         "",                        "open block #id, as it shows, and keep it open",  (t, a) => term_block(t, a, true)],
      ["/close #id",        "",                        "close block #id and keep it closed",             (t, a) => term_block(t, a, false)],
      ["/fold",             "Ctrl+F",                  "the chat in the fewest blocks; again: unfold (Ctrl+F eaten? type /fold)", term_fold],
      ["/import [...]",     "",                        "import your Claude and ChatGPT chats (alone: options)", term_import],
      ["/export",           "",                        "save the memory as ./unii-memory.json",          term_export],
      ["/tree",             "",                        "the whole memory, in the browser (its link prints too)", (t) => term_browse(t, "The memory tree", t.url + "/tree")],
      ["",                  "Ctrl+Z",                  "suspend; fg brings it back",                     (t) => Screen.screen_suspend(t.scr)],
      ["/quit",             "",                        "leave: the chat goes on without this terminal",  term_quit],
      ["/help",             "",                        "this list",                                      term_help],
    ]],
    ["Pick", [
      ["",                  "Shift+Left, Shift+Right", "the model before, the next",                     (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Up, Shift+Down",    "more effort, less",                              (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Tab",               "fast on, off (the next speed), typing or not",   (t) => term_move(t, "speed")],
      ["/model [name]",     "",                        "the models to pick from; with a name, that one", (t, a) => term_pick(t, "model", a)],
      ["/effort [level]",   "",                        "the efforts; with one, that one",                (t, a) => term_pick(t, "effort", a)],
      ["/speed [speed]",    "",                        "the speeds; with one, that one",                 (t, a) => term_pick(t, "speed", a)],
      ["/mcp [name]",       "",                        "the MCP servers, on or off in this chat; with a name, that one turned on or off", term_mcp],
    ]],
    ["Agents", [
      ["",                  "Tab",                     "the next tab",                                   term_cycle],
      ["/tab [name]",       "",                        "the tabs; with a name, that one",               term_tab],
      ["/stop [name]",      "",                        "stop all work, agents too; or that agent",       term_stop],
    ]],
    ["Sign-in", [
      ["/logout",           "",                        "sign this terminal out and quit",               term_logout],
    ]],
  ];
}

function term_commands(v: View.View): Cmd[] {
  return term_groups(v).flatMap(([, cmds]) => cmds);
}

// Term
// ====

function term_new(url: string, token: string): Term {
  const t: Term = {
    v       : View.view_new(),
    scr     : Screen.screen_new((key) => term_press(t, key)),
    url,
    token,
    ended   : false,
    pending : 0,
    last    : -1,
    wait    : [],
    out     : [],
    wipe    : false,
    due     : false,
    settle  : undefined,
    imgs    : [],
    flow    : new Map(),
    logs    : new Map(),
  };
  process.stdin.on("end", () => {
    if (t.scr.ed.text.trim() !== "") {
      term_enter(t);
    }
    t.ended = true;
    term_idle(t);
  });
  process.stdout.on("resize", () => term_resize(t));
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"]) {
    process.on(sig, () => term_bye(t));
  }
  return t;
}

// connects, by View's link
function term_connect(t: Term): void {
  View.link_open(t.v, {
    open : (query) => new WebSocket(t.url.replace(/^http/, "ws") + "/ws" + query, { headers: Client.auth(t.token) } as any),
    post : (path, body) => fetch(t.url + path, { method: "POST", headers: Client.auth(t.token), body }),
    hear : (msg) => term_hear(t, msg),
    lost : (up) => term_lost(t, up),
  });
}

// a socket lost (up: it had opened): the footer says offline; one that
// never opened, if the server refuses this terminal's session, quits
async function term_lost(t: Term, up: boolean): Promise<boolean> {
  term_draw(t);
  if (!up && !await Client.signed(t.url, t.token)) {
    term_note(t, "This terminal is signed out: run unii again to sign in.");
    process.exitCode = 1;
    term_quit(t);
    return false;
  }
  return true;
}

// an act to the server (a message shown while it waits offline); a
// message refused goes back in the input
function term_send(t: Term, msg: View.Client, sent?: View.Sent): void {
  const said = sent === undefined ? "" : sent.text.trim();
  View.link_send(t.v, msg, (a) => {
    if (a.error !== undefined) {
      term_note(t, a.error);
    }
    if (a.error !== undefined && sent !== undefined) {
      term_back(t, sent);
    }
    term_idle(t);
  }, said);
}

// a message of the server: to the view, then to the jobs and the page
function term_hear(t: Term, msg: View.Server): void {
  const first = msg.$ === "view" && t.v.parts.length === 0;
  const was   = t.v.page;
  for (const out of View.view_hear(t.v, msg)) {
    term_send(t, out);
  }
  term_went(t, was);
  term_print(t, msg);
  if (first) {
    term_history(t);
  }
  term_draw(t);
  if (msg.$ === "state") {
    term_idle(t);
  }
}

// an act of the person: to the view; the messages it sends the server
function term_act(t: Term, act: View.Act): View.Client[] {
  const was = t.v.page;
  const out = View.view_act(t.v, act);
  out.forEach((msg) => term_send(t, msg, act.$ === "Send" ? act : undefined));
  term_went(t, was);
  return out;
}

// a message the server refused, back in the input, unless another is in
// it; from a pipe, the end, failed
function term_back(t: Term, sent: View.Sent): void {
  if (!t.scr.tty) {
    process.exitCode = 1;
    term_quit(t);
    return;
  }
  if (t.scr.ed.text !== "" || t.imgs.length > 0) {
    return;
  }
  Screen.ed_type(t.scr.ed, sent.text);
  t.imgs = sent.images ?? [];
}

// the page shown was `was`: another prints below, after its name (a
// wipe and whole print took seconds on a long page); an agent's has no
// input (a pipe's lines still go on)
function term_went(t: Term, was: View.Page | null): void {
  t.scr.off = t.scr.tty && !View.view_typing(t.v);
  if (t.v.page !== was) {
    term_rows(t, t.v.page === null ? [View.Cap(View.MAIN)] : [], false);
    term_show(t);
  }
}

// the input's history: the user's messages known
function term_history(t: Term): void {
  const sent = [...t.v.whole].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => (e.kind === "user" ? [e.text] : []));
  t.scr.ed.hist = sent;
  t.scr.ed.at   = sent.length;
}

// input's end: quits once all it sent is answered and no work runs
function term_idle(t: Term): void {
  if (t.ended && t.pending <= 0 && t.v.out.length === 0 && !View.view_running(t.v)) {
    term_quit(t);
  }
}

// Keys
// ----

// a key ("": text typed): its line of COMMANDS (an agent's page: of
// PAGE_KEYS)
function term_press(t: Term, key: string): void {
  const cmd = term_commands(t.v).find((c) => c[1] !== "" && c[1].split(", ").includes(key));
  if (cmd !== undefined && (!t.scr.off || PAGE_KEYS.includes(key))) {
    cmd[3](t, cmd[0] === "" ? key : "");
  }
  term_draw(t);
}

// Enter: runs a command, or sends the input; text not sent stays (it
// was lost: an unknown /word)
function term_enter(t: Term): void {
  const text = Screen.ed_take(t.scr.ed);
  if (term_command(t, text)) {
    return;
  }
  if (!View.view_typing(t.v)) {
    term_note(t, "Messages go to UniiChat: Tab or /tab goes back.");
  } else if (term_act(t, { $: "Send", text, images: t.imgs }).length > 0) {
    t.imgs = [];
    return;
  }
  Screen.ed_type(t.scr.ed, text);
}

// Ctrl+C or Ctrl+D: clears the input; on an empty one, Ctrl+C interrupts
// UniiChat's turn (never quits), Ctrl+D quits, as it does on an agent's
// page (its input's text kept)
function term_clear(t: Term, key: string): void {
  if (t.scr.ed.text !== "" && !t.scr.off) {
    Screen.ed_take(t.scr.ed);
  } else if (key === "Ctrl+D") {
    term_quit(t);
  } else {
    term_act(t, { $: "Send", text: "" });
  }
}

// the next tab
function term_cycle(t: Term): void {
  const tabs = View.view_tabs(t.v);
  const at   = tabs.findIndex((tab) => tab.here) + 1;
  term_act(t, { $: "Goto", name: tabs[at % tabs.length].name });
}

// Commands
// --------

// a command typed (`/name arg`): runs it (pending while it works on);
// false if the text is none
function term_command(t: Term, text: string): boolean {
  const word = text.trim().split(/\s+/)[0];
  const cmd = term_commands(t.v).find(([use]) => use !== "" && use.split(" ")[0] === word);
  const run = cmd?.[3](t, text.trim().slice(word.length).trim());
  if (run instanceof Promise) {
    t.pending += 1;
    run.finally(() => {
      t.pending -= 1;
      term_idle(t);
    });
  }
  return cmd !== undefined;
}

// the commands and keys by group, in two columns, then the editing keys
function term_help(t: Term): void {
  const how   = (c: Cmd) => [c[0], c[1]].filter((x) => x !== "").join(", ");
  const left  = Math.max(...term_commands(t.v).map((c) => Paint.text_width(how(c)))) + 2;
  const right = Math.max(20, term_inner() - left);
  const row   = (c: Cmd) => Paint.runs_wrap([Paint.Run(c[2])], right, false).map((l, k) => [Paint.Run((k === 0 ? how(c) : "").padEnd(left)), ...l]);
  const bold  = { ...Paint.INK, b: true };
  const group = ([name, cmds]: [string, Cmd[]]) => [[Paint.Run(name, bold)], ...cmds.flatMap(row)];
  const edit  = Paint.runs_wrap([Paint.Run(Screen.EDITING)], term_inner(), false);
  t.out = t.out.concat(term_inset([[], ...term_groups(t.v).flatMap(group), [Paint.Run("Editing", bold)], ...edit]));
}

// attaches the image at a path (as typed or dropped: quoted, escaped, ~)
// to the next message, its bytes as read now (a Bun file inside a Blob
// adds nothing to it, Bun 1.3.14: the server got the text alone and
// refused the message); a file of another kind is refused here
async function term_image(t: Term, arg: string): Promise<void> {
  const file = arg.replace(/^(['"])(.*)\1$/, "$2").replace(/\\(.)/g, "$1").replace(/^~(?=\/|$)/, os.homedir());
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    term_note(t, "No file " + arg + ".");
    return;
  }
  const bytes = await Bun.file(file).bytes();
  if (View.image_kind(bytes) === null) {
    term_note(t, "Not attached: " + arg + " is no image. " + View.IMAGES);
    return;
  }
  t.imgs.push(new Blob([bytes]));
  term_note(t, "Attached " + arg + "; it goes with the next message (" + t.imgs.length + " waiting).");
}

// stops all that runs, or the agent named
function term_stop(t: Term, arg: string): void {
  const name = term_agent(t, arg);
  if (arg !== "" && !t.v.agents.includes(name)) {
    term_note(t, "No agent " + arg + " at work.");
    return;
  }
  term_send(t, arg === "" ? { $: "stop" } : { $: "stop", name });
}

// an agent at work whose name starts with arg, else arg
function term_agent(t: Term, arg: string): string {
  return t.v.agents.find((a) => a.toLowerCase().startsWith(arg.toLowerCase())) ?? arg;
}

// the person's choice for block #id or #id+n (its name, View.block_name),
// open or closed, whatever it shows now: it holds until Fold all
function term_block(t: Term, arg: string, open: boolean): void {
  const name = /^#?(\d+)(?:\+(\d+))?$/.exec(arg);
  const id   = Number(name?.[1]);
  const n    = Number(name?.[2] ?? 1);
  if (name === null || block_row(View.view_body(t.v), id, n) === undefined) {
    term_note(t, arg === "" ? "Which block? " + (open ? "/open" : "/close") + " #id, as each block shows it." : "No block " + arg + " here.");
    return;
  }
  term_act(t, { $: open ? "Open" : "Shut", id, n });
  if (!open || n === 1) {
    term_shown(t, id, n, open);
  }
}

// block #id+n as chosen, printed below what is printed, then a note: the
// scrollback is never written over, so the reader keeps their place, and
// an opened block shows where one reads (it may be far above); the page
// shows the choice in place at its next whole print
function term_shown(t: Term, id: number, n: number, open: boolean): void {
  const row = block_row(View.view_body(t.v), id, n);
  term_rows(t, open && row !== undefined ? [row] : [], false);
  term_note(t, (open ? "Opened " : "Closed ") + View.block_name(id, n) + ".");
}

// the row of block #id+n, among rows or inside their boxes
function block_row(rows: View.Row[], id: number, n: number): View.Row | undefined {
  for (const r of rows) {
    if ((r.$ === "Sum" || r.$ === "Box") && r.id === id && r.n === n) {
      return r;
    }
    const inner = r.$ === "Box" ? block_row(r.rows, id, n) : undefined;
    if (inner !== undefined) {
      return inner;
    }
  }
  return undefined;
}

// folds all (printed when the tops come), or unfolds
function term_fold(t: Term): void {
  if (t.v.page !== null) {
    return;
  }
  const on = t.v.fold === null;
  term_act(t, { $: "Fold", on });
  if (!on) {
    term_page(t);
  }
}

// shows an agent's chat, by the start of its name, or UniiChat's; no
// name lists the tabs
function term_tab(t: Term, arg: string): void {
  const main = arg.toLowerCase() === View.MAIN.toLowerCase();
  if (arg === "") {
    return term_note(t, "Tabs: " + View.view_tabs(t.v).map((tab) => tab.text).join("  "));
  }
  term_act(t, { $: "Goto", name: main ? null : term_agent(t, arg) });
}

// moves the pick one step (a key)
function term_move(t: Term, move: Move): void {
  term_act(t, { $: "Move", move });
}

// a part of the pick: to the value given, or, none, the values it may
// take, the pick's marked
function term_pick(t: Term, move: Move, arg: string): void {
  const knob = View.view_pick(t.v).find((k) => k.move === move);
  if (arg !== "" || knob === undefined || t.v.pick === null) {
    term_act(t, { $: "Move", move, to: arg });
    return;
  }
  // a model two vendors offer is listed under each (/model vendor:model
  // picks the other's), the profiles under their own head
  const pick  = t.v.pick;
  const opts  = Pick.options(pick, move, t.v);
  const head  = (p: Pick) => (p.profile !== undefined ? "profiles" : p.vendor);
  const now   = ([part, p]: [string, Pick]) => (part === knob.text && head(p) === head(pick) ? part + " (now)" : part);
  const heads = [...new Set(opts.map(([, p]) => head(p)))];
  const group = (v: string) => [...new Set(opts.filter(([, p]) => head(p) === v).map(now))].join(", ");
  const twins = move === "model" && heads.length > 1 && opts.some(([part, p]) => p.profile === undefined && Pick.twin(p.vendor, part, t.v.vendors));
  const list  = twins ? heads.map((v) => v + ": " + group(v)).join("; ") : [...new Set(opts.map(now))].join(", ");
  const how   = twins ? "/model <model>, or /model <vendor>:<model>" : "/" + move + " <" + move + ">";
  term_note(t, move[0].toUpperCase() + move.slice(1) + "s: " + list + ". Pick one with " + how + ".");
}

// the MCP servers the server's config sets, on or off in this chat; with
// a name, that one switched
function term_mcp(t: Term, arg: string): void {
  if (arg !== "") {
    term_act(t, { $: "Plug", name: arg });
    return;
  }
  const list = t.v.mcp.map((p) => p.name + (p.on ? " (on)" : " (off)"));
  term_note(t, list.length === 0 ? "No MCP servers: the server's config sets none." : "MCP servers: " + list.join(", ") + ". Turn one on or off with /mcp <name>.");
}

async function term_export(t: Term): Promise<void> {
  const res  = await term_get(t, "/export", "export");
  const file = process.cwd() + "/unii-memory.json";
  if (res !== null) {
    await Bun.write(file, res);
    term_note(t, "Your data is in " + file + ".");
  }
}

// this computer's Claude and ChatGPT chats, and the websites' exports
// given (EXPORT), not imported yet, as the words want (claude, chatgpt;
// Import.Want: since a day; tools; -#n: not session n): without go,
// what it finds (sessions: and the list); with go, sent;
// pause, resume: the import running
async function term_import(t: Term, arg: string): Promise<void> {
  if (/^(pause|resume)$/.test(arg)) {
    return term_send(t, { $: "go", on: arg === "resume" });
  }
  const given = arg.replace(SINCE, "").split(/\s+/).filter((w) => w !== "");
  const files = given.filter((w) => EXPORT.test(w)).map((w) => w.replace(/^~(?=\/)/, os.homedir()));
  const words = given.filter((w) => !EXPORT.test(w)).map((w) => w.toLowerCase());
  const apps  = Import.APPS.filter((app) => words.includes(app.toLowerCase()));
  const want  = { off: [] as string[], since: arg.match(SINCE)?.[1] ?? "", tools: words.includes("tools") };
  if (words.some((w) => !/^(tools|sessions|go|-#\d+)$/.test(w) && !Import.APPS.some((app) => app.toLowerCase() === w))) {
    term_note(t, "Not understood. " + HOW);
    return;
  }
  term_note(t, "Looking for Claude and ChatGPT chats on this computer…");
  const read = await Promise.all([...IMPORTS.map(term_sessions), ...files.map(export_sessions)]).catch((e) => String(e.message ?? e));
  if (typeof read === "string") {
    term_note(t, "Not imported: " + read);
    return;
  }
  const sessions = read.flat().filter((s) => apps.length === 0 || apps.includes(s.app));
  const done  = await term_get(t, "/api/imported", "read what Unii has");
  if (done === null) {
    return;
  }
  const old   = await done.json();
  const shown = Import.import_plan(sessions, want, old).sessions;
  want.off    = shown.filter((s, k) => words.includes("-#" + (k + 1))).map(Import.import_id);
  const plan  = Import.import_plan(sessions, want, old);
  const found = "Found " + Import.import_count(plan.msgs, "new ") + ". ";
  if (plan.msgs === 0) {
    term_note(t, plan.first === "" ? Import.OLD : found + HOW);
    return;
  }
  if (!words.includes("go")) {
    const which = words.includes("sessions") ? shown.map((s, k) => "\n- #" + (k + 1) + " " + s.app + ": " + Import.import_line(s) + (want.off.includes(Import.import_id(s)) ? " (left out)" : "")).join("") + "\n" : "";
    const go    = "To import them, type:\n\n```\n/import " + (arg + " go").trim() + "\n```";
    term_rows(t, View.entry_rows(null, "note", found + which + "\n" + go + "\n\n" + HOW), false);
    return;
  }
  term_note(t, found + "Sending them…");
  term_send(t, { $: "import", body: () => Import.import_body(plan.picked) });
}

// a dir's sessions (none if it is missing), a file at a time
async function term_sessions(dir: string): Promise<Import.Session[]> {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => dir + "/" + (WIN ? String(f).replaceAll("\\", "/") : f)).filter(Import.import_file) : [];
  const found: Import.Session[] = [];
  for (const f of files) {
    found.push(...[await Import.import_session(Bun.file(f), "log")].filter((s) => s !== null));
  }
  return found;
}

// a site's export file's sessions
async function export_sessions(path: string): Promise<Import.Session[]> {
  if (!fs.existsSync(path)) {
    throw new Error("no file " + path);
  }
  return Import.import_export(Bun.file(path));
}

async function term_logout(t: Term): Promise<void> {
  await View.post(t.url + "/api/logout", {}, Client.auth(t.token));
  const conf = Client.read("tui");
  delete conf.tokens?.[Client.host(t.url)];
  Client.write("tui", conf);
  term_note(t, "Signed out. Run unii to sign in again.");
  term_quit(t);
}

// a GET of the server; failing, a note says it could not do `what`
async function term_get(t: Term, path: string, what: string): Promise<Response | null> {
  const res = await fetch(t.url + path, { headers: Client.auth(t.token) }).catch(() => null);
  if (res === null || !res.ok) {
    term_note(t, "Could not " + what + ": " + (res === null ? "no connection" : "HTTP " + res.status) + ".");
    return null;
  }
  return res;
}

// quits, telling the server, once all printed is out
// (a write's callback comes after those before it), with exitCode
function term_quit(t: Term): void {
  t.v.ws?.close(View.QUIT);
  term_paint(t);
  process.stdout.write("", () => process.exit());
}

// quits at a signal (the terminal may be gone: nothing printed)
function term_bye(t: Term): void {
  t.v.ws?.close(View.QUIT);
  process.exit(0);
}

// a page for the browser: its link printed (a terminal reached over ssh
// has no browser of its own), then opened in the browser here, if any
function term_browse(t: Term, what: string, url: string): void {
  term_note(t, what + ": " + url);
  browse(url);
}

// a link opened in the browser here, if any: a Linux with no desktop has
// no xdg-open (spawning one missing throws)
function browse(url: string): void {
  const open = Bun.which(process.platform === "darwin" ? "open" : "xdg-open");
  if (open !== null) {
    child.spawn(open, [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// a note printed above the footer
function term_note(t: Term, text: string): void {
  t.v.notes.push(text);
  term_draw(t);
}

// Printing
// --------

// what a server message prints, as it comes
function term_print(t: Term, msg: View.Server): void {
  const v     = t.v;
  const main  = v.page === null;
  switch (msg.$) {
    case "view": {
      if (main && v.fold === null) {
        term_after(t);
      }
      return;
    }
    case "know": {
      if (main) {
        term_settle(t);
      }
      return;
    }
    case "entry": {
      if (msg.agent !== v.page?.name) {
        return;
      }
      // a page's log comes again at each reconnect
      const text = term_logged(t, msg.kind, msg.text);
      const page = msg.agent ?? "";
      const n    = v.page?.log?.length ?? 0;
      if (main ? msg.id !== undefined && msg.id <= t.last : n <= (t.logs.get(page) ?? 0)) {
        return;
      }
      t.logs.set(page, n);
      t.last = main && msg.id !== undefined ? msg.id : t.last;
      const due  = main && msg.id !== undefined && View.part_due(v, [msg.id, 1], v.parts[v.parts.length - 2]);
      const head = due ? [View.Cap(View.AI)] : [];
      term_rows(t, [...head, ...View.entry_rows(msg.id ?? null, msg.kind, text, msg.images)], false);
      return;
    }
    case "root": {
      if (main && v.fold !== null) {
        term_page(t);
      }
      return;
    }
    case "zoom": {
      if (main) {
        term_shown(t, msg.id, msg.n, true);
      }
      return;
    }
  }
}

// the page shown, whole, alone on the screen and its scrollback (a new
// size, /fold): no other is printed then
function term_page(t: Term): void {
  term_rows(t, [], true);
  [t.last, t.wait, t.logs] = [-1, [], new Map()];
  term_show(t);
}

// what of the page shown was never printed, then its stream again
function term_show(t: Term): void {
  const page = t.v.page;
  t.flow = new Map([...t.flow].filter(([, done]) => done === Infinity));
  if (page !== null) {
    const from = t.logs.get(page.name) ?? 0;
    t.logs.set(page.name, Math.max(from, page.log?.length ?? 0));
    return term_rows(t, View.page_rows(t.v, page, from), false);
  }
  if (t.v.fold === null) {
    return term_after(t);
  }
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, View.view_body(t.v), false);
}

// a new view of the chat: the parts holding a message past the one
// printed last print as they settle, after the AI notice if none is,
// since a terminal's scrollback is never written over; what changed
// above (new summaries) shows at the next whole print (a resize, /fold)
function term_after(t: Term): void {
  const head = t.last < 0 ? [View.Cap(View.AI)] : [];
  t.wait = t.wait.concat(t.v.parts.filter(([id, n]) => id + n - 1 > t.last));
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, head, false);
  term_settle(t);
}

// prints the parts not printed, in order, up to one whose summary isn't
// known yet: from it on they show in the footer till it is (an import's
// blocks, the oldest built last)
function term_settle(t: Term): void {
  const rows = View.view_rows(t.v, t.wait);
  const wait = rows.findIndex((r) => View.rows_wait(t.v, r));
  const done = wait < 0 ? rows.length : wait;
  t.wait = t.wait.slice(done);
  term_rows(t, rows.slice(0, done).flat(), false);
}

// prints what streams that no piece to come changes, a message at a
// time: whole once a message after it started, else its settled blocks;
// a message with a part left holds back those after it
function term_flow(t: Term): void {
  const live = View.view_stream(t.v);
  for (const [l, done] of t.flow) {
    if (done === Infinity && !live.includes(l)) {
      t.flow.delete(l);
    }
  }
  for (const [k, l] of live.entries()) {
    const done  = t.flow.get(l) ?? 0;
    const end   = done + View.entry_settled(l.kind, l.text.slice(done), k < live.length - 1);
    const piece = piece_trim(l.text.slice(done, end));
    if (piece !== "") {
      t.flow.set(l, end);
      term_rows(t, View.entry_rows(null, l.kind, piece), false);
    }
    if (piece_trim(l.text.slice(t.flow.get(l) ?? 0)) !== "") {
      return;
    }
  }
}

// the part of a message logged not printed yet: what follows the printed
// head of the first message streaming of its kind that it starts with;
// that one prints no more
function term_logged(t: Term, kind: Kind, text: string): string {
  const fresh = View.view_stream(t.v).filter((l) => !t.flow.has(l)).map((l): [View.Live, number] => [l, 0]);
  const heads = [...t.flow].filter(([, done]) => done < Infinity).concat(fresh);
  const at    = heads.findIndex(([l, done]) => l.kind === kind && text.startsWith(l.text.slice(0, done).trim()));
  if (at < 0) {
    return text;
  }
  for (const [l] of heads.slice(0, at + 1)) {
    t.flow.set(l, Infinity);
  }
  const [l, done] = heads[at];
  return piece_trim(text.slice(l.text.slice(0, done).trim().length));
}

// a piece of a message as printed: no blank lines around it
function piece_trim(text: string): string {
  return text.replace(/^\s*\n/, "").trimEnd();
}

// rows to print above the footer (with wipe: alone on the screen), after
// the notes before them, painted
function term_rows(t: Term, rows: View.Row[], wipe: boolean): void {
  t.out  = wipe ? [] : t.out;
  t.wipe = t.wipe || wipe;
  t.out  = t.out.concat(term_lines(t.v.notes.splice(0).map(View.Cap)), term_lines(rows));
  term_draw(t);
}

// rows as lines, after a blank line, in the margin
function term_lines(rows: View.Row[]): Paint.Line[] {
  return term_inset(rows.length === 0 ? [] : [[], ...Paint.rows_lines(rows, term_inner())]);
}

function term_inset(lines: Paint.Line[]): Paint.Line[] {
  const pad = Paint.Run(" ".repeat(MARGIN));
  return lines.map((l) => [pad, ...l]);
}

function term_inner(): number {
  return Screen.screen_width() - 2 * MARGIN;
}

// a new size: the page laid out again, at the new width, once the size
// settles
function term_resize(t: Term): void {
  clearTimeout(t.settle);
  t.settle = setTimeout(() => term_page(t), SETTLE);
}

// a paint, a frame from now, unless one is due
function term_draw(t: Term): void {
  if (!t.due) {
    t.due = true;
    setTimeout(() => term_paint(t), FRAME);
  }
}

// prints the lines due, the notes and what of the stream settled, then
// the footer: the rest of the stream (its last lines that fit), the rule,
// the input, a rule (offline while the socket is not open), the tabs.
// The screen's top row stays free: an erase from the top left clears
// the screen, which tmux keeps in its scrollback at each paint
function term_paint(t: Term): void {
  t.out = t.out.concat(term_lines(t.v.notes.splice(0).map(View.Cap)));
  term_flow(t);
  const w     = Screen.screen_width();
  const iw    = term_inner();
  const room  = (process.stdout.rows || 24) - 1;
  const off   = t.scr.off;
  const input = off ? null : Screen.screen_input(t.scr, iw, room - 3, View.HINT + " · /help");
  // with no input, the rule under it only to say offline
  const under = off && t.v.up ? [] : [Paint.rule_text(t.v.up ? "" : "offline", iw)];
  const own   = term_inset([Paint.rule_line(t.v, iw), ...(input?.lines ?? []), ...under, Paint.tabs_line(t.v, iw)]);
  const rest  = View.view_stream(t.v).map((l) => ({ kind: l.kind, text: l.text.slice(t.flow.get(l) ?? 0) }));
  const held  = t.v.page === null ? View.view_rows(t.v, t.wait).flat() : [];
  const tail  = term_lines([...held, ...View.view_tail(t.v, rest)]).flatMap((l) => Paint.runs_wrap(l, w, true));
  const above = tail.slice(Math.max(0, tail.length - room + own.length));
  const at    = input === null ? null : { row: above.length + 1 + input.at.row, col: input.at.col + MARGIN };
  Screen.screen_paint(t.scr, t.out, t.wipe, [...above, ...own], at);
  t.out  = [];
  t.wipe = false;
  t.due  = false;
}

// Main
// ====

// the chat in this terminal: signed in first, if not yet (the server
// it signs in to becomes the default)
export async function main(given: string | undefined): Promise<void> {
  const conf = Client.read("tui");
  const url = Client.server(given, conf);
  const tokens = conf.tokens ?? {};
  let token: string | undefined = tokens[Client.host(url)];
  if (!await Client.signed(url, token)) {
    token = await Client.login(url, "the terminal on " + os.hostname());
    Client.write("tui", { ...conf, url, tokens: { ...tokens, [Client.host(url)]: token } });
  }
  const t = term_new(url, token!);
  term_connect(t);
}
