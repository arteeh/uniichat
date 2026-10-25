// View
// ====
// What a view of the chat holds and draws, shared by the web (main.ts)
// and the terminal (Term.ts), with no DOM: `view_hear` takes the server's
// messages, `view_act` the person's acts, and both answer what to send
// (by the Link). The main chat shows what its agent sees (Server.ts): the
// view's parts as blocks ("nx"), from the turn on each message whole
// (0x) and its thoughts, then what streams or what the turn waits on. An
// agent's page is its log, kept live. The AI notice (AI) opens the chat
// and comes again before a message in another 3-hour window.

import type { Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";

// Types
// =====

// the n messages from id on (n a power of two)
export type Part = [number, number];

// a message logged: its kind, its text, its date (ISO), its images; a
// tool call's id on it and its result, the call's tool on the result
// (Memory.ts Pair)
export type Entry = { kind: Kind; text: string; date?: string; images?: string[]; of?: string; tool?: string };

// what a result is of: its call's tool as logged ("": not known), and
// whether it stands apart from its call (something came between them:
// Server.ts Chat.flush), so it names its tool ("↳ shell result")
export type Of = { tool: string; apart: boolean };

// a summary: its text, its last message's date
export type Node = { text: string; to: string };

export type Live = { kind: Kind; text: string };

// log: null while it loads; pick: what its agent runs on (null: not
// known yet, or its model no longer offered)
export type Page = { name: string; log: Entry[] | null; live: Live[]; pick: Pick | null };

// an import's time done and in all (weighed as Server.ts Chat.time), why
// paused, its messages, its nodes not built by level
export type Progress = { done: number; total: number; why: string | null; msgs: number; open: number[] };

// an import's minutes a unit of its time (the compactor, measured on a
// real import: 990 s for 162,900)
const PACE = 1e-4;

// a new chat's messages: the hello (Server.ts)
export const OPENING = 1;

// what a turn waits on while nothing streams: nothing (""), SUMMARIES,
// or the first piece of the model it names (a request out, no tool
// running; a running tool shows its call)
export const SUMMARIES = "summaries";
export type Wait = string;

// agents: those at work; runs: what each runs on (Tools.shown);
// vendors, models, profiles: those offered;
// limits: the calls waiting for a usage
// limit, by TURN or agent name; timers: the chat's schedules, each
// message's head; talk: conversation mode (null: standard); build: the
// web app's (main.ts renew); site: the server's address (config site:
// the terminal's links to its media) (Server.ts
// Chat.state)
export type State = {
  busy      : boolean;
  wait      : Wait;
  agents    : string[];
  runs      : Record<string, Pick>;
  pick      : Pick | null;
  vendors   : Vendor[];
  models    : string[];
  profiles? : Record<string, Fall[]>;
  importing : Progress | null;
  limits    : Record<string, Parked>;
  timers    : Timer[];
  mcp       : Plug[];
  talk      : Talk | null;
  build?    : string;
  site?     : string;
};

// conversation mode (Memory.ts): its first message whole, the share of
// its space its messages take (0 to 1), their bytes and the space's (the
// pick's model's: Memory.talk_room)
export type Talk = { from: number; used: number; size: number; room: number };

// an MCP server of a device (Mcp.ts), on or off in this chat
export type Plug = { name: string; on: boolean };

// fold: the tops shown (null: not folded); nodes and whole: the summaries
// ("id+n") and messages known; open: the blocks opened (true) or shut by
// hand; minds: the thoughts after each message; pages: the agents' asked
// for; page: the one shown (null: UniiChat's); the Link's: this view's
// id, acts not answered, socket (up: it showed the chat)
export type View = State & {
  parts : Part[];
  turn  : number;
  fold  : Part[] | null;
  nodes : Map<string, Node>;
  whole : Map<number, Entry>;
  open  : Map<string, boolean>;
  live  : Live[];
  minds : Map<number, string[]>;
  pages : Map<string, Page>;
  page  : Page | null;
  notes : string[];
  tab   : string;
  out   : Post[];
  ws    : WebSocket | null;
  up    : boolean;
  flush : () => void;
};

export type Pack = { nodes?: Record<string, Node>; whole?: Record<string, Entry> };

// the server's messages (Server.ts documents them)
export type Server =
  | ({ $: "know" } & Pack)
  | { $: "view"; parts: Part[]; turn: number }
  | { $: "zoom"; id: number; n: number; parts: Part[] }
  | { $: "root"; parts: Part[] }
  | ({ $: "entry"; agent?: string; id?: number } & Entry)
  | { $: "delta"; agent?: string; kind: Kind; text: string; fresh?: boolean }
  | { $: "live"; agent?: string; live: Live[] }
  | ({ $: "state" } & State)
  | { $: "agent"; name: string; found: boolean; pick?: Pick | null }
  | { $: "note"; text: string }
  | ({ $: "ack"; id: string } & Answer)
  | { $: "jobs"; ids: string[] }
  | { $: "job"; id: string; job: unknown };

// a message a person sends: its text, its images
export type Sent = { text: string; images?: Blob[] };

// an act's answer: why refused (status: HTTP's), a recording's words, an
// import's still running; a body, made anew for each post (what fetch
// takes)
export type Answer = { error?: string; status?: number; text?: string; going?: boolean };
export type Body   = () => any;

// the acts a view sends (out: a job's output): changes, then reads; a
// message's body is its images (sizes given), then its text
export type Client =
  | { $: "say"; sizes: number[]; body: Body }
  | { $: "import"; body: Body }
  | { $: "voice"; type: string; body: Body }
  | { $: "stop"; name?: string } // all work, or the agent named, or TURN
  | { $: "goal"; text: string | null } // the goal set (/goal), or none (/halt)
  | { $: "go"; on: boolean } // the import's: resume (true) or pause
  | { $: "pick"; to: Pick }
  | { $: "mcp"; name: string; on: boolean } // an MCP server turned on or off in this chat
  | { $: "talk"; on: boolean } // conversation mode on, or standard
  | { $: "out"; job: string; out: object }
  | { $: "unschedule"; id: string } // a schedule cancelled
  | { $: "zoom"; part: Part }
  | { $: "root" }
  | { $: "agent"; name: string };

// an act not answered: with its id, the socket it went by, what its
// answer does, what a message said (shown while offline: view_tail)
export type Post = { msg: Client & { id: string }; ws: WebSocket | null; done: (a: Answer) => void; said: string };

// how a view reaches the server: a socket by its query, a post, what it
// does with a message, and, one lost (up: it showed the chat), whether to
// open another
export type Link = {
  open : (query: string) => WebSocket;
  post : (path: string, body: any) => Promise<Response>;
  hear : (msg: Server) => void;
  lost : (up: boolean) => Promise<boolean>;
};

// what a person does
export type Act =
  | ({ $: "Send" } & Sent)                      // Enter: a message, or, empty, interrupt
  | { $: "Move"; move: Move; to?: string }      // the pick moves (to: to that value)
  | { $: "Open"; id: number; n: number }        // a click on a block
  | { $: "Shut"; id: number; n: number }        // a click on an open block's bar
  | { $: "Fold"; on: boolean }                  // fold all, unfold all
  | { $: "Goto"; name: string | null }          // a tab, a name, the logo (null: UniiChat)
  | { $: "Unschedule"; id: string }             // a schedule's Cancel
  | { $: "Plug"; name: string }                 // an MCP server turned on if off, else off
  | { $: "Talk"; on: boolean }                  // conversation mode, or standard

// what a page draws, top to bottom
export type Row =
  | { $: "Sum"; id: number; n: number; text: string; call: Call.Call | null }                     // a block: nx, its summary (call: a tool call's, word for word)
  | { $: "Box"; id: number; n: number; text: string; rows: Row[] }                              // a block open: its bar
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[] } // a message whole: 0x (who: its speaker, or a result apart from its call that no block names, "↳ shell result"; call: a tool call's, drawn as Call.ts reads it)
  | { $: "Cap"; text: string }                                                                  // a line about the page

export type Tab = { name: string | null; here: boolean; text: string };

// hint: the knob's value, named (a tooltip; the site's note when it
// changes); choices: its menu (the site's; none: shown only)
export type Knob = { text: string; move: Move; hint: string; choices: Choice[] };

// a value a knob can take: text, as shown (a model by its label alone,
// its vendor heading its group); to, as the move takes it; here, the
// pick's; vendor, the vendor of a model first of its vendor's
export type Choice = { text: string; to: string; move: Move; here: boolean; vendor: string | null };

// what /api/prompts gives: each prompt as used, and its built-in default
export type Prompts = Record<"prompt" | "compact", { text: string; def: string }>;

// Constants
// =========

export const MAIN = "UniiChat";

// UniiChat's turn, as a stop names it among the agents at work
export const TURN = "Unii's turn";

// the messages' version, in a view's query; one more for each change an
// older view would misread
export const WIRE = 3;

// the Link's: the most a live socket hears nothing (ms); the wait to open
// another; the server's tick; a client's close as it quits
export const PING  = 10000;
export const RETRY = 1000;
export const TICK  = "+";
export const QUIT  = 4000;

// a view's word that its page is in use (shown and focused; said again on
// input, at most each USE_PING), or no longer: no push goes out while one
// is (Server.ts Chat.phone)
export const ACTIVE   = "active";
export const IDLE     = "idle";
export const USE_PING = 20000;

// the most a socket message may be (bytes; Bun's own cap is 16 MiB),
// room for a tool's largest output, an image (Machine.ts). A bigger one
// closes its socket (Server.ts)
export const FRAME = 2 ** 22;

export const HINT = "Message UniiChat";

// the disclosure both views show (EU AI Act art. 50, California SB 243,
// New York GBL art. 47, Anthropic's usage policy)
export const AI = "Unii is an AI, not a person, and can make mistakes.";

// the AI notice's period (ms)
const NOTICE = 3 * 60 * 60 * 1000;

const WAIT = "compressing…";
const SUMS = "compressing earlier messages…";

// under the messages sent while offline, still kept to send
const UNSENT = "Sends once connected.";

// the kinds an image may be, each by its mark at a byte of its first HEAD
const MARKS: Array<[string, number, string]> = [
  ["image/png", 0, "\x89PNG"],
  ["image/jpeg", 0, "\xFF\xD8\xFF"],
  ["image/gif", 0, "GIF8"],
  ["image/webp", 8, "WEBP"],
];
export const HEAD   = 12;
export const IMAGES = "Images are png, jpeg, gif or webp.";

// the media store's kinds (Memory.media_add), by a file's extension (some
// named two ways, as the first): its content type. Maps, so a name an
// object has (constructor) is none
export const MEDIA: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"], ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"], ["webm", "video/webm"], ["mov", "video/quicktime"],
  ["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"], ["ogg", "audio/ogg"], ["opus", "audio/ogg"], ["wav", "audio/wav"], ["weba", "audio/webm"],
  ["html", "text/html"],
]);
export const MEDIA_AS: ReadonlyMap<string, string> = new Map([["jpg", "jpeg"], ["m4v", "mp4"], ["oga", "ogg"], ["htm", "html"]]);

// a media file in the store, by its url (/media/<name>, or an older
// image's /image/<name>): image, video, audio or html (a page); null: none
export function media_kind(url: string): string | null {
  const m = /^\/(?:media|image)\/[0-9a-f]{16}\.([a-z0-9]+)$/.exec(url);
  const type = m === null ? undefined : MEDIA.get(m[1]);
  return type === undefined ? null : type === "text/html" ? "html" : type.split("/")[0];
}

// what models get of an image: scaled to FIT px at most, or as is if no
// larger and of IMAGE bytes at most; PIXELS, the most decoded (Memory.ts
// sends a larger one as is)
export const FIT    = 1568;
export const IMAGE  = 2 ** 20;
export const PIXELS = 2 ** 28;

// how a line of one tool call starts
const TOOL = "tool: ";
const FOLD = "The whole chat, folded into the fewest blocks.";

// Constructors
// ============

export function Cap(text: string): Row {
  return { $: "Cap", text };
}

// the bytes a token takes, low (code, JSON and paths run about 3; prose
// about 4), so conversation mode never thinks the model has more room
// than it does (Memory.talk_room)
export const TOKEN = 3;

// conversation mode's fill in tokens (TOKEN bytes each), as its meter's
// tooltip says it: "about 120K of 707K tokens"
export function talk_tokens(talk: Talk): string {
  const k = (bytes: number) => Math.round(bytes / TOKEN / 1000) + "K";
  return "about " + k(talk.size) + " of " + k(talk.room) + " tokens";
}

// View
// ====

export function view_new(): View {
  return {
    busy      : false,
    wait      : "",
    agents    : [],
    runs      : {},
    pick      : null,
    vendors   : [],
    models    : LABELS,
    importing : null,
    limits    : {},
    timers    : [],
    mcp       : [],
    talk      : null,
    parts     : [],
    turn      : Infinity,
    fold      : null,
    nodes     : new Map(),
    whole     : new Map(),
    open      : new Map(),
    live      : [],
    minds     : new Map(),
    pages     : new Map(),
    page      : null,
    notes     : [],
    tab       : uuid(),
    out       : [],
    ws        : null,
    up        : false,
    flush     : () => {},
  };
}

export function view_hear(v: View, msg: Server): Client[] {
  switch (msg.$) {
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn  = msg.turn;
      return v.fold === null ? [] : [{ $: "root" }];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "root": {
      v.fold = v.fold === null ? null : msg.parts;
      return [];
    }
    case "entry": {
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state);
      for (const page of v.pages.values()) {
        page.pick = v.runs[page.name] ?? page.pick;
      }
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      if (msg.found) {
        page.log = [];
        page.pick = msg.pick ?? page.pick;
        return [];
      }
      v.pages.delete(msg.name);
      if (v.page === page) {
        v.page = null;
      }
      v.notes.push("No agent " + msg.name + ".");
      return [];
    }
    case "note": {
      v.notes.push(msg.text);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      return [];
    }
    default: {
      // a kind newer than this view: a unii runs the release it was
      // installed with (Term.ts), behind the server's
      return [];
    }
  }
}

export function view_act(v: View, act: Act): Client[] {
  switch (act.$) {
    case "Send": {
      const text   = act.text.trim();
      const images = act.images ?? [];
      // a `/word` reaching here is no command (the terminal ran its
      // own), but /goal (a message, sent as typed, set as the goal) and
      // /halt: it errs, never goes to the AI as a message
      const word   = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const goal   = word === "/goal" ? text.slice(word.length).trim() : null;
      if (!view_typing(v)) {
        return [];
      }
      if (text === "" && images.length === 0) {
        return v.busy ? [{ $: "stop", name: TURN }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null) {
        v.notes.push(word + " is no command; nothing was sent. The terminal's /help lists its commands; the site's are in its ☰ menu.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say: Client = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      v.fold = null;
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
      // from the last pick asked for and not acked, else the chat's
      const from = v.out.flatMap((p) => (p.msg.$ === "pick" ? [p.msg.to] : [])).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + [act.move, act.to].join(" ").trim() + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Fold": {
      v.open.clear();
      v.fold = act.on ? [] : null;
      return act.on ? [{ $: "root" }] : [];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [], pick: v.runs[act.name] ?? null };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Talk": {
      return [{ $: "talk", on: act.on }];
    }
    case "Plug": {
      // from the last asked for and not acked, else the chat's
      const asked = v.out.flatMap((p) => (p.msg.$ === "mcp" && p.msg.name === act.name ? [p.msg.on] : [])).at(-1);
      const on = asked ?? v.mcp.find((p) => p.name === act.name)?.on;
      if (on === undefined) {
        const names = v.mcp.map((p) => p.name).join(", ");
        v.notes.push("No MCP server " + act.name + (names === "" ? "; none is set up." : "; one of: " + names + "."));
        return [];
      }
      return [{ $: "mcp", name: act.name, on: !on }];
    }
  }
}

export function view_body(v: View): Row[] {
  if (v.page !== null) {
    return page_rows(v, v.page);
  }
  if (v.fold !== null) {
    const tops = v.fold.flatMap(([id, n]) => part_rows(v, id, n, Infinity, false));
    return [Cap(FOLD), ...tops];
  }
  return [Cap(AI), ...view_rows(v, v.parts).flat()];
}

// the chat's parts given, in order, as rows each (part_due)
export function view_rows(v: View, parts: Part[]): Row[][] {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}

// whether rows show a block whose summary isn't known yet (WAIT)
export function rows_wait(v: View, rows: Row[]): boolean {
  return rows.some((row) => (row.$ === "Sum" && !v.nodes.has(row.id + "+" + row.n)) || (row.$ === "Box" && rows_wait(v, row.rows)));
}

// live: what of the stream to draw (the terminal's: what it has not
// printed yet)
export function view_tail(v: View, live = view_stream(v)): Row[] {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const limit = v.limits[v.page === null ? TURN : v.page.name];
  if (limit !== undefined) {
    return [...rows, Cap(limit_show(limit)), ...kept, ...load];
  }
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...kept, ...load];
  }
  return [Cap(v.wait === SUMMARIES ? SUMS : "waiting for " + v.wait + "…"), ...kept, ...load];
}

// a call waiting for a usage limit: when it asks again, in the viewer's
// time (its weekday too if not today), and whether it then surely resumes
export function limit_show(limit: Parked, now = Date.now()): string {
  const at  = new Date(limit.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const };
  return "waiting for the usage limit, " + (limit.known ? "resumes" : "tries again") + " at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" });
}

// what streams on the page shown
export function view_stream(v: View): Live[] {
  return v.page === null ? v.live : v.page.live;
}

// an import's progress
export function progress_show(p: Progress): string {
  const n = (k: number) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}

// the chat, each agent at work, and the page shown while its agent is
// done (so it can be left: the tabs were the way back, and hid)
export function view_tabs(v: View): Tab[] {
  const at    = v.page === null ? null : v.page.name;
  const names = at === null || v.agents.includes(at) ? v.agents : [...v.agents, at];
  return [null, ...names].map((name) => {
    const here = name === at;
    const text = (here ? GLYPH.here : GLYPH.tab) + " " + (name ?? MAIN);
    return { name, here, text };
  });
}

export function view_fold(v: View): string | null {
  if (v.page !== null) {
    return null;
  }
  return v.fold === null ? "fold all" : "unfold all";
}

export function view_typing(v: View): boolean {
  return v.page === null;
}

export function view_running(v: View): boolean {
  return v.busy || v.agents.length > 0;
}

export function view_pick(v: View): Knob[] {
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}

// the pick over the box: the chat's, or on an agent's page what that
// agent runs on, shown only (none while not known)
export function view_shown(v: View): Knob[] {
  if (v.page === null) {
    return view_pick(v);
  }
  return v.page.pick === null ? [] : view_knobs(v, v.page.pick, false);
}

// a pick's knobs; menus: with their choices
function view_knobs(v: View, pick: Pick, menus: boolean): Knob[] {
  const { model, effort, speed, profile } = pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  // a model two vendors offer: its vendor in the hint, not in its name
  const whose = Pick.twin(pick.vendor, model, v.vendors) ? ", " + pick.vendor : "";
  const choices = (move: Move) => (menus ? view_choices(pick, move, v) : []);
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: choices("model") },
    { text: effort, move: "effort", hint: effort + " effort", choices: choices("effort") },
    { text: speed, move: "speed", hint: speed, choices: choices("speed") },
  ];
}

// every value of a knob, in the order a move steps through them; the
// model's: the profiles first (headed "profiles", each by its name),
// then the models, each vendor's headed by it
function view_choices(pick: Pick, move: Move, v: View): Choice[] {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p: Pick) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    // a model by "vendor:model" (two vendors may offer one)
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}

export function view_count(v: View): number {
  return v.parts.reduce((end, [id, n]) => Math.max(end, id + n), 0);
}

function view_learn(v: View, pack: Pack): void {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}

// a message: on its agent's page, in Unii's chat, or, a thought (not
// logged), after the last message
function view_entry(v: View, msg: Server & { $: "entry" }): void {
  const { $, agent, id, ...entry } = msg;
  const last = v.parts[v.parts.length - 1];
  if (agent !== undefined) {
    const log = v.pages.get(agent)?.log;
    if (Array.isArray(log)) {
      log.push(entry);
    }
  } else if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...(v.minds.get(at) ?? []), msg.text]);
  }
}

// null: a page not asked for
function view_live(v: View, agent: string | undefined): Live[] | null {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}

// Link
// ====
// What TCP, WebSocket and HTTP do is theirs; the Link adds only what
// they can't. A socket that dies loses what was in flight: each act has
// an id and is kept until answered (its ack, or its post's answer); those
// not answered go again once the next socket shows the chat (none on a
// live one); the server does each once (Server.ts Chat.apply). An act
// with a body is a post of its own; one unanswered means the link is
// lost. A page sees no pings: the server ticks each PING / 2, and a view
// drops a socket silent for a PING.

export function link_open(v: View, link: Link): void {
  const ws   = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard  = Date.now();
  const tick = setInterval(() => Date.now() - heard > PING && drop(), PING / 2);
  async function drop(): Promise<void> {
    const up = v.up;
    ws.onmessage = null;
    ws.onclose   = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
    if (await link.lost(up)) {
      setTimeout(() => link_open(v, link), RETRY);
    }
  }
  // sends, in order, the acts not sent on this socket
  function flush(): void {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        upload(post);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post: Post): Promise<void> {
    const { body, ...rest } = post.msg as any;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data));
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.pages.clear();
    }
    link.hear(msg);
    if (join) {
      view_act(v, { $: "Goto", name: v.page?.name ?? null }).forEach((out) => link_send(v, out));
      flush();
    }
  };
  ws.onclose = () => drop();
}

// an act, kept until answered; by default a refusal is a note; said: a
// message's text
export function link_send(v: View, msg: Client, done = (a: Answer) => link_note(v, a), said = ""): void {
  v.out.push({ msg: { id: uuid(), ...msg }, ws: null, done, said });
  v.flush();
}

// a random id, as crypto.randomUUID makes one: that is only in a secure
// context, and a page on a LAN's plain http is none
export function uuid(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b, k) => (k === 6 ? (b & 15) | 64 : k === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function link_note(v: View, a: Answer): void {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}

// a JSON post's answer, ok if its status was
export async function post(url: string, body: object, auth: Record<string, string> = {}): Promise<any> {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => (res.ok ? {} : { error: "HTTP " + res.status }));
  return { ...out, ok: res?.ok === true, status: res?.status ?? 0 };
}

// Part
// ====

// a block's name, as /open and /close take it: its first message's id,
// then its size past 1x
export function block_name(id: number, n: number): string {
  return "#" + id + (n === 1 ? "" : "+" + n);
}

// whether the AI notice comes before part, after the part `before`: a
// message from the turn on, in another window than that part's
export function part_due(v: View, part: Part, before: Part | undefined): boolean {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}

// the window (NOTICE) of a part's last date (NaN: not known)
function part_window(v: View, [id, n]: Part): number {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}

// t: the turn; talk: whether talk opens by itself (not in Fold all). Open:
// the person's choice (Open, Shut) if made, else a message of the user or
// Unii (tool calls, reports and the rest stay folded)
function part_rows(v: View, id: number, n: number, t: number, talk: boolean): Row[] {
  const key   = id + "+" + n;
  const entry = v.whole.get(id);
  const half  = n / 2;
  if (n === 1 && id >= t && entry !== undefined) {
    const minds = v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...whole_rows(id, entry, v.whole.get(id - 1)), ...after];
  }
  const open  = talk && n === 1 && ["user", "unii"].includes(entry?.kind ?? "");
  if (!(v.open.get(key) ?? open)) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const text = n === 1 ? "fold" : GLYPH.open + " " + n + "x · fold";
  if (n > 1) {
    const rows = [...part_rows(v, id, half, t, talk), ...part_rows(v, id + half, half, t, talk)];
    return [{ $: "Box", id, n, text, rows }];
  }
  const rows = entry === undefined ? [] : whole_rows(id, entry, v.whole.get(id - 1));
  return [{ $: "Box", id, n, text, rows }];
}

// a message's rows, or a summary's block, made once: neither changes once
// known, so a redraw remakes only the rows that changed. A result's
// depend on the message before it too (entry_of), not known yet or known
// later (a block opened): made once each way
const ROWS  = new WeakMap<Entry | Node, Row[]>();
const APART = new WeakMap<Entry, Row[]>();

function whole_rows(id: number | null, entry: Entry, before: Entry | undefined): Row[] {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images, of);
  made.set(entry, rows);
  return rows;
}

// a block whose summary isn't known yet says WAIT
function sum_rows(id: number, n: number, node: Node = { text: WAIT, to: "" }): Row[] {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: Md.md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}

// Page
// ====

// an agent's page, its log (once it comes) from message `from` on
export function page_rows(v: View, page: Page, from = 0): Row[] {
  const head = Cap(page.name + (v.agents.includes(page.name) ? " · at work" : " · done"));
  const log = page.log ?? [];
  return [head, ...log.slice(from).flatMap((e, k) => whole_rows(null, e, log[from + k - 1]))];
}

// Live
// ====

// a piece joins the message streaming, if of its kind, unless it starts
// one (fresh: a tool call, as two calls never join)
export function live_push(live: Live[], kind: Kind, text: string, fresh = false): void {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}

// the whole stream, told anew (a view joining, a call's entry): one that
// goes on with the stream held extends it in place, each message staying
// the one it was (the terminal prints a message once: Term.ts flow), as
// after a reconnect; another replaces it
function live_set(live: Live[], now: Live[]): void {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => (k < held.length ? Object.assign(held[k], l) : l));
  live.splice(0, live.length, ...next);
}

// the call a line of one message holds, when the line is a tool call
// word for word (the compactor keeps a short message as it is)
function sum_call(n: number, text: string): Call.Call | null {
  const call = n === 1 && text.startsWith(TOOL) ? Call.call_parse(text.slice(TOOL.length)) : null;
  return call === null || call.name === "" ? null : call;
}

// Image
// =====

// an image's kind by its first HEAD bytes (each kind's mark, at its
// byte); null: none of them. Said as IMAGES where one is refused.
export function image_kind(head: Uint8Array): string | null {
  const text = String.fromCharCode(...head.subarray(0, HEAD));
  return MARKS.find(([, at, mark]) => text.slice(at, at + mark.length) === mark)?.[0] ?? null;
}

// Entry
// =====

// what a result is of, by its entry and the message before it (none: not
// known, as when a block holds it): apart unless that is its call (or a
// page of the result before it). A result logged before calls had ids
// (none) is never apart
export function entry_of(entry: Entry, before: Entry | undefined): Of {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}

// a result apart from its call is named by its tool on its first block
// (Md.md_output), or above it if none (a diff alone)
export function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = [], of: Of = { tool: "", apart: false }): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : Call.tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report?.name ?? WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  // (an image pasted in the text shows there: Server.ts Chat.pictured)
  const pics = images.filter((name) => !text.includes("/media/" + name));
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics }];
}

// the length of a streaming message's head printed now: all of it once
// ended, as one block (a frame or fill is drawn whole), else none; none
// of one logged whole (a call, a result, the user's, a report)
export function entry_settled(kind: Kind, text: string, ended: boolean): number {
  return ["user", "work", "echo", "tool"].includes(kind) || !ended ? 0 : text.length;
}

// a result named by `label`; a show call's draws its media (Md.md_shown)
function entry_body(kind: Kind, text: string, label: string, tool: string): Md.Block[] {
  switch (kind) {
    case "user":
    case "work": {
      return Md.md_plain(text);
    }
    case "echo": {
      return Call.tool_name(tool) === "show" ? Md.md_shown(text, label) : Md.md_output(text, label);
    }
    default: {
      return Md.md_parse(text);
    }
  }
}
