// Disk: a script that writes files (one renamed in place) and waits for
// their flush ends by itself: nothing Disk starts holds a process open
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("a script that writes files and flushes them exits on its own", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unii-disk-"));
  const at = (name: string) => JSON.stringify(path.join(dir, name));
  fs.writeFileSync(path.join(dir, "script.ts"), `
    import * as fs from "node:fs";
    const { Disk } = await import(${JSON.stringify(path.join(import.meta.dir, "Disk.ts"))});
    for (let k = 0; k < 20; k++) {
      fs.writeFileSync(${at("f")} + k, String(k));
      Disk.wrote(${at("f")} + k);
    }
    fs.writeFileSync(${at("view.json.new")}, "{}");
    fs.renameSync(${at("view.json.new")}, ${at("view.json")});
    await Disk.wrote(${at("view.json")});
    console.log("flushed");
  `);
  try {
    const proc = Bun.spawn([process.execPath, path.join(dir, "script.ts")], { cwd: dir, env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit", timeout: 20000 });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(proc.signalCode).toBeNull();
    expect(proc.exitCode).toBe(0);
    expect(out).toContain("flushed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
