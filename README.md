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
- **MCP servers** (also run on a device), **skills**, **schedules** (once
  or by cron), image and video viewing.
- **A Settings page**, an editable user prompt and compaction prompt,
  and a memory tree browser.
- **Subagents**: their own tab, a `stop` that ends one and its jobs, and
  a report when one hits a usage limit.
- **No telemetry or update checker**: `unii update` when you want it.

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

`unii update` installs the newest release. A server or device running
keeps the old one till it restarts; on Windows the installer won't run
while one does: stop it first (its task, below), update, start it again.

1. **Start the server** on the computer that keeps your chat (as a
   service, like a device below): `unii serve` serves
   http://127.0.0.1:8788; its data is in `~/.unii` (`$UNII_DIR`). Put it
   behind HTTPS (e.g. `tailscale serve`) to reach it from elsewhere, and
   set `site` to that address.
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
   https://your-server` once by hand: it prints a link and a code to
   confirm in your browser. Its work dir is `~/.unii/work`; its settings
   are in `~/.config/unii/device.json`. Then keep it up as a service,
   e.g. `~/.config/systemd/user/unii-device.service`:

       [Service]
       ExecStart=%h/.local/bin/unii device
       Restart=always
       [Install]
       WantedBy=default.target

   `systemctl --user enable --now unii-device` (and `loginctl
   enable-linger` to run it while you're logged out). The server's
   `unii-serve.service` is the same with `ExecStart=%h/.local/bin/unii
   serve`.

   On Windows, a task that starts it at logon, hidden (no window), and
   again within a minute whenever it has stopped (it is tried every
   minute, and skipped while it runs). For the server, set `$part` to
   `serve`:

       $part = "device"
       $unii = "$env:LOCALAPPDATA\Programs\unii\unii.exe"
       $act = New-ScheduledTaskAction -Execute conhost.exe -Argument "--headless `"$unii`" $part"
       $at = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
       $at.Repetition = (New-ScheduledTaskTrigger -Once -At 0:00 -RepetitionInterval (New-TimeSpan -Minutes 1)).Repetition
       $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
       Register-ScheduledTask "unii-$part" -Action $act -Trigger $at -Settings $set
       Start-ScheduledTask "unii-$part"

   To stop it (for an update, say), turn the task off, then end what it
   runs (Windows ends only the task's own conhost, maybe not unii):

       Disable-ScheduledTask "unii-$part"; Stop-ScheduledTask "unii-$part"
       Get-CimInstance Win32_Process -Filter "Name = 'unii.exe'" | Where-Object CommandLine -match "\s$part(\s|$)" | ForEach-Object { taskkill /T /F /PID $_.ProcessId }

   and to start it again: `Enable-ScheduledTask "unii-$part";
   Start-ScheduledTask "unii-$part"`.

The server's settings are in `~/.unii/config.json` (most are on the
Settings page). Each may also be set as `UNII_<KEY>`, which wins. Besides
`vendors`, `models`, `pick`, `compactor`, `agents`, `profiles` and `site`:

- `mcp`: MCP servers, in Claude's `mcpServers` shape (or a file path).
  Add `"device": "<name>"` to run one on a device.
- `after`: a shell command run after each turn (by sh; on Windows by
  PowerShell).
- `claude_sub`, `claude`, `chatgpt`: where the plans' sign-ins are kept.
- `apple`, `apns`: the iOS app's (ios/) App ID and push key id.

The prompts: `~/.unii/prompt.md` (every turn; subagents get it too)
and `~/.unii/compact.md` (every summary, nothing else) replace the
built-in `prompt.txt` and `compact.txt`. Edit them on the Settings page.

Use
---

- **Web:** the server's address. ☰ has Settings, the memory tree, Import
  History and the MCP servers on or off.
- **Terminal:** `unii [url]` (default: `$UNII_URL`, else the last server,
  else the local one). `/help` lists its commands; `/import` brings in
  this computer's Claude and Codex sessions.
- `unii help` lists every command. unii never checks for updates by
  itself: `unii update` installs the newest release.

From source (Bun): `bun install`, `bun run web` (rebuilds web/app.js),
`bun Cli.ts <command>`, `bun run build` (one `unii` executable).

Uninstall
---------

Back up the server's data (`~/.unii`) first if you may want your chat
again. The paths below are the defaults: if you set `UNII_BIN`,
`UNII_DIR` or `XDG_CONFIG_HOME`, remove those places instead.

- **Linux:** stop and remove the services you made (`systemctl --user
  disable --now unii-device`, and `unii-serve` if you made one, then
  their files in `~/.config/systemd/user`), then `rm ~/.local/bin/unii`
  and `rm -rf ~/.unii ~/.config/unii`.
- **macOS:** stop and remove the launch agents you made, if any
  (`launchctl bootout gui/$(id -u)/<its label>`, then its plist in
  `~/Library/LaunchAgents`), then `rm ~/.local/bin/unii` and `rm -rf
  ~/.unii ~/.config/unii`.
- **Windows:** stop each task you made (above), then
  `Unregister-ScheduledTask unii-device -Confirm:$false` (and
  `unii-serve`), quit any other `unii` you run, then `Remove-Item
  -Recurse -Force "$env:LOCALAPPDATA\Programs\unii", "$HOME\.unii",
  "$HOME\.config\unii"`, and take `%LOCALAPPDATA%\Programs\unii` out of
  your user Path (`rundll32 sysdm.cpl,EditEnvironmentVariables`).

Q&A
---

**Can Unii use my screen?** Not by itself: add a computer-use MCP server,
such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
run on that device:

    "mcp": { "screen": { "command": "cua-driver", "args": ["mcp"], "device": "my-mac",
             "env": { "CUA_DRIVER_RS_TELEMETRY_ENABLED": "0" } } }

**Can others use my server?** No: a server has one owner. Anthropic and
OpenAI don't allow sharing a plan, either.

**Upgrading from arteeh.16 or older?** Stop the server first (`systemctl
--user stop unii-serve`), run the installer, then start it: it moves your
data to the new layout and won't while a server runs. Your user prompt is
then fixed in `prompt.md` (empty it on the Settings page to get later
built-in changes). The terminal is no device any more: set up `unii
device` (above) on each computer Unii should work on.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company.
