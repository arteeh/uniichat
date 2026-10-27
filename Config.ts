import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Vendor } from "./AskAI.ts";
import { err_code, err_why } from "./Err.ts";
import { get, list as items, rec, text_of } from "./Json.ts";
import { EFFORTS, LABELS, VENDORS, Pick, type Fall, type Offer } from "./Pick.ts";

export type Setting = { key: string; def: string; apply: "now" | "restart"; web: boolean };

export type From = "env" | "file" | "default";

type Made = {
  offer     : Offer;
  pick      : Pick;
  compactor : Pick;
  context   : number;
  agents    : Pick | null;
  after     : string;
};

export type McpServer = {
  name    : string;
  device  : string;
  command : string;
  args    : string[];
  env     : Record<string, string>;
  cwd     : string;
  url     : string;
  headers : Record<string, string>;
  timeout : number;
};

export const DIR = config_path(process.env.UNII_DIR ?? "~/.unii");

export const FILE_PATH = DIR + "/config.json";
export const KEYS_PATH = DIR + "/keys.json";

export const SETTINGS: Setting[] = [
  { key: "vendors",   def: "claude-api",                        apply: "now",     web: true  },
  { key: "models",    def: LABELS.join(),                       apply: "now",     web: true  },
  { key: "pick",      def: "claude-api:sonnet-5.5:medium:slow", apply: "now",     web: true  },
  { key: "compactor", def: "claude-api:sonnet-5.5:medium:slow", apply: "now",     web: true  },
  { key: "compactor_context", def: "4",                         apply: "now",     web: true  },
  { key: "agents",    def: "",                                  apply: "now",     web: true  },
  { key: "site",      def: "http://127.0.0.1:8788",             apply: "restart", web: true  },
  { key: "apple",     def: "",                                  apply: "restart", web: true  },
  { key: "apns",      def: "",                                  apply: "restart", web: true  },
  { key: "after",     def: "",                                  apply: "now",     web: false },
];

const USABLE: Record<Vendor, string> = {
  "claude-sub" : "signed in to Claude",
  "openai-sub" : "signed in to ChatGPT",
  "claude-api" : "Anthropic key set",
  "openai-api" : "OpenAI key set",
};
const DEFAULT_MODEL: Record<Vendor, string> = {
  "claude-sub" : "sonnet-5.5",
  "openai-sub" : "gpt-6.1-sol",
  "claude-api" : "sonnet-5.5",
  "openai-api" : "gpt-6.1-sol",
};

const NONE     = "Not signed in and no API key: sign in with `unii serve claude` (or `unii serve chatgpt`) on the server, or set a key in Settings";
const NONE_WHY = "not signed in, no key";

export const VARS: Record<string, string> = {
  anthropic       : "ANTHROPIC_API_KEY",
  openai          : "OPENAI_API_KEY",
  apns            : "APNS_KEY",
};

const FILE: Record<string, unknown> = config_file();

export const CHATGPT    = config_path(config_get("chatgpt", DIR + "/chatgpt.json"));

export const CLAUDE_SUB = config_path(config_get("claude_sub", DIR + "/claude-sub"));
export const CLAUDE     = config_path(config_get("claude", ""));

const ENV_KEYS: Record<string, string> = Object.fromEntries(Object.entries(VARS).map(([name, v]) => [name, config_key(v)]));
export const KEYS: Record<string, string> = config_keys(keys_read());

let FOLLOWED = config_usable().join();

let KEPT: string[] = [];

export const RELOADED = new Set<() => void>();

const MADE = config_make(FILE);

export const STARTED: Record<string, string> = Object.fromEntries(SETTINGS.map((s) => [s.key, config_value(FILE, s.key)]));

export const SITE    = config_value(FILE, "site").replace(/\/$/, "");
export const OFFER: Offer = MADE.offer;

export let   AFTER      = MADE.after;
export let   PICK       = MADE.pick;

export let   COMPACTOR  = MADE.compactor;
export let   COMPACTOR_CONTEXT = MADE.context;
export let   AGENTS     = MADE.agents;

export const APPLE      = config_value(FILE, "apple");
export const APNS       = config_value(FILE, "apns");

export const MEDIA_MAX  = (Number(config_get("media_mb", "")) || 1024) * 2 ** 20;

const MCP_VAR = process.env.UNII_MCP;
delete process.env.UNII_MCP;
export const MCP_LEFT: string | null = config_mcp_some(MCP_VAR)
  ? "UNII_MCP is set, but unii serve runs no MCP servers, so they are left out: put them in the mcp of a device's own ~/.unii/config.json (for this computer, run unii device beside the server)."
  : null;
export const MCP_FILE = config_mcp_some(FILE.mcp);

export function config_value(file: Record<string, unknown>, key: string): string {
  return config_env_value(key) ?? config_str(file[key]) ?? config_default(file, key).value;
}

export function config_default(file: Record<string, unknown>, key: string): { value: string; why: string } {
  const def = SETTINGS.find((s) => s.key === key)?.def ?? "";
  if (key !== "vendors" && key !== "pick" && key !== "compactor") {
    return { value: def, why: "" };
  }
  const usable = config_usable();
  if (key === "vendors") {
    const named = config_named(file).filter((v) => !usable.includes(v));
    const whys = [...usable.map((v) => USABLE[v]), ...(named.length === 0 ? [] : [named.join(", ") + " chosen"])];
    return usable.length + named.length === 0 ? { value: def, why: NONE_WHY } : { value: [...usable, ...named].join(), why: whys.join(", ") };
  }
  const offered = config_value(file, "vendors").split(",").map((v) => v.trim());
  const models = config_value(file, "models").split(",").map((m) => m.trim());
  const model = (v: Vendor) => (models.includes(DEFAULT_MODEL[v]) ? DEFAULT_MODEL[v] : Pick.models([v], models)[0]?.[1].label);
  const order = [...usable, ...VENDORS.filter((v) => !usable.includes(v))].filter((v) => offered.includes(v));
  const vendor = order.find((v) => model(v) !== undefined);
  if (vendor === undefined) {
    return { value: def, why: "" };
  }
  const why = usable.includes(vendor) ? USABLE[vendor] : usable.length === 0 ? NONE_WHY : vendor + " has no sign-in or key here";
  return { value: vendor + ":" + model(vendor) + ":medium:slow", why };
}

function config_named(file: Record<string, unknown>): Vendor[] {
  const set = ["pick", "compactor", "agents"].map((key) => config_env_value(key) ?? config_str(file[key]) ?? "");
  let profiles: unknown = file.profiles;
  try {
    profiles = process.env.UNII_PROFILES === undefined ? profiles : JSON.parse(process.env.UNII_PROFILES);
  } catch {
    profiles = null;
  }
  const lists = typeof profiles === "object" && profiles !== null ? Object.values(profiles) : [];
  const falls = lists.flatMap((list: unknown) => (Array.isArray(list) ? list.map(String) : []));
  const named = [...set, ...falls].map((text) => text.split(":")[0].trim());
  return VENDORS.filter((v) => named.includes(v) || KEPT.includes(v));
}

export function config_keep(vendors: string[]): void {
  if (vendors.join() === KEPT.join()) {
    return;
  }
  KEPT = vendors;
  try {
    config_reload();
  } catch (err) {
    console.error("unii: " + (err instanceof Error ? err.message : String(err)));
  }
}

// the vendors that can be asked here, in the order a default takes
// them: claude-sub signed in, openai-sub signed in, claude-api and
// openai-api with a key. Claude Code keeps its sign-in in its config dir:
// .credentials.json, or (macOS, in the keychain) only its account in
// .claude.json
function config_usable(): Vendor[] {
  const field = (file: string, ...keys: string[]): unknown => {
    let at: unknown;
    try {
      at = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
    for (const key of keys) {
      at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[key] : undefined;
    }
    return at;
  };
  const claude = field(CLAUDE_SUB + "/.credentials.json", "claudeAiOauth") != null || field(CLAUDE_SUB + "/.claude.json", "oauthAccount") != null;
  const chatgpt = typeof field(CHATGPT, "tokens", "refresh_token") === "string";
  const has: Record<Vendor, boolean> = { "claude-sub": claude, "openai-sub": chatgpt, "claude-api": KEYS.anthropic !== "", "openai-api": KEYS.openai !== "" };
  return (Object.keys(USABLE) as Vendor[]).filter((v) => has[v]);
}

export function config_none(): string | null {
  return config_usable().length === 0 ? NONE : null;
}

export function config_follow(): boolean {
  const now = config_usable().join();
  if (now === FOLLOWED) {
    return false;
  }
  FOLLOWED = now;
  try {
    config_reload();
    return true;
  } catch (err) {
    console.error("unii: the sign-ins changed, but " + err_why(err));
    return false;
  }
}

function config_env_value(key: string): string | undefined {
  return process.env["UNII_" + key.toUpperCase()];
}

function config_str(x: unknown): string | undefined {
  return x === undefined || x === null ? undefined : text_of(x);
}

export function config_key_from(name: string, kept: Record<string, string>): From {
  return ENV_KEYS[name] ? "env" : kept[name] ? "file" : "default";
}

function config_path(path: string): string {
  return path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
}

export function config_get(key: string, def: string): string {
  return config_env_value(key) ?? config_str(FILE[key]) ?? def;
}

function config_file(): Record<string, unknown> {
  return config_file_of(config_text(FILE_PATH));
}

export function config_file_of(text: string | null): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  const json = config_json(FILE_PATH, text);
  if (!rec(json)) {
    throw new Error("config: config.json is no JSON object");
  }
  return json;
}

function config_text(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err_code(err) === "ENOENT") {
      return null;
    }
    throw new Error("config: " + path.basename(file) + " can't be read (" + (err_code(err) ?? String(err)) + ")");
  }
}

// a file's JSON, of its text; an Error names the file (keys.json's,
// nothing more: a parser's message may quote what it read)
function config_json(file: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const why = file === KEYS_PATH ? "" : " (" + err_why(err) + ")";
    throw new Error("config: " + path.basename(file) + " is no JSON" + why);
  }
}

export function config_make(file: Record<string, unknown>): Made {
  const offer: Offer = {
    vendors : config_vendors(config_value(file, "vendors")),
    models  : config_value(file, "models").split(",").map((m) => m.trim()),
  };
  offer.profiles = config_profiles(file, offer);
  const agents = config_value(file, "agents");
  return {
    offer,
    pick      : config_run("pick", config_value(file, "pick"), offer),
    compactor : config_run("compactor", config_value(file, "compactor"), offer),
    context   : config_context(config_value(file, "compactor_context")),
    agents    : agents ? config_run("agents", agents, offer) : null,
    after     : config_value(file, "after"),
  };
}

function config_context(text: string): number {
  const kb = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || kb < 1 || kb > 128) {
    throw new Error("config: compactor_context is no whole number of KB from 1 to 128: " + text);
  }
  return kb * 1000;
}

function config_run(key: string, text: string, offer: Offer): Pick {
  const [vendor, model, effort, speed] = text.split(":");
  const pick = Pick.read(Object.hasOwn(offer.profiles ?? {}, text) ? { profile: text, effort: "medium", speed: "slow" } : { vendor, model, effort, speed }, offer);
  if (pick === null) {
    throw new Error("config: " + key + " is no vendor:model:effort:speed or profile offered here: " + text);
  }
  return pick;
}

function config_profiles(file: Record<string, unknown>, offer: Offer): Record<string, Fall[]> {
  const env = process.env.UNII_PROFILES;
  const all: unknown = env === undefined ? file.profiles ?? {} : JSON.parse(env);
  if (!rec(all)) {
    throw new Error("config: profiles is no object of names, each a list of models");
  }
  return Object.fromEntries(Object.entries(all).map(([name, list]) => {
    if (name.trim() === "" || name.includes(":") || LABELS.includes(name) || !Array.isArray(list) || list.length === 0) {
      throw new Error("config: profile " + JSON.stringify(name) + " is no name (none of a model, no \":\") with a list of models");
    }
    return [name, items(list).map((f) => config_fall(name, String(f).trim(), offer))];
  }));
}

function config_fall(name: string, f: string, offer: Offer): Fall {
  const parts = f.split(":");
  const [vendor, label, effort, speed] = parts as [Vendor, string, string?, string?];
  const model = offer.vendors.includes(vendor) && offer.models.includes(label) ? Pick.model(vendor, label) : undefined;
  const bad = parts.length > 4 || (effort !== undefined && !EFFORTS.includes(effort)) || (speed !== undefined && !model?.speeds.includes(speed));
  if (model === undefined || bad) {
    throw new Error("config: profile " + JSON.stringify(name) + " has no vendor:model[:effort[:speed]] offered here: " + f);
  }
  return { vendor, model, effort, speed };
}

function config_vendors(text: string): Vendor[] {
  const list = text.split(",").map((v) => v.trim()) as Vendor[];
  const bad = list.find((v) => !VENDORS.includes(v));
  if (bad !== undefined) {
    throw new Error("config: vendors can't offer " + bad);
  }
  return list;
}

export function config_mcp_prefix(device: string): string {
  return device.replace(/[^A-Za-z0-9-]/g, "-");
}

function config_mcp_some(raw: unknown): boolean {
  if (typeof raw === "string") {
    try {
      return raw.trim() !== "" && config_mcp_some(JSON.parse(raw));
    } catch {
      return true;
    }
  }
  const all = get(raw, "mcpServers") ?? raw;
  return typeof all === "object" && all !== null && Object.keys(all).length > 0;
}

export function config_mcp(raw: unknown, device: string, notes: string[] = []): McpServer[] {
  const all = get(raw, "mcpServers") ?? raw;
  if (!rec(all)) {
    throw new Error("config: mcp must be an object of servers by name");
  }
  return Object.entries(all).flatMap(([name, server]) => {
    try {
      return [config_server(name, server, device)];
    } catch (err) {
      notes.push(err_why(err).replace(/^config: /, "") + ", so it is left out");
      return [];
    }
  });
}

function config_server(name: string, s: unknown, device: string): McpServer {
  const bad = (why: string) => new Error("config: mcp server " + JSON.stringify(name) + " " + why);
  const strs = (list: unknown, what: string): string[] => {
    if (list !== undefined && (!Array.isArray(list) || list.some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as a list of strings");
    }
    return items(list).map(String);
  };
  const map = (obj: unknown, what: string): Record<string, string> => {
    if (obj !== undefined && (typeof obj !== "object" || obj === null || Array.isArray(obj) || Object.values(obj).some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as an object of strings");
    }
    return Object.fromEntries(Object.entries(rec(obj) ? obj : {}).map(([k, v]) => [k, String(v)]));
  };
  if (!/^[A-Za-z0-9-]+(_[A-Za-z0-9-]+)*$/.test(name)) {
    throw bad("needs a name of letters, digits, - and single _s inside (its tools are named <server>__<tool>)");
  }
  if (!rec(s)) {
    throw bad("must be an object");
  }
  const type = s.type ?? (s.url === undefined ? "stdio" : "http");
  const timeout = s.timeout ?? 600;
  if (typeof timeout !== "number" || !(timeout > 0)) {
    throw bad("needs timeout as seconds, more than 0");
  }
  if (s.device !== undefined) {
    throw bad("has \"device\", which a device's own config.json doesn't take (its servers run on it)");
  }
  const server = { name: config_mcp_prefix(device) + "_" + name, device, command: "", args: [], env: {}, cwd: "", url: "", headers: {}, timeout };
  if (type === "stdio") {
    if (typeof s.command !== "string" || s.command === "" || (s.cwd !== undefined && typeof s.cwd !== "string")) {
      throw bad("needs a command (and cwd, if any, as a string)");
    }
    return { ...server, command: s.command, args: strs(s.args, "args"), env: map(s.env, "env"), cwd: typeof s.cwd === "string" ? s.cwd : "" };
  }
  if (type === "http") {
    if (typeof s.url !== "string" || s.url === "") {
      throw bad("needs a url");
    }
    return { ...server, url: s.url, headers: map(s.headers, "headers") };
  }
  throw bad("has type " + JSON.stringify(type) + "; unii runs stdio and http (streamable HTTP) servers");
}

function config_key(name: string): string {
  const key = (process.env[name] ?? "").trim();
  delete process.env[name];
  return key;
}

function config_keys(kept: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(VARS).map((name) => [name, ENV_KEYS[name] || kept[name] || ""]));
}

export function config_reload(): void {
  const file = config_file();
  const made = config_make(file);
  const keys = config_keys(keys_read());
  OFFER.vendors = made.offer.vendors;
  OFFER.models = made.offer.models;
  OFFER.profiles = made.offer.profiles;
  PICK = made.pick;
  COMPACTOR = made.compactor;
  COMPACTOR_CONTEXT = made.context;
  AGENTS = made.agents;
  AFTER = made.after;
  Object.assign(KEYS, keys);
  RELOADED.forEach((f) => f());
}

export type Snapshot = { file: string | null; keys: string | null; version: string };

export function config_snapshot(): Snapshot {
  const file = config_text(FILE_PATH);
  const keys = config_text(KEYS_PATH);
  const hash = crypto.createHash("sha256").update((file ?? "\u0001none") + "\0" + (keys ?? "\u0001none"));
  return { file, keys, version: hash.digest("hex").slice(0, 32) };
}

function keys_read(): Record<string, string> {
  return keys_of(config_text(KEYS_PATH));
}

export function keys_of(text: string | null): Record<string, string> {
  if (text === null) {
    return {};
  }
  const json = config_json(KEYS_PATH, text);
  const keys = rec(json) ? json : {};
  return Object.fromEntries(Object.keys(VARS).flatMap((name) => {
    const key = keys[name];
    return typeof key === "string" && key !== "" ? [[name, key]] : [];
  }));
}

export function keys_text(keys: Record<string, string>): string | null {
  const kept = Object.fromEntries(Object.entries(keys).filter(([name, key]) => VARS[name] !== undefined && key !== ""));
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept, null, 2) + "\n";
}
