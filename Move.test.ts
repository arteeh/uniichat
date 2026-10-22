// Move test
// =========
// `bun test Move.test.ts`. A server started on the default DIR takes the
// official build's ~/.opt over: everything moves, a shared folder merges,
// a file both have keeps the new DIR's copy aside, stale sockets go, and
// nothing moves when the new DIR has users or a server runs on the old.

import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { config_move } from "./Config.ts";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function tree(): { opt: string; unii: string } {
  const r = fs.mkdtempSync(os.tmpdir() + "/move-");
  roots.push(r);
  const [opt, unii] = [r + "/.opt", r + "/.unii"];
  fs.mkdirSync(opt + "/users/1", { recursive: true });
  fs.writeFileSync(opt + "/users/1/view.json", "{}");
  fs.writeFileSync(opt + "/cloud.db", "db");
  fs.writeFileSync(opt + "/cloud.db-wal", "wal");
  fs.writeFileSync(opt + "/config.json", '{"owner":"a@b"}');
  fs.mkdirSync(opt + "/work/Old", { recursive: true });
  fs.writeFileSync(opt + "/lock", "");
  fs.writeFileSync(opt + "/hand0.999999999", "");
  fs.symlinkSync(opt + "/hand0.999999999", opt + "/hand0");
  fs.mkdirSync(unii + "/work/main", { recursive: true });
  fs.mkdirSync(unii + "/127.0.0.1:8788", { recursive: true });
  fs.writeFileSync(unii + "/127.0.0.1:8788/token", "t");
  fs.writeFileSync(unii + "/config.json", "{}");
  fs.mkdirSync(unii + "/users");
  return { opt, unii };
}

test("an official ~/.opt moves into a ~/.unii without users", () => {
  const { opt, unii } = tree();
  expect(config_move(opt, unii)).toBe("moved the data in " + opt + " to " + unii);
  expect(fs.existsSync(opt)).toBe(false);
  expect(fs.readFileSync(unii + "/users/1/view.json", "utf8")).toBe("{}");
  expect(fs.readFileSync(unii + "/cloud.db-wal", "utf8")).toBe("wal");
  expect(fs.readFileSync(unii + "/config.json", "utf8")).toBe('{"owner":"a@b"}');
  expect(fs.readFileSync(unii + "/config.json.before-move", "utf8")).toBe("{}");
  expect(fs.existsSync(unii + "/work/Old") && fs.existsSync(unii + "/work/main")).toBe(true);
  expect(fs.readFileSync(unii + "/127.0.0.1:8788/token", "utf8")).toBe("t");
  expect(fs.existsSync(unii + "/lock") || fs.existsSync(unii + "/hand0")).toBe(false);
  expect(config_move(opt, unii)).toBe("");
});

test("nothing moves when the new DIR has users, or a server runs on the old", () => {
  const a = tree();
  fs.mkdirSync(a.unii + "/users/2");
  expect(config_move(a.opt, a.unii)).toContain("not moved");
  expect(fs.existsSync(a.opt + "/cloud.db")).toBe(true);
  const b = tree();
  fs.writeFileSync(b.opt + "/hand0." + process.ppid, "");
  expect(config_move(b.opt, b.unii)).toContain("still runs");
  expect(fs.existsSync(b.opt + "/users/1")).toBe(true);
  expect(fs.existsSync(b.unii + "/users")).toBe(true);
});

test("no official data, nothing to do", () => {
  const { opt, unii } = tree();
  fs.rmSync(opt + "/users", { recursive: true });
  expect(config_move(opt, unii)).toBe("");
  expect(config_move(unii, unii)).toBe("");
});
