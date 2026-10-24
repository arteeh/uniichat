// Config
// ======
// The server's settings. Its DIR ($UNII_DIR, default ~/.unii) holds
// config.json, keys.json, the prompts, the lock, unii.db (Owner.ts) and
// the chat (chat/). Each key of config.json (README, SETTINGS) may be
// set as UNII_<KEY> instead, which wins; a path may start with "~/". The
// keys are read from the environment and removed from it, so no program
// an agent runs inherits them; a key the environment lacks is read from
// keys.json (0600), where the settings page puts them (Settings.ts).
// config_reload reads both
// files again: what SETTINGS applies "now" changes at once, the rest
// on the next start.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Vendor } from "./AskAI.ts";
import { EFFORTS, LABELS, VENDORS, Pick, type Fall, type Offer } from "./Pick.ts";

// Types
// =====

// a setting: its key in config.json, its default; whether a change
// applies at once ("now": config_reload) or on the next start; whether
// the settings page may change it (one that names a command or a file
// the server runs or reads may not: a sign-in would be a shell on the
// server; one that decides how the server is reached neither: a wrong
// one is fixed only by hand)
export type Setting = { key: string; def: string; apply: "now" | "restart"; web: boolean };

// where a value comes from: the environment, config.json (a key:
// keys.json), the default (a key: none)
export type From = "env" | "file" | "default";

// the settings a config.json gives, the environment's winning
type Made = {
  offer     : Offer;
  pick      : Pick;
  compactor : Pick;
  context   : number;
  agents    : Pick | null;
  after     : string;
};

// Types
// =====

// a user's MCP server (Mcp.ts), from a device's own config.json
// (Tools.servers), run on that device (Mcp.here): a program (stdio:
// command, its args, its env: all it gets beside the few of the device's
// variables Mcp.ts passes on, its dir) or a URL (streamable HTTP, with
// headers), reached from the device; how long a tool call may take, in
// seconds; the device. Its ${VAR}s and ~ are read there
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

// Constants
// =========

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

// the keys, by name, and the variable each is read from
export const VARS: Record<string, string> = {
  anthropic       : "ANTHROPIC_API_KEY",
  openai          : "OPENAI_API_KEY",
  apns            : "APNS_KEY",
};

// config.json as read at the start
const FILE: Record<string, unknown> = config_file();

const MADE = config_make(FILE);

// the values this process started with: what a "restart" setting runs on
export const STARTED: Record<string, string> = Object.fromEntries(SETTINGS.map((s) => [s.key, config_value(FILE, s.key)]));

export const SITE    = config_value(FILE, "site").replace(/\/$/, "");
export const OFFER: Offer = MADE.offer;

export let   AFTER      = MADE.after;
export let   PICK       = MADE.pick;

// what every compaction runs on, a chat's and an import's alike, whatever
// the chat's pick
export let   COMPACTOR  = MADE.compactor;
// how much of the chat (bytes; config compactor_context, in KB) a
// compaction sees before its input: less context, less for it to copy
// into its line that the input lacks
export let   COMPACTOR_CONTEXT = MADE.context;
export let   AGENTS     = MADE.agents;

// the iOS app (ios/, Owner.ts): its App ID, the team's then the bundle's
// ("TEAM.com.example.uniichat"), whose app sign-in links open; and
// the id of the key its pushes are signed with (APNS_KEY holds the key)
export const APPLE      = config_value(FILE, "apple");
export const APNS       = config_value(FILE, "apns");

// openai-sub's ChatGPT sign-in (ChatGPT.ts)
export const CHATGPT    = config_path(config_get("chatgpt", DIR + "/chatgpt.json"));

// claude-sub's Claude Code (ClaudeSub.ts): its config dir, where its
// sign-in is kept; the executable ("": the one unii carries, else the
// Agent SDK's)
export const CLAUDE_SUB = config_path(config_get("claude_sub", DIR + "/claude-sub"));
export const CLAUDE     = config_path(config_get("claude", ""));

// the keys the environment gave (removed from it), and every key as used:
// the environment's, else keys.json's
const ENV_KEYS: Record<string, string> = Object.fromEntries(Object.entries(VARS).map(([name, v]) => [name, config_key(v)]));
export const KEYS: Record<string, string> = config_keys(keys_read());

// MCP servers run only on devices (Mcp.ts): UNII_MCP's are left out,
// MCP_LEFT the note that says so (null: unset), for the log and the chat;
// MCP_FILE: this config.json has servers in its `mcp`, which only a
// device on this computer reading it as its own runs (Tools.servers):
// only the log says so as the server starts, since as a turn starts
// (one a restart cut, resumed) that device may not have joined yet.
// UNII_MCP leaves the environment (its headers may hold a secret)
const MCP_VAR = process.env.UNII_MCP;
delete process.env.UNII_MCP;
export const MCP_LEFT: string | null = config_mcp_some(MCP_VAR)
  ? "UNII_MCP is set, but unii serve runs no MCP servers, so they are left out: put them in the mcp of a device's own ~/.unii/config.json (for this computer, run unii device beside the server)."
  : null;
export const MCP_FILE = config_mcp_some(FILE.mcp);

// Config
// ======

// a setting's value in `file`, the environment's winning, else its default
export function config_value(file: Record<string, unknown>, key: string): string {
  const def = SETTINGS.find((s) => s.key === key)?.def ?? "";
  return config_env_value(key) ?? config_str(file[key]) ?? def;
}

function config_env_value(key: string): string | undefined {
  return process.env["UNII_" + key.toUpperCase()];
}

// a value of config.json as a string (one hand-written as a number or a
// list too); null and none: unset
function config_str(x: unknown): string | undefined {
  return x === undefined || x === null ? undefined : String(x);
}

// a key's: the environment's, keys.json's (`kept`), or none ("default")
export function config_key_from(name: string, kept: Record<string, string>): From {
  return ENV_KEYS[name] ? "env" : kept[name] ? "file" : "default";
}

function config_path(path: string): string {
  return path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
}

// a setting not on the settings page: the environment's, else
// config.json's, else `def`
export function config_get(key: string, def: string): string {
  return config_env_value(key) ?? config_str(FILE[key]) ?? def;
}

// config.json, read (none: empty); an Error if it is no JSON object
export function config_file(): Record<string, unknown> {
  return config_file_of(config_text(FILE_PATH));
}

// config.json's text (null: none), as read
export function config_file_of(text: string | null): Record<string, unknown> {
  if (text === null) {
    return {};
  }
  const json = config_json(FILE_PATH, text);
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("config: config.json is no JSON object");
  }
  return json;
}

// a file's text; null: there is none
export function config_text(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return null;
    }
    throw new Error("config: " + path.basename(file) + " can't be read (" + (err?.code ?? err) + ")");
  }
}

// a file's JSON, of its text; an Error names the file (keys.json's,
// nothing more: a parser's message may quote what it read)
function config_json(file: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch (err: any) {
    const why = file === KEYS_PATH ? "" : " (" + (err?.message ?? err) + ")";
    throw new Error("config: " + path.basename(file) + " is no JSON" + why);
  }
}

// what `file` sets, checked as a start does: an Error names the first
// setting that is wrong
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

// compactor_context: whole KB, 1 to 128, as bytes
function config_context(text: string): number {
  const kb = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || kb < 1 || kb > 128) {
    throw new Error("config: compactor_context is no whole number of KB from 1 to 128: " + text);
  }
  return kb * 1000;
}

// vendor:model:effort:speed, or a profile's name (at medium and slow
// unless its first model names its own)
function config_run(key: string, text: string, offer: Offer): Pick {
  const [vendor, model, effort, speed] = text.split(":");
  const pick = Pick.read(Object.hasOwn(offer.profiles ?? {}, text) ? { profile: text, effort: "medium", speed: "slow" } : { vendor, model, effort, speed }, offer);
  if (pick === null) {
    throw new Error("config: " + key + " is no vendor:model:effort:speed or profile offered here: " + text);
  }
  return pick;
}

// config `profiles` (as UNII_PROFILES: its JSON) in `file`: names no
// model has and without a ":", each a list of the models `offer` has,
// one or more (a JSON object, not a string: read and written as one)
export function config_profiles(file: Record<string, unknown>, offer: Offer): Record<string, Fall[]> {
  const env = process.env.UNII_PROFILES;
  const all: any = env === undefined ? file.profiles ?? {} : JSON.parse(env);
  if (all === null || typeof all !== "object" || Array.isArray(all)) {
    throw new Error("config: profiles is no object of names, each a list of models");
  }
  return Object.fromEntries(Object.entries(all).map(([name, list]: [string, any]) => {
    if (name.trim() === "" || name.includes(":") || LABELS.includes(name) || !Array.isArray(list) || list.length === 0) {
      throw new Error("config: profile " + JSON.stringify(name) + " is no name (none of a model, no \":\") with a list of models");
    }
    return [name, list.map((f) => config_fall(name, String(f).trim(), offer))];
  }));
}

// a profile's model: vendor:model, then an effort and a speed if not the pick's
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

// a device's name as its MCP servers' start: other than letters, digits
// and -, each character a - (so desk_a's and desk-a's are one: Tools.plug)
export function config_mcp_prefix(device: string): string {
  return device.replace(/[^A-Za-z0-9-]/g, "-");
}

// whether an `mcp` has any server: Claude's `mcpServers` shape with one,
// its JSON, or a file's path (Device.ts reads that)
function config_mcp_some(raw: unknown): boolean {
  if (typeof raw === "string") {
    try {
      return raw.trim() !== "" && config_mcp_some(JSON.parse(raw));
    } catch {
      return true;
    }
  }
  const all: any = (raw as any)?.mcpServers ?? raw;
  return typeof all === "object" && all !== null && Object.keys(all).length > 0;
}

// a device's MCP servers, from the `mcp` of its own config.json
// (Device.ts), in Claude's `mcpServers` shape (the object, or one that
// holds it under that key, as Claude's .mcp.json does): each named
// <device>_<server>, run there, its ${VAR}s and ~ read there (Mcp.here).
// One that is wrong is left out, why in `notes`
export function config_mcp(raw: unknown, device: string, notes: string[] = []): McpServer[] {
  const all: any = (raw as any)?.mcpServers ?? raw;
  if (typeof all !== "object" || all === null || Array.isArray(all)) {
    throw new Error("config: mcp must be an object of servers by name");
  }
  return Object.entries(all).flatMap(([name, server]) => {
    try {
      return [config_server(name, server, device)];
    } catch (err: any) {
      notes.push(err.message.replace(/^config: /, "") + ", so it is left out");
      return [];
    }
  });
}

// a device's server, its strings kept as they are (the device reads
// their ${VAR}s). An error never quotes a value (it may hold a secret). A
// name has no "__" and no _ at its ends, so "<server>__<tool>" names its
// server
function config_server(name: string, s: any, device: string): McpServer {
  const bad = (why: string) => new Error("config: mcp server " + JSON.stringify(name) + " " + why);
  const strs = (list: unknown, what: string): string[] => {
    if (list !== undefined && (!Array.isArray(list) || list.some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as a list of strings");
    }
    return (list ?? []) as string[];
  };
  const map = (obj: unknown, what: string): Record<string, string> => {
    if (obj !== undefined && (typeof obj !== "object" || obj === null || Array.isArray(obj) || Object.values(obj).some((x) => typeof x !== "string"))) {
      throw bad("needs " + what + " as an object of strings");
    }
    return { ...(obj ?? {}) } as Record<string, string>;
  };
  if (!/^[A-Za-z0-9-]+(_[A-Za-z0-9-]+)*$/.test(name)) {
    throw bad("needs a name of letters, digits, - and single _s inside (its tools are named <server>__<tool>)");
  }
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
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
  // named for its device too (two devices of one prefix: Tools.plug)
  const server = { name: config_mcp_prefix(device) + "_" + name, device, command: "", args: [], env: {}, cwd: "", url: "", headers: {}, timeout };
  if (type === "stdio") {
    if (typeof s.command !== "string" || s.command === "" || (s.cwd !== undefined && typeof s.cwd !== "string")) {
      throw bad("needs a command (and cwd, if any, as a string)");
    }
    return { ...server, command: s.command, args: strs(s.args, "args"), env: map(s.env, "env"), cwd: s.cwd ?? "" };
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

// every key as used, keys.json's (`kept`) under the environment's
function config_keys(kept: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(VARS).map((name) => [name, ENV_KEYS[name] || kept[name] || ""]));
}

// config.json and keys.json read again: what applies at once takes their
// values (OFFER and KEYS changed in place, so who holds them sees it);
// one wrong (a hand edit) throws and changes nothing
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
}

// config.json and keys.json as read at once: their texts (null: none)
// and their version, a hash of both: what a save checks is unchanged
// since the page read them. What a page shows is read from these same
// texts, so its version is what it shows
export type Snapshot = { file: string | null; keys: string | null; version: string };

export function config_snapshot(): Snapshot {
  const file = config_text(FILE_PATH);
  const keys = config_text(KEYS_PATH);
  const hash = crypto.createHash("sha256").update((file ?? "\u0001none") + "\0" + (keys ?? "\u0001none"));
  return { file, keys, version: hash.digest("hex").slice(0, 32) };
}

export function config_version(): string {
  return config_snapshot().version;
}

// Keys
// ====
// The keys the settings page set, by name, in keys.json: plain JSON,
// only the server's user may read it (600; README).

export function keys_read(): Record<string, string> {
  return keys_of(config_text(KEYS_PATH));
}

// keys.json's keys, of its text (null: none); an Error if it is no JSON
export function keys_of(text: string | null): Record<string, string> {
  if (text === null) {
    return {};
  }
  const json = config_json(KEYS_PATH, text);
  const keys = json !== null && typeof json === "object" && !Array.isArray(json) ? json : {};
  return Object.fromEntries(Object.keys(VARS).filter((name) => typeof keys[name] === "string" && keys[name] !== "").map((name) => [name, keys[name]]));
}

// keys.json's text for `keys`; none left: null (the file goes)
export function keys_text(keys: Record<string, string>): string | null {
  const kept = Object.fromEntries(Object.entries(keys).filter(([name, key]) => VARS[name] !== undefined && key !== ""));
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept, null, 2) + "\n";
}
