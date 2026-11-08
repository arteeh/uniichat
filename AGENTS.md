- **No unit tests.** Don't add `*.test.ts` files or a test runner.
- **Test like a user.** Run your change the way a real user would use it: run uniichat in an isolated container, with the user's state copied over (NOT mounted) if needed, and use the software there. Test the web UI using [playwright-cli](https://www.npmjs.com/package/@playwright/cli).
- `bun run check` (tsc, eslint, knip) must finish with 0 errors.
- `web/app.js` is generated and not committed: run `bun run web` after changing `web/src`.
- Don't write docs into the codebase. The readme and code speak for themselves. The README is for users: what UniiChat does and how to use it. Don't describe the codebase. Change it only when using the app changes, and keep that to a line or two.
- Be extremely strict on comments. Only add them if the information is essential and can't be inferred from the code.

## How to test

`testing/README.md` starts the test rig: a container with UniiChat on your checkout, a device, and fake models of all four vendors. Use the web app there with playwright-cli, and steer what the models answer with `fake` (replies, tool calls, errors, stalls), never with test commands in chat messages.
