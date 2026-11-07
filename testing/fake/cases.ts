export type Vendor = "claude-api" | "claude-sub" | "openai-api" | "openai-sub";

export type Kind = "prompt-too-long" | "overloaded" | "rate-limit" | "usage-limit" | "auth-expired";

type At = { model: string; reset: number };

// a failure as the vendor sends it: an HTTP error, or (stream) an SSE stream
// whose events fail the response; `source` says where its text comes from
type Case = { status: number; body: (at: At) => object | string; headers?: (at: At) => Record<string, string>; stream?: true; source: string };

const LOG = "UniiChat's own server log";
const CODE = "how UniiChat reads it (";

const wait = (at: At) => Math.max(1, Math.ceil((at.reset - Date.now()) / 1e3));

const month = (at: At) => {
  const d = new Date(at.reset);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

const anthropic = (type: string, message: string) => ({ type: "error", error: { type, message } });

const openai = (type: string | null, code: string | null, message: string) => ({ error: { message, type, param: null, code } });

const failed = (code: string, message: string) => (at: At) => ({ code, message, model: at.model });

export const CASES: Record<Kind, Record<Vendor, Case>> = {
  "prompt-too-long": {
    "claude-api": { status: 400, body: () => anthropic("invalid_request_error", "prompt is too long: 1048123 tokens > 1000000 maximum"), source: CODE + "Agent.ts TOO_LONG); claude-sub's \"invalid_request: Prompt is too long\" in " + LOG + ", 2026-10-31, is Claude Code's word for it" },
    "claude-sub": { status: 400, body: () => anthropic("invalid_request_error", "prompt is too long: 1048123 tokens > 1000000 maximum"), source: "the same as claude-api; Claude Code turns it into \"invalid_request: Prompt is too long\", seen 13 times in " + LOG + ", 2026-10-31" },
    "openai-api": { status: 400, body: () => openai("invalid_request_error", "context_length_exceeded", "Your input exceeds the context window of this model. Please adjust your input and try again."), source: CODE + "Agent.ts TOO_LONG) and the OpenAI SDK's error shape" },
    "openai-sub": { status: 200, stream: true, body: failed("context_length_exceeded", "Your input exceeds the context window of this model. Please adjust your input and try again."), source: CODE + "OpenAI.ts step, a response.failed in the stream) and Codex's handling of context_length_exceeded" },
  },
  overloaded: {
    "claude-api": { status: 502, body: () => "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n</body>\r\n</html>\r\n", headers: () => ({ "content-type": "text/html" }), source: LOG + ", haiku-5.5, 2026-10-14" },
    "claude-sub": { status: 529, body: () => anthropic("overloaded_error", "Overloaded"), headers: () => ({ "x-should-retry": "true" }), source: CODE + "Anthropic.ts step, ClaudeSub.ts BUSY_ERRORS) and Anthropic's documented 529" },
    "openai-api": { status: 500, body: () => openai("server_error", null, "The server had an error while processing your request. Sorry about that!"), source: CODE + "Agent.ts passing) and the OpenAI SDK's error shape" },
    "openai-sub": { status: 200, stream: true, body: failed("server_error", "An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists."), source: CODE + "OpenAI.ts step: server_error is busy)" },
  },
  "rate-limit": {
    "claude-api": { status: 429, body: (at) => anthropic("rate_limit_error", "This request would exceed your rate limit of 500,000 input tokens per minute (model: " + at.model + "). For details, refer to: https://docs.claude.com/en/api/rate-limits. You can see the response headers for current usage. Reduce the prompt length"), headers: (at) => ({ "retry-after": String(wait(at)), "anthropic-ratelimit-input-tokens-remaining": "0", "anthropic-ratelimit-input-tokens-reset": new Date(at.reset).toISOString() }), source: LOG + ", haiku-5.5, 2026-10-08 (org id left out); headers from Agent.ts until" },
    "claude-sub": { status: 429, body: () => anthropic("rate_limit_error", "Number of concurrent requests across all models has exceeded your organization's limit. Wait for in-flight requests to complete and retry. Limits increase automatically as your organization moves up usage tiers."), headers: (at) => ({ "retry-after": String(wait(at)), "anthropic-ratelimit-unified-reset": String(Math.ceil(at.reset / 1e3)) }), source: LOG + ", claude-api haiku-5.5 and sonnet-5.5, 2026-10-08 to 10-14 (277 times)" },
    "openai-api": { status: 429, body: (at) => openai("requests", "rate_limit_exceeded", "Rate limit reached for " + at.model + " on requests per min (RPM): Limit 10000, Used 10000, Requested 1. Please try again in " + wait(at) + "s."), headers: (at) => ({ "retry-after": String(wait(at)), "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": Math.floor(wait(at) / 60) + "m" + (wait(at) % 60) + "s" }), source: CODE + "Agent.ts until: x-ratelimit-reset-*) and the OpenAI SDK's error shape" },
    "openai-sub": { status: 429, body: (at) => openai("rate_limit_exceeded", "rate_limit_exceeded", "Rate limit reached for " + at.model + ". Please try again in " + wait(at) + "s."), headers: (at) => ({ "retry-after": String(wait(at)) }), source: CODE + "Agent.ts limited and until)" },
  },
  "usage-limit": {
    "claude-api": { status: 400, body: (at) => anthropic("invalid_request_error", "You have reached your specified API usage limits. You will regain access on " + month(at) + " at 00:00 UTC."), source: LOG + ", haiku-5.5, 2026-10-21 (161 times)" },
    "claude-sub": { status: 429, body: () => anthropic("rate_limit_error", "This request would exceed your account's rate limit. Please try again later."), headers: (at) => ({ "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-reset": String(Math.ceil(at.reset / 1e3)), "anthropic-ratelimit-unified-5h-status": "rejected", "anthropic-ratelimit-unified-5h-reset": String(Math.ceil(at.reset / 1e3)), "anthropic-ratelimit-unified-5h-utilization": "1.0", "anthropic-ratelimit-unified-representative-claim": "five_hour", "anthropic-ratelimit-unified-overage-status": "rejected" }), source: CODE + "ClaudeSub.ts note and reset, from Claude Code's rate_limit_event); it ends in \"usage limit; resets ...\" as in " + LOG + ", 2026-10-30" },
    "openai-api": { status: 429, body: () => openai("insufficient_quota", "insufficient_quota", "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors."), source: CODE + "Agent.ts SPENT and limited)" },
    "openai-sub": { status: 429, body: (at) => ({ error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "plus", resets_at: Math.ceil(at.reset / 1e3), resets_in_seconds: wait(at) } }), source: LOG + ", gpt-6-astra, 2026-10-22 to 11-02; its fields from ChatGPT.ts reset and refusal" },
  },
  "auth-expired": {
    "claude-api": { status: 401, body: () => anthropic("authentication_error", "invalid x-api-key"), source: "the Anthropic SDK's error shape and docs" },
    "claude-sub": { status: 401, body: () => anthropic("authentication_error", "OAuth token has expired. Please obtain a new token or refresh your existing token."), source: "claude-sub's sign-in that expired on 2026-10-27 (API 401); ClaudeSub.ts authentication_failed" },
    "openai-api": { status: 401, body: () => openai("invalid_request_error", "invalid_api_key", "Incorrect API key provided: sk-proj-****-key. You can find your API key at https://platform.openai.com/account/api-keys."), source: "the OpenAI SDK's error shape and docs" },
    "openai-sub": { status: 401, body: () => ({ error: { message: "Provided authentication token is expired. Please try signing in again.", type: null, code: "token_expired", param: null }, status: 401 }), source: CODE + "Agent.ts: a 401 renews the sign-in, ChatGPT.ts refresh)" },
  },
};
