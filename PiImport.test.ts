import { expect, test } from "bun:test";
import * as Import from "./Import.ts";

const date = "2026-10-01T12:00:00.000Z";
async function rejected(operation: Promise<unknown>, part: string): Promise<void> {
  const error: unknown = await operation.then(() => null, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error instanceof Error ? error.message : "").toContain(part);
}
type Header = { type: string; version?: number; id: string; cwd: string; timestamp: string };
const header: Header = { type: "session", version: 3, id: "pi-session", cwd: "/project", timestamp: date };
function message(id: string, parentId: string | null, role: string, content: unknown, extra: Record<string, unknown> = {}) {
  return { type: "message", id, parentId, timestamp: date, message: { role, content, timestamp: Date.parse(date), ...extra } };
}
function file(entries: unknown[], first = header): Blob {
  return new Blob([[first, ...entries].map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n")]);
}
type Row = { kind: string; text: string; date: string; source?: string; more?: boolean };
async function read(blob: Blob) {
  const session = await Import.import_session(blob, "log");
  const payload = session === null ? "" : (await Array.fromAsync(Import.import_body([session]))).join("");
  const rows = payload.trim() === "" ? [] : payload.trim().split("\n").map((line) => JSON.parse(line) as Row);
  return { session, messages: rows.filter((row) => row.kind !== "note") };
}

test("Pi logs are a separate source with millisecond dates and no private reasoning", async () => {
  const { session, messages } = await read(file([
    message("a", null, "user", "Question"),
    message("b", "a", "assistant", [{ type: "thinking", thinking: "not imported" }, { type: "text", text: "Answer" }]),
  ]));
  expect(session?.app).toBe("Pi");
  expect(Import.APPS).toContain("Pi");
  expect(session?.where).toBe("session in /project");
  expect(messages.map(({ kind, text, date }) => ({ kind, text, date }))).toEqual([
    { kind: "user", text: "Question", date }, { kind: "unii", text: "Answer", date },
  ]);
  expect(Import.import_file(".pi/agent/sessions/project/session.jsonl")).toBe(true);
});

test("The last saved metadata entry selects its active branch, not abandoned siblings", async () => {
  const { messages } = await read(file([
    message("root", null, "user", "Shared"),
    message("old", "root", "assistant", [{ type: "text", text: "Abandoned" }]),
    message("chosen", "root", "assistant", [{ type: "text", text: "Chosen" }]),
    { type: "model_change", id: "last", parentId: "chosen", timestamp: date },
  ]));
  expect(messages.map((row) => row.text)).toEqual(["Shared", "Chosen"]);
});

test("Original messages survive compaction without importing summaries or retained-tail copies", async () => {
  const original = message("a", null, "user", "Original");
  const { messages } = await read(file([
    original,
    { type: "compaction", id: "c", parentId: "a", timestamp: date, summary: "Summary", retainedTail: [original] },
    message("b", "c", "assistant", [{ type: "text", text: "Reply" }]),
  ]));
  expect(messages.map((row) => row.text)).toEqual(["Original", "Reply"]);
});

test("A branch summary's fromId is not a parent edge", async () => {
  const { messages } = await read(file([
    message("old", null, "user", "Old root"),
    { type: "branch_summary", id: "summary", parentId: null, fromId: "old", timestamp: date, summary: "Generated" },
    message("new", "summary", "user", "New root"),
  ]));
  expect(messages.map((row) => row.text)).toEqual(["New root"]);
});

test("Tools are opt-in and preserve call association; images become placeholders", async () => {
  const { session, messages } = await read(file([
    message("a", null, "user", [{ type: "text", text: "Read" }, { type: "image", data: "private-image" }]),
    message("b", "a", "assistant", [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "image.png" } }]),
    message("c", "b", "toolResult", [{ type: "text", text: "Failed" }], { toolCallId: "call-1", toolName: "read", isError: true }),
    message("d", "c", "assistant", [{ type: "text", text: "Final" }]),
  ]));
  expect(messages.map((row) => row.kind)).toEqual(["user", "tool", "echo", "unii"]);
  expect(messages[0].text).toContain("[image]");
  expect(messages[1].text).toContain("call-1");
  expect(messages[2].text).toContain("call-1");
  expect(messages[2].text).toContain("error");
  expect(session).not.toBeNull();
  if (session === null) throw new Error("No Pi session");
  const plan = Import.import_plan([session], { off: [], since: "", tools: false }, {});
  const payload = (await Array.fromAsync(Import.import_body(plan.picked))).join("");
  expect(plan.msgs).toBe(2);
  expect(payload).not.toContain("call-1");
  expect(payload).not.toContain("private-image");
});

test("Generated custom context is excluded; shell records are tools, not user messages", async () => {
  const { messages } = await read(file([
    message("a", null, "user", "Actual question"),
    { type: "custom_message", id: "custom", parentId: "a", timestamp: date, content: "Injected context" },
    message("b", "custom", "bashExecution", [], { command: "printf hi", output: "hi", exitCode: 0 }),
  ]));
  expect(messages.filter((row) => row.kind === "user").map((row) => row.text)).toEqual(["Actual question"]);
  expect(messages.some((row) => row.kind === "echo" && row.text.includes("hi"))).toBe(true);
  expect(messages.map((row) => row.text).join(" ")).not.toContain("Injected context");
});

test("Legacy versions and malformed lines are read without rewriting the source", async () => {
  const blob = file([
    "broken JSON", "null",
    { type: "message", timestamp: date, message: { role: "user", content: "Legacy" } },
    "{truncated",
  ], { ...header, version: undefined });
  const before = await blob.text();
  expect((await read(blob)).messages.map((row) => row.text)).toEqual(["Legacy"]);
  expect(await blob.text()).toBe(before);
  expect((await read(file([message("a", null, "user", "Version two")], { ...header, version: 2 }))).messages[0].text).toBe("Version two");
});

test("Ambiguous graphs, unsupported versions and oversized IDs fail before preview", async () => {
  for (const entries of [
    [message("a", "missing", "user", "Orphan")],
    [message("a", "b", "user", "Cycle"), message("b", "a", "user", "Cycle")],
    [message("a", null, "user", "Duplicate"), message("a", null, "user", "Duplicate")],
  ]) await rejected(read(file(entries)), "Pi");
  await rejected(read(file([], { ...header, version: 99 })), "version");
  await rejected(read(file([message("a", null, "user", "Text")], { ...header, id: "x".repeat(2050) })), "ID");
});
