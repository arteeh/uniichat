// Server-only composition: one native provider path for chat, subagents and compaction.
import type { Ask } from "./AskAI.ts";
import { SubscriptionAuth } from "./SubscriptionAuth.ts";
import { SubscriptionModels } from "./SubscriptionModels.ts";
import { SubscriptionWire } from "./SubscriptionWire.ts";
import * as config from "./Config.ts";

export namespace Subscriptions {
  export function wire(ask: Ask): SubscriptionWireResult {
    if (!SubscriptionModels.isVendor(ask.vendor)) throw new Error("Not a native subscription vendor");
    const vendor = ask.vendor;
    const model = SubscriptionModels.model(vendor, ask.model);
    if (model === undefined) throw new Error("Unsupported subscription model");
    let endpoint = model.baseUrl;
    return SubscriptionWire.wire(model, {
      auth: async (refused, signal) => {
        // Token, destination and entitlement come from one locked credential read.
        const session = await SubscriptionAuth.session(config.DIR, vendor, refused, signal);
        endpoint = session.endpoint;
        return session.access;
      },
      endpoint: () => endpoint,
    });
  }
}
type SubscriptionWireResult = ReturnType<typeof SubscriptionWire.wire>;
