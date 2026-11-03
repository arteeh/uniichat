import { setTimeout as delay } from "node:timers/promises";
import type { SubscriptionVendor } from "./SubscriptionModels.ts";
import { secret } from "./SubscriptionAuthStore.ts";

export type Body = Record<string, unknown>;
export class Denied extends Error {
  constructor() { super("Subscription permission missing, removed, or expired; log in again"); }
}
export class Transient extends Error {}
const AUTH_URLS = new Set([
  "https://auth.x.ai/oauth2/device/code", "https://auth.x.ai/oauth2/token",
]);
async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<{ body: Body; ok: boolean; status: number }> {
  if (!AUTH_URLS.has(url)) throw new Error("Untrusted subscription auth URL");
  const timeout = AbortSignal.timeout(30_000);
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(url, { ...init, redirect: "error", signal: bounded }).catch((error: unknown) => {
      throw bounded.aborted ? error : new Transient("Subscription sign-in service unreachable; try again later");
    });
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) { await reader.cancel(); throw new Error(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    if (res.status === 401 || res.status === 403) throw new Denied();
    if (res.status === 429 || res.status >= 500) throw new Transient("Subscription sign-in service unavailable (HTTP " + res.status + "); try again later");
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error(); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { body: body as Body, ok: res.ok, status: res.status };
  } catch (error) {
    if (error instanceof Denied || error instanceof Transient) throw error;
    // Never surface fetch errors, statusText, URLs from responses, or provider bodies.
    throw new Error("Subscription auth request failed (network, timeout, redirect, or malformed response)");
  }
}
export async function form(url: string, fields: Record<string, string>, signal?: AbortSignal) {
  return request(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) }, signal);
}
export function success(res: { body: Body; ok: boolean; status: number }): Body {
  if (["invalid_grant", "invalid_scope", "access_denied", "authorization_denied"].includes(String(res.body.error))) throw new Denied();
  if (!res.ok || res.body.error !== undefined) throw new Error("Subscription auth rejected request (HTTP " + res.status + ")");
  return res.body;
}
export function lifetime(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error("Invalid subscription expiry response");
  }
  return value;
}
export type LoginOptions = {
  show?: (url: string, code: string) => void; wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
};
export async function device(_vendor: SubscriptionVendor, url: string, tokenUrl: string, fields: Record<string, string>, options: LoginOptions): Promise<Body> {
  const started = success(await form(url, fields, options.signal));
  const deviceCode = secret(started.device_code);
  const userCode = started.user_code;
  if (typeof userCode !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(userCode)) throw new Error("Invalid device user code");
  const hosts = ["auth.x.ai", "accounts.x.ai", "x.ai"];
  let verification: URL;
  try { verification = new URL(String(started.verification_uri)); } catch { throw new Error("Untrusted device verification URL"); }
  if (verification.protocol !== "https:" || verification.username || verification.password || verification.port ||
      verification.search || verification.hash || !hosts.includes(verification.hostname)) throw new Error("Untrusted device verification URL");
  let interval = lifetime(started.interval === 0 ? undefined : started.interval, 5, 60) * 1000;
  // xAI may issue a code valid longer than our local 15-minute wait budget.
  // Accept that provider lifetime, but never extend our polling deadline.
  const duration = lifetime(started.expires_in, 900, Number.MAX_SAFE_INTEGER);
  const end = Date.now() + Math.min(duration, 900) * 1000;
  options.show?.(verification.href, userCode);
  const wait = options.wait ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  while (Date.now() < end) {
    await wait(Math.min(interval, end - Date.now()), options.signal);
    options.signal?.throwIfAborted();
    if (Date.now() >= end) break;
    const res = await form(tokenUrl, { client_id: fields.client_id, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }, options.signal);
    if (res.body.error === "authorization_pending") continue;
    if (res.body.error === "slow_down") {
      interval = Math.max(interval + 5000, lifetime(res.body.interval, interval / 1000 + 5, 900) * 1000);
      continue;
    }
    return success(res);
  }
  throw new Error("Subscription device login expired; start login again");
}
