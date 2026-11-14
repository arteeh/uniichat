<img width="1266" height="663" alt="ki-screenshot" src="https://github.com/user-attachments/assets/35b5c75d-cae8-4892-8a49-30f25cf53880" />

Ki is an AI agent with one chat that never ends. There is no "new chat" button: you talk to the same agent for days, weeks, years, and it remembers. Ki is a fork of [Victor Taelin's UniiChat](https://github.com/VictorTaelin/uniichat).

Features
--------

- **One chat, forever.** Forget about sessions or context engineering. Just talk to your agent, from any device.
- **A memory system that keeps everything.** Messages are summarized into a tree that the agent sees every turn: recent messages in detail, older ones more broadly. It can zoom into any line, down to the original message.
- **All your computers.** Run `ki device` on a machine and the agent can run commands and edit files there.
- **Claude and ChatGPT plans** as vendors (`claude-sub`, `openai-sub`) beside API keys; profiles that fall back to the next model when one is out; auto-resume after hitting usage limits.
- **Multiple agents** so each one can have specific knowledge.
- **Subagents** to delegate grunt work while the agent keeps the big picture.
- **Scheduling tools** to give your agent future or repeating tasks.
- **Memory tree viewer** to browse what your agent knows.
- **Image and video viewing tools** to let the agent see images and video files.
- **Images, video, audio and HTML pages inline** for the agent to show you things, or for you to show the agent.
- **Conversation mode** for when you want a short continuous back-and-forth without the agent forgetting anything you said (shout out to /grill-me!).
- **MCP servers** per device. Ask your agent to set them up on your preferred device.
- **Skills** read from the ~/.agents/skills folder.
- **An installable web app (PWA)** on phones and desktops: icons, an offline shell, Web Push for replies, a nav bar that shows on Android; the composer stays above a phone's keyboard.
- **Don't start from scratch.** Import past conversations from Claude Code or Codex into your memory tree.

Install
-------

Linux, macOS or WSL:

`curl -fsSL https://github.com/arteeh/ki/releases/latest/download/install.sh | sh`

Windows (PowerShell, no admin needed):

`irm https://github.com/arteeh/ki/releases/latest/download/install.ps1 | iex`

Either way you get one `ki` program (in `~/.local/bin`, or `%LOCALAPPDATA%\Programs\ki` on Windows). `ki update` installs the newest release and restarts the background services on it.

Set up
------

1. **Start the server** on the computer (preferably one that's reachable and on 24/7) that keeps your chat: `ki serve -d`. It runs in the background from then on, at http://127.0.0.1:8788, with its data in `~/.ki` (or `$KI_DIR`). See the Q&A if you want to set up a client on another device right away.
2. **Sign in.** `ki serve link` on that computer prints a link that signs your browser in. Devices sign in with a link and a code you confirm in that browser.
3. **Pick a model.** In the web app, Settings (the cogwheel): add API keys. To use your Claude or ChatGPT plan instead, run `ki serve claude login` or `ki serve chatgpt login` on the server's computer, then pick `claude-sub` or `openai-sub`.
4. **Add your computers.** On each one Ki may work on: `ki device -d https://your-server`. Ki works in `~/.ki/work` there. Want it working on the server's computer too? Run a device there as well.

**In the background**, `-d` runs the server or a device as a service as your user (systemd on Linux, a Scheduled Task on Windows, a LaunchAgent on macOS): it starts at login and restarts if it crashes. `ki serve stop` / `ki device stop` removes it, `logs -f` follows its output. On Linux, `loginctl enable-linger` keeps it running while you're logged out. On Windows, `sudo ki device -d` offers to run it as administrator, so Ki can control apps that run as admin; then `sudo ki device stop` removes it.

Use
---

- **Web UI:** open the server's address. Install it as an app from your browser to get notifications when Ki replies.
- **Agents:** **+** in the chat list makes another agent, with its own chat, memory and editable system prompt.
- **Leader:** If you want an agent that automatically knows where the other agents are at, go to the agent's settings and enable Leader Mode. A leader will see the most recent memory of each agent.
- **Conversation mode:** the mode menu left of the model picker. From then on, your and the agent's messages stay word for word in its context, for a real back-and-forth. It costs more per turn and turns itself off when the model's context window fills up.
- `ki help` lists every command.

From source (Bun): `bun install`, `bun run web`, `bun Cli.ts <command>`, `bun run build` for a single `ki` program.

Uninstall
---------

Back up `~/.ki` first if you may want your chat back. Run `ki device stop` and `ki serve stop` where you used `-d`, then:

- **Linux, macOS:** `rm ~/.local/bin/ki` and `rm -rf ~/.ki ~/.config/ki`.
- **Windows:** `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ki", "$HOME\.ki", "$HOME\.config\ki"`, and take `%LOCALAPPDATA%\Programs\ki` out of your user Path.

Q&A
---

**Can Ki use my screen?**

Not by itself: ask Ki to add a computer-use MCP server, such as [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver), to the device whose screen it should use.

**I don't trust its unlimited tool calling. Can I sandbox Ki?**

Yes, with [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/). Run `ki device` inside the sandbox and on no other computer, pointed at your server outside it (`http://host.docker.internal:8788` if it runs on the same PC), and let the sandbox reach it: `sbx policy allow network localhost:8788`. That device's MCP servers run in the sandbox too.

**I don't trust its unlimited tool calling. Can I make it ask for permission on tool calls?**

You enjoy pressing enter?

**How can I reach Ki from outside my home network?**

With Tailscale: ask your agent to set up Tailscale Serve on HTTPS port 443, pointing at `http://127.0.0.1:8788`. Only your own Tailscale devices can reach it, not the whole internet.

**How can I give Ki administrator rights?**

- Linux: set up passwordless sudo (run `sudo visudo` and then add the line `your_username ALL=(ALL) NOPASSWD: ALL`).
- Windows: run `sudo ki device -d` and be sure to enable the sudo option in settings when it prompts you.

Be aware of the risks. Your agent will have the power to break your computer, and potential vulnerabilities in Ki will leave your devices more exposed.

**Can others use my server?**

No: a server has one owner. Anthropic and OpenAI don't allow sharing a subscription.

**Coming from UniiChat?**

We've accounted for some migrations from other versions (especially older versions of this fork), but too much has changed under the hood for it to be a simple `unii update`. Ask your agent to do the migration for you.

License
-------

Apache-2.0 (LICENSE).

Copyright 2026 Higher Order Company.

Copyright 2026 Maarten de Jong.
