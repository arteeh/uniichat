// Public capability snapshots, not account entitlement or a billing guarantee.
// Sources and generation provenance are recorded in SubscriptionCatalog.json.
import catalog from "./SubscriptionCatalog.json";

export const SUBSCRIPTION_VENDORS = ["xai-sub"] as const;
export type SubscriptionVendor = (typeof SUBSCRIPTION_VENDORS)[number];
export type SubscriptionApi = "openai-responses";
export type SubscriptionModel = {
  label: string; id: string; speeds: string[]; window: number; output: number;
  api: SubscriptionApi; baseUrl: string; reasoning: boolean; input: string[];
  efforts: string[];
};

export namespace SubscriptionModels {
  export function isVendor(vendor: string): vendor is SubscriptionVendor {
    return (SUBSCRIPTION_VENDORS as readonly string[]).includes(vendor);
  }
  export function models(vendor: SubscriptionVendor): SubscriptionModel[] {
    return catalog.models[vendor] as SubscriptionModel[];
  }
  export function model(vendor: SubscriptionVendor, label: string): SubscriptionModel | undefined {
    return models(vendor).find((m) => m.label === label);
  }
}
