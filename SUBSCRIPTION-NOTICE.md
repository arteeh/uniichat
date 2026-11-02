# Subscription adapter references and notices

These native UniiChat adapters use the authentication/protocol implementations and public model catalogs in Pi and NodeCode Cells as references. Neither their agent runtimes nor their credential stores are consumed. `SubscriptionCatalog.json` records the exact source commits used for its public data; those declarations are not live entitlement or billing evidence.

- Pi: https://github.com/earendil-works/pi — `packages/ai/src/auth/oauth/{xai,meta,github-copilot}.ts`, `packages/ai/src/api/`, and provider catalog data for xAI, OpenCode Go and Copilot.
- Cells: the inspected `cells` checkout's `providers/nodecode-{xai-oauth,muse-code,github-copilot}/` implementations; Muse's `models.json` supplies the catalog because the inspected Pi checkout lacked generated Meta model data.
- Anthropic Messages route composition follows the SDK resource's `/v1/messages` path relative to the documented provider base, not a guessed `/messages` path.

The adapted references/catalog material is MIT licensed under the notices below. This does not change UniiChat's own license. OAuth client IDs in the source are public client identifiers, not credentials. No operator identities, authorization tokens or sessions are part of this catalog or these notices.

## MIT notices

MIT License

Copyright (c) 2025 Mario Zechner

Copyright (c) 2025-2026 Nodecode AI

Copyright (c) 2025-2026 Can Bölük

Copyright (c) 2026 Stencil Labs, Inc.

Cells' provider notices additionally credit oh-my-pi (https://github.com/can1357/oh-my-pi, commit `c9383c1f327521006715f9eb6a33f541cb215521`), and its xAI authentication lineage credits NousResearch/hermes-agent (MIT).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
