// Write
// =====
// A file replaced at once by `text` (null: removed): written whole beside
// it (<file>.<pid>.new), readable by `mode` from its first byte, synced,
// then moved in, so a crash leaves the old file or the new, never half,
// and two processes writing it never share a temp file. Imports nothing
// of the server's: devices and terminals write their files with it too.

import * as fs from "node:fs";

export function write_whole(file: string, text: string | null, mode = 0o600): void {
  if (text === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  const tmp = file + "." + process.pid + ".new";
  try {
    const fd = fs.openSync(tmp, "w", mode);
    try {
      fs.fchmodSync(fd, mode);
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
