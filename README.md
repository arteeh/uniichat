UniiChat (arteeh's fork)
========================

UniiChat is an AI agent with one chat that never ends. There is no "new
chat" button: you talk to the same agent for days, weeks, years, and it
remembers.

Based on [Victor Taelin's UniiChat source code](https://github.com/VictorTaelin/uniichat).

Features
--------

- **One chat, forever.** No new chats or sessions. Every tab, phone
  and terminal shows the same live chat.
- **A memory system that keeps everything.** Messages are summarized into a
  tree that the agent sees every turn: recent messages in detail, older
  ones more broadly. It can zoom into any line, down to the original
  message.
- **All your computers.** Run `unii device` on a machine and the agent
  can run commands and edit files there.
- **Subagents** do the grunt work in the background and report back.
- **Goals.** `/goal` keeps UniiChat working until something is done.
- **Don't start from scratch.** Import past conversations from either
  Claude Code, Codex or another UniiChat instance into your memory tree.

What this fork adds:

- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`)
  beside API keys; profiles that fall back to the next model when one is
  out; auto-resume after hitting usage limits; a model per subagent.
- **Native Windows**: server, devices and terminal, with a one-line
  PowerShell install.
- **MCP servers** per device.
- **Skills** read from the ~/.agents/skills folder.
- **Scheduling tools** to give your agent future or repeating tasks.
- **Image and video viewing tools** to let it see images and video files.
- **Settings page** where you can customize the system prompt and compaction prompt.
- **Improved memory tree viewer** to browse what your agent knows.
- **Full markdown** as GitHub draws it, in the web app and the terminal.
- **Images, video, audio and HTML pages inline** for the agent to show you things,
  or for you to show the agent.
- **Conversation mode** for when you want a short continuous
  back-and-forth without the agent forgetting anything you said.
- **An installable web app (PWA)** on phones and desktops: icons, an
  offline shell, Web Push for replies, a nav bar that shows on Android;
  the composer stays above a phone's keyboard.
- **One owner per server**, no accounts, email, billing, or anything
  else exclusive to the uniichat.com version; `unii serve sessions`
  and `unii serve sessions revoke` to sign a lost device out.
- **Background services** (`-d`, `stop`, `logs`) that updates restart.
- **Subagent improvements**: their own tab, a `stop` that ends one
  and its jobs, and a report when one hits a usage limit.
- **No telemetry or update checker**: `unii update` when you want it.
- **Better defaults**: Sonnet 5.5 medium does the compaction, seeing 4 KB
  of chat around each message (was Haiku 5.5 high with 32 KB), so
  summaries make up less.

Install
-------

Linux, macOS or WSL:

    curl -fsSL https://github.com/arteeh/uniichat/releases/latest/download/install.sh | sh

Windows (PowerShell, no admin needed):

    irm https://github.com/arteeh/uniichat/releases/latest/download/install.ps1 | iex

Either way you get one `unii` program (in `~/.local/bin`, or
`%LOCALAPPDATA%\Programs\unii` on Windows). `unii update` installs the
newest release and restarts the background services on it.

Set up
------

1. **Start the server** on the computer that keeps your chat:
   `unii serve -d`. It runs in the background from then on, at
   http://127.0.0.1:8788, with its data in `~/.unii` (or `$UNII_DIR`). To use it from
   other devices, put it behind HTTPS (see Q&A) and set `site` in
   Settings to that address.
2. **Sign in.** `unii serve link` on that computer prints a link that
   signs your browser in. Terminals and devices sign in with a link
   and a code you confirm in that browser.
3. **Pick a model.** In the web app, ☰ › Settings: add API keys. To use
   your Claude or ChatGPT plan instead, run `unii serve claude login` or
   `unii serve chatgpt login` on the server's computer, then pick `claude-sub`
   or `openai-sub`.
4. **Add your computers.** On each one Unii may work on:
   `unii device -d https://your-server`. Unii works in `~/.unii/work`
   there. Want it working on the server's computer too? Run a device
   there as well.

**MCP servers** belong to a device: list them in that device's
`~/.unii/config.json`, in the same shape as Claude's `mcpServers`:

    { "mcp": { "blender": { "command": "uvx", "args": ["blender-mcp"] } } }

Unii sees them from its next turn, no restart. Switch them on or off in
Settings.

**In the background**, `-d` runs the server or a device as a service of
your user (systemd on Linux, a Scheduled Task on Windows, a LaunchAgent
on macOS): it starts at login and restarts if it crashes.
`unii serve stop` / `unii device stop` removes it, `logs -f` follows its
output. On Linux, `loginctl enable-linger` keeps it running while you're
logged out. On Windows, `sudo unii device -d` offers to run it as
administrator, so Unii can control apps that run as admin; then
`sudo unii device stop` removes it.

**Settings** are mostly on the Settings page, including Unii's system
prompt and compaction prompt. They're kept in `~/.unii/config.json`,
where `UNII_<KEY>` environment variables override them. One lives only
there: `after`, a shell command to run after each turn.

Use
---

- **Web:** open the server's address. Install it as an app from your
  browser to get notifications when Unii replies.
- **Terminal:** `unii [url]`. `/help` lists its commands; `/import`
  brings in this computer's Claude Code and Codex sessions. Without a
  url it uses `$UNII_URL`, else the last one, else http://127.0.0.1:8788.
  The terminal and devices keep their server and sign-in in `~/.config/unii`.
- **Conversation mode:** the switch next to "fold all" (`/mode` in the
  terminal). From then on, your and Unii's messages stay word for word
  in Unii's memory, for a real discussion. It costs more per turn and
  turns itself off when the model's context window fills up.
- `unii help` lists every command.

From source (Bun): `bun install`, `bun run web`, `bun Cli.ts <command>`,
`bun run build` for a single `unii` program.

Uninstall
---------

Back up `~/.unii` first if you may want your chat back. Run
`unii device stop` and `unii serve stop` where you used `-d`, then:

- **Linux, macOS:** `rm ~/.local/bin/unii` and
  `rm -rf ~/.unii ~/.config/unii`.
- **Windows:** `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\unii", "$HOME\.unii", "$HOME\.config\unii"`,
  and take `%LOCALAPPDATA%\Programs\unii` out of your user Path.

Q&A
---

**Can Unii use my screen?**

Not by itself: ask Unii to add a computer-use MCP server, such as
[cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver),
to the device whose screen it should use.

**I don't trust its unlimited tool calling. Can I sandbox Unii?**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run
`unii device` inside the sandbox and on no other computer, pointed at
your server outside it (`http://host.docker.internal:8788` if it runs on
the same PC), and let the sandbox reach it:
`sbx policy allow network localhost:8788`. That device's MCP servers
run in the sandbox too.

**I don't trust its unlimited tool calling. Can I make it ask for permission on tool calls?**

You enjoy pressing enter?

**How can I reach UniiChat from outside my home network?**

With Tailscale: ask Unii to set up Tailscale Serve on HTTPS port 443,
pointing at `unii serve`. Only your own Tailscale devices can reach it,
not the whole internet.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a
plan, either.

**Upgrading from arteeh.16 or older?**

Stop the server first (`systemctl --user stop unii-serve`), run the
installer, then start it again: it moves your data to the new layout.
The terminal no longer works on files itself: run `unii device` on each
computer Unii should work on.

License
-------

Apache-2.0 (LICENSE).
Copyright 2026 Higher Order Company.
Copyright 2026 Maarten de Jong.
