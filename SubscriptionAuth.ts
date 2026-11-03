import type { SubscriptionVendor } from "./SubscriptionModels.ts";
import { SubscriptionModels } from "./SubscriptionModels.ts";
import { forget, load, locked, save, type Credential } from "./SubscriptionAuthStore.ts";
import { Denied, Transient, type LoginOptions } from "./SubscriptionAuthHttp.ts";
import { initial, renew, usable } from "./SubscriptionAuthProtocols.ts";

function check(vendor: SubscriptionVendor): void {
  if (!SubscriptionModels.isVendor(vendor)) throw new Error("Unknown subscription vendor");
}
function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Subscription auth cancelled");
}
export async function login(dir: string, vendor: SubscriptionVendor, options: LoginOptions = {}): Promise<void> {
  check(vendor);
  await locked(dir, vendor, async () => {
    cancelled(options.signal);
    forget(dir, vendor);
    const credential = await initial(vendor, options);
    usable(credential);
    save(dir, vendor, credential);
  }, options.signal);
}
export namespace SubscriptionAuth {
  // Local provisioning snapshot, not a live entitlement or billing assertion.
  export function status(dir: string, vendor: SubscriptionVendor): { connected: boolean; endpoint?: string } {
    check(vendor);
    try {
      const c = load(dir, vendor);
      if (!c || c.pending || c.blocked) return { connected: false };
      usable(c);
      return { connected: true, endpoint: c.endpoint };
    } catch { return { connected: false }; }
  }
  export async function session(dir: string, vendor: SubscriptionVendor, refused?: string, signal?: AbortSignal): Promise<Credential> {
    check(vendor);
    cancelled(signal);
    return locked(dir, vendor, async () => {
      cancelled(signal);
      const old = load(dir, vendor);
      if (!old || old.blocked) throw new Error("Subscription not connected; run login for " + vendor);
      if (old.pending) throw new Error("Subscription refresh outcome uncertain; log in again (refresh will not be replayed)");
      if (!old.pending) usable(old);
      if (!old.pending && old.access !== refused && old.expires > Date.now() + 5 * 60_000) return old;
      // Clear access before dispatch. Crash, timeout, invalid JSON or an
      // uncertain response leaves this durable marker; NEVER replay that refresh.
      save(dir, vendor, { ...old, access: "", pending: true });
      try {
        const next = await renew(old);
        usable(next);
        save(dir, vendor, next);
        // A caller cancellation cannot lose a successfully rotated refresh token.
        cancelled(signal);
        return next;
      } catch (error) {
        if (error instanceof Denied) forget(dir, vendor);
        if (error instanceof Transient) save(dir, vendor, old);
        throw error;
      }
    }, signal);
  }
  export async function cli(dir: string, vendor: SubscriptionVendor, args: string[]): Promise<void> {
    check(vendor);
    if (args.length !== 1 || !["login", "logout", "status", "models"].includes(args[0])) {
      throw new Error("Use login, logout, status, or models; secrets must never be passed as arguments");
    }
    if (args[0] === "logout") {
      await locked(dir, vendor, () => { forget(dir, vendor);  return Promise.resolve(); });
      console.log(vendor + ": local credentials removed (provider session not revoked)");
    } else if (args[0] === "status" || args[0] === "models") {
      // Local snapshot only; never a live entitlement or quota check.
      const connection = status(dir, vendor);
      console.log(JSON.stringify(args[0] === "models" ? { ...connection, catalog: SubscriptionModels.models(vendor).map((m) => m.id), catalog_scope: "public capabilities, not account entitlement" } : connection));
    } else {
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.once("SIGINT", abort); process.once("SIGTERM", abort);
      try {
        await login(dir, vendor, {
          signal: controller.signal,
          show: (url, code) => console.log("Open " + url + " and enter " + code + " only if you started this login."),
        });
        console.log(vendor + ": locally connected; configuration unchanged");
      } finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
    }
  }
}
