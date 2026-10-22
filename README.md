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

What this fork adds: one owner per server, no accounts or email; Claude
and ChatGPT plans as vendors (`claude-sub`, `openai-sub`) beside API
keys; profiles that fall back to the next model when one is out; waiting
out usage limits; MCP servers (also run on a device); skills; image and
video viewing; an editable user prompt and compaction prompt; a memory
tree browser.

Install and set up
------------------

On Linux or macOS (Windows: WSL):

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

This installs `unii` to `~/.local/bin`; `unii update` installs the
newest release. The installer also moves data from older versions.

1. **Start the server** on the computer that keeps your chat (as a
   systemd user service, say): `unii serve` serves http://127.0.0.1:8788;
   its data is in `~/.unii` (`$UNII_DIR`). Put it behind HTTPS (e.g.
   `tailscale serve`) to reach it from elsewhere, and set `site` to that
   address.
2. **Sign in.** On the server's computer, `unii serve link` prints a link
   that signs a browser in. A terminal or a device signs in by a link and
   a code you confirm in that browser. `unii serve sessions` lists them;
   `unii serve revoke <n>` (or `--all`) signs one out.
3. **Pick a vendor.** In the web app, ☰ › Settings: vendors, models and
   API keys (kept in `~/.unii/keys.json`). For a plan instead of keys,
   run `unii serve claude` (Claude) or `unii serve chatgpt` (ChatGPT) on
   the server's computer, then pick `claude-sub` or `openai-sub`. Each
   takes `logout` or `status`.
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
   enable-linger` to run it while you're logged out).

The server's settings are in `~/.unii/config.json` (most are on the
Settings page). Each may also be set as `UNII_<KEY>`, which wins. Besides
`vendors`, `models`, `pick`, `compactor`, `agents`, `profiles` and `site`:

- `mcp`: MCP servers, in Claude's `mcpServers` shape (or a file path).
  Add `"device": "<name>"` to run one on a device.
- `after`: a shell command run after each turn.
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
- `unii help` lists every command. Once a day the terminal asks GitHub
  for the newest release; `UNII_NO_UPDATE_CHECK=1` turns that off.

From source (Bun): `bun install`, `bun run web` (rebuilds web/app.js),
`bun Cli.ts <command>`, `bun run build` (one `unii` executable).

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
