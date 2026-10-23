// Write
// =====
// A file replaced at once by `text` (null: removed): written whole beside
// it (<file>.<pid>.new), readable by `mode` from its first byte, synced,
// then moved in, and its folder synced (the move durable too; not on
// Windows, which can't), so a crash leaves the old file or the new, never
// half, and two processes writing it never share a temp file. Imports nothing
// of the server's: devices and terminals write their files with it too.
// On Windows a mode is no protection (only its write bit counts): the
// file's ACL, from the user's profile folder it is in, keeps others out.

import * as fs from "node:fs";
import * as path from "node:path";

const WIN = process.platform === "win32";

// how often, and how far apart (ms), a move Windows refused is tried
// again: a virus scanner or the search indexer may hold the file a moment
const TRIES = 20;
const APART = 50;

export function write_whole(file: string, text: string | null, mode = 0o600): void {
  if (text === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  const tmp = file + "." + process.pid + ".new";
  try {
    const fd = fs.openSync(tmp, "w", mode);
    try {
      if (!WIN) {
        fs.fchmodSync(fd, mode);
      }
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    move_over(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  sync_dir(path.dirname(file));
}

// a folder's entries made durable (a file moved in); skipped on Windows,
// and if it fails: the file is in place already
function sync_dir(dir: string): void {
  if (WIN) {
    return;
  }
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
}

// a file moved over another at once (rename); on Windows tried again
// while it is held (EPERM, EACCES, EBUSY), up to TRIES times
export function move_over(from: string, to: string): void {
  for (let k = 1; ; k++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err: any) {
      if (!WIN || k >= TRIES || !["EPERM", "EACCES", "EBUSY"].includes(err?.code)) {
        throw err;
      }
      Bun.sleepSync(APART);
    }
  }
}
