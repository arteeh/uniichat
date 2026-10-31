#!/usr/bin/env bun

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { err_why } from "./Err.ts";
import type { Part } from "./Service.ts";
import * as Update from "./Update.ts";

const SET = /^--env=(UNII_DIR|XDG_CONFIG_HOME)=(.+)$/;
const ARGS = process.argv.slice(2).filter((a) => !SET.test(a));
const SETS = process.argv.slice(2).filter((a) => SET.test(a));
for (const a of SETS) {
  const m = SET.exec(a);
  if (m !== null) {
    process.env[m[1]] = m[2];
  }
}
const WEB  = /^https?:\/\//;
const URL_ = ARGS.find((a) => WEB.test(a));
const FLAGS = ["-d", "-f", "--service"];
const HELPS = ["--help", "-h", "help"];
const REST = ARGS.filter((a) => !WEB.test(a) && !FLAGS.includes(a) && !HELPS.includes(a));
const FLAG = new Set(ARGS.filter((a) => FLAGS.includes(a)));

const SERVICE = process.env.UNII_SERVICE;
const SUPERVISOR = Number(process.env.UNII_SUPERVISOR ?? 0);
delete process.env.UNII_SERVICE;
delete process.env.UNII_SUPERVISOR;

type Cmd = {
  use: string;
  about: string;
  kids?: Cmd[];
  arg?: RegExp;
  need?: boolean;
  url?: boolean;
  follow?: boolean;
  run?: (arg?: string) => unknown;
};

const PORT = /^\d+$/;

async function serve_free(): Promise<void> {
  const Service = await import("./Service.ts");
  const dir = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=[\\/]|$)/, (await import("node:os")).homedir());
  const pid = Number(fs.existsSync(dir + "/server.pid") ? fs.readFileSync(dir + "/server.pid", "utf8") : 0);
  const up = pid > 0 && Service.ours("serve", [pid]).length > 0;
  if (up && Service.running("serve") === null) {
    fail("a unii server runs here already (pid " + pid + "), not as unii serve -d's service: stop it first.");
  }
}

function fail(why: string): never {
  console.error("unii: " + why);
  process.exit(1);
}

const WIN  = process.platform === "win32";
const BUN  = /^bun(\.exe)?$/i.test(path.basename(process.execPath));

function update(): void {
  if (BUN) {
    fail("this unii runs from source (bun): update it with git.");
  }
  const cmd = Update.update_cmd(WIN);
  console.error(cmd);
  const run = WIN ? powershell_exiting_as_installer(cmd) : ["sh", "-c", cmd];
  process.exitCode = child.spawnSync(run[0], run.slice(1), { stdio: "inherit", env: updater_env() }).status ?? 1;
}

const FAILED_TILL_INSTALLER_EXITS = "$global:LASTEXITCODE = 1; ";

function powershell_exiting_as_installer(cmd: string): string[] {
  return [Bun.which("pwsh") ?? "powershell.exe", "-NoProfile", "-Command", "$ErrorActionPreference = 'Stop'; " + FAILED_TILL_INSTALLER_EXITS + cmd + "; exit $LASTEXITCODE"];
}

function updater_env(): Record<string, string | undefined> {
  return { ...process.env, UNII_UPDATER: String(process.pid), UNII_BIN: process.execPath };
}

function unmark_from_parent_shell(): void {
  for (const k of ["UNII_RUN", "UNII_AGENT", "INVOCATION_ID"]) {
    delete process.env[k];
  }
}

// on Windows a running unii.exe can't be replaced, only renamed: the
// installer leaves the one it replaced as unii.exe.old (or .old-<n>),
// removed here once it no longer runs (one still running stays till a
// later start). Only those names: any other file beside it is the user's
if (WIN && !BUN) {
  const dir = path.dirname(process.execPath);
  const leaf = path.basename(process.execPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const old = new RegExp("^" + leaf + "\\.old(-[0-9]+)?$", "i");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => old.test(f));
  } catch {}
  for (const f of files) {
    try {
      if (fs.lstatSync(path.join(dir, f)).isFile()) {
        fs.rmSync(path.join(dir, f));
      }
    } catch {}
  }
}

async function run_here(part: Part): Promise<void> {
  not_by_sudo(part);
  const Service = await import("./Service.ts");
  if (SERVICE === undefined) {
    Service.foreground(part);
  } else {
    Service.served(part);
  }
}

function service(part: Part, run: (arg?: string) => unknown): Cmd[] {
  return [
    { use: "-d", about: "the same, as a service that starts at login", arg: part === "serve" ? PORT : undefined, url: part === "device", run: (arg) => { not_by_sudo(part + " -d"); return run(arg); } },
    { use: "stop", about: "stop and remove that service", run: async () => { unmark_from_parent_shell(); await (await import("./Service.ts")).stop(part); } },
    { use: "logs [-f]", about: "its output (-f: keep following)", follow: true, run: async () => (await import("./Service.ts")).logs(part, FLAG.has("-f")) },
  ];
}

function not_by_sudo(cmd: string): void {
  const user = process.env.SUDO_USER;
  if (!WIN && process.getuid?.() === 0 && user !== undefined) {
    fail("Run `unii " + cmd + "` without sudo. To give the agent admin rights, set up passwordless sudo for " + user + ".");
  }
}

function plan(name: "claude" | "chatgpt", about: string): Cmd {
  const cli = async (word: string) => {
    const mod = name === "claude" ? (await import("./ClaudeSub.ts")).ClaudeSub : (await import("./ChatGPT.ts")).ChatGPT;
    await mod.cli([word]).catch((err: unknown) => fail(err_why(err)));
  };
  return { use: name, about, kids: [
    { use: "login", about: "sign in", run: () => cli("login") },
    { use: "logout", about: "sign out", run: () => cli("logout") },
    { use: "status", about: "who it's signed in as", run: () => cli("status") },
  ] };
}

const TREE: Cmd = { use: "unii [url]", about: "the chat in this terminal", url: true, run: async () => (await import("./Term.ts")).main(URL_), kids: [
  { use: "device [url]", about: "this computer as a device of a server", url: true, run: async () => { await run_here("device"); await (await import("./Device.ts")).run(URL_); }, kids: service("device", async () => {
    unmark_from_parent_shell();
    const Service = await import("./Service.ts");
    const admin = Service.admin("device");
    await (await import("./Device.ts")).signin(URL_);
    await Service.start("device", [], admin);
  }) },
  { use: "serve [port]", about: "your UniiChat server (port 8788)", arg: PORT, run: async (port) => { await run_here("serve"); await (await import("./Server.ts")).serve(Number(port ?? 8788)); }, kids: [
    ...service("serve", async (port) => {
      unmark_from_parent_shell();
      await serve_free();
      const Service = await import("./Service.ts");
      await Service.start("serve", port === undefined ? [] : [port], Service.admin("serve"));
    }),
    { use: "link", about: "a link that signs a browser in", run: async () => { (await import("./Owner.ts")).Owner.cli(); } },
    { use: "sessions", about: "the browsers, terminals and devices signed in", run: async () => (await import("./Owner.ts")).Owner.sessions(), kids: [
      { use: "revoke <n>|--all", about: "sign one out, or all", arg: /^(\d+|--all)$/, need: true, run: async (n) => (await import("./Owner.ts")).Owner.sessions(n).catch((err: unknown) => fail(err_why(err))) },
    ] },
    plan("claude", "your Claude plan (claude-sub)"),
    plan("chatgpt", "your ChatGPT plan (openai-sub)"),
  ] },
  { use: "update", about: "install the newest release", run: update },
  { use: "version", about: "this unii's version", run: () => console.log("unii " + Update.VERSION) },
  { use: "help", about: "this" },
] };

const key = (c: Cmd) => c.use.split(" ")[0];

function rows(c: Cmd, head: string, depth: number): [string, string][] {
  return [["  ".repeat(depth) + head, c.about], ...(c.kids ?? []).flatMap((k) => rows(k, k.use, depth + 1))];
}

const words = REST[0] === "-v" || REST[0] === "--version" ? ["version", ...REST.slice(1)] : [...REST];
const help = ARGS.some((a) => HELPS.includes(a));
let cmd = TREE;
const trail = ["unii"];
while (words.length > 0) {
  const next = cmd.kids?.find((k) => key(k) === words[0]);
  if (next === undefined) {
    break;
  }
  cmd = next;
  trail.push(key(next));
  words.shift();
}
const part = trail[1] === "device" || trail[1] === "serve" ? trail[1] : null;
const daemon = FLAG.has("-d") ? cmd.kids?.find((k) => key(k) === "-d") : undefined;
if (daemon !== undefined) {
  cmd = daemon;
  trail.push("-d");
}

if (SUPERVISOR > 0) {
  (await import("./Service.ts")).watch(SUPERVISOR, part ?? undefined);
}

const service_run = FLAG.has("--service") && trail.length === 2 && FLAG.size === 1 ? part : null;
const arg = words[0];
const fits =
  cmd.run !== undefined &&
  words.length <= (cmd.arg ? 1 : 0) &&
  (arg === undefined ? !cmd.need : cmd.arg?.test(arg) === true) &&
  (URL_ === undefined || cmd.url === true) &&
  [...FLAG].every((f) => (f === "-d" && daemon !== undefined) || (f === "-f" && cmd.follow === true) || (f === "--service" && service_run !== null)) &&
  (SETS.length === 0 || service_run !== null);

if (help || !fits) {
  const head = trail.length === 1 ? TREE.use : [...trail.slice(0, -1), cmd.use].join(" ");
  const all = rows(cmd, head, 0);
  const width = Math.max(31, ...all.map(([use]) => use.length + 2));
  console.log(all.map(([use, about]) => use.padEnd(width) + about).join("\n"));
  process.exitCode = help ? 0 : 2;
} else if (service_run !== null) {
  await (await import("./Service.ts")).supervise(service_run, REST.slice(1).concat(URL_ ?? []));
} else {
  await cmd.run?.(arg);
}
