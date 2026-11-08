Test rig
========

A container that runs UniiChat from your checkout against fake models, the way a user would: a server, a device named `box`, and a fake of all four vendors (claude-api, claude-sub, openai-api, openai-sub) with fake sign-ins. No accounts, no network, no paid calls. It works with Podman or Docker (swap the command).

Start it from the repository's folder:

```sh
podman build -t uniichat-test -f testing/Containerfile .
podman run -d --name rig --network none -v "$PWD:/src:ro,z" uniichat-test
podman logs -f rig   # until "rig up"
```

It copies your checkout in at every start, so after a change, `podman restart rig`. The chat and the sign-ins stay until you `podman rm -f rig`. Build the image again when `bun.lock` changes.

Use it from inside: `podman exec -it rig bash`.

- **Web:** `unii serve link` prints a sign-in link. `playwright-cli open <link>`, press "Sign in", then use the app with `playwright-cli snapshot`, `click`, `fill`, `press`.
- **Models:** pick any vendor and model in the app. `unii serve chatgpt login` and `unii serve claude login` sign in again against the fake.
- **Logs:** `/rig/logs` (server, device, fake).

Steer the fake
--------------

Talk to UniiChat with realistic messages and tell the fake separately what to answer. Each command applies to the next model call; with nothing queued, a call gets "ok".

```sh
fake reply "Here's the plan..."                       # the next call streams this text
fake tool shell '{"device":"box","command":"ls"}'     # the next call asks for a tool (several: NAME JSON NAME JSON)
fake error prompt-too-long                            # or overloaded, rate-limit, usage-limit, auth-expired
fake error usage-limit --reset 5m                     # when the limit ends (default 1h; rate-limit 60s)
fake stall 60s                                        # the stream starts, then hangs
fake cut                                              # the stream drops halfway
fake reply --match "PEARS" "There are 3 pears."       # only for the call whose latest message has "PEARS"
fake reply --think "Let me count." "3 pears."         # thinks for 5 s first (Claude vendors)
fake log                                              # every call: vendor, model, latest message, the answer
fake last                                             # the last call: system prompt, tools, sender labels, cache marks
fake last --json                                      # its headers and whole body
fake clear                                            # forget the queue, limits and refused sign-ins
```

`--match` matters when calls run at once, as the chat and the compactor do. The compactor's calls get a short summary and take only commands matched to their task: `--match Compaction:`. A usage limit lasts until its reset for every call to that vendor. `auth-expired` also refuses the sign-in renewal that follows, so the app sees a sign-in that's gone.

When a real provider answers in a way the fake doesn't know, add it as a case in `testing/fake/cases.ts`: the real response with every secret stripped (keys, tokens, account, org and user ids, emails, cookies), and where and when it was seen.
