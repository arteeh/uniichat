import type * as Md from "./Md.ts";

export type Call = { name: string; head: string; device: string; blocks: Md.Code[] };

type Input = Record<string, unknown>;

type Shown = { head: string; blocks: Md.Code[] };

const SHORT = 60;

const CALL = /^(\S+) (\{[\s\S]*)$/;

const MCP = /^mcp__.+?__/;

const THEIRS = /^(?:([A-Za-z0-9-]+)_)?([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__(.+)$/;

const READS = new Map<string, (x: Input) => Shown>([
  ["shell",    (x) => ({ head: String(x.command ?? ""), blocks: [] })],
  ["read",     (x) => ({ head: String(x.path ?? "") + lines_show(x.offset, x.limit), blocks: [] })],
  ["write",    (x) => ({ head: String(x.path ?? ""), blocks: [] })],
  ["view_video", (x) => ({ head: String(x.path ?? "") + range_show(x.start, x.end, x.unit) + (x.step === undefined ? "" : " every " + x.step), blocks: [] })],
  ["edit",     (x) => (Array.isArray(x.edits) ? { head: edits_files(x.edits), blocks: [] } : input_shown(x))],
  ["zoom",     (x) => ({ head: msg_show(x.id, x.n) + (x.at === undefined ? "" : " from char " + x.at), blocks: [] })],
  ["date",     (x) => ({ head: msg_show(x.id, 1), blocks: [] })],
  ["spawn",    (x) => ({ head: tasks_show(x.tasks, x.model, x.effort), blocks: (Array.isArray(x.tasks) ? x.tasks : []).flatMap(task_block) })],
  ["tell",     (x) => ({ head: String(x.name ?? ""), blocks: text_block(x.message) })],
  ["computer", (x) => ({ head: "", blocks: text_block(x.task) })],
  ["schedule", (x) => ({ head: (x.cron === undefined ? String(x.at ?? "") : "cron " + x.cron) + " " + String(x.zone ?? ""), blocks: text_block(x.message) })],
]);

export type Report = { name: string; text: string };

export function report_text(name: string, text: string): string {
  return "[" + name + "]\n" + text + "\n\nFull chat: zoom(\"" + name + "\")";
}

export function report_read(text: string): Report | null {
  const m = /^\[([^\]\n]+)\]\s*([\s\S]*?)(?:\s*Full chat: zoom\("[^"\n]*"\))?\s*$/.exec(text);
  return m === null ? null : { name: m[1], text: m[2] };
}

export function call_parse(text: string): Call {
  const m     = CALL.exec(text);
  const input = m === null ? null : input_parse(m[2]);
  if (m === null || input === null) {
    return { name: "", head: text, device: "", blocks: [] };
  }
  const name = m[1].replace(MCP, "");
  const theirs = THEIRS.exec(name);
  if (theirs !== null) {
    return { name: tool_name(name), device: theirs[1] ?? "", ...input_shown(input) };
  }
  const { device, ...rest } = input;
  const shown = (READS.get(name) ?? input_shown)(rest);
  return { name, device: typeof device === "string" ? device : "", ...shown };
}

export function tool_name(logged: string): string {
  const name = logged.replace(MCP, "");
  const theirs = THEIRS.exec(name);
  return theirs === null ? name : theirs[2] + ": " + theirs[3];
}

export function call_line(c: Call): string {
  const blocks = c.blocks.map((b) => (b.k === "" ? "" : b.k + ": ") + b.x);
  const where  = c.device === "" ? [] : ["· " + c.device];
  return [c.head, ...blocks, ...where].join(" ").replace(/\s+/g, " ").trim();
}

export function call_text(c: Call): string {
  const where = c.name.includes(": ") && c.device !== "" ? " · " + c.device : "";
  return [(c.name + " " + c.head).trim() + where, ...c.blocks.map((b) => b.x)].join("\n");
}

function input_shown(input: Input): Shown {
  const keys   = Object.keys(input);
  const args   : string[] = [];
  const blocks : Md.Code[] = [];
  for (const k of keys) {
    const v    = input[k];
    const json = JSON.stringify(v);
    const word = typeof v !== "string" || /^[^\s"\\]*$/.test(v);
    if (json.length <= SHORT && word) {
      args.push(json);
    } else {
      const x = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      blocks.push({ $: "Code", k: keys.length > 1 ? k : "", x });
    }
  }
  return { head: args.join(" "), blocks };
}

function text_block(x: unknown): Md.Code[] {
  return typeof x === "string" && x !== "" ? [{ $: "Code", k: "", x: x.replace(/\n$/, "") }] : [];
}

function msg_show(id: unknown, n: unknown): string {
  const many = typeof n === "number" && n > 1 ? "+" + n : "";
  return typeof id === "number" ? "#" + id + many : String(id ?? "");
}

function tasks_show(tasks: unknown, model: unknown, effort: unknown): string {
  const list = Array.isArray(tasks) ? tasks : [];
  const knobs = [...new Set([knobs_show(model, effort), ...list.map((t) => knobs_show(t?.model, t?.effort))])].filter((k) => k !== "").map((k) => " · " + k).join("");
  return list.length + (list.length === 1 ? " agent" : " agents") + knobs;
}

function knobs_show(model: unknown, effort: unknown): string {
  return [model, effort].filter((k) => typeof k === "string").join(" ");
}

function task_block(t: any): Md.Code[] {
  return typeof t === "string" ? text_block(t) : text_block(t?.task).map((b) => ({ ...b, k: knobs_show(t.model, t.effort) }));
}

function lines_show(offset: unknown, limit: unknown): string {
  const from = typeof offset === "number" ? offset : 1;
  const to   = typeof limit === "number" ? String(from + limit - 1) : "";
  return offset === undefined && limit === undefined ? "" : ":" + from + "-" + to;
}

function range_show(start: unknown, end: unknown, unit: unknown): string {
  const s = unit === "second" ? "s" : "";
  return start === undefined && end === undefined ? "" : " " + (start ?? 0) + s + "-" + (end ?? "") + (end === undefined ? "" : s);
}

function edits_files(edits: unknown[]): string {
  const paths = edits.map((e: any) => e?.path).filter((p) => typeof p === "string");
  return [...new Set(paths)].join(", ");
}

function input_parse(text: string): Record<string, unknown> | null {
  const shut: string[] = [];
  let quote = false;
  let esc   = false;
  let field = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      quote = esc || c !== '"';
      esc   = !esc && c === "\\";
    } else if (c === '"') {
      quote = true;
    } else if (c === "{" || c === "[") {
      shut.push(c === "{" ? "}" : "]");
      field = shut.length === 1 ? i + 1 : field;
    } else if (c === "}" || c === "]") {
      shut.pop();
    } else if (c === "," && shut.length === 1) {
      field = i;
    }
  }
  const open = quote ? (esc ? text.slice(0, -1) : text) + '"' : text;
  const full = open.replace(/[\s,]*$/, "") + shut.reverse().join("");
  return object_parse(full) ?? object_parse(text.slice(0, field) + "}");
}

function object_parse(text: string): Record<string, unknown> | null {
  try {
    const x = JSON.parse(text);
    return typeof x === "object" && x !== null && !Array.isArray(x) ? x : null;
  } catch {
    return null;
  }
}
