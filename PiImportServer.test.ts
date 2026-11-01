import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Session, Done } from "./Import.ts";

const dir = fs.mkdtempSync(os.tmpdir() + "/unii-pi-server-");
process.env.UNII_DIR = dir;
process.env.ANTHROPIC_API_KEY = "synthetic-test-key";
const Import = await import("./Import.ts");
const { Chat } = await import("./Server.ts");
const { Memory } = await import("./Memory.ts");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const date = "2026-10-01T12:00:00Z";
function entry(id: string, parentId: string | null, content: string, timestamp = date) {
  return { type: "message", id, parentId, timestamp, message: { role: "user", content } };
}
async function session(entries: unknown[], version = 3): Promise<Session> {
  const header = { type: "session", version, id: "same-session", cwd: "/fixture", timestamp: date };
  const result = await Import.import_session(new Blob([[header, ...entries].map((row) => JSON.stringify(row)).join("\n")]), "log");
  if (result === null) throw new Error("No Pi session");
  return result;
}
async function fresh(sessions: Session[], done: Done) {
  return fresh_payload((await Array.fromAsync(Import.import_body(sessions))).join(""), done);
}
async function fresh_payload(payload: string, done: Done) {
  const file = dir + "/body-" + crypto.randomUUID();
  fs.writeFileSync(file, payload);
  const fh = await fs.promises.open(file, "r");
  try { return (await Array.fromAsync(Chat.fresh({ fh, size: Buffer.byteLength(payload) }, done))).flat(); }
  finally { await fh.close(); }
}
function memory() {
  const mem = Memory.load(dir + "/memory-" + crypto.randomUUID(), () => ({ vendor: "claude-api", model: "claude-haiku-5-5", effort: "medium", speed: "slow", system: "", searches: 0, server: "" }));
  mem.done = true; // persistence only: no compaction/model calls
  return mem;
}
function done(mem: ReturnType<typeof memory>): Done { return Chat.done({ mem } as Parameters<typeof Chat.done>[0]); }

test("Pi source identities reject metadata poisoning and noncanonical positions", () => {
  const source = "pi:same-session:message-0:0";
  expect(() => Chat.imported({ kind: "note", text: "Unrelated", date, source })).toThrow("source ID");
  for (const bad of ["pi:same-session:any:0", "pi:same-session:message-01:0", "pi:same-session:message-0:00", source + "\n", "pi:%zz:message-0:0", "pi:%73ame-session:message-0:0"]) {
    expect(() => Chat.imported({ kind: "user", text: "Text", date, source: bad })).toThrow("source ID");
  }
});

test("Pi message identities must match the enclosing session note", async () => {
  const rows = [
    { kind: "note", text: "Claude session in /fixture, from now", date },
    { kind: "user", text: "Poison", date, source: "pi:same-session:message-0:0" },
  ];
  for (const text of [rows[0].text, "Pi [session other-session] session in /fixture, from now"]) {
    rows[0].text = text;
    const error: unknown = await fresh_payload(rows.map((row) => JSON.stringify(row)).join("\n"), {}).then(() => null, (error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : "").toContain("session note");
  }
});

test("Same-millisecond appends retain source IDs through persisted memory", async () => {
  const mem = memory();
  try {
    const first = await session([entry("a", null, "First")]);
    Memory.push(mem, (await fresh([first], {})).map((row) => ({ ...row, imported: true })));
    const next = await session([entry("a", null, "First"), entry("b", "a", "Second")]);
    const plan = Import.import_plan([next], { off: [], since: "", tools: false }, done(mem));
    expect(plan.msgs).toBe(1);
    const rows = await fresh(plan.picked, done(mem));
    expect(rows.filter((row) => row.kind === "user").map((row) => row.text)).toEqual(["Second"]);
    expect(rows.find((row) => row.kind === "user")?.source).toBeDefined();
    Memory.push(mem, rows.map((row) => ({ ...row, imported: true })));
    expect(await fresh([next], done(mem))).toEqual([]);
  } finally { Memory.stop(mem); }
});

test("An older unseen branch is not discarded by a timestamp watermark", async () => {
  const mem = memory();
  try {
    const root = entry("a", null, "Root");
    const old = await session([root, entry("b", "a", "Imported branch", "2026-10-02T00:00:00Z")]);
    Memory.push(mem, (await fresh([old], {})).map((row) => ({ ...row, imported: true })));
    const next = await session([root, entry("b", "a", "Imported branch", "2026-10-02T00:00:00Z"), entry("c", "a", "Unseen branch")]);
    const plan = Import.import_plan([next], { off: [], since: "", tools: false }, done(mem));
    expect(plan.msgs).toBe(1);
    expect((await fresh(plan.picked, done(mem))).filter((row) => row.kind === "user").map((row) => row.text)).toEqual(["Unseen branch"]);
  } finally { Memory.stop(mem); }
});

test("Copied sessions deduplicate in both client planning and the server's two passes", async () => {
  const one = await session([entry("a", null, "Once")]);
  const copy = await session([entry("a", null, "Once")]);
  expect(Import.import_plan([one, copy], { off: [], since: "", tools: false }, {}).msgs).toBe(1);
  const prior: Done = {};
  const accepted = await fresh([one, copy], prior);
  expect(accepted.filter((row) => row.kind === "user").map((row) => row.text)).toEqual(["Once"]);
  expect(await fresh([one, copy], prior)).toEqual(accepted);
  expect(prior).toEqual({});
});

test("Native v1 migration can regenerate tree IDs without duplicating history", async () => {
  const original = { type: "message", timestamp: date, message: { role: "user", content: "Legacy" } };
  const mem = memory();
  try {
    Memory.push(mem, (await fresh([await session([original], 1)], {})).map((row) => ({ ...row, imported: true })));
    const migrated = await session([{ ...original, id: "new-native-id", parentId: null }, entry("new", "new-native-id", "Appended")]);
    const plan = Import.import_plan([migrated], { off: [], since: "", tools: false }, done(mem));
    expect(plan.msgs).toBe(1);
    expect((await fresh(plan.picked, done(mem))).filter((row) => row.kind === "user").map((row) => row.text)).toEqual(["Appended"]);
  } finally { Memory.stop(mem); }
});
