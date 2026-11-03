// Private, crash-durable auth state. The writer holds its own kernel lock;
// process death releases it, with no helper or time-based lease to outlive.
import { dlopen, FFIType, read } from "bun:ffi";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { SubscriptionVendor } from "./SubscriptionModels.ts";
import { SubscriptionModels } from "./SubscriptionModels.ts";

export type Credential = {
  vendor: SubscriptionVendor; access: string; refresh?: string; expires: number;
  endpoint: string; scope?: string; pending?: boolean; blocked?: boolean;
};
function vendorCheck(vendor: SubscriptionVendor): void {
  if (!SubscriptionModels.isVendor(vendor)) throw new Error("Unknown subscription vendor");
}
function location(dir: string, vendor: SubscriptionVendor): { root: string; file: string } {
  vendorCheck(vendor);
  const root = path.join(path.resolve(dir), ".subscription-auth");
  return { root, file: path.join(root, vendor + ".json") };
}
function secure(stat: fs.Stats, directory = false): void {
  if ((directory ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (process.getuid && stat.uid !== process.getuid()) || (!directory && stat.nlink !== 1)) {
    throw new Error("Subscription auth storage must be private, owned, and not linked");
  }
}
function syncDir(dir: string): void {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function prepare(dir: string, vendor: SubscriptionVendor): { root: string; file: string } {
  if (!["linux", "darwin"].includes(process.platform)) throw new Error("Native subscription auth runs on Linux (macOS untested); this platform is unsupported");
  const loc = location(dir, vendor);
  fs.mkdirSync(path.resolve(dir), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(loc.root, { mode: 0o700 });
    syncDir(path.resolve(dir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  secure(fs.lstatSync(loc.root), true);
  return loc;
}
export function secret(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,16384}$/.test(value)) {
    throw new Error("Invalid subscription credential response");
  }
  return value;
}
export function load(dir: string, vendor: SubscriptionVendor): Credential | undefined {
  const { root, file } = location(dir, vendor);
  let fd: number | undefined;
  try {
    secure(fs.lstatSync(root), true);
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    secure(stat);
    if (stat.size > 128 * 1024) throw new Error("Oversized subscription auth state");
    const c = JSON.parse(fs.readFileSync(fd, "utf8")) as Credential;
    if (!c || c.vendor !== vendor || typeof c.access !== "string" ||
        typeof c.endpoint !== "string" || !Number.isFinite(c.expires) || c.expires < 0 ||
        (c.refresh !== undefined && typeof c.refresh !== "string") ||
        (c.scope !== undefined && typeof c.scope !== "string") ||
        (c.pending !== undefined && typeof c.pending !== "boolean") ||
        (c.blocked !== undefined && typeof c.blocked !== "boolean")) {
      throw new Error("Invalid subscription auth state");
    }
    return c;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot read private subscription auth state; inspect storage permissions or log in again");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
// Call only under locked(). Rename + file fsync + directory fsync are mandatory.
export function save(dir: string, vendor: SubscriptionVendor, state: Credential): void {
  const { root, file } = prepare(dir, vendor);
  const tmp = path.join(root, vendor + "." + randomUUID() + ".new");
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(state) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    syncDir(root);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
  }
}
export function forget(dir: string, vendor: SubscriptionVendor): void {
  save(dir, vendor, { vendor, access: "", expires: 0, endpoint: "", blocked: true });
}
let acquire: ((fd: number) => boolean) | undefined;
function kernelLock(): (fd: number) => boolean {
  if (acquire) return acquire;
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const libraries = process.platform === "darwin" ? ["/usr/lib/libSystem.B.dylib"] : ["libc.so.6", "libc.musl-" + arch + ".so.1"];
  const errno = process.platform === "darwin" ? "__error" : "__errno_location";
  for (const library of libraries) {
    try {
      const libc = dlopen(library, {
        flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
        [errno]: { args: [], returns: FFIType.ptr },
      });
      acquire = (fd) => {
        if (libc.symbols.flock(fd, 2 | 4) === 0) return true;
        const address = libc.symbols[errno]();
        if (address === null) throw new Error("Cannot read subscription auth lock error");
        const code = read.i32(address);
        if (code === (process.platform === "darwin" ? 35 : 11) || code === 4) return false;
        throw new Error("Cannot acquire private subscription auth lock (errno " + code + ")");
      };
      return acquire;
    } catch {}
  }
  throw new Error("Native subscription auth requires an available system flock function");
}
export async function locked<T>(dir: string, vendor: SubscriptionVendor, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const { root, file } = prepare(dir, vendor);
  const lock = kernelLock();
  const fd = fs.openSync(file + ".lock", fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  try {
    secure(fs.fstatSync(fd)); fs.fsyncSync(fd); syncDir(root);
    const until = performance.now() + 30_000;
    while (!lock(fd)) {
      signal?.throwIfAborted();
      if (performance.now() >= until) throw new Error("Subscription auth lock unavailable (wait budget 30 seconds)");
      await Bun.sleep(25);
    }
    signal?.throwIfAborted();
    // A dispatched rotating request settles durably even if its caller cancels.
    return await fn();
  } finally { fs.closeSync(fd); }
}
