#!/usr/bin/env bun
// Cli
// ===
// `unii`: one executable (this fork's GitHub releases, Update.ts) for
// three parts, each with its own config and state: the server (`unii
// serve`, Server.ts; its data and sign-ins in ~/.unii), a device (`unii
// device`, Device.ts) and the terminal chat (`unii [url]`, Term.ts),
// these two with their files in ~/.config/unii (Client.ts). `unii
// update` runs the newest release's installer, which replaces this
// executable.
//
// Usage: USAGE (`unii help` prints it).

import * as child from "node:child_process";
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
       unii update          replace this unii with the fork's newest
                            release (curl | sh, shown first)
       unii update <url>    run that server's installer instead
       unii version         this unii's version
       unii help            this
The terminal and the device keep their server and sign-in in
~/.config/unii (tui.json, device.json). Once a day the terminal asks
GitHub which release of arteeh/uniichat is the newest (one plain GET);
UNII_NO_UPDATE_CHECK=1 turns that off. In the chat, /help lists every
command and key.`;

function fail(why: string): never {
  console.error("unii: " + why);
  process.exit(1);
}

// runs an installer: the one way unii changes. It replaces this
// executable, wherever and however named; from source (bun) there is
// none to replace. The command prints first, so one can run it alone.
function update(url: string | undefined): void {
  if (process.platform === "win32") {
    fail("on Windows, build unii.exe again from the source (README).");
  }
  if (/^bun(\.exe)?$/.test(process.execPath.split("/").pop() ?? "")) {
    fail("this unii runs from source (bun): update it with git.");
  }
  const cmd = Update.update_cmd(url, process.execPath);
  console.error(cmd);
  process.exitCode = child.spawnSync("sh", ["-c", cmd], { stdio: "inherit" }).status ?? 1;
}

const [cmd, sub, more] = REST;
const odd = (words: string[]) => REST.slice(words.length).length > 0;

if (cmd === undefined) {
  await (await import("./Term.ts")).main(URL_);
} else if (["help", "--help", "-h"].includes(cmd)) {
  console.log(USAGE);
} else if (cmd === "version" && !odd([cmd])) {
  console.log("unii " + Update.VERSION);
} else if (cmd === "update" && !odd([cmd])) {
  update(URL_);
} else if (cmd === "device" && !odd([cmd])) {
  await (await import("./Device.ts")).run(URL_);
} else if (cmd === "serve" && sub === "chatgpt" && [undefined, "logout", "status"].includes(more) && !odd([cmd, sub, ...(more ? [more] : [])])) {
  await (await import("./ChatGPT.ts")).ChatGPT.cli(REST.slice(1)).catch((err) => fail(err.message));
} else if (cmd === "serve" && sub === "claude" && [undefined, "logout", "status"].includes(more) && !odd([cmd, sub, ...(more ? [more] : [])])) {
  await (await import("./ClaudeSub.ts")).ClaudeSub.cli(REST.slice(1)).catch((err) => fail(err.message));
} else if (cmd === "serve" && sub === "link" && !odd([cmd, sub])) {
  (await import("./Owner.ts")).Owner.cli();
} else if (cmd === "serve" && (sub === undefined || /^\d+$/.test(sub)) && !odd([cmd, ...(sub ? [sub] : [])]) && URL_ === undefined) {
  await (await import("./Server.ts")).serve(Number(sub ?? 8788));
} else {
  const moved = cmd === "chatgpt" || cmd === "claude" ? " (now unii serve " + cmd + ")" : "";
  fail("no command " + ARGS.join(" ") + moved + ".\n\n" + USAGE);
}
