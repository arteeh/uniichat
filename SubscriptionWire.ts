import type { Ask } from "./AskAI.ts";
import type { Step, Wire } from "./Agent.ts";
import type { SubscriptionModel } from "./SubscriptionModels.ts";
import { destination, object, request, vendorOf } from "./SubscriptionRequest.ts";
import * as Stream from "./SubscriptionStream.ts";

type State = Stream.State;
type Connection = {
  auth: (refused: string | undefined, signal?: AbortSignal) => Promise<string>;
  endpoint: () => string;
};
// Parent must invoke this on HTTP failures before generic Agent.reason/logging.
// Raw HTTP bodies are deliberately never incorporated in the Step.
type NativeWire = Wire<State, unknown> & { auth: Connection["auth"]; reject: (res: Response, body: string) => Step };

export namespace SubscriptionWire {
  export function wire(model: SubscriptionModel, connection: Connection): NativeWire {
    const vendor = vendorOf(model);
    const contexts = new WeakMap<Ask, { allowed: Set<string> }>();
    // Fail unsafe catalog defaults immediately; validate callback output anew
    // after every auth/refresh, including before preparing credential headers.
    destination(model, vendor, model.baseUrl);
    const endpoint = () => destination(model, vendor, connection.endpoint() || model.baseUrl);
    return {
      key: vendor,
      auth: connection.auth,
      idle: 1200e3,
      get url() { return endpoint(); },
      headers: (key, _ask) => {
        endpoint();
        const headers: Record<string, string> = { authorization: "Bearer " + key, "content-type": "application/json" };
        return headers;
      },
      body: (ask, items, tools, max) => {
        const body = request(model, vendor, ask, items, tools, max);
        contexts.set(ask, { allowed: new Set(tools.map((t) => t.name)) });
        return body;
      },
      start: (ask) => Stream.start(model.api, contexts.get(ask)?.allowed ?? new Set()),
      read: Stream.read,
      begun: (event) => {
        try {
          const ev = object(event);
          return ev.type === "response.output_item.added";
        } catch { return false; }
      },
      step: Stream.step,
      reject: (res, body) => {
        const spent = /insufficient_quota|billing_hard_limit_reached|credit balance is too low/i.test(body);
        const context = !spent && [400, 413, 422].includes(res.status) && /context_length_exceeded|model_context_window_exceeded|prompt is too long|maximum context length|too many input tokens/i.test(body);
        return {
          out: [], uses: [], entries: [], note: "",
          stop: context ? "fail" : spent ? "down" : res.status === 429 ? "limit" : [408, 409].includes(res.status) || res.status >= 500 ? "busy" : "down",
          off: spent || [401, 402, 403, 404].includes(res.status),
          why: context ? "Subscription context window exceeded" : "subscription inference HTTP " + res.status + (spent ? " (quota unavailable)" : ""),
        };
      },
    };
  }
}
