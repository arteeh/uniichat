// Server test
// ===========
// `bun test Server.test.ts`. `./Server.ts <port>` alone serves the site
// (its prices only if it bills); with workers set, it is their
// supervisor, which only routes (a proxy in front sends each request to
// the worker it names).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// `./Server.ts <port>` on a fresh dir, with `env`: its answer to `path`,
// read whole, once it answers
async function server_get(port: number, env: Record<string, string>, path: string): Promise<Response> {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  const site = "http://127.0.0.1:" + port;
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, ...env },
    stdout : "ignore",
    stderr : "inherit",
  });
  try {
    for (let k = 0; k < 100; k++) {
      const res = await fetch(site + path).catch(() => null);
      if (res !== null) {
        return new Response(await res.text(), res);
      }
      await Bun.sleep(50);
    }
    throw new Error("no answer on " + site);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

test("Server.ts alone serves the page", async () => {
  const res = await server_get(9461, {}, "/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>");
});

test("with workers, Server.ts routes to them", async () => {
  const res = await server_get(9471, { UNII_WORKERS: "2" }, "/");
  expect(res.headers.get("x-unii-worker")).toMatch(/^127\.0\.0\.1:947[23]$/);
  expect(await res.text()).toBe("");
});

// a server says whether it bills (Billing.ts): this one doesn't, so it
// serves no prices or terms
test("a free server bills nothing: it says so, and shows no prices or terms", async () => {
  expect(await (await server_get(9481, {}, "/api/hello")).json()).toMatchObject({ bills: false, github: false });
  expect((await server_get(9482, {}, "/pricing")).status).toBe(404);
  expect((await server_get(9483, {}, "/terms.html")).status).toBe(404);
});

// a /model while the turn's call runs picks the next call's: the wait
// names the model the running one asked. Its own process, as config is
// read once a process (another test file's dir is not this one's)
const TURN = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
Chat.take(chat, Chat.push(chat, null, "user", "hi"));
await Bun.sleep(10);
const model = chat.pick.model;
const waited = Chat.waits(chat);
const to = { ...chat.pick, model: model === "opus-5.5" ? "haiku-5.5" : "opus-5.5" };
const acted = await Chat.act(chat, "pick", { $: "pick", to }, "");
console.log(JSON.stringify({ model, waited, acted, picked: chat.pick.model, to: to.model, after: Chat.waits(chat) }));
process.exit(0);
`;

test("a turn's wait names the model it runs on, not one picked since", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/turn.ts", TURN);
  const proc = Bun.spawn([process.execPath, dir + "/turn.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.model).toMatch(/\w/);
  expect(out.to).not.toBe(out.model);
  expect(out.waited).toBe(out.model);
  expect(out.acted).toEqual({});
  expect(out.picked).toBe(out.to);
  expect(out.after).toBe(out.model);
});

// a user's SOUL.md joins only their chat's prompts (subagents' too);
// only the owner replaces the base prompt, for all. Its own process,
// as config is read once a process
const SOUL = `
const { Chat, Main } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { MASTER, Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const boss = { id: "u1", name: "Boss@b.c" };
const sam = { id: "u2", name: "sam@b.c" };
const [a, b] = [Chat.open(boss), Chat.open(sam)];
const post = async (chat, user, body) => (await Main.soul(chat, user, new Request("http://x/api/soul", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }))).status;
const system = (chat) => Chat.share(chat).system;
const out = {};
// none: the prompt as before, byte for byte (the vendor's cache holds)
out.plain = system(b) === MASTER + "\\n\\n" + "rules here\\n";
out.set = await post(b, sam, { soul: "Call yourself Kit." });
out.sams = system(b);
out.boss = system(a);
out.sub = Tools.system("SUB", b.mem.dir);
out.exported = JSON.parse([...Memory.dump(b.mem, {})].join("")).soul;
out.big = await post(b, sam, { soul: "x".repeat(16 * 1024 + 1) });
out.junk = await post(b, sam, "not json");
out.kept = system(b);
out.denied = await post(b, sam, { base: "You are Bob." });
out.deniedboss = system(a);
out.base = await post(a, boss, { base: "You are Bob." });
out.sambase = system(b);
out.cleared = await post(b, sam, { soul: "" });
console.log(JSON.stringify(out));
process.exit(0);
`;

test("SOUL.md joins a user's prompts; only the owner replaces the base prompt", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/soul.ts", SOUL);
  fs.writeFileSync(dir + "/rules.md", "rules here\n");
  const env = { ...process.env, UNII_DIR: dir, UNII_OWNER: "boss@b.c", UNII_RULES: dir + "/rules.md" };
  const proc = Bun.spawn([process.execPath, dir + "/soul.ts"], { env, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.plain).toBe(true);
  expect(out.set).toBe(200);
  expect(out.sams).toContain("Call yourself Kit.");
  expect(out.boss).not.toContain("Kit");
  expect(out.sub).toContain("Call yourself Kit.");
  expect(out.exported).toBe("Call yourself Kit.");
  expect([out.big, out.junk]).toEqual([413, 400]);
  expect(out.kept).toContain("Call yourself Kit.");
  expect(out.denied).toBe(403);
  expect(out.deniedboss).not.toContain("Bob");
  expect(out.base).toBe(200);
  expect(out.sambase).toStartWith("You are Bob.");
  expect(out.cleared).toBe(200);
  expect(fs.existsSync(dir + "/users/u2/SOUL.md")).toBe(false);
});

// a deploy (Main.away): a call the old process gives away is cut once it
// waits for a usage limit, so the old process doesn't wait hours; one only
// passed on is left to its origin. Where the chat went, a cut turn and
// agent go on as after a restart, nothing lost
const DEPLOY = `
const at = (f) => ${JSON.stringify(import.meta.dir)} + "/" + f;
const { Chat, Main } = await import(at("Server.ts"));
const { AskAI } = await import(at("AskAI.ts"));
const { Cloud } = await import(at("Cloud.ts"));
const { Memory } = await import(at("Memory.ts"));
const { Tools } = await import(at("Tools.ts"));
const { TURN } = await import(at("View.ts"));
const out = {};
const sent = [];
const peer = { send: (m) => sent.push(m.$ === "end" ? "end " + m.end.cut : m.ev.$), end: (then) => then(), asks: new Map(), feeds: new Map(), grants: new Map() };
const LIMIT = { $: "Limit", limit: { until: Date.now() + 7200e3, known: true } };
const fake = () => {
  const c = { stopped: 0, woken: 0 };
  const [call, feed] = AskAI.tie(() => {}, undefined, () => {}, () => {
    c.stopped += 1;
    feed.end({ ok: false, text: "stopped", left: [], stop: "lost" });
  }, () => (c.woken += 1));
  return { c, call, feed };
};
const mine = fake();
Main.away(peer, mine.call);
mine.feed.on({ $: "Entry", kind: "mind", text: "x" });
mine.feed.on(LIMIT);
mine.feed.on({ $: "Limit", limit: null });
out.mine = [mine.c.woken, mine.c.stopped, ...sent.splice(0)];
const passed = fake();
Main.refs.set(passed.call, "elsewhere#1");
Main.away(peer, passed.call);
passed.feed.on(LIMIT);
out.passed = [passed.c.woken, passed.c.stopped, ...sent.splice(0)];
// where the chat went
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
const calls = [];
AskAI.ask = (ask, on) => {
  const c = { ask, on, stopped: false };
  const [call, feed] = AskAI.tie(on, ask.bill, () => {}, () => {
    c.stopped = true;
    feed.end({ ok: false, text: "stopped", left: [] });
  });
  c.feed = feed;
  calls.push(c);
  return call;
};
const CUT = { ok: false, text: "stopped", left: [], stop: "lost", cut: true };
const texts = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i).kind + ": " + Memory.message(chat.mem, i).text);
Chat.take(chat, Chat.push(chat, null, "user", "hi"));
await Bun.sleep(10);
const name = Tools.start(chat.tools, { $: "sub", effort: null, model: null }, "a task", []);
calls[0].feed.end(CUT);
await Bun.sleep(10);
out.turn = calls.length === 3 && texts().at(-1) === "note: " + Tools.restarted([TURN]);
calls[1].feed.end(CUT);
await Bun.sleep(10);
out.agent = calls.length === 4 && calls[3].ask.system === calls[1].ask.system && Memory.agent(chat.mem, name).at(-1).text === Tools.restarted([name]);
out.failed = texts().filter((t) => /No reply|No goal check|failed/.test(t));
console.log(JSON.stringify(out));
process.exit(0);
`;

test("a deploy cuts a call waiting for a usage limit, which goes on where its chat went", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/deploy.ts", DEPLOY);
  const proc = Bun.spawn([process.execPath, dir + "/deploy.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    mine    : [1, 1, "Entry", "end true"],
    passed  : [0, 0, "Limit"],
    turn    : true,
    agent   : true,
    failed  : [],
  });
});
// the settings page over HTTP: the owner's alone; a key saved is never
// sent back nor logged, and keys.json is the owner's only
test("settings: the owner's alone, keys never sent back", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/config.json", JSON.stringify({ owner: "owner@example.com" }));
  const site = "http://127.0.0.1:9491";
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", "9491"], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", RESEND_API_KEY: "" },
    stdout : "pipe",
    stderr : "inherit",
  });
  let out = "";
  (async () => {
    const reader = proc.stdout.getReader();
    for (let piece = await reader.read(); !piece.done; piece = await reader.read()) {
      out += new TextDecoder().decode(piece.value);
    }
  })();
  const get = (path: string, init: RequestInit = {}) => fetch(site + path, { ...init, redirect: "manual" });
  const sign_in = async (who: string) => {
    await get("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ who }) });
    for (let k = 0; k < 50 && !out.includes("sign-in link for " + who); k++) {
      await Bun.sleep(50);
    }
    const link = out.match(new RegExp("sign-in link for " + who.replace(".", "\\.") + ": (\\S+)"))![1];
    return ((await get(link.slice(site.length))).headers.get("set-cookie") ?? "").split(";")[0];
  };
  try {
    for (let k = 0; k < 100 && (await fetch(site + "/").catch(() => null)) === null; k++) {
      await Bun.sleep(50);
    }
    const owner = await sign_in("owner@example.com");
    const other = await sign_in("other@example.com");
    const json = { "content-type": "application/json" };
    expect((await get("/api/settings")).status).toBe(401);
    expect((await get("/api/settings", { headers: { cookie: other } })).status).toBe(403);
    const { version } = await (await get("/api/settings", { headers: { cookie: owner } })).json();
    const body = JSON.stringify({ version, set: {}, keys: { anthropic: "sk-ant-api03-NEVERSENTBACK0123456789-tail" } });
    expect((await get("/api/settings", { method: "POST", headers: { ...json, cookie: other }, body })).status).toBe(403);
    expect(fs.existsSync(dir + "/keys.json")).toBe(false);
    const saved = await get("/api/settings", { method: "POST", headers: { ...json, cookie: owner }, body });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain("NEVERSENTBACK");
    expect(fs.statSync(dir + "/keys.json").mode & 0o777).toBe(0o600);
    expect(out).not.toContain("NEVERSENTBACK");
  } finally {
    proc.kill();
    await proc.exited;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
