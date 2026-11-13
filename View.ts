import type { Again, Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";
import type { Bg, Job } from "./Machine.ts";
import type { Row as SubRow } from "./Sub.ts";
import { rec } from "./Json.ts";

export type Part = [number, number];

type Entry = { kind: Kind; text: string; date?: string; images?: string[]; of?: string; tool?: string; from?: string };

export type Queued = { kind: Kind; text: string };

// hop and from: another agent's message, the hop it is on and whose it is
export type Pending = Queued & { images: string[]; act?: string; hop?: number; from?: string };

type Of = { tool: string; apart: boolean };

type Node = { text: string; to: string };

// of: a tool call's id, while it waits for its result
export type Live = { kind: Kind; text: string; of?: string };

// an agent as the chat list shows it: last, its last message's gist
export type Mate = { id: string; name: string; about: string; picture: string; unread: number; last: string; busy: boolean; archived: number; subs?: SubRow[] };

// a subagent's page: its log as loaded (from: how many of its first
// entries aren't yet), what it says now, whether it is done (#116)
type Logged = Entry & { id?: number };

type Page = { name: string; log: Logged[] | null; live: Live[]; from: number; loading: boolean; done: boolean };

export type Progress = { done: number; total: number; why: string | null; msgs: number; open: number[] };

const PACE = 1e-4;

export const OPENING = 1;

export const SUMMARIES = "summaries";
export type Wait = string;

export type Sums = { done: number; total: number };

type Turning = {
  busy      : boolean;
  wait      : Wait;
  sums      : Sums | null;
  again     : Again | null;
  importing : Progress | null;
};

type ByRun = {
  limit     : Parked | null;
  queue     : Queued[];
  sent      : number[];
};

type Offered = {
  pick      : Pick | null;
  vendors   : Vendor[];
  models    : string[];
  profiles? : Record<string, Fall[]>;
};

type ChatSet = {
  timers    : Timer[];
  mcp       : Plug[];
  talk      : Talk | null;
};

type ServerSays = {
  agent?    : string;
  thinking? : boolean;
  build?    : string;
  site?     : string;
};

type State = Turning & ByRun & Offered & ChatSet & ServerSays;

export type Talk = { from: number; used: number; tokens: number; window: number; model: string; guess: boolean };

export type Plug = { name: string; on: boolean };

// agent: the agent whose chat is wanted; on: whose chat the server sends;
// held: whose chat the view holds, kept over a reconnect (#114)
export type View = State & {
  agent : string;
  on    : string;
  held  : string;
  pages : Map<string, Page>;
  page  : Page | null;
  team  : Mate[];
  parts : Part[];
  turn  : number;
  nodes : Map<string, Node>;
  whole : Map<number, Entry>;
  open  : Map<string, boolean>;
  live  : Live[];
  minds : Map<number, string[]>;
  notes : string[];
  refused : { text: string; old: boolean } | null;
  tab   : string;
  out   : Post[];
  ws    : WebSocket | null;
  up    : boolean;
  down  : number;
  tries : number;
  retry : ReturnType<typeof setTimeout> | null;
  flush : () => void;
  wake  : () => void;
};

type Pack = { nodes?: Record<string, Node>; whole?: Record<string, Entry> };

export type Server =
  | ({ $: "know" } & Pack)
  | { $: "view"; parts: Part[]; turn: number }
  | { $: "zoom"; id: number; n: number; parts: Part[] }
  | ({ $: "entry"; agent?: string; id?: number; sent?: boolean } & Entry)
  | { $: "delta"; agent?: string; kind: Kind; text: string; fresh?: boolean }
  | { $: "live"; agent?: string; live: Live[] }
  | { $: "agent"; name: string; found: boolean; from: number; before?: number; entries: Logged[]; done: boolean; end?: boolean }
  | ({ $: "state" } & State)
  | { $: "note"; text: string }
  | { $: "team"; agents: Mate[] }
  | { $: "error"; text: string; build?: string; wire?: number }
  | ({ $: "ack"; id: string } & Answer)
  | { $: "jobs"; ids: string[] }
  | { $: "job"; id: string; job: Job };

export type Sent = { text: string; images?: Blob[] };

export type Answer = { error?: string; status?: number; text?: string; going?: boolean };
type Upload = BodyInit | AsyncIterable<string>;
type Body   = () => Upload | Promise<Upload>;

export type Client =
  | { $: "say"; sizes: number[]; body: Body; agent?: string }
  | { $: "import"; body: Body }
  | { $: "voice"; type: string; body: Body }
  | { $: "stop" }
  | { $: "goal"; text: string | null }
  | { $: "go"; on: boolean }
  | { $: "pick"; to: Pick }
  | { $: "mcp"; name: string; on: boolean }
  | { $: "talk"; on: boolean }
  | { $: "out"; job: string; out: object }
  | { $: "done"; agent: string; text: string }
  | { $: "running"; jobs: Bg[] }
  | { $: "unschedule"; id: string }
  | { $: "zoom"; part: Part }
  | { $: "agent"; name: string; before?: number }
  | { $: "open"; agent: string };

type Post = { msg: Client & { id: string }; ws: WebSocket | null; done: (a: Answer) => void; said: string };

export type Link = {
  open : (query: string) => WebSocket;
  post : (path: string, body: Upload) => Promise<Response>;
  hear : (msg: Server) => void;
  lost : (up: boolean) => Promise<boolean>;
};

export type Act =
  | ({ $: "Send" } & Sent)
  | { $: "Move"; move: Move; to?: string }
  | { $: "Open"; id: number; n: number }
  | { $: "Shut"; id: number; n: number }
  | { $: "Unschedule"; id: string }
  | { $: "Plug"; name: string }
  | { $: "Talk"; on: boolean }
  | { $: "Goto"; name: string | null }

export type Row =
  | { $: "Sum"; id: number; n: number; text: string }
  | { $: "Box"; id: number; n: number; text: string; rows: Row[] }
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[]; queued?: boolean; from?: string; of?: string; writing?: true }
  | { $: "Line"; id: number | null; call: Call.Call; echo: string | null; rows: Row[]; phase?: Phase }
  | { $: "Cap"; text: string; think?: true; earlier?: true; wait?: true }

// a tool call while it's written, then while it runs (#129)
type Phase = "typing" | "running";

export type Knob = { text: string; move: Move; hint: string; choices: Choice[] };

export type Choice = { text: string; to: string; move: Move; here: boolean; vendor: string | null };

export const TURN = "Unii's turn";

export const WIRE = 5;

export const PING  = 10000;
export const RETRY = 1000;
export const SLOW  = 30000;
export const TICK  = "+";
export const QUIT  = 4000;

export const ACTIVE   = "active";
export const IDLE     = "idle";
export const USE_PING = 20000;

export const FRAME = 2 ** 22;

export const HINT = "Message UniiChat";

const WAIT = "compressing…";
const SUMS = "compressing earlier messages…";

const UNSENT = "Sends once connected.";
const OLDER  = "This unii is older than the server: run `unii update`.";
const NEWER  = "The server runs an older unii than this one: run `unii update` there. Trying again every " + SLOW / 1000 + " s.";

const MARKS: Array<[string, number, string]> = [
  ["image/png", 0, "\x89PNG"],
  ["image/jpeg", 0, "\xFF\xD8\xFF"],
  ["image/gif", 0, "GIF8"],
  ["image/webp", 8, "WEBP"],
];
export const HEAD   = 12;
export const IMAGES = "Images are png, jpeg, gif or webp.";

export const MEDIA = Md.MEDIA;
const MEDIA_AS = Md.MEDIA_AS;

export const STORED = /^[0-9a-f]{16}\.([a-z0-9]{1,10})$/;

export function media_kind(url: string): string | null {
  const m = /^\/(?:media|image)\/[0-9a-f]{16}\.([a-z0-9]{1,10})$/.exec(url);
  return m === null ? null : ext_kind(m[1]);
}

export function ext_kind(ext: string): string | null {
  const type = MEDIA.get(ext);
  return type === undefined ? null : type === "text/html" ? "html" : type.split("/")[0];
}

export function store_file(url: string): boolean {
  return url.startsWith("/media/") && STORED.test(url.slice("/media/".length)) && media_kind(url) === null;
}

export function media_ext(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot < 0 ? "" : file.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return MEDIA_AS.get(ext) ?? ext;
}

export function size_show(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  const k = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const n = bytes / 1024 ** k;
  return (k === 0 ? String(bytes) : n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + units[k];
}

export const FIT    = 1568;
export const IMAGE  = 2 ** 20;
export const PIXELS = 2 ** 28;


function Cap(text: string): Row {
  return { $: "Cap", text };
}

export const TOKEN = 3;

export function talk_percent(talk: Talk): number {
  return Math.ceil(talk.used * 100);
}

export function talk_tokens(talk: Talk): string {
  const k = (n: number) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n));
  return "about " + k(talk.tokens) + " of " + talk.model + "'s " + k(talk.window) + " tokens" + (talk.guess ? ", guessed: no request yet" : ", in its last request and the messages since");
}

export function view_new(agent: string): View {
  return {
    agent     : agent,
    on        : "",
    team      : [],
    busy      : false,
    wait      : "",
    pick      : null,
    vendors   : [],
    models    : LABELS,
    importing : null,
    limit     : null,
    queue     : [],
    sent      : [],
    sums      : null,
    again     : null,
    timers    : [],
    mcp       : [],
    talk      : null,
    held      : "",
    pages     : new Map(),
    page      : null,
    parts     : [],
    turn      : Infinity,
    nodes     : new Map(),
    whole     : new Map(),
    open      : new Map(),
    live      : [],
    minds     : new Map(),
    notes     : [],
    refused   : null,
    tab       : uuid(),
    out       : [],
    ws        : null,
    up        : false,
    down      : Date.now(),
    tries     : 0,
    retry     : null,
    flush     : () => {},
    wake      : () => {},
  };
}

// another chat's state starts the wanted one's chat afresh, and what the
// server sent of the chat before it is dropped
export function view_switch(v: View, agent: string): Client[] {
  if (v.agent === agent) {
    return [];
  }
  v.agent = agent;
  v.pages.clear();
  v.page = null;
  return v.up ? [{ $: "open", agent }] : [];
}

function view_chat(v: View): void {
  const fresh = view_new(v.agent);
  for (const k of ["busy", "wait", "importing", "limit", "queue", "sent", "sums", "again", "timers", "talk", "parts", "turn", "nodes", "whole", "open", "live", "minds"] as const) {
    Object.assign(v, { [k]: fresh[k] });
  }
}

const OWN = ["team", "ack", "error", "note", "jobs", "job"];

export function view_hear(v: View, msg: Server): Client[] {
  // a new link: the subagents' pages seen before may have missed what
  // came while it was down, so they're asked for again; the open one now
  const fresh = msg.$ === "state" && msg.agent !== undefined && msg.agent !== v.on && msg.agent === v.agent;
  if (fresh) {
    v.pages.clear();
  }
  const again: Client[] = fresh && v.page !== null ? [{ $: "agent", name: v.page.name }] : [];
  if (fresh && v.page !== null) {
    v.page = { ...v.page, log: null, live: [], from: 0, loading: false, done: false };
    v.pages.set(v.page.name, v.page);
  }
  return [...again, ...view_heard(v, msg)];
}

function view_heard(v: View, msg: Server): Client[] {
  if (msg.$ === "state" && msg.agent !== undefined && v.on === "" && msg.agent !== v.agent) {
    v.agent = msg.agent;
  }
  if (msg.$ === "state" && msg.agent !== undefined && msg.agent !== v.on && msg.agent === v.agent) {
    if (msg.agent !== v.held) {
      view_chat(v);
    }
    v.on = msg.agent;
    v.held = msg.agent;
  }
  if (!OWN.includes(msg.$) && v.on !== v.agent) {
    return [];
  }
  switch (msg.$) {
    case "team": {
      v.team = msg.agents;
      return [];
    }
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn  = msg.turn;
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      page.done = msg.done;
      if (msg.end === true) {
        page.live = [];
        return [];
      }
      if (msg.found && (msg.before === undefined || msg.before === page.from)) {
        page.log = [...msg.entries, ...(msg.before === undefined ? [] : page.log ?? [])];
        [page.from, page.loading] = [msg.from, false];
        return [];
      }
      if (!msg.found) {
        v.pages.delete(msg.name);
        v.page = v.page === page ? null : v.page;
        v.notes.push("No subagent " + msg.name + ".");
      }
      return [];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "entry": {
      if (msg.agent !== undefined) {
        const { $, agent, id, sent, ...entry } = msg;
        const log = v.pages.get(agent)?.log;
        log?.push(id === undefined ? entry : { ...entry, id });
        return [];
      }
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = msg.agent === undefined ? v.live : v.pages.get(msg.agent)?.live;
      if (live !== undefined) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = msg.agent === undefined ? v.live : v.pages.get(msg.agent)?.live;
      if (live !== undefined) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state);
      return [];
    }
    case "note":
    case "error": {
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
      return [];
    }
  }
}

export function view_act(v: View, act: Act): Client[] {
  switch (act.$) {
    case "Send": {
      const text   = act.text.trim();
      const images = act.images ?? [];
      const word   = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const goal   = word === "/goal" ? text.slice(word.length).trim() : null;
      if (text === "" && images.length === 0) {
        return view_stoppable(v) ? [{ $: "stop" }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null) {
        v.notes.push(word + " is no command; nothing was sent.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say: Client = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
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
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Talk": {
      return [{ $: "talk", on: act.on }];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [], from: 0, loading: false, done: false };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Plug": {
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
    const sub = view_sub(v);
    const rows = page_rows(v.page, v.thinking !== false, sub);
    return sub === undefined ? rows : running(rows, 0);
  }
  const rows = view_lines(view_rows(v, v.parts).flat());
  return v.busy ? running(rows, v.turn) : rows;
}

// a subagent's page shown near its top: its earlier entries (#143)
export function view_earlier(v: View): Client[] {
  const page = v.page;
  if (page === null || page.log === null || page.from === 0 || page.loading) {
    return [];
  }
  page.loading = true;
  return [{ $: "agent", name: page.name, before: page.from }];
}

// the shown subagent page's row in the chat list, while it runs
export function view_sub(v: View): SubRow | undefined {
  return v.team.find((m) => m.id === v.agent)?.subs?.find((s) => s.name === v.page?.name);
}

// a subagent's page: its log, earlier entries as it scrolls up (#143),
// the messages it took but hasn't answered marked (#144)
function page_rows(page: Page, minds: boolean, sub: SubRow | undefined): Row[] {
  const log = (page.log ?? []).filter((e) => minds || e.kind !== "mind");
  const earlier: Row[] = page.from > 0 ? [{ $: "Cap", text: page.loading ? "Loading…" : "", earlier: true }] : [];
  const rows = log.flatMap((e, k) => (e.id === 0 && e.kind === "note" ? [] : sent_rows(e.id !== undefined && sub?.sent.includes(e.id) === true, whole_rows(e.id ?? null, e, log[k - 1]))));
  return [...earlier, ...view_lines(rows), ...(page.done && page.log !== null ? [Cap("Done: its report is in the chat that spawned it.")] : [])];
}

// each tool call and its result are one line that opens in place (#121);
// a result whose call is in a fold is one line of its own
function view_lines(rows: Row[]): Row[] {
  const paired = new Set<string>();
  const out: Row[] = [];
  for (const [k, r] of rows.entries()) {
    if (r.$ === "Box") {
      out.push({ ...r, rows: view_lines(r.rows) });
    } else if (r.$ === "Msg" && r.kind === "tool" && r.call !== null) {
      const echo = r.of === undefined ? undefined : rows.slice(k + 1).find((x) => x.$ === "Msg" && x.kind === "echo" && x.of === r.of);
      if (echo !== undefined && r.of !== undefined) {
        paired.add(r.of);
      }
      out.push({ $: "Line", id: r.id, call: r.call, echo: echo?.$ === "Msg" ? echo.text : null, rows: echo === undefined ? [r] : [r, echo] });
    } else if (r.$ === "Msg" && r.kind === "echo" && r.of !== undefined && paired.has(r.of)) {
      continue;
    } else if (r.$ === "Msg" && r.kind === "echo") {
      out.push({ $: "Line", id: r.id, call: { name: "", head: r.who === "" ? "result" : r.who, device: "", blocks: [] }, echo: r.text, rows: [r] });
    } else {
      out.push(r);
    }
  }
  return out;
}

function view_rows(v: View, parts: Part[]): Row[][] {
  return parts.map(([id, n]) => part_rows(v, id, n, v.turn));
}

// a busy agent looks busy (#129): waiting for its model, writing, thinking,
// writing a tool call, waiting for its result
const WAITING: Row = { $: "Cap", text: "", wait: true };
const THINKING: Row = { $: "Cap", text: "Thinking", think: true };

// thinking starts with no text yet (#154): "Thinking" until its text comes,
// nothing once the model goes on without any
function thinks(live: Live[], k: number): boolean {
  return live[k].kind === "mind" && (live[k].text !== "" || k === live.length - 1);
}

// what streams in now: the text being written, a tool call being written
// or waiting to run
function live_rows(live: Live[], writing: boolean): Row[] {
  return live.flatMap((l, k) => l.kind === "mind" && l.text === "" ? (thinks(live, k) ? [THINKING] : []) : view_lines(entry_rows(null, l.kind, l.text, [], undefined, undefined, l.of)).map((r): Row => {
    if (r.$ === "Line") {
      return { ...r, phase: l.of === undefined ? "typing" : "running" };
    }
    return r.$ === "Msg" && l.kind === "unii" && writing && k === live.length - 1 ? { ...r, writing: true } : r;
  }));
}

// a tool call of the turn going on with no result yet runs
function running(rows: Row[], from: number): Row[] {
  return rows.map((r) => (r.$ === "Line" && r.echo === null && r.id !== null && r.id >= from ? { ...r, phase: "running" } : r));
}

export function view_tail(v: View): Row[] {
  if (v.page !== null) {
    const live = v.page.live;
    const page = live.filter((l) => v.thinking !== false || l.kind !== "mind");
    const thought = v.thinking === false && live.some((_, k) => thinks(live, k)) ? [THINKING] : [];
    const sub = view_sub(v);
    const queued = (sub?.queue ?? []).flatMap((text) => sent_rows(true, entry_rows(null, "user", text)));
    const idle = sub !== undefined && v.page.live.length === 0 && v.page.log?.at(-1)?.kind !== "tool" && sub.doing !== "usage limit";
    return [...thought, ...live_rows(page, sub !== undefined), ...(idle ? [WAITING] : []), ...queued];
  }
  const thought = v.thinking === false && v.live.some((_, k) => thinks(v.live, k)) ? [THINKING] : [];
  const rows = [...thought, ...live_rows(v.live.filter((l) => v.thinking !== false || l.kind !== "mind"), v.busy && v.wait === "")];
  const load = v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const queued = v.queue.flatMap((q) => entry_rows(null, q.kind, q.text).map((row) => (row.$ === "Msg" ? { ...row, queued: true } : row)));
  const after = [...queued, ...kept, ...load];
  if (v.limit !== null) {
    return [...rows, Cap(limit_show(v.limit)), ...after];
  }
  if (v.wait === SUMMARIES) {
    return [...rows, ...(rows.length > 0 ? [] : [Cap(sums_show(v.sums, v.again))]), ...after];
  }
  return [...rows, ...(v.busy && v.wait !== "" ? [WAITING] : []), ...after];
}

function sums_show(sums: Sums | null, again: Again | null, now = Date.now()): string {
  const head = sums === null ? SUMS : SUMS.replace(/…$/, "") + ": " + sums.done + " of " + sums.total;
  if (again === null) {
    return head;
  }
  const when = again.limit ? "at " + clock(again.until, now) : "in " + Math.max(1, Math.ceil((again.until - now) / 60e3)) + " min";
  const why  = again.why.length > 120 ? again.why.slice(0, 120) + "…" : again.why.replace(/\.$/, "");
  return head + " · compactor: " + why + ", asking again " + when;
}

function limit_show(limit: Parked, now = Date.now()): string {
  return limit_note(limit.vendor, limit.known ? "resumes" : "tries again", limit.until, now);
}

// the one usage-limit note: the parked wait's row, a call ended by one
// (Limit.off)
export function limit_note(vendor: Vendor, does: string, until: number | null, now = Date.now()): string {
  return "Usage limit on " + vendor + ", " + (until === null ? "reset time unknown" : does + " at " + clock(until, now));
}

function clock(at: number, now = Date.now()): string {
  const day = new Date(at).toDateString() === new Date(now).toDateString() ? {} : { weekday: "short", day: "numeric", month: "short" } as const;
  return new Date(at).toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function progress_show(p: Progress): string {
  const n = (k: number) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}

// the user's Stop is for the agent's own turn: its subagents go on
export function view_stoppable(v: View): boolean {
  return v.busy || v.limit !== null;
}

export function view_pick(v: View): Knob[] {
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}

function view_knobs(v: View, pick: Pick, menus: boolean): Knob[] {
  const { model, effort, speed, profile } = pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  const whose = Pick.twin(pick.vendor, model, v.vendors) ? ", " + pick.vendor : "";
  const choices = (move: Move) => (menus ? view_choices(pick, move, v) : []);
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: choices("model") },
    { text: effort, move: "effort", hint: effort + " effort", choices: choices("effort") },
    { text: speed, move: "speed", hint: speed, choices: choices("speed") },
  ];
}

function view_choices(pick: Pick, move: Move, v: View): Choice[] {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p: Pick) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}

function view_learn(v: View, pack: Pack): void {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}

function view_entry(v: View, msg: Server & { $: "entry" }): void {
  const { $, id, sent, ...entry } = msg;
  if (sent === true && id !== undefined) {
    v.sent = [...v.sent, id];
  }
  const last = v.parts.findLast(([at]) => v.whole.get(at)?.kind !== "team");
  if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...(v.minds.get(at) ?? []), msg.text]);
  }
}

// offline shows only once a reconnect has failed or this long has gone
export const GRACE = 3000;
const BACKOFF = 30000;

export function view_offline(v: View, now = Date.now()): boolean {
  return !v.up && (v.tries > 1 || now - v.down >= GRACE);
}

// a link that drops is opened again at once, then after 1, 2, 4… s
export function link_open(v: View, link: Link): void {
  v.retry = null;
  const ws   = link.open("?tab=" + v.tab + "&wire=" + WIRE + "&agent=" + v.agent);
  v.on = "";
  let heard  = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - heard > PING) {
      void drop();
    }
  }, PING / 2);
  function shut(): void {
    ws.onmessage = null;
    ws.onclose   = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
  }
  async function drop(): Promise<void> {
    const up = v.up;
    shut();
    if (up) {
      v.down = Date.now();
    }
    const wait = v.tries === 0 ? 0 : Math.min(BACKOFF, RETRY * 2 ** (v.tries - 1));
    v.tries++;
    if (await link.lost(up)) {
      v.retry = setTimeout(() => link_open(v, link), wait);
    }
  }
  function flush(): void {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        void upload(post, post.msg);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post: Post, msg: Extract<Post["msg"], { body: Body }>): Promise<void> {
    const { body, ...rest } = msg;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = (await res?.json().catch(() => null)) as Answer | null | undefined;
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      void drop();
    }
  }
  // back in view: a link not heard from since the server's last tick (or
  // since it opened) is dead, and one waiting to open again opens now
  function wake(): void {
    if (!v.up) {
      v.down = Date.now();
    }
    if (v.ws === ws && Date.now() - heard > PING / 2 + RETRY) {
      v.tries = 0;
      void drop();
    } else if (v.ws === null && v.retry !== null) {
      clearTimeout(v.retry);
      v.tries = 0;
      link_open(v, link);
    }
  }
  // the server took no part in this link: its wire is not ours. An older
  // client stops, a newer one tries again slowly till the server is updated
  function refused(msg: Extract<Server, { $: "error" }>): void {
    const old = (msg.wire ?? 0) > WIRE;
    shut();
    if (!old) {
      setTimeout(() => link_open(v, link), SLOW);
    }
    const text = old ? OLDER : NEWER;
    if (v.refused?.text !== text) {
      v.refused = { text, old };
      link.hear({ $: "error", text, ...(old && msg.build !== undefined ? { build: msg.build } : {}) });
    }
  }
  [v.ws, v.flush, v.wake] = [ws, flush, wake];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data)) as Server;
    if (msg.$ === "error" && !v.up) {
      refused(msg);
      return;
    }
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.tries = 0;
    }
    link.hear(msg);
    if (join) {
      v.refused = null;
      flush();
    }
  };
  ws.onclose = () => void drop();
}

export function link_send(v: View, msg: Client, done = (a: Answer) => link_note(v, a), said = ""): void {
  const to = msg.$ === "say" ? { agent: v.agent } : {};
  v.out.push({ msg: { id: uuid(), ...msg, ...to }, ws: null, done, said });
  v.flush();
}

// a random id, as crypto.randomUUID makes one: that is only in a secure
// context, and a page on a LAN's plain http is none
function uuid(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b, k) => (k === 6 ? (b & 15) | 64 : k === 8 ? (b & 63) | 128 : b).toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function link_note(v: View, a: Answer): void {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}

export async function post(url: string, body: object, auth: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out: unknown = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => (res.ok ? {} : { error: "HTTP " + res.status }));
  return { ...(rec(out) ? out : {}), ok: res?.ok === true, status: res?.status ?? 0 };
}

// one message is shown as itself, never as a fold of one (#120), a team
// copy not at all (#134); two and more are a fold till opened, which
// shows its two halves
function part_rows(v: View, id: number, n: number, t: number): Row[] {
  const key   = id + "+" + n;
  const entry = v.whole.get(id);
  const half  = n / 2;
  if (n === 1 && entry?.kind === "team") {
    return [];
  }
  if (n === 1 && entry !== undefined) {
    const minds = id < t || v.thinking === false ? [] : v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...sent_rows(v.sent.includes(id), whole_rows(id, entry, v.whole.get(id - 1))), ...after];
  }
  if (n === 1 || v.open.get(key) !== true) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const rows = [...part_rows(v, id, half, t), ...part_rows(v, id + half, half, t)];
  return [{ $: "Box", id, n, text: GLYPH.open + " " + n + "x · fold", rows }];
}

const ROWS  = new WeakMap<Entry | Node, Row[]>();
const APART = new WeakMap<Entry, Row[]>();

function whole_rows(id: number | null, entry: Entry, before: Entry | undefined): Row[] {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images, of, entry.from, entry.of);
  made.set(entry, rows);
  return rows;
}

function sum_rows(id: number, n: number, node: Node = { text: WAIT, to: "" }): Row[] {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: Md.md_flat(node.text) }];
  ROWS.set(node, rows);
  return rows;
}

function sent_rows(sent: boolean, rows: Row[]): Row[] {
  return sent ? rows.map((row) => (row.$ === "Msg" ? { ...row, queued: true } : row)) : rows;
}

export function live_push(live: Live[], kind: Kind, text: string, fresh = false): void {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}

function live_set(live: Live[], now: Live[]): void {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => (k < held.length ? Object.assign(held[k], l) : l));
  live.splice(0, live.length, ...next);
}

export function image_kind(head: Uint8Array): string | null {
  const text = String.fromCharCode(...head.subarray(0, HEAD));
  return MARKS.find(([, at, mark]) => text.slice(at, at + mark.length) === mark)?.[0] ?? null;
}

function entry_of(entry: Entry, before: Entry | undefined): Of {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}

function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = [], of: Of = { tool: "", apart: false }, from?: string, pair?: string): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : Call.tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report?.name ?? WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  const pics = images.filter((name) => !text.includes("/media/" + name));
  const sent = { ...(from === undefined ? {} : { from }), ...(pair === undefined ? {} : { of: pair }) };
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics, ...sent }];
}

function entry_body(kind: Kind, text: string, label: string, tool: string): Md.Block[] {
  if (kind !== "echo") {
    return Md.md_parse(text, kind === "user" || kind === "work");
  }
  const name = Call.tool_name(tool);
  return name === "show" ? Md.md_shown(text, label) : Md.md_output(text, label);
}
