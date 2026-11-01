// Pi's persisted active-branch transcript, not its compacted LLM context.
// Originals stay in native logs: ignore generated summaries/retainedTail
// copies, thinking and custom injected context. Source files are read only.
import type { Kind } from "./AskAI.ts";
import type { Msg } from "./Import.ts";
import { clip_pages, stream_lines } from "./Clip.ts";
import { list, rec, str, text_of } from "./Json.ts";

type Header = { id: string; cwd: string; start: string };
type Entry = { id: string; parent: string | null; line: number; message: boolean };
export type PiSession = Header & { active: Set<number>; ordinals: Map<number, number>; warnings: string[] };

async function* records(file: Blob) {
  let n = 0;
  for await (const lines of stream_lines(file.stream())) for (const line of lines) {
    const at = n++;
    if (line.trim() === "") continue;
    let value: unknown = null;
    try { value = JSON.parse(line) as unknown; } catch { /* a malformed line contributes no entry */ }
    yield { line: at, value: rec(value) ? value : null };
  }
}

export async function pi_scan(file: Blob): Promise<PiSession | null> {
  let header: Header | null = null;
  let version = 0;
  let broken = 0;
  let generated = 0;
  let snapshots = false;
  let leaf: Entry | undefined;
  const index = new Map<string, Entry>();
  const ordinals = new Map<number, number>();
  let ordinal = 0;
  for await (const row of records(file)) {
    const j = row.value;
    if (j === null) { broken++; continue; }
    if (header === null) {
      if (j.type !== "session") return null;
      const v = j.version ?? 1;
      if (typeof v !== "number" || ![1, 2, 3].includes(v)) throw new Error("Unsupported Pi session version: " + text_of(v));
      const id = str(j.id);
      const cwd = str(j.cwd);
      const start = iso(j.timestamp);
      if (id === undefined || id === "" || cwd === undefined || start === "") throw new Error("Invalid Pi session header");
      if (encodeURIComponent(id).length > 1900) throw new Error("Pi session ID is too long to import safely");
      version = v;
      header = { id, cwd, start };
      continue;
    }
    if (j.type === "session") throw new Error("Multiple Pi session headers");
    if (typeof j.type !== "string") { broken++; continue; }
    const id = version === 1 ? "v1-" + row.line : j.id;
    const parent = version === 1 ? leaf?.id ?? null : j.parentId;
    if (typeof id !== "string" || id === "" || (parent !== null && typeof parent !== "string")) throw new Error("Invalid Pi entry ID or parent");
    if (index.has(id)) throw new Error("Duplicate Pi entry ID");
    const role = rec(j.message) ? str(j.message.role) : undefined;
    const ordinary = j.type === "message" && role !== undefined && ["user", "assistant", "toolResult", "bashExecution"].includes(role);
    if (j.type === "message") ordinals.set(row.line, ordinal++);
    leaf = { id, parent, line: row.line, message: ordinary };
    index.set(id, leaf);
    snapshots ||= j.type === "compaction" && Array.isArray(j.retainedTail);
    generated += Number(j.type === "custom_message" || (j.type === "message" && !ordinary));
  }
  if (header === null) return null;
  const active = new Set<number>();
  const visited = new Set<string>();
  let messages = 0;
  for (let entry = leaf; entry !== undefined;) {
    if (visited.has(entry.id)) throw new Error("Cycle in Pi session branch");
    visited.add(entry.id); active.add(entry.line); messages += Number(entry.message);
    if (entry.parent === null) break;
    const next = index.get(entry.parent);
    if (next === undefined) throw new Error("Missing parent in Pi session branch");
    if (next.line >= entry.line) throw new Error("Invalid parent order in Pi session branch");
    entry = next;
  }
  if (snapshots && messages === 0) throw new Error("Pi snapshot-only history is unsupported; choose the original log");
  const warnings = [
    ...(broken > 0 ? [broken + " malformed/non-object lines skipped"] : []),
    ...(generated > 0 ? [generated + " generated/custom records excluded"] : []),
  ];
  return { ...header, active, ordinals, warnings };
}

export async function* pi_read(file: Blob, session: PiSession): AsyncGenerator<Msg> {
  let last = session.start;
  for await (const { line, value: j } of records(file)) {
    if (!session.active.has(line) || j?.type !== "message" || !rec(j.message)) continue;
    const m = j.message;
    const date = typeof m.timestamp === "number" ? iso(m.timestamp) || iso(j.timestamp) || last : iso(j.timestamp) || last;
    last = date;
    let part = 0;
    // Native v1 migration regenerates tree IDs, but preserves the order of
    // all message records, including those outside the active branch.
    const source = "pi:" + encodeURIComponent(session.id) + ":message-" + session.ordinals.get(line) + ":";
    const emit = (kind: Kind, value: string) => pages(kind, value, date).map((msg) => ({ ...msg, source: source + part++ }));
    switch (m.role) {
      case "user":
        yield* emit("user", text(m.content));
        break;
      case "assistant": {
        const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : list(m.content);
        let say: unknown[] = [];
        for (const block of blocks) {
          if (!rec(block)) continue;
          if (block.type === "text" || block.type === "image") say.push(block);
          if (block.type === "toolCall") {
            yield* emit("unii", text(say)); say = [];
            yield* emit("tool", text_of(block.name, "tool") + call(block.id) + " " + JSON.stringify(block.arguments ?? {}));
          }
        }
        yield* emit("unii", text(say));
        break;
      }
      case "toolResult":
        yield* emit("echo", text_of(m.toolName, "tool") + call(m.toolCallId) + (m.isError === true ? " [error]" : "") + ": " + text(m.content));
        break;
      case "bashExecution":
        yield* emit("tool", "shell " + JSON.stringify({ command: m.command ?? "" }));
        yield* emit("echo", text_of(m.output) + (typeof m.exitCode === "number" && m.exitCode !== 0 ? "\n[exit " + m.exitCode + "]" : ""));
        break;
    }
  }
}

function call(id: unknown): string { return typeof id === "string" ? " [call:" + id + "]" : ""; }
function text(content: unknown): string {
  if (typeof content === "string") return content;
  return list(content).flatMap((part) => !rec(part) ? [] : part.type === "image" ? ["[image]"] : part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
}
function pages(kind: Kind, value: string, date: string): Msg[] {
  const parts = value.trim() === "" ? [] : clip_pages(value);
  return parts.map((text, k) => ({ kind, text, date, more: k < parts.length - 1 }));
}
function iso(at: unknown): string {
  const n = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(n) && !Number.isNaN(new Date(n).getTime()) ? new Date(n).toISOString() : "";
}
