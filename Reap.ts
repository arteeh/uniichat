// Reap
// ====
// As PID 1 with no init (a container started without --init), the
// server is the parent of every orphan: a process whose own parent ended
// first, as a Claude Code's helpers (rg, git) when its call's Claude Code
// is stopped, or a job a command left running. Each that ends stays a
// zombie till its parent waits on it, so every TICK the server (serve,
// Server.ts) waits on its zombies that aren't Bun's. Bun waits on each
// process it spawns (Bun.spawn, node:child_process: commands,
// Claude Codes) through a pidfd it holds, and one waited on from under
// it throws (ECHILD): a zombie this process holds a pidfd for is Bun's,
// and one that wasn't a zombie at the tick before too is left for now.
// Not PID 1, or not on Linux: nothing.

import { dlopen, FFIType } from "bun:ffi";
import * as fs from "node:fs";

const TICK    = 2000;
const WNOHANG = 1;

export namespace Reap {

  export function start(): void {
    if (process.platform !== "linux" || process.pid !== 1) {
      return;
    }
    const wait = Reap.waitpid();
    if (wait === null) {
      console.error("unii: PID 1 can't reap orphans (no libc): run its container with --init");
      return;
    }
    let last = new Set<number>();
    setInterval(() => (last = Reap.tick(wait, last)), TICK).unref();
  }

  export function tick(wait: (pid: number) => void, last: Set<number>, proc = "/proc"): Set<number> {
    const now = Reap.zombies(process.pid, proc);
    const due = now.filter((pid) => last.has(pid));
    const bun = due.length > 0 ? Reap.held(proc) : new Set<number>();
    const reap = due.filter((pid) => !bun.has(pid));
    reap.forEach(wait);
    return new Set(now.filter((pid) => !reap.includes(pid)));
  }

  export function zombies(ppid: number, proc = "/proc"): number[] {
    const found: number[] = [];
    for (const name of fs.readdirSync(proc)) {
      if (!/^\d+$/.test(name)) {
        continue;
      }
      try {
        const stat = fs.readFileSync(proc + "/" + name + "/stat", "utf8");
        const [state, parent] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        if (state === "Z" && Number(parent) === ppid) {
          found.push(Number(name));
        }
      } catch {}
    }
    return found;
  }

  // the processes this one holds a pidfd for (Bun's own children)
  export function held(proc = "/proc"): Set<number> {
    const pids = new Set<number>();
    for (const fd of fs.readdirSync(proc + "/self/fd")) {
      try {
        if (fs.readlinkSync(proc + "/self/fd/" + fd) === "anon_inode:[pidfd]") {
          const pid = /^Pid:\s*(\d+)/m.exec(fs.readFileSync(proc + "/self/fdinfo/" + fd, "utf8"));
          if (pid) {
            pids.add(Number(pid[1]));
          }
        }
      } catch {}
    }
    return pids;
  }

  // libc's waitpid(pid, NULL, WNOHANG) (glibc, or musl), null if neither loads
  export function waitpid(): ((pid: number) => void) | null {
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    for (const lib of ["libc.so.6", "libc.musl-" + arch + ".so.1"]) {
      try {
        const libc = dlopen(lib, { waitpid: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 } });
        return (pid) => void libc.symbols.waitpid(pid, null, WNOHANG);
      } catch {}
    }
    return null;
  }

}
