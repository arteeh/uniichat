// Import
// ======
// A person's past Claude and ChatGPT chats (APPS), read into their chat:
// those on their computer (Claude Code's and Codex's logs), by the
// terminal (Term.ts `/import`) or a folder picked on the site (main.ts),
// and those on the websites, from the zip each mails on request
// (import_export). A session (a log; a site's chat) is streamed twice:
// for its messages' heads (the count and the estimate), then the heads
// picked (Want) as JSON lines (import_body): a note, then its messages
// (pages), oldest first; never thinking. Its summaries run on the
// compactor (Config.ts COMPACTOR). A session imported before (import_key)
// brings only its new messages.
//
// A run's progress is weighed by its plan (import_guess): each node whose
// source is over NODE takes a call, weighed by its cost as measured on
// the compactor (PRICE), which goes as its time.

import type { Kind } from "./AskAI.ts";
import { clip_pages, stream_lines } from "./Clip.ts";

// Types
// =====

// a message (a page) as imported: its date ISO, whether the next goes on
// with its text
export type Msg = { kind: Kind; text: string; date: string; more?: boolean };

// a message as the count and the estimate read it: its size, import_size;
// its place in its session
export type Head = { kind: Kind; date: string; size: number; n: number };

// how a session's file reads: a log (Claude Code's or Codex's, told by
// its first line), or its messages as JSON lines (a site's chat)
export type Form = "log" | "msgs";

// a session: its app (APPS), its form, where it was (a log: "session in
// <cwd>"; a site's chat: 'chat "<title>"'), its first message's date,
// its file, its messages' heads
export type Session = { app: string; form: Form; where: string; start: string; file: Blob; heads: Head[] };

// the sessions imported before, by import_key: their last message's date
export type Done = Record<string, string>;

// what an import takes: the sessions read but those left out (off:
// import_id), the messages from a day on ("": all), tool calls or not
export type Want = { off: string[]; since: string; tools: boolean };

// an import: the sessions as wanted but for off, those picked, their
// messages, the first new message's day ("": none), their sizes
export type Plan = { sessions: Session[]; picked: Session[]; msgs: number; first: string; sizes: number[] };

// a node as the estimate sees it: its source's bytes, and the summaries
// under it (0: its source is messages as they are)
export type Node = { bytes: number; depth: number };

// Constants
// =========

// Memory's NODE
const NODE = 512;

// a summary's bytes (the compactor writes 460-510)
const LINE = 480;

// what a compaction call costs on the compactor (Config.ts COMPACTOR, its
// view of up to COMPACTOR_CONTEXT), in micro-USD: base, `byte` a doubling of its source past
// NODE, `depth` a summary under it (its own too); no view term: the view
// is read from cache, and a view term fit here takes a negative base; fit
// on 5,617 compaction calls of real imports
const PRICE = { base: 187, byte: 735, depth: 628 };

// what import_body yields at least (characters): the site keeps each as a
// Blob, on disk when large, so a page never holds an import whole
const PART = 2 ** 20;

// the apps a session is of: two sources, each its program on the
// computer and its website
export const APPS = ["Claude", "ChatGPT"];

// sessions all imported before
export const OLD = "Nothing new: these chats are in Unii's memory already.";

// a file given as a site's export that is none (import_export)
const NOT_EXPORT = "Not a Claude or ChatGPT export.";

// what a message sent while an import runs does (Memory.settle)
export const MIDWAY = "Meanwhile, UniiChat can answer with a partial tree.";

// an import's end, as it went
export const DONE = "Your past chats are in Unii's memory: ask about them any time.";

// a session's day and count as listed (import_cells), made once
const DAY   = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
const COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });

// where each app's website gives its export, a zip it emails (said where
// one is taken)
export const EXPORTS: Record<string, string> = { Claude: "Settings › Privacy › Export data", ChatGPT: "Settings › Data controls › Export data" };

const INJECTED = /^(<[a-z_]+[ >]|# AGENTS\.md)/;

const SKIP = /^(<command-|<local-command|\[Request interrupted)/;

// Import
// ======

// a path the import reads: a session's file
export function import_file(path: string): boolean {
  const session = /(^|\/)(projects|sessions|archived_sessions)\//.test(path);
  return session && path.endsWith(".jsonl") && !path.includes("subagents/");
}

// a session's file read for its heads (a log's app and where are told by
// its lines); null: no messages
export async function import_session(file: Blob, form: Form, app = "", where = ""): Promise<Session | null> {
  const s: Session = { app, form, where, start: "", file, heads: [] };
  for await (const m of import_read(s)) {
    s.heads.push({ kind: m.kind, date: m.date, size: import_size(m), n: s.heads.length });
  }
  s.start = s.heads[0]?.date ?? "";
  return s.heads.length > 0 ? s : null;
}

// a session's messages, its file read a line at a time
export async function* import_read(s: Session): AsyncGenerator<Msg> {
  let date = "";
  for await (const lines of stream_lines(s.file.stream())) {
    for (const line of lines) {
      const msgs = line_msgs(s, line, date);
      date = msgs.at(-1)?.date ?? date;
      yield* msgs;
    }
  }
}

// a log's line: a Codex log (first line session_meta) is a ChatGPT
// session, a Claude Code log a Claude one
function line_log(s: Session, j: any, last: string): Msg[] {
  s.app ||= j.type === "session_meta" ? "ChatGPT" : "Claude";
  return s.app === "ChatGPT" ? line_codex(s, j, last) : line_claude(s, j, last);
}

// a line's messages; none if it is no JSON, or JSON of a shape its reader
// can't take (a log is another app's file: one odd line, a null, a bad
// date, never fails its session, nor the import of all the others)
function line_msgs(s: Session, line: string, last: string): Msg[] {
  try {
    const j = JSON.parse(line);
    return s.form === "msgs" ? [j] : line_log(s, j, last);
  } catch {
    return [];
  }
}

// the sessions oldest first, with the heads kept only
function import_pick(sessions: Session[], want: Want, done: Done): Session[] {
  const old  = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  const keep = (m: Head, last?: string) => (want.tools || m.kind === "user" || m.kind === "unii") && m.date >= want.since && import_new(m, last);
  const kept = (s: Session, last?: string) => s.heads.filter((m) => keep(m, last));
  return old.map((s) => ({ ...s, heads: kept(s, done[import_id(s)]) })).filter((s) => s.heads.length > 0);
}

// the sessions found, as an import
export function import_plan(sessions: Session[], want: Want, done: Done): Plan {
  const all    = import_pick(sessions, { ...want, since: "" }, done);
  const shown  = import_pick(all, want, {});
  const picked = shown.filter((s) => !want.off.includes(import_id(s)));
  const first  = all.map((s) => s.heads[0].date).sort()[0] ?? "";
  const sizes  = picked.flatMap((s) => [import_size(import_note(s)), ...s.heads.map((m) => m.size)]);
  return { sessions: shown, picked, msgs: sizes.length - picked.length, first: first.slice(0, 10), sizes };
}

// whether a message of a session imported up to `last` (none: never) is
// new: dated after it
export function import_new(m: { date?: string }, last: string | undefined): boolean {
  return last === undefined || (m.date ?? "") > last;
}

// a session: the app, where, when
function import_name(s: Session): string {
  return s.app + " " + s.where + ", from " + new Date(s.start).toLocaleString("sv-SE").slice(0, 16);
}

// a session as listed to pick, under its app, in columns of one width
// each: its day, its messages at a glance, where (a folder short, a
// chat's title): ["Oct 07, 2026", "12k", "~/code/…/app/src"]
export function import_cells(s: Session): string[] {
  const day   = DAY.format(new Date(s.start));
  const where = s.where.startsWith("session in ") ? path_short(s.where.slice(11)) : s.where.replace(/^chat "(.*)"$/, "$1") || "untitled";
  return [day, count_short(s.heads.length), where];
}

// a session as one line ("Oct 07, 2026 · 34 · ~/code/…/app/src")
export function import_line(s: Session): string {
  return import_cells(s).join(" · ");
}

// a count in at most 4 characters: 999, 12k, 3m
function count_short(n: number): string {
  return COUNT.format(n).toLowerCase();
}

// a folder as read at a glance: home as ~, and past three folders the
// first and the last two, the middle as … ("~/code/…/app/src")
export function path_short(path: string): string {
  const parts = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").split("/");
  const head  = parts[0] === "" ? 2 : 1;
  return parts.length - head > 3 ? [...parts.slice(0, head + 1), "…", ...parts.slice(-2)].join("/") : parts.join("/");
}

// a session as it opens
function import_note(s: Session): Msg {
  return { kind: "note", text: import_name(s) + " (imported)", date: s.start };
}

// a session's name in Done (its note's) and in Want.off
export function import_id(s: Session): string {
  return import_key(import_note(s));
}

// a session's name in Done: its note's date and where (its text less the
// app's name, whatever it was, and the time: the date's, in the zone of
// whoever imported it, so another zone named every session anew)
export function import_key(note: { text: string; date?: string }): string {
  return note.date + " " + note.text.replace(/^.*?(?= session in | chat ")/, "").replace(/, from [^,]*$/, "");
}

// the sessions picked, each its note, then its heads' messages, as JSON
// lines, read again from its file, a PART at least at a time
export async function* import_body(picked: Session[]): AsyncGenerator<string> {
  let part = "";
  for (const s of picked) {
    const kept = new Set(s.heads.map((m) => m.n));
    let n = 0;
    part += JSON.stringify(import_note(s)) + "\n";
    for await (const m of import_read(s)) {
      part += kept.has(n++) ? JSON.stringify(m) + "\n" : "";
      if (part.length >= PART) {
        yield part;
        part = "";
      }
    }
  }
  yield part;
}

// by level, what each node of messages of these sizes appended to a chat
// of `a` costs (micro-USD): the import's nodes (their last message its:
// Memory.ts), each its node_usd; a leaf's source is its message, a
// merge's its two children's lines (node_line; a chat's own older one, a
// summary as deep as it)
export function import_guess(a: number, sizes: number[]): number[][] {
  const usd: number[][] = [];
  let nodes: Node[] = sizes.map((bytes) => ({ bytes, depth: 0 }));
  for (let l = 0, i = a; nodes.length > 0; l++, i = Math.floor(i / 2)) {
    usd.push(nodes.map(node_usd));
    const line = (k: number) => (k < 0 ? { bytes: LINE, depth: l } : node_line(nodes[k]));
    const from = Math.floor(i / 2);
    nodes = Array.from({ length: Math.floor((i + nodes.length) / 2) - from }, (_, j) => node_merge(line(2 * (from + j) - i), line(2 * (from + j) + 1 - i)));
  }
  return usd;
}

// a message's bytes as summarized
export function import_size(m: { kind: Kind; text: string }): number {
  return new TextEncoder().encode(m.kind + ": " + m.text).length;
}

// "1 message", "2,048 new messages" (what: "new ")
export function import_count(n: number, what: string): string {
  return n.toLocaleString("en-US") + " " + what + (n === 1 ? "message" : "messages");
}

// Node
// ====

// a node's cost (micro-USD, whole): none if its source fits, else a
// call's (PRICE)
function node_usd(node: Node): number {
  if (node.bytes <= NODE) {
    return 0;
  }
  const { base, byte, depth } = PRICE;
  return Math.round(base + byte * Math.log2(node.bytes / NODE) + depth * (node.depth + 1));
}

// a node's line: its source if it fits, else a summary one deeper
function node_line(node: Node): Node {
  return node.bytes > NODE ? { bytes: LINE, depth: node.depth + 1 } : { bytes: node.bytes, depth: 0 };
}

// two lines merged: a node over both (and the newline between)
function node_merge(a: Node, b: Node): Node {
  return { bytes: a.bytes + 1 + b.bytes, depth: Math.max(a.depth, b.depth) };
}

// Export
// ======

// a site's export, its zip (conversations.json in it) or that file alone,
// as sessions, one a chat: ChatGPT's (a tree, `mapping`) or Claude's
// (`chat_messages`); a file not a list of those is no export
export async function import_export(file: Blob): Promise<Session[]> {
  const zip  = (await file.slice(0, 2).text()) === "PK";
  const json = zip ? await zip_file(file, "conversations.json") : file;
  if (json === null) {
    throw new Error("No conversations.json in the zip.");
  }
  const chats = await json.text().then(JSON.parse).catch(() => null);
  if (!Array.isArray(chats) || !chats.every((chat) => chat?.mapping !== undefined || Array.isArray(chat?.chat_messages))) {
    throw new Error(NOT_EXPORT);
  }
  const sessions = await Promise.all(chats.map(chat_session));
  return sessions.filter((s) => s !== null);
}

// a chat as a session: its messages as JSON lines, its title as where
function chat_session(chat: any): Promise<Session | null> {
  const [app, msgs] = chat.mapping ? ["ChatGPT", chat_openai(chat)] : ["Claude", chat_claude(chat)];
  const file = new Blob(msgs.map((m) => JSON.stringify(m) + "\n"));
  return import_session(file, "msgs", app, 'chat "' + String(chat.title ?? chat.name ?? "") + '"');
}

// a ChatGPT chat's messages: its thread shown, current_node up to the
// root (an edit or a retry leaves its old branch); a person's say,
// ChatGPT's, what it sent a tool (recipient) as a call, a tool's output
// as an echo; never thoughts, nor a hidden one
function chat_openai(chat: any): Msg[] {
  const nodes: any[] = [];
  for (let id = chat.current_node; id; id = chat.mapping[id]?.parent) {
    nodes.unshift(chat.mapping[id]?.message);
  }
  let date = import_date(chat.create_time, "");
  return nodes.flatMap((m) => {
    const role = m?.author?.role;
    const type = String(m?.content?.content_type);
    const kind = role === "user" ? "user" : role === "assistant" ? (m.recipient === "all" ? "unii" : "tool") : role === "tool" ? "echo" : null;
    const skip = kind === null || m.metadata?.is_visually_hidden_from_conversation === true || type === "thoughts" || type === "reasoning_recap";
    date = import_date(m?.create_time, date);
    return skip ? [] : msgs_of(kind, (kind === "tool" ? m.recipient + " " : "") + parts_text(m.content.parts ?? [m.content.text]), date);
  });
}

// a Claude website chat's messages, in order: a person's say (its texts and
// its files' names), Claude's, their tool calls and results (Claude's
// blocks, as Claude Code's); never thinking
function chat_claude(chat: any): Msg[] {
  let date = import_date(chat.created_at, "");
  return (chat.chat_messages ?? []).flatMap((m: any) => {
    date = import_date(m.created_at, date);
    const kind   = m.sender === "human" ? "user" : "unii";
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.text ?? "") }];
    const files  = [...(m.attachments ?? []), ...(m.files ?? [])].map((f: any) => ({ type: "text", text: "[file " + f.file_name + "]" }));
    return blocks_msgs(kind, [...blocks, ...files], date);
  });
}

// Zip
// ===

// a zip's file by name (at any depth), read without the rest: its entry
// in the central directory at the zip's end, then its data, inflated
// (DecompressionStream) if deflated; null: none such. A ZIP64 (over 4 GB,
// or 65,535 files) says where its directory is in its own end record,
// found by the locator right before the classic one
export async function zip_file(zip: Blob, name: string): Promise<Blob | null> {
  const view = async (at: number, n: number) => new DataView(await zip.slice(at, at + n).arrayBuffer());
  const back = Math.min(zip.size, 65577);
  const tail = await view(zip.size - back, back);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) {
    end -= 1;
  }
  if (end < 0) {
    return null;
  }
  const wide = end >= 20 && tail.getUint32(end - 20, true) === 0x07064b50;
  const z64  = wide ? await view(Number(tail.getBigUint64(end - 12, true)), 56) : null;
  const count = z64 === null ? tail.getUint16(end + 10, true) : Number(z64.getBigUint64(32, true));
  const size  = z64 === null ? tail.getUint32(end + 12, true) : Number(z64.getBigUint64(40, true));
  const from  = z64 === null ? tail.getUint32(end + 16, true) : Number(z64.getBigUint64(48, true));
  const dir   = await view(from, size);
  for (let p = 0, k = 0; k < count; k++) {
    const entry = new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, dir.getUint16(p + 28, true)));
    const [, packed, at] = zip_sizes(dir, p);
    if (entry === name || entry.endsWith("/" + name)) {
      const head = await view(at, 30);
      const data = zip.slice(at + 30 + head.getUint16(26, true) + head.getUint16(28, true)).slice(0, packed);
      return dir.getUint16(p + 10, true) === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : data;
    }
    p += 46 + dir.getUint16(p + 28, true) + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return null;
}

// a directory entry's size, size packed and local header's place, each
// as its 32 bits say; one too large for them reads 0xFFFFFFFF, its value
// in the entry's ZIP64 extra field (id 1), which holds only those, in
// this order
function zip_sizes(dir: DataView, p: number): number[] {
  const short = [p + 24, p + 20, p + 42].map((at) => dir.getUint32(at, true));
  const extra = p + 46 + dir.getUint16(p + 28, true);
  let x = extra;
  while (x + 4 <= extra + dir.getUint16(p + 30, true) && dir.getUint16(x, true) !== 1) {
    x += 4 + dir.getUint16(x + 2, true);
  }
  let k = 0;
  return short.map((n) => (n === 0xffffffff ? Number(dir.getBigUint64(x + 4 + 8 * k++, true)) : n));
}

// Claude Code
// ===========

// a line's say (its texts and images) is one message; then its tools;
// a line without a timestamp is of the last message's date
function line_claude(s: Session, j: any, last: string): Msg[] {
  const date = import_date(j.timestamp, last);
  const own  = (j.type === "user" || j.type === "assistant") && !j.isMeta && !j.isSidechain && !j.isCompactSummary;
  const content = j.message?.content;
  const blocks = !own ? [] : typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  s.where ||= j.cwd ? "session in " + j.cwd : "";
  if (j.type === "attachment" && j.attachment?.type === "queued_command") {
    return msgs_of("user", String(j.attachment.prompt ?? ""), date);
  }
  return blocks_msgs(j.type === "user" ? "user" : "unii", blocks, date);
}

// a say's blocks (Claude's shape: texts, images, tool calls and their
// results) as a message, its texts and images; then its calls, each its
// name and input, and their results
function blocks_msgs(kind: Kind, blocks: any[], date: string): Msg[] {
  const say   = blocks.filter((b) => b.type === "image" || (b.type === "text" && !SKIP.test(b.text)));
  const tools = blocks.flatMap((b) => b.type === "tool_use" ? msgs_of("tool", b.name + " " + JSON.stringify(b.input), date) : b.type === "tool_result" ? msgs_of("echo", parts_text(b.content), date) : []);
  return [...msgs_of(kind, parts_text(say), date), ...tools];
}

// Codex
// =====

// an agent's rollout (source subagent, internal) is no person's chat
function line_codex(s: Session, j: any, last: string): Msg[] {
  const p    = j.payload ?? {};
  const date = import_date(j.timestamp, last);
  if (j.type === "session_meta") {
    s.where = p.source?.subagent ?? p.source?.internal ? "" : "session in " + String(p.cwd ?? "");
  }
  return j.type === "response_item" && s.where !== "" ? item_codex(p, date) : [];
}

function item_codex(p: any, date: string): Msg[] {
  switch (p.type) {
    case "message": {
      const kind  = p.role === "user" ? "user" : p.role === "assistant" ? "unii" : null;
      const parts = (p.content ?? []).filter((c: any) => !INJECTED.test(c.text ?? ""));
      return kind === null ? [] : msgs_of(kind, parts_text(parts), date);
    }
    case "function_call": {
      return msgs_of("tool", p.name + " " + p.arguments, date);
    }
    case "custom_tool_call": {
      return msgs_of("tool", p.name + " " + JSON.stringify({ input: p.input }), date);
    }
    case "local_shell_call": {
      return msgs_of("tool", "shell " + JSON.stringify({ command: p.action?.command }), date);
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      return msgs_of("echo", parts_text(p.output), date);
    }
  }
  return [];
}

// Msgs
// ====

// a time as ISO (as the server logs it): a log's or Claude's site's
// string, ChatGPT's seconds; none or bad: `last`
function import_date(at: unknown, last: string): string {
  const ms = typeof at === "number" ? at * 1000 : Date.parse(String(at));
  return Number.isNaN(ms) ? last : new Date(ms).toISOString();
}

// a message in its pages
function msgs_of(kind: Kind, text: string, date: string): Msg[] {
  const pages = text.trim() === "" ? [] : clip_pages(text);
  return pages.map((page, k) => ({ kind, text: page, date, more: k < pages.length - 1 }));
}

// content as text: a string, or parts (texts, images)
function parts_text(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  const parts = Array.isArray(content) ? content : [];
  return parts.map((c: any) => typeof c === "string" ? c : typeof c.text === "string" ? c.text : String(c.type ?? c.content_type).includes("image") ? "[image]" : "").join("\n");
}
