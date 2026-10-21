// Reap test
// =========
// `bun test Reap.test.ts`. The zombies and pidfds read from a /proc;
// only a zombie seen at the tick before too, and not Bun's, is waited
// on. Then, on Linux, in a process of its own made a subreaper (as PID 1
// is), an orphan's zombie is reaped while Bun's own child, a zombie as
// long, keeps its exit code.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Reap } from "./Reap.ts";

// a fake /proc: its processes (pid, state, ppid), its pidfds (fd: pid)
function proc(procs: [number, string, number][], pidfds: Record<number, number>): string {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-reap-");
  for (const [pid, state, ppid] of procs) {
    fs.mkdirSync(dir + "/" + pid);
    fs.writeFileSync(dir + "/" + pid + "/stat", pid + " (a (b) c) " + state + " " + ppid + " 1 1 0");
  }
  fs.mkdirSync(dir + "/self/fd", { recursive: true });
  fs.mkdirSync(dir + "/self/fdinfo");
  fs.symlinkSync("/dev/null", dir + "/self/fd/0");
  fs.writeFileSync(dir + "/self/fdinfo/0", "pos:\t0\nflags:\t02\n");
  for (const [fd, pid] of Object.entries(pidfds)) {
    fs.symlinkSync("anon_inode:[pidfd]", dir + "/self/fd/" + fd);
    fs.writeFileSync(dir + "/self/fdinfo/" + fd, "pos:\t0\nflags:\t02000002\nmnt_id:\t15\nino:\t1057\nPid:\t" + pid + "\nNSpid:\t" + pid + "\n");
  }
  return dir;
}

test("only an orphan's zombie seen twice is waited on", () => {
  const me = process.pid;
  const dir = proc([[10, "Z", me], [11, "Z", me], [12, "S", me], [13, "Z", 99], [14, "Z", me]], { 7: 11 });
  expect(Reap.zombies(me, dir).sort()).toEqual([10, 11, 14]);
  expect([...Reap.held(dir)]).toEqual([11]);
  const waited: number[] = [];
  const last = Reap.tick((pid) => waited.push(pid), new Set([10, 11, 13]), dir);
  // 10: an orphan's; 11: Bun's (a pidfd); 13: not ours; 14: new
  expect(waited).toEqual([10]);
  expect([...last].sort()).toEqual([11, 14]);
  fs.rmSync(dir, { recursive: true });
});

test.skipIf(process.platform !== "linux")("an orphan is reaped, Bun's child keeps its exit code", async () => {
  const code = `
    const { dlopen, FFIType } = await import("bun:ffi");
    const { Reap } = await import(${JSON.stringify(import.meta.dir + "/Reap.ts")});
    const libc = dlopen("libc.so.6", { prctl: { args: [FFIType.i32, FFIType.u64], returns: FFIType.i32 } });
    libc.symbols.prctl(36, 1); // PR_SET_CHILD_SUBREAPER: orphans come here, as to PID 1
    const wait = Reap.waitpid();
    const orphan = Bun.spawn(["sh", "-c", "sleep 0.1 & echo $!"], { stdout: "pipe" });
    const pid = Number((await new Response(orphan.stdout).text()).trim());
    const shell = await orphan.exited;
    const mine = Bun.spawn(["sh", "-c", "sleep 0.1; exit 7"]);
    const t = Date.now();
    while (Date.now() - t < 500) {} // both end, Bun can't wait on its child yet
    let last = Reap.tick(wait, new Set());
    const before = Reap.zombies(process.pid).sort();
    last = Reap.tick(wait, last);
    const after = Reap.zombies(process.pid);
    console.log(JSON.stringify({ shell, before, after, orphan: pid, mine: mine.pid, code: await mine.exited }));
  `;
  const run = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse(await new Response(run.stdout).text());
  expect(await run.exited).toBe(0);
  expect(out.shell).toBe(0);
  expect(out.before).toEqual([out.orphan, out.mine].sort());
  expect(out.after).toEqual([out.mine]);
  expect(out.code).toBe(7);
});
