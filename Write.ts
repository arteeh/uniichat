import * as fs from "node:fs";
import * as path from "node:path";
import { err_code } from "./Err.ts";

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
    } catch (err) {
      if (!WIN || k >= TRIES || !["EPERM", "EACCES", "EBUSY"].includes(err_code(err) ?? "")) {
        throw err;
      }
      Bun.sleepSync(APART);
    }
  }
}
