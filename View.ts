import type { Again, Kind, Parked, Vendor } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import { LABELS, type Fall, type Move, Pick } from "./Pick.ts";
import { GLYPH, WHO } from "./Theme.ts";
import type { Timer } from "./Timer.ts";
import type { Job } from "./Machine.ts";
import { rec } from "./Json.ts";

export type Part = [number, number];

export type Entry = { kind: Kind; text: string; date?: string; images?: string[]; of?: string; tool?: string };

export type Queued = { kind: Kind; text: string };

export type Pending = Queued & { images: string[]; act?: string };

export type Of = { tool: string; apart: boolean };

type Node = { text: string; to: string };

export type Live = { kind: Kind; text: string };

export type Page = { name: string; log: Entry[] | null; live: Live[]; pick: Pick | null };

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
  agents    : string[];
  runs      : Record<string, Pick>;
  limits    : Record<string, Parked>;
  queue     : Record<string, Queued[]>;
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
  build?    : string;
  site?     : string;
};

type State = Turning & ByRun & Offered & ChatSet & ServerSays;

export type Talk = { from: number; used: number; tokens: number; window: number; model: string; guess: boolean };

export type Plug = { name: string; on: boolean };

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

type Pack = { nodes?: Record<string, Node>; whole?: Record<string, Entry> };

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
  | { $: "error"; text: string }
  | ({ $: "ack"; id: string } & Answer)
  | { $: "jobs"; ids: string[] }
  | { $: "job"; id: string; job: Job };

export type Sent = { text: string; images?: Blob[] };

export type Answer = { error?: string; status?: number; text?: string; going?: boolean };
type Upload = BodyInit | AsyncIterable<string>;
type Body   = () => Upload | Promise<Upload>;

export type Client =
  | { $: "say"; sizes: number[]; body: Body }
  | { $: "import"; body: Body }
  | { $: "voice"; type: string; body: Body }
  | { $: "stop"; name?: string }
  | { $: "goal"; text: string | null }
  | { $: "go"; on: boolean }
  | { $: "pick"; to: Pick }
  | { $: "mcp"; name: string; on: boolean }
  | { $: "talk"; on: boolean }
  | { $: "out"; job: string; out: object }
  | { $: "unschedule"; id: string }
  | { $: "zoom"; part: Part }
  | { $: "root" }
  | { $: "agent"; name: string };

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
  | { $: "Fold"; on: boolean }
  | { $: "Goto"; name: string | null }
  | { $: "Unschedule"; id: string }
  | { $: "Plug"; name: string }
  | { $: "Talk"; on: boolean }

export type Row =
  | { $: "Sum"; id: number; n: number; text: string; call: Call.Call | null }
  | { $: "Box"; id: number; n: number; text: string; rows: Row[] }
  | { $: "Msg"; id: number | null; kind: Kind; who: string; text: string; body: Md.Block[]; call: Call.Call | null; images: string[]; queued?: boolean }
  | { $: "Cap"; text: string }

export type Tab = { name: string | null; here: boolean; text: string };

export type Knob = { text: string; move: Move; hint: string; choices: Choice[] };

export type Choice = { text: string; to: string; move: Move; here: boolean; vendor: string | null };

export type Prompts = Record<"prompt" | "compact", { text: string; def: string }>;

export const MAIN = "UniiChat";

export const TURN = "Unii's turn";

export const WIRE = 3;

export const PING  = 10000;
export const RETRY = 1000;
export const TICK  = "+";
export const QUIT  = 4000;

export const ACTIVE   = "active";
export const IDLE     = "idle";
export const USE_PING = 20000;

export const FRAME = 2 ** 22;

export const HINT = "Message UniiChat";

// the disclosure both views show (EU AI Act art. 50, California SB 243,
// New York GBL art. 47, Anthropic's usage policy)
export const AI = "Unii is an AI, not a person, and can make mistakes.";

const NOTICE = 3 * 60 * 60 * 1000;

const WAIT = "compressing…";
const SUMS = "compressing earlier messages…";

const UNSENT = "Sends once connected.";

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

const TOOL = "tool: ";
const FOLD = "The whole chat, folded into the fewest blocks.";

export function Cap(text: string): Row {
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
    queue     : {},
    sums      : null,
    again     : null,
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
      if (!view_typing(v)) {
        return [];
      }
      if (text === "" && images.length === 0) {
        return view_stoppable(v) ? [{ $: "stop", name: TURN }] : [];
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

export function view_rows(v: View, parts: Part[]): Row[][] {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}

export function rows_wait(v: View, rows: Row[]): boolean {
  return rows.some((row) => (row.$ === "Sum" && !v.nodes.has(row.id + "+" + row.n)) || (row.$ === "Box" && rows_wait(v, row.rows)));
}

export function view_tail(v: View, live = view_stream(v)): Row[] {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const name = v.page === null ? TURN : v.page.name;
  const queued = (v.queue[name] ?? []).flatMap((q) => entry_rows(null, q.kind, q.text).map((row) => (row.$ === "Msg" ? { ...row, queued: true } : row)));
  const after = [...queued, ...kept, ...load];
  const limit = v.limits[name];
  if (limit !== undefined) {
    return [...rows, Cap(limit_show(limit)), ...after];
  }
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...after];
  }
  return [Cap(v.wait === SUMMARIES ? sums_show(v.sums, v.again) : "waiting for " + v.wait + "…"), ...after];
}

function sums_show(sums: Sums | null, again: Again | null, now = Date.now()): string {
  const head = sums === null ? SUMS : SUMS.replace(/…$/, "") + ": " + sums.done + " of " + sums.total;
  if (again === null) {
    return head;
  }
  const at   = new Date(again.until);
  const day  = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const };
  const when = again.limit ? "at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" }) : "in " + Math.max(1, Math.ceil((again.until - now) / 60e3)) + " min";
  const why  = again.why.length > 120 ? again.why.slice(0, 120) + "…" : again.why.replace(/\.$/, "");
  return head + " · compactor: " + why + ", asking again " + when;
}

function limit_show(limit: Parked, now = Date.now()): string {
  const at  = new Date(limit.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" as const };
  return "waiting for the usage limit, " + (limit.known ? "resumes" : "tries again") + " at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" });
}

export function view_stream(v: View): Live[] {
  return v.page === null ? v.live : v.page.live;
}

export function progress_show(p: Progress): string {
  const n = (k: number) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}

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

export function view_stoppable(v: View): boolean {
  return v.busy || v.limits[TURN] !== undefined;
}

export function view_running(v: View): boolean {
  return v.busy || v.agents.length > 0;
}

export function view_pick(v: View): Knob[] {
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}

export function view_shown(v: View): Knob[] {
  if (v.page === null) {
    return view_pick(v);
  }
  return v.page.pick === null ? [] : view_knobs(v, v.page.pick, false);
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

function view_live(v: View, agent: string | undefined): Live[] | null {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}

export function link_open(v: View, link: Link): void {
  const ws   = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard  = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - heard > PING) {
      void drop();
    }
  }, PING / 2);
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
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data)) as Server;
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
  ws.onclose = () => void drop();
}

export function link_send(v: View, msg: Client, done = (a: Answer) => link_note(v, a), said = ""): void {
  v.out.push({ msg: { id: uuid(), ...msg }, ws: null, done, said });
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

export function block_name(id: number, n: number): string {
  return "#" + id + (n === 1 ? "" : "+" + n);
}

export function part_due(v: View, part: Part, before: Part | undefined): boolean {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}

function part_window(v: View, [id, n]: Part): number {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}

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

const ROWS  = new WeakMap<Entry | Node, Row[]>();
const APART = new WeakMap<Entry, Row[]>();

function whole_rows(id: number | null, entry: Entry, before: Entry | undefined): Row[] {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images, of);
  made.set(entry, rows);
  return rows;
}

function sum_rows(id: number, n: number, node: Node = { text: WAIT, to: "" }): Row[] {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: Md.md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}

export function page_rows(v: View, page: Page, from = 0): Row[] {
  const head = Cap(page.name + (v.agents.includes(page.name) ? " · at work" : " · done"));
  const log = page.log ?? [];
  return [head, ...log.slice(from).flatMap((e, k) => whole_rows(null, e, log[from + k - 1]))];
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

function sum_call(n: number, text: string): Call.Call | null {
  const call = n === 1 && text.startsWith(TOOL) ? Call.call_parse(text.slice(TOOL.length)) : null;
  return call === null || call.name === "" ? null : call;
}

export function image_kind(head: Uint8Array): string | null {
  const text = String.fromCharCode(...head.subarray(0, HEAD));
  return MARKS.find(([, at, mark]) => text.slice(at, at + mark.length) === mark)?.[0] ?? null;
}

export function entry_of(entry: Entry, before: Entry | undefined): Of {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}

export function entry_rows(id: number | null, kind: Kind, text: string, images: string[] = [], of: Of = { tool: "", apart: false }): Row[] {
  const call = kind === "tool" ? Call.call_parse(text) : null;
  const report = kind === "work" ? Call.report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : Call.tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report?.name ?? WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  const pics = images.filter((name) => !text.includes("/media/" + name));
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics }];
}

export function entry_settled(kind: Kind, text: string, ended: boolean): number {
  return ["user", "work", "echo", "tool"].includes(kind) || !ended ? 0 : text.length;
}

function entry_body(kind: Kind, text: string, label: string, tool: string): Md.Block[] {
  if (kind !== "echo") {
    return Md.md_parse(text, kind === "user" || kind === "work");
  }
  return Call.tool_name(tool) === "show" ? Md.md_shown(text, label) : Md.md_output(text, label);
}
