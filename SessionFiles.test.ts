import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { session_files } from "./SessionFiles.ts";
import { pi_scan } from "./PiImport.ts";
import { stream_lines } from "./Clip.ts";

test("A custom session root isolates invalid files and excludes subagents", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-custom-history-");
  const header = { type: "session", version: 3, id: "fixture", cwd: "/fixture", timestamp: "2026-10-01T00:00:00Z" };
  const row = { type: "message", id: "a", parentId: null, timestamp: header.timestamp, message: { role: "user", content: "Fixture" } };
  try {
    const data = JSON.stringify(header) + "\n" + JSON.stringify(row);
    fs.writeFileSync(path.join(dir, "good.jsonl"), data);
    fs.writeFileSync(path.join(dir, "bad.jsonl"), JSON.stringify(header) + "\n" + JSON.stringify({ ...row, parentId: "missing" }));
    fs.mkdirSync(path.join(dir, "subagents"));
    fs.writeFileSync(path.join(dir, "subagents", "ignored.jsonl"), data);
    const skipped: string[] = [];
    const sessions = await session_files(dir, (file) => skipped.push(file));
    expect(sessions.map((session) => session.app)).toEqual(["Pi"]);
    expect(skipped).toEqual([path.join(dir, "bad.jsonl")]);
    expect(await session_files(path.join(dir, "absent"))).toEqual([]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Header probes release byte streams on early return and parse errors", async () => {
  for (const header of [{ type: "session_meta" }, { type: "session", version: 99 }]) {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(header) + "\n")); },
      cancel() { canceled = true; },
    });
    class Source extends Blob { override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { return stream; } }
    if (header.type === "session") {
      const error: unknown = await pi_scan(new Source()).then(() => null, (error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
    } else expect(await pi_scan(new Source())).toBeNull();
    expect(canceled).toBe(true);
    expect(stream.locked).toBe(false);
  }
});

test("Chunked UTF-8 and final unterminated lines remain intact", async () => {
  const bytes = new TextEncoder().encode("one\nαβ\nlast");
  let at = 0;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull(controller) {
    if (at === bytes.length) controller.close(); else controller.enqueue(bytes.slice(at, ++at));
  } });
  expect((await Array.fromAsync(stream_lines(stream))).flat()).toEqual(["one", "αβ", "last"]);
});
