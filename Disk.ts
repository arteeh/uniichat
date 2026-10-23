// Disk
// ====
// Durability by group commit. What the server writes under config.DIR
// goes at once to the OS's cache, so no chat waits on the disk; flushes
// run one at a time, each making durable every write before it began:
// an fsync of each file written, then of each folder they are in (its
// entries: a file made or renamed there), each once however often it was
// written. A process crash loses nothing; a machine's, about the last
// flush. An act is answered, and a charge sent, only once flushed.

import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

// Globals
// =======

// the files written since the flush running began, the asks waiting on
// them, the flushes running (null: none)
const DIRTY = new Set<string>();
let WAITS: Array<() => void> = [];
let RUN: Promise<void> | null = null;

// Disk
// ====

export namespace Disk {

  // a db the processes share, each waiting its turn to write (the wait
  // set first: the switch to WAL locks too)
  export function db(file: string): Database {
    const db = new Database(file, { create: true });
    db.exec("pragma busy_timeout = 10000; pragma journal_mode = wal; pragma synchronous = normal;");
    return db;
  }

  // a file written: flushed soon; answers once it is
  export function wrote(file: string): Promise<void> {
    DIRTY.add(file);
    return Disk.synced();
  }

  // answers once all written so far is flushed
  export function synced(): Promise<void> {
    if (DIRTY.size === 0) {
      return RUN ?? Promise.resolve();
    }
    const done = new Promise<void>((ok) => WAITS.push(ok));
    RUN ??= Disk.run();
    return done;
  }

  export async function run(): Promise<void> {
    while (DIRTY.size > 0) {
      const files = [...DIRTY];
      const waits = WAITS;
      DIRTY.clear();
      WAITS = [];
      await Disk.flush(files).catch((err: Error) => console.error("disk: a flush failed: " + err.message));
      waits.forEach((ok) => ok());
    }
    RUN = null;
  }

  // each file fsynced, then (but on Windows, which can't open a folder to
  // sync it) each folder they are in, so a file new there or moved in
  // place (a rename) is durable too
  export async function flush(files: string[]): Promise<void> {
    await Promise.all(files.map(Disk.fsync));
    if (process.platform !== "win32") {
      await Promise.all([...new Set(files.map((file) => path.dirname(file)))].map(Disk.fsync));
    }
  }

  // a file (or folder) gone since needs none. Windows flushes only a file
  // opened to write (FlushFileBuffers), so there it is opened so, writing
  // nothing
  export async function fsync(file: string): Promise<void> {
    const handle = await fs.promises.open(file, process.platform === "win32" ? "r+" : "r").catch((err) => {
      if (err.code !== "ENOENT") {
        throw err;
      }
      return null;
    });
    try {
      await handle?.sync();
    } finally {
      await handle?.close();
    }
  }

}
