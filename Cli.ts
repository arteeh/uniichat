#!/usr/bin/env bun
// Cli
// ===
// `unii`: one executable (this fork's GitHub releases, Update.ts) for
// three parts, each with its own config and state: the server (`unii
// serve`, Server.ts; its data and sign-ins in ~/.unii), a device (`unii
// device`, Device.ts) and the terminal chat (`unii [url]`, Term.ts),
// these two with their files in ~/.config/unii (Client.ts). `unii
// update` runs the newest release's installer, which replaces this
// executable. All three run on Linux, macOS and Windows alike.
//
// Usage: USAGE (`unii help` prints it).

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Update from "./Update.ts";

const ARGS = process.argv.slice(2);
const WEB  = /^https?:\/\//;
const URL_ = ARGS.find((a) => WEB.test(a));
const REST = ARGS.filter((a) => !WEB.test(a));

const USAGE = `Usage: unii [url]           the chat in this terminal (url: $UNII_URL, else
                            the last one, else http://127.0.0.1:8788)
       unii device [url]    this computer as a device of the server: the
                            agent's shell and files here (run it as a
                            service to keep it up)
       unii serve [port]    your UniiChat server, at http://127.0.0.1:8788
                            (another port: set its "site" too); data in
                            ~/.unii ($UNII_DIR)
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
// Windows it refuses while a device or server runs, but not for this
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

if (cmd === undefined) {
  await (await import("./Term.ts")).main(URL_);
} else if (["help", "--help", "-h"].includes(cmd)) {
  console.log(USAGE);
} else if (cmd === "version" && !odd([cmd])) {
  console.log("unii " + Update.VERSION);
} else if (cmd === "update" && !odd([cmd]) && URL_ === undefined) {
  update();
} else if (cmd === "device" && !odd([cmd])) {
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
} else if (cmd === "serve" && (sub === undefined || /^\d+$/.test(sub)) && !odd([cmd, ...(sub ? [sub] : [])]) && URL_ === undefined) {
  await (await import("./Server.ts")).serve(Number(sub ?? 8788));
} else {
  const moved = cmd === "chatgpt" || cmd === "claude" ? " (now unii serve " + cmd + ")" : "";
  fail("no command " + ARGS.join(" ") + moved + ".\n\n" + USAGE);
}
