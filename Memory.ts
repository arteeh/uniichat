import * as fs from "node:fs";
import { AskAI, type Again, type Ask, type Block, type Call, type Event, type Img, type Kind, type Say } from "./AskAI.ts";
import { clip_page, clip_pages } from "./Clip.ts";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { err_code, err_why } from "./Err.ts";
import { Pick } from "./Pick.ts";
import * as names from "./Names.ts";
import type { Timer } from "./Timer.ts";
import { FIT, HEAD, IMAGE, image_kind, MEDIA, media_ext, PIXELS, STORED, TOKEN, type Pending } from "./View.ts";
import { move_over } from "./Write.ts";

type Root = Msg & { i: number; size: number; date: string };

export type Msg = { kind: Kind; text: string; date?: string; images?: string[]; imported?: boolean; line?: string; more?: boolean; act?: string } & Pair;

export type Pair = { of?: string; tool?: string };

type Part = { l: number; i: number };

type View = { parts: Part[]; size: number; batch: boolean; high: number };

type Sum = Part & { kind: Served };
type Served = "compactor" | "import";

export type Share = Omit<Ask, "blocks">;

export type Room = { take: (n: number) => string | null; wrote: (n: number) => void; end: () => void };

type Stream = "main" | "tree";

type End = [number, number];

type Kept = { parts: Array<[number, number]>; batch: boolean };

type Saved = Kept & { seen?: Kept; main: End; tree: End; pick: object | null; goal?: string | null; work?: string[]; timers?: Timer[]; off?: string[]; talk?: number | null };

type Queues = { main: Pending[]; agents: Record<string, string[]> };

// a line of a log, as Memory.log writes it
type Rec = { i?: number; l?: number; act?: string; ans?: object };

type Recs = { main: Root; tree: { text: string } };

export type Memory = {
  dir    : string;
  fds    : Map<string, number>;
  count  : number;
  open   : number;
  pick   : object | null;
  goal   : string | null;
  off    : string[];
  talk   : number | null;
  talked : Map<number, number>;
  work   : string[];
  timers : Timer[];
  queue  : Pending[];
  tells  : Record<string, string[]>;
  nodes  : Map<number, string>;
  agents : Map<string, number>;
  view   : View;
  seen   : View;
  ready  : number[][][];
  ends   : Record<Stream, End>;
  busy   : Map<number, number>;
  sides  : Map<number, number>;
  calls  : Map<Call, Sum>;
  hold   : Array<string | null>;
  done   : boolean;
  wait   : Set<() => void>;
  share  : () => Omit<Share, keyof Pick>;
  made?  : (l: number, i: number) => void;
  acted  : (id: string, ans: object) => void;
  again  : Again | null;
};

const NODE  = 512;
export const JOBS = 64;

const LOGGED = 60e3;

const FAILED = new Map<string, number>();
const TRIES = 5;
const HIGH  = 128000;
const BLOCK = 4;

const SLOT  = 16;
const DAY   = 864e5;

const FDS   = 8;

// Anthropic takes 32 MB a request, 20 images at full size: 20 of IMAGE
// bytes (View.ts), in base64
const PICS   = 20;

const PIECE = 2 ** 20;

const SCALE = "-".repeat(NODE);

const WAIT = "(not summarized yet: zoom it)";

const TALKING = "Conversation mode is on from message {id}: from there on, the user's and Unii's messages are whole, word for word (zoom on one only to see an image it names); tool calls, their output, notes and reports stay summary lines.";

const IMAGES = "/docs/images/";

const MEDIA_DIR = "/docs/media/";

const PAGE_MAX = 4 * 2 ** 20;

const AGENTS = "/docs/agent/";

const LEAF = `Compaction: compress message {id} into one line of at most ${NODE} bytes
(about 70 words), the length of this ruler:
${SCALE}
<input>
`;

const MERGE = `Compaction: merge lines {a} and {b}, adjacent, into one line of at most
${NODE} bytes (about 70 words), the length of this ruler:
${SCALE}
<chat> may hold their messages, {id} to {end}, in more detail: take details
of them from there too.
<input>
`;

export namespace Memory {

  export function load(dir: string, share: Memory["share"], acted: Memory["acted"] = () => {}): Memory {
    const mem: Memory = {
      dir, fds: new Map(), count: 0, open: 0, pick: null, goal: null, off: [], talk: null, talked: new Map(), work: [], timers: [], queue: [], tells: {}, nodes: new Map(), agents: new Map(), ready: [[], []], ends: { main: [0, 0], tree: [0, 0] },
      view: { parts: [], size: 0, batch: false, high: HIGH }, seen: { parts: [], size: 0, batch: false, high: config.COMPACTOR_CONTEXT },
      busy: new Map(), sides: new Map(), calls: new Map(), hold: [null, "paused"], done: false, wait: new Set(), share, acted, again: null,
    };
    const saved = Memory.saved(dir);
    mem.pick = saved?.pick ?? null;
    mem.goal = saved?.goal ?? null;
    mem.off  = saved?.off ?? [];
    mem.talk = saved?.talk ?? null;
    mem.work = saved?.work ?? [];
    mem.timers = saved?.timers ?? [];
    const queues = Memory.queues(dir);
    mem.queue = queues.main;
    mem.tells = queues.agents;
    mem.ends.main = Memory.index(mem, "main", saved?.main ?? [0, 0]);
    mem.ends.tree = Memory.index(mem, "tree", saved?.tree ?? [0, 0]);
    mem.count = fs.statSync(dir + "/main.index").size / SLOT;
    while (Memory.message(mem, mem.count - 1)?.more) {
      mem.count -= 1;
    }
    Memory.open(mem, mem.view, saved);
    Memory.open(mem, mem.seen, saved?.seen ?? saved);
    Memory.roots(mem.count).flatMap((part) => Memory.todo(mem, part)).forEach((part) => Memory.ready(mem, part, true));
    Memory.fit(mem);
    Memory.save(mem);
    return mem;
  }

  export function saved(dir: string): Saved | null {
    try {
      return JSON.parse(fs.readFileSync(dir + "/view.json", "utf8")) as Saved;
    } catch {
      return null;
    }
  }

  export function open(mem: Memory, view: View, kept: Kept | null): void {
    const keys = kept === null ? null : new Set(kept.parts.map(([l, i]) => Memory.slot(l, i)));
    view.parts = Memory.roots(mem.count).flatMap((part) => Memory.down(mem, part, keys));
    view.size = view.parts.reduce((n, part) => n + Memory.size(mem, part), 0);
    view.batch = kept?.batch ?? false;
  }

  export function save(mem: Memory): void {
    const file = mem.dir + "/view.json";
    const [chat, seen] = [mem.view, mem.seen].map((view): Kept => ({ parts: view.parts.map((part) => [part.l, part.i]), batch: view.batch }));
    fs.writeFileSync(file + ".new", JSON.stringify({ ...chat, seen, pick: mem.pick, goal: mem.goal, off: mem.off, talk: mem.talk, work: mem.work, timers: mem.timers, ...mem.ends }));
    move_over(file + ".new", file);
    void Disk.wrote(file);
  }

  export function queues(dir: string): Queues {
    try {
      const got = JSON.parse(fs.readFileSync(dir + "/queue.json", "utf8")) as Partial<Queues>;
      return { main: got.main ?? [], agents: got.agents ?? {} };
    } catch {
      return { main: [], agents: {} };
    }
  }

  export function save_queue(mem: Memory): void {
    const file = mem.dir + "/queue.json";
    fs.writeFileSync(file + ".new", JSON.stringify({ main: mem.queue, agents: mem.tells }));
    move_over(file + ".new", file);
    void Disk.wrote(file);
  }

  export function index(mem: Memory, stream: Stream, from: End): End {
    const file = mem.dir + "/" + stream + ".index";
    let end: End = fs.existsSync(file) ? from : [0, 0];
    fs.mkdirSync(mem.dir + "/" + stream, { recursive: true });
    const fd = fs.openSync(file, end[0] === 0 ? "w+" : "r+");
    const days = fs.readdirSync(mem.dir + "/" + stream).map((f) => Date.parse(f.slice(0, 10)) / DAY);
    try {
      for (const day of days.filter((day) => day >= end[0]).sort((a, b) => a - b)) {
        end = [day, Memory.scan(mem, stream, day, day === end[0] ? end[1] : 0, fd)];
      }
    } finally {
      fs.closeSync(fd);
    }
    return end;
  }

  export function scan(mem: Memory, stream: Stream, day: number, at: number, fd: number): number {
    const file = Memory.path(mem, stream, day);
    const data = Memory.slice(file, at, fs.statSync(file).size - at);
    let k = 0;
    for (let nl = data.indexOf(10); nl >= 0; nl = data.indexOf(10, k)) {
      const rec = Memory.parse(data.subarray(k, nl).toString("utf8"), file) as Rec | null;
      if (rec !== null) {
        Memory.place(mem, fd, stream, rec, day, at + k, nl - k);
      }
      k = nl + 1;
    }
    if (k < data.length) {
      console.error("skipped the last line of " + file + ": cut short");
      fs.appendFileSync(file, "\n");
      return at + data.length + 1;
    }
    return at + k;
  }

  export function slot(l: number, i: number): number {
    return (2 * i + 1) * 2 ** l - 1;
  }

  export function place(mem: Memory, fd: number, stream: Stream, rec: Rec, day: number, at: number, length: number): void {
    const buf = Buffer.alloc(SLOT);
    if (rec.act !== undefined) {
      mem.acted(rec.act, rec.ans ?? {});
    }
    if (rec.i === undefined) {
      return;
    }
    buf.writeDoubleLE(at, 0);
    buf.writeUInt32LE(day, 8);
    buf.writeUInt32LE(length, 12);
    fs.writeSync(fd, buf, 0, SLOT, (stream === "main" ? rec.i : Memory.slot(rec.l ?? 0, rec.i)) * SLOT);
  }

  export function read<S extends Stream>(mem: Memory, stream: S, slot: number): Recs[S] | null {
    const rec = Memory.pread(Memory.fd(mem, mem.dir + "/" + stream + ".index"), slot * SLOT, SLOT);
    const day = rec.length < SLOT ? 0 : rec.readUInt32LE(8);
    if (day === 0) {
      return null;
    }
    const line = Memory.pread(Memory.fd(mem, Memory.path(mem, stream, day)), rec.readDoubleLE(0), rec.readUInt32LE(12));
    return JSON.parse(line.toString("utf8")) as Recs[S];
  }

  export function fd(mem: Memory, file: string): number {
    const fd = mem.fds.get(file) ?? fs.openSync(file, "r");
    mem.fds.delete(file);
    mem.fds.set(file, fd);
    for (const [old, gone] of mem.fds) {
      if (mem.fds.size <= FDS) {
        break;
      }
      fs.closeSync(gone);
      mem.fds.delete(old);
    }
    return fd;
  }

  export function pread(fd: number, at: number, n: number): Buffer {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, fs.readSync(fd, buf, 0, n, at));
  }

  export function slice(file: string, at: number, n: number): Buffer {
    const fd = fs.openSync(file, "r");
    try {
      return Memory.pread(fd, at, n);
    } finally {
      fs.closeSync(fd);
    }
  }

  export function path(mem: Memory, stream: Stream, day: number): string {
    return mem.dir + "/" + stream + "/" + new Date(day * DAY).toISOString().slice(0, 10) + ".jsonl";
  }

  export function file(file: string): Root[] {
    const data = fs.readFileSync(file, "utf8");
    if (data !== "" && !data.endsWith("\n")) {
      fs.appendFileSync(file, "\n");
    }
    return data.split("\n").flatMap((line) => (Memory.parse(line, file) as Root | null) ?? []);
  }

  export function file_text(file: string): string {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  }

  export function parse(line: string, file: string): unknown {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      if (line !== "") {
        console.error("skipped a line of " + file + ": not JSON");
      }
      return null;
    }
  }

  export function log(mem: Memory, stream: Stream, recs: Rec[]): void {
    const day = Date.parse(new Date().toLocaleDateString("sv-SE")) / DAY;
    const lines = recs.map((rec) => JSON.stringify(rec));
    let at = Memory.append(Memory.path(mem, stream, day), lines);
    const fd = fs.openSync(mem.dir + "/" + stream + ".index", "r+");
    try {
      for (const [k, line] of lines.entries()) {
        Memory.place(mem, fd, stream, recs[k], day, at, Memory.bytes(line));
        at += Memory.bytes(line) + 1;
      }
    } finally {
      fs.closeSync(fd);
    }
    mem.ends[stream] = [day, at];
  }

  export function append(file: string, lines: string[]): number {
    const fd = fs.openSync(file, "a");
    try {
      const at = fs.fstatSync(fd).size;
      fs.writeSync(fd, lines.map((line) => line + "\n").join(""));
      return at;
    } finally {
      fs.closeSync(fd);
      void Disk.wrote(file);
    }
  }

  export function bytes(text: string): number {
    return Buffer.byteLength(text, "utf8");
  }

  export function root(i: number, msg: Msg): Root {
    const date   = msg.date ?? new Date().toISOString();
    const images = msg.images?.length ? msg.images : undefined;
    const root: Root = { ...msg, text: msg.text.toWellFormed(), i, size: 0, date, images };
    root.size = Memory.bytes(Memory.show(root));
    return root;
  }

  export function show(root: Root): string {
    const pics = (root.images ?? []).map((name) => "\n[image docs/images/" + name + "]");
    const who  = root.imported && (root.kind === "unii" || root.kind === "tool") ? "ai" : root.kind;
    return who + ": " + root.text + pics.join("");
  }

  export function message(mem: Memory, i: number): Root | null {
    return Number.isInteger(i) && i >= 0 && i < mem.count ? Memory.read(mem, "main", i) : null;
  }

  export function at(mem: Memory, i: number): Root {
    const root = Memory.message(mem, i);
    if (root === null) {
      throw new Error("the chat has no message #" + i);
    }
    return root;
  }

  export function push(mem: Memory, msgs: Msg[]): Root[] {
    const roots = msgs.flatMap(Memory.pages).map((msg, k) => Memory.root(mem.count + mem.open + k, msg));
    const done = roots.findLastIndex((root) => !root.more) + 1;
    const ids = Array.from({ length: done === 0 ? 0 : mem.open + done }, (_, k) => mem.count + k);
    Memory.log(mem, "main", roots);
    mem.open += roots.length - ids.length;
    mem.count += ids.length;
    ids.forEach((i) => Memory.ready(mem, { l: 0, i }, true));
    Memory.fit(mem, true);
    Memory.pump(mem);
    return roots;
  }

  export function pages(msg: Msg): Msg[] {
    const texts = clip_pages(msg.text);
    const pics = msg.images ?? [];
    const n = Math.max(texts.length, Math.ceil(pics.length / PICS));
    return Array.from({ length: n }, (_, k) => {
      const end = Math.max(0, pics.length - (n - 1 - k) * PICS);
      const images = pics.slice(Math.max(0, end - PICS), end);
      const more = k < n - 1 || msg.more === true ? true : undefined;
      const act = k === n - 1 ? msg.act : undefined;
      return { ...msg, text: texts[k - n + texts.length] ?? "", images, line: k === 0 ? msg.line : undefined, more, act };
    });
  }

  export function whole(mem: Memory, from: number): number {
    let [k, size, pics] = [mem.count, 0, 0];
    for (; k > from; k--) {
      const root = Memory.at(mem, k - 1);
      size += root.size;
      pics += root.images?.length ?? 0;
      if (k < mem.count && (size > HIGH || pics > PICS)) {
        return k;
      }
    }
    return k;
  }

  export function say(mem: Memory, a: number, b: number): Say {
    const ids = Array.from({ length: b - a }, (_, k) => a + k);
    const text = ids.map((id) => Memory.at(mem, id).text).join("");
    return { text, imgs: ids.flatMap((id) => Memory.images(mem, id)) };
  }

  export async function image_add(mem: Memory, bytes: Buffer): Promise<string | null> {
    const kind = image_kind(bytes);
    if (kind === null) {
      return null;
    }
    const img = new Bun.Image(bytes);
    const size = await img.metadata().catch(() => null);
    if (size === null) {
      return null;
    }
    const hash = new Bun.CryptoHasher("sha256");
    for (let at = 0; at < bytes.length; at += PIECE) {
      hash.update(bytes.subarray(at, at + PIECE));
      await new Promise((ok) => setImmediate(ok));
    }
    const name = hash.digest("hex").slice(0, 16) + "." + kind.split("/")[1];
    const k = Math.min(1, FIT / Math.max(size.width, size.height));
    const fit = (k < 1 || bytes.length > IMAGE) && size.width * size.height <= PIXELS;
    fs.mkdirSync(mem.dir + IMAGES, { recursive: true });
    if (fit) {
      const out = img.resize(Math.round(size.width * k), Math.round(size.height * k)).jpeg({ quality: 85 });
      await Bun.write(mem.dir + IMAGES + name + ".jpg", await out.bytes());
      void Disk.wrote(mem.dir + IMAGES + name + ".jpg");
    }
    await Bun.write(mem.dir + IMAGES + name, bytes);
    void Disk.wrote(mem.dir + IMAGES + name);
    return name;
  }

  export async function media_add(mem: Memory, body: ReadableStream<Uint8Array>, file: string, room: Room): Promise<{ name: string } | { error: string }> {
    const named = media_ext(file);
    fs.mkdirSync(mem.dir + MEDIA_DIR, { recursive: true });
    const tmp = mem.dir + MEDIA_DIR + ".up-" + crypto.randomUUID();
    const out = await fs.promises.open(tmp, "wx");
    const hash = new Bun.CryptoHasher("sha256");
    const reader = body.getReader();
    let [size, head, done] = [0, Buffer.alloc(0), false];
    try {
      for (let got = await reader.read(); !got.done; got = await reader.read()) {
        const piece = got.value;
        size += piece.length;
        const why = named === "html" && size > PAGE_MAX ? file + " is over the " + PAGE_MAX / 2 ** 20 + " MB a page may be." : room.take(piece.length);
        if (why !== null) {
          return { error: why };
        }
        head = head.length < HEAD ? Buffer.concat([head, piece]).subarray(0, HEAD) : head;
        hash.update(piece);
        await out.write(piece);
        room.wrote(piece.length);
      }
      done = true;
      const sniffed = image_kind(head)?.split("/")[1] ?? null;
      const picture = (MEDIA.get(named) ?? "").startsWith("image/") && named !== "svg";
      if (picture && sniffed === null) {
        return { error: file + " isn't the image its name says." };
      }
      const ext = picture || named === "" ? sniffed ?? "bin" : named;
      await out.close();
      const name = hash.digest("hex").slice(0, 16) + "." + ext;
      fs.renameSync(tmp, mem.dir + MEDIA_DIR + name);
      await Disk.wrote(mem.dir + MEDIA_DIR + name);
      return { name };
    } finally {
      if (!done) {
        reader.cancel().catch(() => {});
      }
      await out.close().catch(() => {});
      fs.rmSync(tmp, { force: true });
      room.end();
    }
  }

  export function media_file(mem: Memory, name: string): string | null {
    const file = mem.dir + MEDIA_DIR + name;
    return STORED.test(name) && fs.existsSync(file) ? file : Memory.image_file(mem, name);
  }

  export function image_file(mem: Memory, name: string): string | null {
    const file = mem.dir + IMAGES + name;
    return /^[0-9a-f]{16}\.(png|jpeg|gif|webp)$/.test(name) && fs.existsSync(file) ? file : null;
  }

  export function images(mem: Memory, id: number): Img[] {
    const names = (Memory.message(mem, id)?.images ?? []).filter((name) => Memory.image_file(mem, name) !== null);
    return names.map((name) => {
      const fit = fs.existsSync(mem.dir + IMAGES + name + ".jpg");
      const data = fs.readFileSync(mem.dir + IMAGES + name + (fit ? ".jpg" : "")).toString("base64");
      return { type: fit ? "image/jpeg" : "image/" + name.split(".")[1], data };
    });
  }

  export function built(mem: Memory, l: number, i: number): boolean {
    return mem.nodes.has(Memory.slot(l, i));
  }

  export function node(mem: Memory, part: Part): string | null {
    const slot = Memory.slot(part.l, part.i);
    return mem.nodes.get(slot) ?? Memory.read(mem, "tree", slot)?.text ?? null;
  }

  export function roots(count: number): Part[] {
    const out: Part[] = [];
    for (let l = 30, id = 0; l >= 0; l--) {
      if (id + 2 ** l <= count) {
        out.push({ l, i: id / 2 ** l });
        id += 2 ** l;
      }
    }
    return out;
  }

  export function down(mem: Memory, part: Part, keys: Set<number> | null): Part[] {
    const key = Memory.slot(part.l, part.i);
    const text = Memory.node(mem, part);
    if (text !== null) {
      mem.nodes.set(key, text);
    }
    if (part.l === 0 || (text !== null && (keys === null || keys.has(key)))) {
      return [part];
    }
    return Memory.halves(part).flatMap((half) => Memory.down(mem, half, keys));
  }

  export function halves(part: Part): Part[] {
    return part.l === 0 ? [] : [{ l: part.l - 1, i: 2 * part.i }, { l: part.l - 1, i: 2 * part.i + 1 }];
  }

  export function source(mem: Memory, l: number, i: number): string | null {
    if (l === 0) {
      const root = Memory.message(mem, i);
      return root === null ? null : root.line ?? Memory.show(root);
    }
    const [a, b] = Memory.halves({ l, i }).map((half) => Memory.node(mem, half));
    return a === null || b === null ? null : Memory.flat(a) + "\n" + Memory.flat(b);
  }

  export function ctx(l: number, i: number): number {
    return l === 0 ? i : (i + 1) * 2 ** l;
  }

  export function first(mem: Memory, k = 0, side = 0): number {
    return (mem.ready[side][0] ?? [])[k] ?? mem.count;
  }

  export function unbuilt(mem: Memory, end: number): number {
    const queue = mem.ready[0][0] ?? [];
    const k = queue.findIndex((i) => i >= end);
    return k < 0 ? queue.length : k;
  }

  export function ready(mem: Memory, { l, i }: Part, on: boolean): void {
    const queue = (mem.ready[Memory.side(mem, l, i)][l] ??= []);
    let [a, z] = [0, queue.length];
    while (a < z) {
      const m = (a + z) >> 1;
      [a, z] = queue[m] < i ? [m + 1, z] : [a, m];
    }
    if (on !== (queue[a] === i)) {
      queue.splice(a, on ? 0 : 1, ...(on ? [i] : []));
    }
  }

  export function side(mem: Memory, l: number, i: number): number {
    const last = (i + 1) * 2 ** l - 1;
    const side = mem.sides.get(last) ?? (Memory.message(mem, last)?.imported === true ? 1 : 0);
    mem.sides.set(last, side);
    return side;
  }

  export function pump(mem: Memory): void {
    let built = false;
    for (let free = Memory.starts(mem); free.length > 0 && !mem.done; free = Memory.starts(mem)) {
      Memory.store(mem, free);
      built = true;
    }
    if (built) {
      Memory.fit(mem);
    }
  }

  export function starts(mem: Memory): Array<Part & { text: string }> {
    const free: Array<Part & { text: string }> = [];
    for (const side of [0, 1].filter((side) => mem.hold[side] === null)) {
      const end = Memory.first(mem, JOBS - 1, side);
      const next: Part[] = [];
      mem.ready[side].forEach((queue, l) => {
        for (let k = 0; k < queue.length && Memory.ctx(l, queue[k]) <= end; k++) {
          next.push({ l, i: queue[k] });
        }
      });
      next.sort((a, b) => Memory.ctx(a.l, a.i) - Memory.ctx(b.l, b.i) || b.l - a.l);
      for (const { l, i } of next) {
        if (mem.done || Memory.running(mem, side) >= JOBS) {
          break;
        }
        const text = mem.busy.has(Memory.slot(l, i)) ? null : Memory.source(mem, l, i);
        if (text !== null && Memory.bytes(text) <= NODE) {
          free.push({ l, i, text });
        } else if (text !== null) {
          Memory.job(mem, l, i, text);
        }
      }
    }
    return free;
  }

  export function pause(mem: Memory): void {
    mem.hold[1] = "paused";
    mem.calls.forEach((sum, call) => sum.kind === "import" && call.stop());
  }

  export function todo(mem: Memory, part: Part): Part[] {
    if (Memory.built(mem, part.l, part.i)) {
      return [];
    }
    const halves = Memory.halves(part);
    const here = halves.every((half) => Memory.built(mem, half.l, half.i)) ? [part] : [];
    return [...here, ...halves.flatMap((half) => Memory.todo(mem, half))];
  }

  export function running(mem: Memory, side: number): number {
    return [...mem.busy.values()].filter((n) => n === side).length;
  }

  export function job(mem: Memory, l: number, i: number, text: string): void {
    const key = Memory.slot(l, i);
    mem.busy.set(key, Memory.side(mem, l, i));
    Memory.build(mem, l, i, text).finally(() => {
      mem.busy.delete(key);
      Memory.pump(mem);
      Memory.fit(mem);
    }).catch((err: unknown) => {
      console.error("compactor: node " + l + "/" + i + ": " + err_why(err));
    });
  }

  export function stop(mem: Memory): void {
    mem.done = true;
    mem.calls.forEach((_, call) => call.stop());
    mem.fds.forEach((fd) => fs.closeSync(fd));
    mem.fds.clear();
  }

  export async function build(mem: Memory, l: number, i: number, text: string): Promise<void> {
    const task = { text: Memory.task(l, i) + text + "\n</input>", mark: false };
    const upto = Math.min(Memory.ctx(l, i), Memory.first(mem, 0, Memory.side(mem, l, i)));
    const blocks = [...Memory.view(mem, upto, Memory.last(mem, Memory.before(mem.seen.parts, upto), config.COMPACTOR_CONTEXT)), task];
    const lines: string[] = [];
    let end = await Memory.compact(mem, l, i, Memory.ask(mem, l, i, blocks));
    while (end.ok && end.text.trim() !== "") {
      const line = end.text.trim();
      lines.push(line);
      if (Memory.bytes(line) <= NODE || lines.length === TRIES || mem.done) {
        break;
      }
      const note = { text: Memory.over(line), mark: false };
      end = await Memory.compact(mem, l, i, Memory.ask(mem, l, i, [...blocks, note]));
    }
    if (lines.length === 0 && !end.ok && end.stop !== "fail") {
      throw new Error(end.text);
    }
    if (lines.length === 0) {
      console.error("compactor: node " + l + "/" + i + ": " + (end.ok ? "an empty line" : end.text) + "; clipped");
    }
    const line = lines.length === 0 ? Memory.cut(Memory.flat(text)) : lines.reduce((a, b) => (Memory.bytes(b) < Memory.bytes(a) ? b : a));
    Memory.store(mem, [{ l, i, text: line }]);
  }

  export function served(mem: Memory, l: number, i: number): Served {
    return Memory.side(mem, l, i) === 1 ? "import" : "compactor";
  }

  export function store(mem: Memory, parts: Array<Part & { text: string }>): void {
    Memory.log(mem, "tree", parts.map(({ l, i, text }) => ({ l, i, text, size: Memory.bytes(text) })));
    for (const { l, i, text } of parts) {
      Memory.ready(mem, { l, i }, false);
      mem.nodes.set(Memory.slot(l, i), text);
      mem.sides.delete((i + 1) * 2 ** l - 1);
      [mem.view, mem.seen].forEach((view) => (view.size += l === 0 && i < Memory.end(view) ? Memory.bytes(text) : 0));
    }
    for (const { l, i } of parts) {
      const up = { l: l + 1, i: i >> 1 };
      if (Memory.built(mem, l, i ^ 1) && !Memory.built(mem, up.l, up.i)) {
        Memory.ready(mem, up, true);
      }
    }
    parts.forEach(({ l, i }) => mem.made?.(l, i));
  }

  export function ask(mem: Memory, l: number, i: number, blocks: Block[]): Call {
    const own = Memory.served(mem, l, i) === "compactor";
    const repick = () => Pick.ask(config.COMPACTOR);
    const told: { again: Again | null } = { again: null };
    return AskAI.ask({ ...mem.share(), ...repick(), blocks, patient: true, repick, yields: own ? undefined : mem.dir, who: own ? "compactor" : "import" }, (ev) => Memory.heard(mem, own, ev, told));
  }

  export function heard(mem: Memory, own: boolean, ev: Event, told: { again: Again | null }): void {
    const failed = ev.$ === "Again" ? ev.again : null;
    if (failed !== null) {
      const now = Date.now();
      const line = (own ? "compactor: " : "compactor (import): ") + failed.why.slice(0, 300).replace(/\.$/, "");
      FAILED.forEach((at, seen) => now - at >= LOGGED && FAILED.delete(seen));
      if (!FAILED.has(line)) {
        FAILED.set(line, now);
        console.error(line + "; asking again " + (failed.limit ? "at " + new Date(failed.until).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "in " + Math.ceil((failed.until - now) / 60e3) + " min"));
      }
    }
    const answered = ev.$ === "Delta" || (ev.$ === "Entry" && ev.kind !== "mind");
    const asks = ev.$ === "Again" && failed === null && mem.again === told.again;
    const again = failed ?? (asks || answered ? null : mem.again);
    if (ev.$ === "Again") {
      told.again = failed;
    }
    if (own && again !== mem.again) {
      mem.again = again;
      mem.wait.forEach((check) => check());
    }
  }

  export function compact(mem: Memory, l: number, i: number, call: Call): Call["done"] {
    mem.calls.set(call, { l, i, kind: Memory.served(mem, l, i) });
    return call.done.finally(() => mem.calls.delete(call));
  }

  export function task(l: number, i: number): string {
    const [a, z] = Memory.span({ l, i });
    const n = 2 ** l / 2;
    const fill: Array<[string, string]> = [["{a}", a + "+" + n], ["{b}", a + n + "+" + n], ["{id}", String(a)], ["{end}", String(z)]];
    return fill.reduce((t, [k, v]) => t.replace(k, v), l === 0 ? LEAF : MERGE);
  }

  export function cut(text: string): string {
    return Buffer.from(text, "utf8").subarray(0, NODE).toString("utf8").replace(/\uFFFD+$/, "");
  }

  export function over(line: string): string {
    return `Too long: your last line for this <input> was ${Memory.bytes(line)} bytes,
over the ${NODE}-byte limit. Write the whole line again, cutting just
enough of the least valuable items to fit before this cut:
${Memory.cut(line)}| ← LIMIT`;
  }

  export function text(mem: Memory, part: Part): string {
    return mem.nodes.get(Memory.slot(part.l, part.i)) ?? WAIT;
  }

  export function size(mem: Memory, part: Part): number {
    return Memory.built(mem, part.l, part.i) ? Memory.bytes(Memory.text(mem, part)) : 0;
  }

  export function fit(mem: Memory, next = false): void {
    const gone: Part[] = [];
    let changed = false;
    const sides = [0, 1].filter((side) => mem.hold[side] === null).map((side) => Memory.first(mem, 0, side));
    mem.seen.high = config.COMPACTOR_CONTEXT;
    Memory.reach(mem, mem.view, mem.count);
    Memory.reach(mem, mem.seen, Math.min(mem.count, ...sides));
    for (const view of [mem.view, mem.seen]) {
      const [parts, batch] = [view.parts.length, view.batch];
      if (view.size > view.high || (next && view.batch)) {
        const merged = Memory.merge(mem, view);
        if (next || merged.size <= Math.max(view.high / 2, view.size - view.high)) {
          [view.parts, view.size] = [merged.parts, merged.size];
          gone.push(...merged.gone);
        }
        view.batch = view.size > view.high / 2;
      }
      changed ||= view.parts.length !== parts || view.batch !== batch;
    }
    gone.filter((part) => !Memory.held(mem, part)).forEach((part) => mem.nodes.delete(Memory.slot(part.l, part.i)));
    if (changed) {
      Memory.save(mem);
    }
    mem.wait.forEach((check) => check());
  }

  export function reach(mem: Memory, view: View, end: number): void {
    for (const part of view.parts.splice(Memory.cover(view, end))) {
      view.size -= Memory.size(mem, part);
    }
    for (let i = Memory.end(view); i < end; i++) {
      view.parts.push({ l: 0, i });
      view.size += Memory.size(mem, { l: 0, i });
    }
  }

  export function end({ parts }: View): number {
    return parts.length === 0 ? 0 : Memory.span(parts[parts.length - 1])[1] + 1;
  }

  export function cover({ parts }: View, id: number): number {
    let [a, z] = [0, parts.length];
    while (a < z) {
      const m = (a + z) >> 1;
      [a, z] = Memory.span(parts[m])[1] < id ? [m + 1, z] : [a, m];
    }
    return a;
  }

  export function held(mem: Memory, part: Part): boolean {
    return [mem.view, mem.seen].some((view) => {
      const k = Memory.cover(view, Memory.span(part)[0]);
      return k === view.parts.length || view.parts[k].l <= part.l;
    });
  }

  export function merge(mem: Memory, from: View): { parts: Part[]; size: number; gone: Part[] } {
    const [t, low] = [Memory.end(from), from.high / 2];
    const view: Array<Part | null> = [...from.parts];
    const gone: Part[] = [];
    const next = view.map((_, k) => k + 1);
    const prev = view.map((_, k) => k - 1);
    const heap: Array<{ d: number; k: number; a: Part; b: Part }> = [];
    const over = (x: (typeof heap)[0], y: (typeof heap)[0]) => x.d > y.d || (x.d === y.d && x.k < y.k);
    const swap = (x: number, y: number) => ([heap[x], heap[y]] = [heap[y], heap[x]]);
    const offer = (k: number) => {
      const [a, b] = [view[k], view[next[k]]];
      if (k < 0 || !a || !b || a.i % 2 !== 0 || b.l !== a.l || b.i !== a.i + 1 || !Memory.built(mem, a.l + 1, a.i / 2)) {
        return;
      }
      heap.push({ d: (t + 1) / 2 ** a.l - a.i, k, a, b });
      for (let x = heap.length - 1; x > 0 && over(heap[x], heap[(x - 1) >> 1]); x = (x - 1) >> 1) {
        swap(x, (x - 1) >> 1);
      }
    };
    const take = () => {
      const top = heap[0];
      const last = heap.pop();
      if (last !== undefined && heap.length > 0) {
        heap[0] = last;
        for (let x = 0; ; ) {
          const m = [x, 2 * x + 1, 2 * x + 2].reduce((m, c) => (c < heap.length && over(heap[c], heap[m]) ? c : m));
          if (m === x) {
            break;
          }
          swap(x, m);
          x = m;
        }
      }
      return top;
    };
    let size = from.size;
    view.forEach((_, k) => offer(k));
    while (heap.length > 0 && size > low) {
      const { k, a, b } = take();
      const j = next[k];
      if (view[k] !== a || view[j] !== b) {
        continue;
      }
      const up = { l: a.l + 1, i: a.i / 2 };
      size += Memory.size(mem, up) - Memory.size(mem, a) - Memory.size(mem, b);
      [view[k], view[j]] = [up, null];
      next[k] = next[j];
      prev[next[j]] = k;
      gone.push(a, b);
      offer(prev[k]);
      offer(k);
    }
    return { parts: view.filter((part) => part !== null), size, gone };
  }

  export function settle(mem: Memory, end: number, signal: AbortSignal): Promise<string | null> {
    return new Promise((resolve) => {
      const check = () => {
        const built = Memory.first(mem) >= end;
        const why = signal.aborted ? "Stopped." : built ? null : mem.hold[0];
        if (built || why !== null) {
          mem.wait.delete(check);
          signal.removeEventListener("abort", check);
          resolve(why);
        }
      };
      mem.wait.add(check);
      signal.addEventListener("abort", check);
      check();
    });
  }

  export function span(part: Part): [number, number] {
    const a = part.i * 2 ** part.l;
    return [a, a + 2 ** part.l - 1];
  }

  export function flat(text: string): string {
    if (!text.includes("\n")) {
      return text;
    }
    return text.replace(/\s*\n\s*/g, " ");
  }

  export function ref(part: Part): string {
    return part.i * 2 ** part.l + "+" + 2 ** part.l;
  }

  export function line(part: Part, text: string): string {
    return Memory.ref(part) + "|" + Memory.flat(text);
  }

  export function before(view: Part[], end: number): Part[] {
    return view.filter((part) => Memory.span(part)[1] < end);
  }

  export function last(mem: Memory, parts: Part[], most: number): Part[] {
    let [k, size] = [parts.length, 0];
    for (; k > 0; k--) {
      const part = parts[k - 1];
      const n = Memory.built(mem, part.l, part.i) ? Memory.bytes(Memory.line(part, Memory.text(mem, part))) + 1 : 0;
      if (size + n > most) {
        break;
      }
      size += n;
    }
    return parts.slice(k);
  }

  export function view(mem: Memory, end = mem.count, parts = mem.view.parts, talk: number | null = null, back = -1): Block[] {
    const lines = talk === null ? Memory.before(parts, end).filter((part) => Memory.built(mem, part.l, part.i)).map((part) => Memory.line(part, Memory.text(mem, part)) + "\n") : Memory.talking(mem, end, parts, talk);
    const whole = Math.floor(lines.length / BLOCK);
    const blocks: Block[] = [{ text: "<chat>\n", mark: whole === 0 }];
    for (let k = 0; k < whole; k++) {
      blocks.push({ text: lines.slice(k * BLOCK, (k + 1) * BLOCK).join(""), mark: k === whole - 1, ...(k === back && k < whole - 1 ? { back: true } : {}) });
    }
    blocks.push({ text: lines.slice(whole * BLOCK).join("") + "</chat>\n", mark: false });
    return blocks;
  }

  export function talking(mem: Memory, end: number, parts: Part[], talk: number): string[] {
    const before = parts.flatMap((part) => Memory.upto(mem, part, Math.min(talk, end)));
    const lines = before.flatMap((part) => {
      const text = Memory.node(mem, part);
      return text === null ? [] : [Memory.line(part, text) + "\n"];
    });
    const said = Array.from({ length: Math.max(0, end - talk) }, (_, k) => Memory.talk_line(mem, talk + k) + "\n");
    return [...lines, TALKING.replace("{id}", String(talk)) + "\n", ...said];
  }

  export function upto(mem: Memory, part: Part, end: number): Part[] {
    const [a, z] = Memory.span(part);
    if (a >= end) {
      return [];
    }
    if (z < end && (part.l === 0 || Memory.node(mem, part) !== null)) {
      return [part];
    }
    return Memory.halves(part).flatMap((half) => Memory.upto(mem, half, end));
  }

  export function said(root: Root): boolean {
    return (root.kind === "user" || root.kind === "unii") && !root.imported;
  }

  export function talk_line(mem: Memory, i: number): string {
    const root = Memory.at(mem, i);
    const part = { l: 0, i };
    return Memory.said(root) ? Memory.ref(part) + "|" + Memory.show(root).replace(/<\/chat>/gi, "<\\/chat>") : Memory.line(part, Memory.node(mem, part) ?? WAIT);
  }

  export function talk_room(window: number): number {
    return (window * TOKEN * 3) / 4 - HIGH;
  }

  export function talk_size(mem: Memory, end = mem.count): number {
    let size = 0;
    for (let i = mem.talk ?? end; i < end; i++) {
      let n = mem.talked.get(i);
      if (n === undefined) {
        const done = Memory.said(Memory.at(mem, i)) || Memory.node(mem, { l: 0, i }) !== null;
        n = done ? Memory.bytes(Memory.talk_line(mem, i)) + 1 : NODE + 16;
        if (done) {
          mem.talked.set(i, n);
        }
      }
      size += n;
    }
    return size;
  }

  export function talk_from(mem: Memory): number {
    for (let i = mem.count - 1; i >= 0; i--) {
      if (Memory.said(Memory.at(mem, i))) {
        while (i > 0 && Memory.at(mem, i - 1).more) {
          i--;
        }
        return i;
      }
    }
    return mem.count;
  }

  export function part(mem: Memory, id: number, n: number): Part | null {
    const l = Math.log2(n);
    const ok = Number.isInteger(id) && Number.isInteger(l) && id >= 0 && id % n === 0 && id + n <= mem.count;
    return ok ? { l, i: id / n } : null;
  }

  export function zoom(mem: Memory, id: number, n: number, at: number): string {
    const part = Memory.part(mem, id, n);
    const root = n === 1 ? Memory.message(mem, id) : null;
    if (part === null) {
      const roots = Memory.roots(mem.count).map((root) => Memory.ref(root)).join(", ");
      return "No line " + id + "+" + n + ": n is a power of 2, id a multiple of n. The tree's roots: " + roots + ".";
    }
    if (root !== null) {
      const images = at === 0 ? root.images : undefined;
      return id + "+0|" + Memory.show({ ...root, text: clip_page(root.text, at), images });
    }
    return Memory.halves(part).map((half) => Memory.line(half, Memory.node(mem, half) ?? WAIT)).join("\n");
  }

  export function date(mem: Memory, id: number): string {
    const root = Memory.message(mem, id);
    return root === null ? "No message " + id + "." : new Date(root.date).toLocaleString("sv-SE");
  }

  export function turn(mem: Memory): number {
    const whole = mem.view.parts.slice(mem.view.parts.findLastIndex((part) => part.l > 0) + 1);
    const user = whole.findLast((part) => ["user", "work"].includes(Memory.message(mem, part.i)?.kind ?? ""));
    return (user ?? whole[0])?.i ?? mem.count;
  }

  export function levels(mem: Memory): number[] {
    return Array.from({ length: mem.count.toString(2).length }, (_, l) => l);
  }

  export function* level(mem: Memory, l: number): Generator<[Part, string]> {
    for (let i = 0; (i + 1) * 2 ** l <= mem.count; i++) {
      const text = Memory.node(mem, { l, i });
      if (text !== null) {
        yield [{ l, i }, text];
      }
    }
  }

  export function* dump(mem: Memory): Generator<string> {
    const ls = (sub: string) => (fs.existsSync(mem.dir + sub) ? fs.readdirSync(mem.dir + sub).sort() : []);
    let sep = "\n";
    yield '{"messages": [';
    for (let i = 0; i < mem.count; i++) {
      const { kind, text, date, images, more, of, tool } = Memory.at(mem, i);
      yield (i === 0 ? "\n" : ",\n") + JSON.stringify({ id: i, kind, text, date, images, more, of, tool });
    }
    yield '],\n"summaries": [';
    for (const l of Memory.levels(mem)) {
      for (const [part, text] of Memory.level(mem, l)) {
        yield sep + JSON.stringify({ id: Memory.span(part)[0], n: 2 ** l, text });
        sep = ",\n";
      }
    }
    yield '],\n"agents": {';
    sep = "\n";
    for (const name of ls(AGENTS).map((file) => file.replace(/\.jsonl$/, ""))) {
      const log = Memory.agent(mem, name);
      if (log === null) {
        continue;
      }
      const entries = log.map(({ i, kind, text, date, of, tool }) => ({ id: i, kind, text, date, of, tool }));
      yield sep + JSON.stringify(name) + ": " + JSON.stringify(entries);
      sep = ",\n";
    }
    yield '},\n"images": {';
    sep = "\n";
    for (const name of ls(IMAGES)) {
      const file = Memory.image_file(mem, name);
      if (file === null) {
        continue;
      }
      yield sep + JSON.stringify(name) + ': "';
      for (let at = 0, size = fs.statSync(file).size; at < size; at += 3 * PIECE) {
        yield Memory.slice(file, at, 3 * PIECE).toString("base64");
      }
      yield '"';
      sep = ",\n";
    }
    yield "}}\n";
  }

  export function meta(mem: Memory): { count: number; has: string[]; parts: [number, number][]; view: { h: string; t: string }[] } {
    const index = Memory.pread(Memory.fd(mem, mem.dir + "/tree.index"), 0, 2 * mem.count * SLOT);
    const built = (at: number) => at + SLOT <= index.length && index.readUInt32LE(at + 8) !== 0;
    const has = Memory.levels(mem).map((l) => Array.from({ length: Math.floor(mem.count / 2 ** l) }, (_, i) => (built(Memory.slot(l, i) * SLOT) ? 1 : 0)).join(""));
    const view = mem.view.parts.map((part) => Memory.card(mem, part.l, part.i) ?? { h: "LVL" + part.l + " #" + part.i, t: WAIT });
    return { count: mem.count, has, parts: mem.view.parts.map((part) => [part.l, part.i]), view };
  }

  export function card(mem: Memory, l: number, i: number): { h: string; t: string; k?: string } | null {
    const root = l === -1 ? Memory.message(mem, i) : null;
    const part = Number.isInteger(l) && l >= 0 ? Memory.part(mem, i * 2 ** l, 2 ** l) : null;
    const text = root?.text ?? (part && Memory.node(mem, part));
    if (typeof text !== "string") {
      return null;
    }
    const [a, b] = part === null ? [i, i] : Memory.span(part);
    const when = Memory.date(mem, a) + (a === b ? "" : " – " + Memory.date(mem, b));
    const head = root === null ? ["LVL" + l + " #" + a + (a === b ? "" : "-" + b), when, Memory.bytes(text) + " B"] : ["ROOT #" + i, when, root.kind, root.size + " B"];
    return { h: head.join(" · "), t: text, k: root?.kind };
  }

  export function agent(mem: Memory, name: string): Root[] | null {
    const file = mem.dir + AGENTS + name + ".jsonl";
    return /^[A-Za-z-]+$/.test(name) && fs.existsSync(file) ? Memory.file(file) : null;
  }

  export function agent_new(mem: Memory): string {
    const name = names.name_random();
    fs.mkdirSync(mem.dir + AGENTS, { recursive: true });
    try {
      fs.writeFileSync(mem.dir + AGENTS + name + ".jsonl", "", { flag: "wx" });
    } catch (err) {
      if (err_code(err) === "EEXIST") {
        return Memory.agent_new(mem);
      }
      throw err;
    }
    mem.agents.set(name, 0);
    return name;
  }

  export function agent_push(mem: Memory, name: string, kind: Kind, text: string, pair: Pair = {}): number {
    const n = mem.agents.get(name) ?? Memory.agent(mem, name)?.length ?? 0;
    const root = Memory.root(n, { kind, text, ...pair });
    Memory.append(mem.dir + AGENTS + name + ".jsonl", [JSON.stringify(root)]);
    mem.agents.set(name, n + 1);
    return root.i;
  }

  export function agent_show(mem: Memory, name: string): string {
    return Memory.agent(mem, name)?.map(Memory.agent_line).join("\n\n") ?? "No agent " + name + ".";
  }

  export function agent_line(root: Root): string {
    return root.i + "|" + Memory.show(root);
  }

}
