UniiChat (arteeh's fork)
========================

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers. This fork runs it as your own server, for you alone. The
original is [VictorTaelin/uniichat](https://github.com/VictorTaelin/uniichat).

**This repo is vibe-coded.** AI agents wrote nearly all of it, and AI
agents reviewed it. Expect bugs.

Features
--------

- **One chat, a memory tree.** Every message is summarized into one line,
  and neighboring lines are merged in pairs, again and again. Each call
  sees the whole chat, recent messages in detail and older ones in
  broader lines, and can zoom into any line down to the original message.
- **Agents and devices.** Unii runs a shell, reads and edits files and
  views images and videos on your computers that run `unii device`. It
  spawns subagents, which work in the background and report back.
- **Schedules, goals, imports.** It can message itself on a schedule,
  keep working until a `/goal` is met, and take in your past Claude Code
  and Codex sessions (or the websites' exports).
- **Web, phone and terminal.** The server hosts the web app (installable,
  with push notifications); `unii` is the same chat in a terminal.

What this fork adds:

- **One owner per server**, no accounts, email or billing; `unii serve
  sessions` and `revoke` to sign a lost device out.
- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`)
  beside API keys; profiles that fall back to the next model when one is
  out; usage limits waited out instead of failing; a model per subagent.
- **An installable web app (PWA)** on phones and desktops: icons, an
  offline shell, Web Push for replies, a nav bar that shows on Android;
  the composer stays above a phone's keyboard.
- **Native Windows**: server, devices and terminal, with a one-line
  PowerShell install.
- **MCP servers** (a device's set up on it), **skills**, **schedules**
  (once or by cron), image and video viewing.
- **A Settings page**, an editable user prompt and compaction prompt,
  and a memory tree browser.
- **Subagents**: their own tab, a `stop` that ends one and its jobs, and
  a report when one hits a usage limit.
- **No telemetry or update checker**: `unii update` when you want it.
- **Background services** (`-d`, `stop`, `logs`) that updates restart,
  and a **conversation mode**.

Install and set up
------------------

On Linux or macOS (or in WSL):

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

This installs `unii` to `~/.local/bin`. The installer also moves data
from older versions.

Windows: native, or WSL with the Linux installer. Natively, in
PowerShell:

    irm https://github.com/arteeh/uniichat/releases/latest/download/install.ps1 | iex

This installs `unii.exe` to `%LOCALAPPDATA%\Programs\unii` (set
`$env:UNII_BIN` first for another place) and adds its folder to your
user PATH (no admin).
The server, devices and the terminal all run on Windows as on Linux and
macOS, with the data in `%USERPROFILE%\.unii` (no older unii kept any
on Windows, so the installer moves nothing there). Nobody has run them on
real Windows yet, though: expect rough edges there. One known gap: the
`stop` tool kills a job's process tree while its shell runs, but can't
find a process that left the tree once its shell has ended (Linux and
macOS find those by a mark in their environment).

`unii update` installs the newest release and restarts the background
services `-d` made (below) on it. A server or device you run another
way keeps the old one till it restarts; on Windows the installer won't
run while one does: stop it first, update, start it again.

1. **Start the server** on the computer that keeps your chat: `unii
   serve -d` runs it in the background (below); `unii serve` in the
   foreground. It serves http://127.0.0.1:8788; its data is in `~/.unii`
   (`$UNII_DIR`). Put it behind HTTPS (e.g. `tailscale serve`) to reach
   it from elsewhere, and set `site` to that address.
2. **Sign in.** On the server's computer, `unii serve link` prints a link
   that signs a browser in. A terminal or a device signs in by a link and
   a code you confirm in that browser. `unii serve sessions` lists them;
   `unii serve revoke <n>` (or `--all`) signs one out.
3. **Pick a vendor.** In the web app, ☰ › Settings: vendors, models and
   API keys (kept in `~/.unii/keys.json`, readable by you alone: on
   Windows by your profile folder's permissions). For a plan instead of
   keys, run `unii serve claude` (Claude) or `unii serve chatgpt`
   (ChatGPT) on the server's computer, then pick `claude-sub` or
   `openai-sub`. Each takes `logout` or `status`.
4. **Add devices.** On each computer Unii may work on, run `unii device
   -d https://your-server`: it prints a link and a code to confirm in
   your browser, then runs in the background. Its work dir is
   `~/.unii/work`; its settings are in `~/.config/unii/device.json`.
   Its own MCP servers go in its `~/.unii/config.json` (`mcp`, below):
   they come and go with it and an edit needs no restart, from the next
   turn (once no subagent is working); their tools are named
   `<device>_<server>__<tool>` (one over 64 characters is left out). On
   the server's computer the two share that file: its programs run as
   the server's, and the device brings in its edits.

**In the background**, `-d` runs the server or a device as a service of
your user (a systemd user service; on Windows a Scheduled Task, no
admin; on macOS a LaunchAgent), started at login and again if it
crashes. `-d` again restarts it, `stop` (`unii serve stop`, `unii device
stop`) stops and removes it, and `logs [-f]` shows (follows) its output:
the journal on Linux, `~/.unii/logs/` on Windows and macOS. On Linux,
`loginctl enable-linger` starts it at boot and keeps it up after you log
out. A service by its name (`unii-serve`, `unii-device`) that you made
yourself is left as it is: remove it to use `-d`.

The server's settings are in `~/.unii/config.json` (most are on the
Settings page). Each may also be set as `UNII_<KEY>`, which wins. Besides
`vendors`, `models`, `pick`, `compactor`, `agents`, `profiles` and `site`:

- `compactor_context` (also on the Settings page): how much of the chat,
  in KB (default 4), each summary sees beside its message. More lets the
  compactor copy in what the message doesn't say; Sonnet medium does
  that less than Haiku.
- `mcp`: MCP servers, in Claude's `mcpServers` shape (or a file path):
  URL servers and programs run on the server. A program to run on a
  device goes in that device's own `~/.unii/config.json`, in the same
  shape (no `"device"`); its `${VAR}`s are read there.
- `after`: a shell command run after each turn (by sh; on Windows by
  PowerShell).
- `claude_sub`, `claude`, `chatgpt`: where the plans' sign-ins are kept.
- `apple`, `apns`: the iOS app's (ios/) App ID and push key id.

The prompts: `~/.unii/prompt.md` (every turn; subagents get it too)
and `~/.unii/compact.md` (every summary, nothing else) replace the
built-in `prompt.txt` and `compact.txt`. Edit them on the Settings page.

Use
---

- **Web:** the server's address. ☰ has Settings (with the MCP servers
  on or off), the memory tree and Import History.
- **Terminal:** `unii [url]` (default: `$UNII_URL`, else the last server,
  else the local one). `/help` lists its commands; `/import` brings in
  this computer's Claude and Codex sessions.
- **Conversation mode:** the standard / conversation switch by "fold all"
  (`/mode` in the terminal) keeps your and Unii's messages word for word
  in Unii's view from then on, for a discussion; it costs more per turn.
  Its line fills as that space (96 KB, beside the summaries before it)
  does; full, it switches itself off.
- `unii help` lists every command. unii never checks for updates by
  itself: `unii update` installs the newest release.

From source (Bun): `bun install`, `bun run web` (rebuilds web/app.js),
`bun Cli.ts <command>`, `bun run build` (one `unii` executable).

Uninstall
---------

Back up the server's data (`~/.unii`) first if you may want your chat
again. The paths below are the defaults: if you set `UNII_BIN`,
`UNII_DIR` or `XDG_CONFIG_HOME`, remove those places instead.

First run `unii device stop` and `unii serve stop` where you used `-d`
(and stop any service you made yourself).

- **Linux, macOS:** `rm ~/.local/bin/unii` and `rm -rf ~/.unii
  ~/.config/unii`.
- **Windows:** quit any other `unii` you run, then `Remove-Item
  -Recurse -Force "$env:LOCALAPPDATA\Programs\unii", "$HOME\.unii",
  "$HOME\.config\unii"`, and take `%LOCALAPPDATA%\Programs\unii` out of
  your user Path (`rundll32 sysdm.cpl,EditEnvironmentVariables`).

Q&A
---

**Can Unii use my screen?**

Not by itself: ask Unii to add a computer-use MCP server, such as
[cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
to the device whose screen it should use.

**Can I sandbox Unii? I don't trust its unlimited tool calling.**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run
`unii device` in the sandbox and on no other computer, pointed at your
`unii serve` outside it (`http://host.docker.internal:8788` if the server
runs on the same PC). Then let the sandbox reach it:
`sbx policy allow network localhost:8788`. The sandbox turns
host.docker.internal into localhost, so the rule names localhost.

**How can I reach UniiChat from outside my home network?**

With Tailscale: ask Unii to set up Tailscale Serve on HTTPS port 443,
pointing at `unii serve`. Only your own Tailscale devices can reach it,
not the whole internet.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a
plan, either.

**Upgrading from arteeh.16 or older?**

Stop the server first (`systemctl --user stop unii-serve`), run the
installer, then start it: it moves your data to the new layout and won't
while a server runs. Your user prompt is then fixed in `prompt.md` (empty
it on the Settings page to get later built-in changes). The terminal is no
device any more: set up `unii device` (above) on each computer Unii should
work on.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company.
