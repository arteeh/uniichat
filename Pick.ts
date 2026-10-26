import type { Vendor } from "./AskAI.ts";

export type Pick = {
  vendor   : Vendor;
  model    : string;
  effort   : string;
  speed    : string;
  profile? : string;
};

export type Move = "next" | "prev" | "model" | "up" | "down" | "effort" | "speed";

export type Model = { label: string; id: string; speeds: string[]; window: number };

export type Offer = { vendors: Vendor[]; models: string[]; profiles?: Record<string, Fall[]> };

export type Fall = { vendor: Vendor; model: Model; effort?: string; speed?: string };

export const VENDORS: Vendor[] = ["claude-api", "openai-api", "openai-sub", "claude-sub"];

// the windows: Claude's 1M, its models' default (Claude Code's docs:
// Opus 4.7+, Sonnet 5+, Haiku 5.5 need no [1m]), at the API and on a
// plan alike; OpenAI's as Codex's models cache has them for a ChatGPT
// plan (context_window; a request can't ask for more), the API's taken
// as the same
const OPUS  : Model = { label: "opus-5.5",   id: "claude-opus-5-5",   speeds: ["slow", "fast"], window: 1e6 };
const SONNET: Model = { label: "sonnet-5.5", id: "claude-sonnet-5-5", speeds: ["slow"], window: 1e6 };
const HAIKU : Model = { label: "haiku-5.5",  id: "claude-haiku-5-5",  speeds: ["slow"], window: 1e6 };
const OPENAI: Model[] = [
  { label: "gpt-6-luna",  id: "gpt-6-luna",  speeds: ["slow", "fast"], window: 272e3 },
  { label: "gpt-6.1-sol", id: "gpt-6.1-sol", speeds: ["slow", "fast"], window: 500e3 },
  { label: "gpt-6-astra", id: "gpt-6-astra", speeds: ["slow", "fast", "ultrafast"], window: 272e3 },
];

// a ChatGPT plan's (ChatGPT.ts): fast is its priority tier, no ultrafast
const PLAN: Model[] = OPENAI.map((m) => ({ ...m, speeds: m.speeds.filter((s) => s !== "ultrafast") }));

const MODELS: Record<Vendor, Model[]> = {
  "claude-api": [OPUS, SONNET, HAIKU],
  "openai-api": OPENAI,
  "openai-sub": PLAN,
  "claude-sub": [{ ...OPUS, speeds: ["slow"] }, SONNET, HAIKU],
};

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const SPEEDS = ["slow", "fast", "ultrafast"];

export const LABELS = [...new Set(Object.values(MODELS).flat().map((m) => m.label))];

export namespace Pick {

  export function model(vendor: Vendor, label: string): Model | undefined {
    return MODELS[vendor].find((m) => m.label === label);
  }

  export function on(pick: Pick, vendor: Vendor, model: Model): Pick {
    const below = SPEEDS.slice(0, SPEEDS.indexOf(pick.speed) + 1);
    const speed = below.filter((s) => model.speeds.includes(s)).pop() ?? "slow";
    return { ...pick, vendor, model: model.label, speed };
  }

  export function models(vendors: Vendor[], labels: string[]): Array<[Vendor, Model]> {
    return vendors.flatMap((v) => MODELS[v].filter((m) => labels.includes(m.label)).map((m): [Vendor, Model] => [v, m]));
  }

  export function options(pick: Pick, move: Move, offer: Offer): Array<[string, Pick]> {
    const speeds = Pick.model(pick.vendor, pick.model)?.speeds ?? [];
    const { profile: _, ...plain } = pick;
    const all = Pick.models(offer.vendors, offer.models).map(([v, m]): [string, Pick] => [m.label, Pick.on(plain, v, m)]);
    const profiles = Object.keys(offer.profiles ?? {}).map((name): [string, Pick] => [name, Pick.profile(name, offer, pick.effort, pick.speed)!]);
    switch (move) {
      case "next":
      case "prev":
      case "model": {
        return [...profiles, ...all];
      }
      case "up":
      case "down":
      case "effort": {
        return EFFORTS.map((effort) => [effort, { ...pick, effort }]);
      }
      case "speed": {
        return speeds.map((speed) => [speed, { ...pick, speed }]);
      }
    }
  }

  export function move(pick: Pick, move: Move, offer: Offer, to?: string): Pick | null {
    const list = Pick.options(pick, move, offer);
    const n    = list.length;
    const at   = list.findIndex(([, p]) => Pick.label(p) === Pick.label(pick) && p.profile === pick.profile);
    const d    = move === "prev" || move === "down" ? -1 : 1;
    const ends = move === "up" || move === "down";
    const next = ends ? Math.max(0, Math.min(n - 1, at + d)) : (at + d + n) % n;
    const mine = ([, p]: [string, Pick]) => p.profile === undefined && p.vendor === pick.vendor;
    const same = list.filter(([part, p]) => part === to || (p.profile === undefined && p.vendor + ":" + part === to));
    const like = list.filter(([part]) => part.toLowerCase().includes(String(to).toLowerCase()));
    const one  = like.length === 1 ? like[0] : like.filter(mine).length === 1 ? like.find(mine) : undefined;
    const hit  = to === undefined ? list[next] : same.find(mine) ?? same[0] ?? one;
    return hit === undefined ? null : hit[1];
  }

  export function to_model(pick: Pick, label: string, vendors: Vendor[], { models }: Offer): Pick | null {
    const all = Pick.models(vendors, models).filter(([, m]) => m.label === label);
    const hit = all.find(([v]) => v === pick.vendor) ?? all[0];
    return hit === undefined ? null : Pick.on(pick, hit[0], hit[1]);
  }

  export function twin(vendor: Vendor, label: string, vendors: Vendor[]): boolean {
    return vendors.some((v) => v !== vendor && Pick.model(v, label) !== undefined);
  }

  export function label(pick: Pick): string {
    return [pick.vendor, pick.model, pick.effort, pick.speed].join(":");
  }

  export function ask(pick: Pick): Pick {
    const model = Pick.model(pick.vendor, pick.model);
    return { ...pick, model: model?.id ?? pick.model };
  }

  export function named(run: Pick): Pick {
    const model = MODELS[run.vendor].find((m) => m.id === run.model);
    return { ...run, model: model?.label ?? run.model };
  }

  export function falls(run: Pick, falls: Fall[]): Pick[] {
    const own = { vendor: run.vendor, model: run.model, effort: run.effort, speed: run.speed };
    const list = falls.map((f) => {
      const on = Pick.on(own, f.vendor, f.model);
      return Pick.ask({ ...on, effort: f.effort ?? on.effort, speed: f.speed ?? on.speed });
    });
    return [own, ...list].filter((p, k, all) => all.findIndex((q) => q.vendor === p.vendor && q.model === p.model) === k);
  }

  export function profile(name: string, offer: Offer, effort: string, speed: string): Pick | null {
    const first = Object.hasOwn(offer.profiles ?? {}, name) ? offer.profiles![name][0] : undefined;
    if (first === undefined) {
      return null;
    }
    const on = Pick.on({ vendor: first.vendor, model: first.model.label, effort, speed }, first.vendor, first.model);
    return { ...on, effort: first.effort ?? effort, speed: first.speed ?? on.speed, profile: name };
  }

  export function read(x: any, offer: Offer): Pick | null {
    if (x.profile !== undefined) {
      return typeof x.profile === "string" && EFFORTS.includes(x.effort) ? Pick.profile(x.profile, offer, x.effort, String(x.speed)) : null;
    }
    const model = offer.vendors.includes(x.vendor) && offer.models.includes(x.model) ? Pick.model(x.vendor, x.model) : undefined;
    if (model === undefined || !EFFORTS.includes(x.effort) || !model.speeds.includes(x.speed)) {
      return null;
    }
    return { vendor: x.vendor, model: x.model, effort: x.effort, speed: x.speed };
  }

  export function window(pick: Pick, offer: Offer): number {
    const falls = pick.profile === undefined ? [] : offer.profiles?.[pick.profile] ?? [];
    const models = [Pick.model(pick.vendor, pick.model), ...falls.map((f) => f.model)];
    return Math.min(...models.map((m) => m?.window ?? 272e3));
  }

  export function load(saved: object | null, offer: Offer, def: Pick): Pick {
    return Pick.read(saved ?? def, offer) ?? def;
  }

}
