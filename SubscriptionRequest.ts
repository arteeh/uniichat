import type { Ask, Img } from "./AskAI.ts";
import type { Item, Tool } from "./Agent.ts";
import { SubscriptionModels, SUBSCRIPTION_VENDORS, type SubscriptionModel, type SubscriptionVendor } from "./SubscriptionModels.ts";

export type Obj = Record<string, unknown>;
export function object(x: unknown): Obj {
  if (x === null || typeof x !== "object" || Array.isArray(x)) throw new Error("invalid subscription protocol object");
  return x as Obj;
}
export function text(x: unknown): string {
  if (typeof x !== "string") throw new Error("invalid subscription protocol text");
  return x;
}
export function vendorOf(model: SubscriptionModel): SubscriptionVendor {
  for (const vendor of SUBSCRIPTION_VENDORS) {
    if (SubscriptionModels.models(vendor).some((m) => m.id === model.id && m.api === model.api && m.baseUrl === model.baseUrl)) return vendor;
  }
  throw new Error("unsupported subscription model/protocol/endpoint combination");
}

export function destination(_model: SubscriptionModel, _vendor: SubscriptionVendor, base: string): string {
  const clean = base.replace(/\/$/, "");
  if (clean !== "https://api.x.ai/v1") throw new Error("unsafe subscription inference endpoint");
  return clean + "/responses";
}

function effort(model: SubscriptionModel, ask: Ask): string | undefined {
  if (!model.efforts.includes(ask.effort)) throw new Error("unsupported subscription reasoning effort");
  if (!model.reasoning) return undefined;
  return ask.effort;
}

function image(img: Img): Obj {
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(img.type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data)) {
    throw new Error("unsupported subscription image encoding");
  }
  return { type: "input_image", image_url: "data:" + img.type + ";base64," + img.data };
}
function content(texts: string[], imgs: Img[]): Obj[] {
  return [...texts.filter((t) => t !== "").map((t) => ({ type: "input_text", text: t })), ...imgs.map(image)];
}
function hasImages(items: Item[]): boolean {
  return items.some((i) => i.$ === "User" ? i.imgs.length > 0 : i.$ === "Back" && i.backs.some((b) => (b.out.imgs?.length ?? 0) > 0));
}

function responsesInput(items: Item[]): unknown[] {
  return items.flatMap((i): unknown[] => {
    if (i.$ === "User") return [{ role: "user", content: content(i.parts.map((p) => p.text), i.imgs) }];
    if (i.$ === "Turn") return i.out;
    return i.backs.map((b) => ({ type: "function_call_output", call_id: b.id, output: content([b.out.text], b.out.imgs ?? []) }));
  });
}
function grokSchema(schema: object): object {
  const s = object(schema);
  const key = Array.isArray(s.anyOf) ? "anyOf" : "oneOf";
  const branches = s[key];
  if ((s.type === "object" || s.properties || (Array.isArray(s.type) && s.type.includes("object"))) && Array.isArray(branches) && branches.length > 0 && branches.every((b: unknown) => {
    const o = object(b);
    return Array.isArray(o.required) && o.required.length > 0 && o.required.every((k) => typeof k === "string" && k.length > 0) && Object.keys(o).every((k) => ["required", "title", "description"].includes(k));
  })) {
    const copy = { ...s };
    delete copy[key];
    return copy;
  }
  return schema;
}

export function request(model: SubscriptionModel, _vendor: SubscriptionVendor, ask: Ask, items: Item[], tools: Tool[], max: number): Obj {
  if (ask.model !== model.id && ask.model !== model.label) throw new Error("subscription model does not match request");
  if (!model.speeds.includes(ask.speed)) throw new Error("unsupported subscription speed");
  if (ask.searches > 0) throw new Error("native subscription web search is unsupported");
  if (hasImages(items) && !model.input.includes("image")) throw new Error("subscription model does not accept images");
  const e = effort(model, ask);
  if (![max, model.output, model.window].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error("invalid subscription token budget");
  // Text uses a conservative UTF-8 byte count, not a tokenizer. Pi's
  // utils/estimate.ts reserves 4800/3.5 tokens per image, not base64 bytes.
  // This is a context estimate; the service remains authoritative.
  let images = 0;
  const estimateImage = (img: Img) => { images++; return { type: img.type }; };
  const history = JSON.stringify(items.map((i) => i.$ === "User" ? { ...i, imgs: i.imgs.map(estimateImage) }
    : i.$ === "Back" ? { ...i, backs: i.backs.map((b) => ({ ...b, out: { ...b.out, imgs: b.out.imgs?.map(estimateImage) } })) } : i));
  const inputEstimate = new TextEncoder().encode(ask.system + history + JSON.stringify(tools)).length + images * Math.ceil(4800 / 3.5);
  const cap = Math.min(max, model.output, model.window - inputEstimate);
  if (cap < 16) throw new Error("subscription context has no output room");
  const body: Obj = { model: model.id, stream: true };
  const grok = model.id.startsWith("grok-");
  Object.assign(body, { store: false, max_output_tokens: cap, input: [{ role: "developer", content: [{ type: "input_text", text: ask.system }] }, ...responsesInput(items)] });
  if (model.reasoning) {
    body.include = ["reasoning.encrypted_content"];
    if (e !== undefined && !model.id.startsWith("grok-build") && !model.id.includes("-reasoning")) body.reasoning = { effort: e };
  }
  if (tools.length) body.tools = tools.map((t) => ({ type: "function", name: t.name, description: t.info, parameters: grok ? grokSchema(t.schema) : t.schema }));
  return body;
}
