// What the pickers need of the subscription catalog, kept apart so the web bundle carries no request details.
import picks from "./SubscriptionPicks.json";
import type { Model } from "./Pick.ts";

export const SUBSCRIPTION_VENDORS = ["xai-sub"] as const;
export type SubscriptionVendor = (typeof SUBSCRIPTION_VENDORS)[number];

export namespace SubscriptionPicks {
  export function isVendor(vendor: string): vendor is SubscriptionVendor {
    return (SUBSCRIPTION_VENDORS as readonly string[]).includes(vendor);
  }
  export function models(vendor: SubscriptionVendor): Model[] {
    return picks[vendor];
  }
}
