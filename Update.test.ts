// Update test
// ===========
// `bun test Update.test.ts`. The fork's versions order by their -arteeh.N
// as numbers (10 after 9), a redirect's tag is read or refused, and
// `unii update` picks the fork's installer unless given a server, always
// naming this executable, quoted, as where the new one goes.

import { expect, test } from "bun:test";
import * as Update from "./Update.ts";

test("this build's version is a full fork version, upstream's before it", () => {
  expect(Update.VERSION).toMatch(/^\d+\.\d+\.\d+-arteeh\.\d+$/);
  expect(Update.update_parse(Update.VERSION)).not.toBe(null);
  expect(Update.VERSION.startsWith(Update.BASE + "-arteeh.")).toBe(true);
});

test("versions compare as numbers, fork builds after their upstream", () => {
  expect(Update.update_newer("1.0.138-arteeh.10", "1.0.138-arteeh.9")).toBe(true);
  expect(Update.update_newer("1.0.138-arteeh.9", "1.0.138-arteeh.10")).toBe(false);
  expect(Update.update_newer("1.0.138-arteeh.10", "1.0.138-arteeh.10")).toBe(false);
  expect(Update.update_newer("1.0.138-arteeh.1", "1.0.138")).toBe(true);
  expect(Update.update_newer("1.0.139", "1.0.138-arteeh.10")).toBe(true);
  expect(Update.update_newer("1.0.137-arteeh.99", "1.0.138-arteeh.1")).toBe(false);
  expect(Update.update_newer("garbage", "1.0.138")).toBe(false);
  expect(Update.update_newer("1.0.139-beta", "1.0.138")).toBe(false);
});

test("the newest release's version is read from its redirect only", () => {
  expect(Update.update_tag("https://github.com/arteeh/uniichat/releases/tag/v1.0.138-arteeh.10")).toBe("1.0.138-arteeh.10");
  expect(Update.update_tag(null)).toBe(null);
  expect(Update.update_tag("https://github.com/arteeh/uniichat/releases")).toBe(null);
  expect(Update.update_tag("https://github.com/arteeh/uniichat/releases/tag/v1.0.138-arteeh.10\nrm -rf ~")).toBe(null);
});

test("update runs the fork's installer, or a given server's, into this executable", () => {
  expect(Update.update_cmd(undefined, "/home/a/.local/bin/unii"))
    .toBe("curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | UNII_BIN='/home/a/.local/bin/unii' sh");
  expect(Update.update_cmd("http://127.0.0.1:8788/", "/x/unii"))
    .toBe("curl -fsSL http://127.0.0.1:8788/install.sh | UNII_BIN='/x/unii' sh");
  expect(Update.update_cmd(undefined, "/it's/unii")).toEndWith("UNII_BIN='/it'\\''s/unii' sh");
});
