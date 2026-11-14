- **No unit tests.** Don't add `*.test.ts` files or a test runner.
- **Test like a user.** Run your change the way a real user would use it: run ki in an isolated container, with the user's state copied over (NOT mounted) if needed, and use the software there. Test the web UI using [playwright-cli](https://www.npmjs.com/package/@playwright/cli).
- `bun run check` (tsc, eslint, knip) must finish with 0 errors.
- **No dead code.** What your change leaves unused (code, a setting, a type's case, a text, a CSS rule, a file) goes in the same commit. Dead code or a bug you come across anywhere is fixed in the version you work on, not left for a later one. knip finds unused exports and namespace members, not an option no caller passes or a rule no page uses: look for those yourself.
- The first commit of every version updates every dependency to its latest version: `package.json` and `bun.lock`, and Bun itself (`testing/Containerfile`, the release builds).
- `web/app.js` is generated and not committed: run `bun run web` after changing `web/src`.
- Don't write docs into the codebase. The readme and code speak for themselves. The README is for users: what Ki does and how to use it. Don't describe the codebase. Change it only when using the app changes, and keep that to a line or two.
- Be extremely strict on comments. Only add them if the information is essential and can't be inferred from the code.

## How to test

The test rig is a container with Ki on your checkout, a device named `box`, and fake models of all four vendors (claude-api, claude-sub, openai-api, openai-sub) with fake sign-ins: no accounts, no network, no paid calls. From the repository's folder (Podman or Docker):

```sh
podman build -t ki-test -f testing/Containerfile .   # again when bun.lock changes
podman run -d --name rig --network none -v "$PWD:/src:ro,z" ki-test
podman logs -f rig                                          # until "rig up"
```

It copies your checkout in at every start, so after a change, `podman restart rig`; `podman rm -f rig` forgets the chat and sign-ins. Work inside it with `podman exec -it rig bash`: `ki serve login` prints a code to type on the sign-in page (`playwright-cli open http://127.0.0.1:8788`); the logs are in `/rig/logs`.

Steer what the models answer with `fake`, never with test commands in chat messages. Each command applies to the next model call; with nothing queued, a call gets "ok":

```sh
fake reply "text"                        # or --think "t" "text": thinks 5 s first, its text "t" at the end
fake tool NAME 'JSON' [NAME 'JSON' ...]  # tool calls
fake error KIND [--reset 5m]             # prompt-too-long, overloaded, rate-limit, usage-limit, auth-expired
fake stall 60s | fake cut                # the stream hangs, or drops halfway
fake log | fake last [--json] | fake clear
```

`--match TEXT` limits a command to the call whose latest message has TEXT. Use it whenever calls run at once: the chat, the compactor (`--match Compaction:`) and subagents.

A real provider answer the fake doesn't know goes in `testing/fake/cases.ts`, every secret stripped (keys, tokens, account, org and user ids, emails, cookies), with where and when it was seen.
