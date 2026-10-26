#!/usr/bin/env bun
// Cli
// ===
// `unii`: one executable (this fork's GitHub releases, Update.ts) for
// three parts, each with its own config and state: the server (`unii
// serve`, Server.ts; its data and sign-ins in ~/.unii), a device (`unii
// device`, Device.ts) and the terminal chat (`unii [url]`, Term.ts),
// these two with their files in ~/.config/unii (Client.ts). Either of
// the first two runs in the background too, as a user service of the OS
// (`-d`, `stop`, `logs`: Service.ts). `unii update` runs the newest
// release's installer, which replaces this executable (and restarts
// those services). All three run on Linux, macOS and Windows alike.
//
// Usage: USAGE (`unii help` prints it).

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Update from "./Update.ts";

// a Windows service's dirs (Service.ts DIRS), as `--env=<name>=<dir>`:
// set before any part reads them
const SET = /^--env=(UNII_DIR|XDG_CONFIG_HOME)=(.+)$/;
const ARGS = process.argv.slice(2).filter((a) => !SET.test(a));
const SETS = process.argv.slice(2).filter((a) => SET.test(a));
for (const a of SETS) {
  const [, k, v] = a.match(SET)!;
  process.env[k] = v;
}
const WEB  = /^https?:\/\//;
const URL_ = ARGS.find((a) => WEB.test(a));
// -d: to the background; -f: logs followed; --service: as a service's
// supervisor runs (Service.ts), not typed by hand
const FLAGS = ["-d", "-f", "--service"];
const REST = ARGS.filter((a) => !WEB.test(a) && !FLAGS.includes(a));
const FLAG = new Set(ARGS.filter((a) => FLAGS.includes(a)));

// a background service's own run (Service.ts), which no program it runs
// inherits: the part it runs, and on Windows and macOS its supervisor
const SERVICE = process.env.UNII_SERVICE;
const SUPERVISOR = Number(process.env.UNII_SUPERVISOR ?? 0);
delete process.env.UNII_SERVICE;
delete process.env.UNII_SUPERVISOR;

const USAGE = `Usage: unii [url]           the chat in this terminal (url: $UNII_URL, else
                            the last one, else http://127.0.0.1:8788)
       unii device [url]    this computer as a device of the server: the
                            agent's shell and files here
       unii serve [port]    your UniiChat server, at http://127.0.0.1:8788
                            (another port: set its "site" too); data in
                            ~/.unii ($UNII_DIR)
       unii device|serve -d [url|port]
                            the same in the background, as a service of
                            your user (systemd; Windows: a Scheduled Task;
                            macOS: a LaunchAgent) that starts at login and
                            again if it crashes; run again, it restarts
       unii device|serve stop
                            stop that service and remove it
       unii device|serve logs [-f]
                            its output (-f: and follow it)
       unii serve link      a link that signs a browser in to the server
                            here (run it where the server runs)
       unii serve chatgpt [logout|status]
                            sign the server here in to a ChatGPT plan (its
                            openai-sub vendor), by a code entered in any
                            browser; or out; or show who it's signed in as
       unii serve claude [logout|status]
                            the same for a Claude plan (its claude-sub
                            vendor), in Claude Code's own sign-in
       unii serve sessions  the browsers, terminals and devices signed in
       unii serve revoke <n>|--all
                            sign one of them out (its open sockets close),
                            or all
       unii update          replace this unii with the fork's newest
                            release (its installer, shown first)
       unii version         this unii's version
       unii help            this
The terminal and the device keep their server and sign-in in
~/.config/unii (tui.json, device.json). unii never checks for updates by
itself: run unii update. In the chat, /help lists every command and key.`;

// before serve -d: no server running here but the service's (it would
// hold the data, and the service could never start)
async function serve_free(): Promise<void> {
  const Service = await import("./Service.ts");
  const dir = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=[\\/]|$)/, (await import("node:os")).homedir());
  const pid = Number(fs.existsSync(dir + "/server.pid") ? fs.readFileSync(dir + "/server.pid", "utf8") : 0);
  // still a unii server (a pid reused since isn't)
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

// runs an installer: the one way unii changes. It replaces this
// executable, wherever and however named; from source (bun) there is
// none to replace. The command prints first, so one can run it alone:
// on Windows a PowerShell one, its exit code the installer's (install.ps1
// ends setting $LASTEXITCODE, as an `exit` would close the window of one
// who runs it by hand; 1 until it does, so one that never got that far
// failed). The installer is told this process's pid (UNII_UPDATER): on
// Windows it refuses while a device or server runs that no service of
// -d's runs (it restarts those), but not for this
function update(): void {
  if (BUN) {
    fail("this unii runs from source (bun): update it with git.");
  }
  const cmd = Update.update_cmd(process.execPath, WIN);
  console.error(cmd);
  const run = WIN ? [Bun.which("pwsh") ?? "powershell.exe", "-NoProfile", "-Command", "$ErrorActionPreference = 'Stop'; $global:LASTEXITCODE = 1; " + cmd + "; exit $LASTEXITCODE"] : ["sh", "-c", cmd];
  const env = { ...process.env, UNII_UPDATER: String(process.pid) };
  process.exitCode = child.spawnSync(run[0], run.slice(1), { stdio: "inherit", env }).status ?? 1;
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

const [cmd, sub, more] = REST;
const odd = (words: string[]) => REST.slice(words.length).length > 0;
// flags only where they go: -d and --service on a part's run, -f on logs
const part = cmd === "serve" || cmd === "device" ? cmd : null;
const flags = (...ok: string[]) => [...FLAG].every((f) => ok.includes(f)) && !(FLAG.has("-d") && FLAG.has("--service"));
const runs = part !== null && (part === "device" ? sub === undefined : sub === undefined || /^\d+$/.test(sub)) && !odd([cmd, ...(sub ? [sub] : [])]) && (part === "device" || URL_ === undefined) && flags("-d", "--service");
if (SUPERVISOR > 0) {
  (await import("./Service.ts")).watch(SUPERVISOR, part ?? undefined);
}

// what a service -d makes or stop ends must not carry the marks of the
// unii shell this may run in (Machine.ts: as that device quits, it kills
// what has them), nor its systemd unit's id
if (part !== null && (FLAG.has("-d") || sub === "stop")) {
  for (const k of ["UNII_RUN", "UNII_AGENT", "INVOCATION_ID"]) {
    delete process.env[k];
  }
}

if ((SETS.length > 0 && !FLAG.has("--service")) || (FLAG.size > 0 && !runs && !(part !== null && sub === "logs" && flags("-f")))) {
  fail("no command " + ARGS.join(" ") + ".\n\n" + USAGE);
} else if (runs && FLAG.has("--service")) {
  await (await import("./Service.ts")).supervise(part!, REST.slice(1).concat(URL_ ?? []));
} else if (runs && FLAG.has("-d")) {
  if (part === "device") {
    await (await import("./Device.ts")).signin(URL_);
  } else {
    await serve_free();
  }
  await (await import("./Service.ts")).start(part!, REST.slice(1));
} else if (part !== null && sub === "stop" && !odd([cmd, sub]) && URL_ === undefined) {
  await (await import("./Service.ts")).stop(part);
} else if (part !== null && sub === "logs" && !odd([cmd, sub]) && URL_ === undefined) {
  await (await import("./Service.ts")).logs(part, FLAG.has("-f"));
} else if (cmd === undefined) {
  await (await import("./Term.ts")).main(URL_);
} else if (["help", "--help", "-h"].includes(cmd)) {
  console.log(USAGE);
} else if (cmd === "version" && !odd([cmd])) {
  console.log("unii " + Update.VERSION);
} else if (cmd === "update" && !odd([cmd]) && URL_ === undefined) {
  update();
} else if (runs && part === "device") {
  if (SERVICE === undefined) {
    (await import("./Service.ts")).foreground(part!);
  } else {
    (await import("./Service.ts")).served(part!);
  }
  await (await import("./Device.ts")).run(URL_);
} else if (cmd === "serve" && sub === "chatgpt" && [undefined, "logout", "status"].includes(more) && !odd([cmd, sub, ...(more ? [more] : [])])) {
  await (await import("./ChatGPT.ts")).ChatGPT.cli(REST.slice(1)).catch((err) => fail(err.message));
} else if (cmd === "serve" && sub === "claude" && [undefined, "logout", "status"].includes(more) && !odd([cmd, sub, ...(more ? [more] : [])])) {
  await (await import("./ClaudeSub.ts")).ClaudeSub.cli(REST.slice(1)).catch((err) => fail(err.message));
} else if (cmd === "serve" && sub === "sessions" && !odd([cmd, sub])) {
  await (await import("./Owner.ts")).Owner.sessions();
} else if (cmd === "serve" && sub === "revoke" && more !== undefined && !odd([cmd, sub, more])) {
  await (await import("./Owner.ts")).Owner.sessions(more).catch((err) => fail(err.message));
} else if (cmd === "serve" && sub === "link" && !odd([cmd, sub])) {
  (await import("./Owner.ts")).Owner.cli();
} else if (runs && part === "serve") {
  if (SERVICE === undefined) {
    (await import("./Service.ts")).foreground(part!);
  } else {
    (await import("./Service.ts")).served(part!);
  }
  await (await import("./Server.ts")).serve(Number(sub ?? 8788));
} else {
  const moved = cmd === "chatgpt" || cmd === "claude" ? " (now unii serve " + cmd + ")" : "";
  fail("no command " + ARGS.join(" ") + moved + ".\n\n" + USAGE);
}
