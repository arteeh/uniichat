// Html
// ====
// What View.ts draws and Md.ts's tokens, as HTML, every text escaped, one
// element per row, knob or tab; and the settings page's parts. A click's
// effect is in the markup: `data-act`, the View.Act it makes;
// `data-copy`, what Copy copies (main.ts).

import type { Vendor } from "../../AskAI.ts";
import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import { EFFORTS, LABELS, Pick, VENDORS } from "../../Pick.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import * as Theme from "../../Theme.ts";
import * as Timer from "../../Timer.ts";
import * as View from "../../View.ts";

// Types
// =====

// this browser's notifications (main.ts notify_state): off, on, blocked
// in its settings, or only once on the Home Screen (an iPhone's Safari)
export type Notify = "off" | "on" | "blocked" | "home";

// Constants
// =========

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// a user's message past TALL chars (a line counts 80 or more: a paste)
// shows its head; its `details` unfolds it (style.css)
const TALL = 4000;

// the Copy button's icons: two sheets, and a check once copied
export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

// a diff line's class, by its mark
const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

// Show
// ====

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function copy_html(text: string): string {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}

// a row's markup, made once: a known message's rows are kept (View's
// whole_rows)
const MADE = new WeakMap<View.Row, string>();

export function row_html(row: View.Row): string {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}

function row_make(row: View.Row): string {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, Call.call_line(row.call), "");
      return `<div class="block"${open} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": { // a message open (1x) looks as it does whole, its "fold" pill beside Copy
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one  = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const copy = copy_html(row.call === null ? row.text : Call.call_text(row.call));
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL;
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      return `<div class="msg ${row.kind}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}

// a tool call: its icon, verb, head and device, over a code block for
// each other value
function call_html(c: Call.Call): string {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}

// a call's head: its emoji (Theme.TOOL) and name, then text ("" device:
// none shown)
function head_html(c: Call.Call, text: string, device: string): string {
  const icon  = `<span class="ic">${Theme.tool_glyph(c.name)}</span>`;
  const verb  = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}

function images_html(names: string[]): string {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}

// the memory modes' switch (on the chat's page) and its tooltips
export const MODES: Array<[string, string]> = [
  ["standard", "Each message is summarized for Unii's memory. Cheapest, good for long working sessions."],
  ["conversation", "Messages stay word-for-word in Unii's view until you switch back. Use it for discussions. It costs more per turn."],
];

// the line over the message box: fold/unfold and the memory mode (none
// on an agent's page: talk undefined), a rule, then the pick's knobs,
// each opening its menu (the browser's popover, placed by main.ts); one
// without choices (an agent's page) shown only. In conversation mode the
// rule is its meter: filled as far as its space is, from grey to orange
export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[], talk?: View.Talk | null): string[] {
  const parts = knobs.map((k) => k.choices.length === 0 ? [`<span class="knob" title="${esc(k.hint)}">${esc(k.text)}</span>`] : [
    `<button title="${esc(k.hint)}" data-knob="${k.move}" popovertarget="pick-${k.move}" aria-haspopup="menu">${esc(k.text)}</button>`,
    `<div id="pick-${k.move}" class="choices" popover role="menu" aria-label="${k.move[0].toUpperCase() + k.move.slice(1)}">${k.choices.map(choice_html).join("")}</div>`,
  ]);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  // each picks its mode; a narrow screen shows instead the mode on, as
  // one button that switches to the other (style.css)
  const mode = ([name, hint]: [string, string], k: number) => {
    const here = (talk != null) === (k === 1);
    return `<button title="${esc(hint)}" aria-pressed="${here}"${act_html({ $: "Talk", on: k === 1 })}>${name}</button>`;
  };
  const [now, about] = MODES[talk == null ? 0 : 1];
  const flip = `<button class="flip" title="${esc(about)} Tap for ${MODES[talk == null ? 1 : 0][0]}."${act_html({ $: "Talk", on: talk == null })}>${now}</button>`;
  const modes = talk === undefined ? [] : [`<span class="modes" role="group" aria-label="Memory mode">${MODES.map(mode).join("")}</span>`, flip];
  const used = talk == null ? 0 : Math.round(talk.used * 100);
  const rule = talk == null ? `<span class="rule"></span>` : `<span class="rule meter" style="--used:${used}%" title="Conversation: ${used}% of space used" role="meter" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100" aria-label="Conversation space used"></span>`;
  return [...all, ...modes, rule, ...parts.flatMap((part, i) => (i === 0 ? part : [`<span class="dot">·</span>`, ...part]))];
}

// a menu's row: a model's vendor over its first; the pick's marked and
// focused as the menu opens, its click only closing it
function choice_html(c: View.Choice): string {
  const head = c.vendor === null ? "" : `<p>${esc(c.vendor)}</p>`;
  const act  = c.here ? " autofocus" : act_html({ $: "Move", move: c.move, to: c.to });
  return `${head}<button role="menuitemradio" aria-checked="${c.here}"${act}>${esc(c.text)}</button>`;
}

// the MCP servers in the ☰ menu, each on or off in this chat (a click
// switches it); none: nothing
export function mcp_html(plugs: View.Plug[]): string[] {
  const one = (p: View.Plug) => {
    const hint = "Its tools are " + (p.on ? "on" : "off") + " in this chat; click to turn them " + (p.on ? "off" : "on") + ".";
    return `<button class="${p.on ? "on" : "off"}" title="${esc(hint)}"${act_html({ $: "Plug", name: p.name })}>${esc(p.name)}<span>${p.on ? "on" : "off"}</span></button>`;
  };
  return plugs.length === 0 ? [] : [`<p>MCP servers</p>`, ...plugs.map(one)];
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}

// the chat's schedules (the header's ⏰): each one's time, message and
// Cancel
export function timers_html(timers: Timer.Timer[]): string[] {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(Timer.timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}

// Settings page
// =============

// the settings page (/settings, or /account): the prompts (null, unread:
// a retry); this browser's own acts (notify: its notifications, null:
// none to offer); then the server's settings (main.ts fills .owned)
export function account_html(prompts: View.Prompts | null, notify: Notify | null = null): string {
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const acts    = [
    item("This browser", "Signed in to this server.", `<button class="chip out">Sign out</button>`),
    ...(notify === null ? [] : [notify_html(notify)]),
    item("Export memory", "The chat and its summaries, in one file.", `<a class="chip" href="/export">Download</a>`),
  ];
  const unread  = item("Could not read the prompts.", "", `<button class="chip retry">Try again</button>`);
  const mine    = section_html("Prompts", prompts === null ? unread : prompt_html("prompt", prompts.prompt.text, "The user prompt: Unii's system prompt in every turn; its subagents get it too once you change it. Add who you are and how you want work done at its end. prompt.md in the server's folder; empty: the built-in one.")
    + prompt_html("compact", prompts.compact.text, "The compaction prompt: all a summary of the memory gets, nothing else. compact.md in the server's folder; empty: the built-in one."));
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Settings</h1>` + mine + section_html("This browser", acts.join("")) + `<div class="owned"></div>`;
}

// a prompt's editor: its note, its text (name: what /api/prompts sets), Save
function prompt_html(name: string, text: string, note: string): string {
  const area = `<textarea name="${name}" rows="12" spellcheck="false">${esc(text)}</textarea>`;
  return `<form class="prompt"><p class="note">${esc(note)}</p>${area}<div><p class="why"></p><button class="chip">Save</button></div></form>`;
}

// the account page's notifications item: its note, and its button
function notify_html(notify: Notify): string {
  const note = {
    off     : "Replies on this device, when UniiChat isn't open.",
    on      : "Replies on this device, when UniiChat isn't open.",
    blocked : "Blocked in this browser's settings for this site.",
    home    : "On iPhone and iPad: Share, then Add to Home Screen, and open it from there.",
  }[notify];
  const button = notify === "home" ? "" : `<button class="chip notify"${notify === "blocked" ? " disabled" : ""}>${notify === "on" ? "Turn off" : "Turn on"}</button>`;
  return `<div class="item"><p>Notifications<small>${note}</small></p>${button}</div>`;
}

// Settings
// ========
// The owner's part of the settings page (the server's settings:
// Settings.ts), at its bottom: a row a setting or a key the page may
// change, each its control (named by its key; a key's "key.<name>"),
// where its value comes from and when a change applies, a button back
// to the default (a key: out) if config.json sets it, and a place for
// why a save was refused. One the page may not change (set by the
// environment, or a server path or command) isn't shown. main.ts reads
// the form and fills the picks' lists (picks_html).

// what each setting is, as the page says it: its name, a line about it
const SETTING: Record<string, [string, string]> = {
  vendors   : ["Vendors", "Whose models the server offers."],
  models    : ["Models", "The models offered, of those vendors."],
  pick      : ["Default model", "What a chat runs on until it picks another."],
  compactor : ["Compactor model", "What writes the memory's summaries. Sonnet medium summarizes more faithfully than Haiku, using more of a plan's limits."],
  compactor_context : ["Compactor context", "How much of the chat each summary sees, in KB (1 to 128). More context lets it copy more into a summary that its message doesn't say. New summaries only."],
  agents    : ["Subagent model", "What subagents run on."],
  site      : ["Site", "The server's address, for sign-in links and the installer."],
  apple     : ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns      : ["APNs key ID", "The ID of the key the app's pushes are signed with."],
};

const KEY: Record<string, [string, string]> = {
  anthropic : ["Anthropic key", "For claude-api's models."],
  openai    : ["OpenAI key", "For openai-api's models and dictation."],
  apns      : ["APNs key", "The .p8 key the iOS app's pushes are signed with."],
};

// each vendor's key
export const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

// the settings whose value is a pick (four lists: picks_html)
export const PICKS = ["pick", "compactor", "agents"];

const GROUPS: Array<[string, string[]]> = [
  ["Models", ["vendors", "models", "pick", "compactor", "compactor_context", "agents"]],
  ["Server", ["site", "apple", "apns"]],
];

export function settings_html(page: Page): string {
  const rows = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, keys]: [string, string[]]) => {
    const shown = keys.flatMap((k) => rows.get(k) ?? []);
    return shown.length === 0 ? "" : section_html(title, shown.map(setting_html).join(""));
  };
  const shown = page.keys.filter((k) => k.from !== "env");
  const keys = shown.length === 0 ? "" : section_html("Keys", `<p class="sub">Kept in keys.json in the server's folder, readable by the server's user only, and never shown again, only their last characters.</p>` + shown.map(key_html).join(""));
  const error = page.error === null ? "" : `<p class="why bad">${esc(page.error)}</p>`;
  const save = `<div class="save"><p class="why"></p><button class="chip go"${page.error === null ? "" : " disabled"}>Save</button></div>`;
  const head = `<p class="sub">The server's settings, in config.json in its folder.</p>`;
  const profiles = page.profiles === null ? "" : section_html("Profiles", `<p class="sub">Ranked models: a chat on a profile runs on the first and falls back to the next when one is out.</p><div class="set profiles" data-key="profiles"><div class="field"></div><p class="err"></p></div>`);
  return head + error + `<form class="settings" autocomplete="off">` + group(GROUPS[0]) + profiles + keys + group(GROUPS[1]) + save + `</form>`;
}

// the models the vendors and models checked offer, as "vendor:model"
export function offered(vendors: string[], models: string[]): string[] {
  return Pick.models(VENDORS.filter((v) => vendors.includes(v)), models).map(([v, m]) => v + ":" + m.label);
}

// the profile editor (main.ts fills .profiles .field and keeps the
// list): each profile its name, Delete, its models in order (each a
// handle to drag, or move by arrow keys, and Remove) and a list to add
// one of `offered` ("vendor:model", the vendors' and models checked);
// then Add profile
export function profiles_html(profiles: Array<[string, string[]]>, offered: string[]): string {
  const model = (m: string, i: number, j: number) => {
    const [vendor = "", label = m, ...rest] = m.split(":");
    const more = rest.length === 0 ? "" : ` <small>${esc(rest.join(" · "))}</small>`;
    return `<li data-j="${j}"><button type="button" class="grip" data-i="${i}" data-j="${j}" aria-label="Move ${esc(label)}">⠿</button><span>${esc(label)}${more} <small>${esc(vendor)}</small></span><button type="button" class="out" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(label)}">×</button></li>`;
  };
  const add = (list: string[], i: number) => {
    const left = offered.filter((m) => !list.some((x) => x.split(":").slice(0, 2).join(":") === m));
    const groups = [...new Set(left.map((m) => m.split(":")[0]))].map((v) => `<optgroup label="${esc(v)}">${left.filter((m) => m.startsWith(v + ":")).map((m) => `<option value="${esc(m)}">${esc(m.split(":")[1])}</option>`).join("")}</optgroup>`);
    return left.length === 0 ? "" : `<select class="add" data-i="${i}" aria-label="Add model"><option value="">Add model</option>${groups.join("")}</select>`;
  };
  const one = ([name, list]: [string, string[]], i: number) =>
    `<div class="prof" data-i="${i}"><div class="name"><input class="pname" data-i="${i}" value="${esc(name)}" aria-label="Name" placeholder="Enter the profile name here" maxlength="60" spellcheck="false" autocapitalize="off"><button type="button" class="chip red pdel" data-i="${i}">Delete</button></div><ol>${list.map((m, j) => model(m, i, j)).join("")}</ol>${add(list, i)}</div>`;
  return profiles.map(one).join("") + `<button type="button" class="chip pnew">Add profile</button>`;
}

function setting_html(r: Row): string {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(r.key)}</code></small></label>`;
  return `<div class="set" data-key="${esc(r.key)}">${label}<div class="field">${control_html(r)}</div>${from_html(r)}<p class="err"></p></div>`;
}

function control_html(r: Row): string {
  switch (r.key) {
    case "vendors": {
      return checks_html("vendors", VENDORS, list(r.value), () => "") + `<p class="warn"></p>`;
    }
    case "models": {
      return checks_html("models", LABELS, list(r.value), (x) => Pick.models(VENDORS, [x]).map(([vendor]) => vendor).join(" "));
    }
    case "pick":
    case "compactor":
    case "agents": {
      return `<input type="hidden" name="${r.key}" value="${esc(r.value)}"><div class="four"></div>`;
    }
    case "compactor_context": {
      return `<input id="set-${r.key}" name="${r.key}" type="number" min="1" max="128" step="1" inputmode="numeric" value="${esc(r.value)}" placeholder="${esc(r.def)}">`;
    }
  }
  return `<input id="set-${r.key}" name="${r.key}" value="${esc(r.value)}" placeholder="${esc(r.def)}" spellcheck="false" autocapitalize="off">`;
}

// a list setting's items
export function list(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

// a list as saved (`was`) and its items checked now (`now`, in the boxes'
// order): null if the same items (in any order: no change); else the
// items kept, in their order, then those added, in the boxes'
export function list_changed(was: string[], now: string[]): string[] | null {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}

// a box per item; a model's names the vendors that offer it
// (`data-vendor`, space-separated: main.ts shows it while one is checked)
function checks_html(name: string, all: string[], on: string[], vendor: (x: string) => string): string {
  const box = (x: string) => `<label class="opt" data-vendor="${esc(vendor(x))}"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}

// where a value comes from, when a change applies, and the button back
// to the default
function from_html(r: Row): string {
  const from = r.from === "file" ? "From config.json" : "Default";
  const apply = r.apply === "now" ? "applies at once" : "applies on a restart";
  const running = r.running === null ? "" : ` · running on <code>${esc(r.running === "" ? "(none)" : r.running)}</code> till then`;
  const reset = r.from === "file" ? ` <button type="button" class="reset">Use the default</button>` : "";
  return `<p class="from">${from} · ${apply}${running}${reset}</p>`;
}

function key_html(k: Key): string {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = k.name === "apns" ? `<textarea id="${id}" name="key.${k.name}" rows="3" placeholder="Paste a new key to set it" spellcheck="false"></textarea>` : `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "file" ? `Set${tail}, in keys.json` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(k.env)}</code></small></label>`;
  return `<div class="set key" data-key="key.${esc(k.name)}">${label}<div class="field">${field}</div><p class="from">${from}${reset}</p><p class="err"></p></div>`;
}

// a pick setting's four lists, vendor, model, effort and speed, for
// `value` (vendor:model:effort:speed): the vendors and the models checked
// (`vendors`, `models`), the vendor's models, the model's speeds; first
// `none` (agents: the chat's pick, value ""), which shows the vendor's
// list only. A part they don't offer shows, said. The profiles' names
// (`profiles`) follow the vendors in the first list; one picked is
// the whole value, so no other list shows.
export function picks_html(key: string, vendors: string[], models: string[], value: string, none: string | null, profiles: string[] = []): string {
  const [vendor = "", model = "", effort = "", speed = ""] = value === "" ? [] : value.split(":");
  const known = (VENDORS as string[]).includes(vendor);
  const offered = (VENDORS as string[]).filter((v) => vendors.includes(v));
  const labels = known ? Pick.models([vendor as Vendor], models).map(([, m]) => m.label) : [];
  const speeds = known ? Pick.model(vendor as Vendor, model)?.speeds ?? [] : [];
  const select = (part: string, name: string, all: string[], on: string, first: string | null) => {
    const opts: Array<[string, string]> = [...(first === null ? [] : [["", first] as [string, string]]), ...(all.includes(on) || (on === "" && first !== null) ? [] : [[on, on + " (not offered)"] as [string, string]]), ...all.map((x): [string, string] => [x, x])];
    const items = opts.map(([v, text]) => `<option value="${esc(v)}"${v === on ? " selected" : ""}>${esc(text)}</option>`).join("");
    return `<select id="set-${key}-${part}" name="${key}.${part}" aria-label="${name}">${items}</select>`;
  };
  const head = select("vendor", "Vendor", [...offered, ...profiles], vendor, none);
  return vendor === "" || profiles.includes(vendor) ? head : head + select("model", "Model", labels, model, null) + select("effort", "Effort", EFFORTS, effort, null) + select("speed", "Speed", speeds, speed, null);
}

// a pick of its four parts as chosen: a model its vendor lacks gives way
// to the vendor's first checked, a speed the model lacks to its first, no
// effort to medium; no vendor: none (""); a profile (`profiles`): its name
export function pick_mend(parts: string[], models: string[], profiles: string[] = []): string {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!(VENDORS as string[]).includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor as Vendor, model) ?? Pick.models([vendor as Vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, effort || "medium", m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}

// a section of the settings page: its title, then its markup
function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

export function block_html(b: Md.Block): string {
  switch (b.$) {
    case "Para": {
      return `<p>${b.x.map(spans_html).join("<br>")}</p>`;
    }
    case "Head": {
      const tag = "h" + Math.min(4, b.k + 1);
      return `<${tag}>${spans_html(b.x)}</${tag}>`;
    }
    case "Code": {
      const lang = b.k === "" ? "" : `<span class="lang">${esc(b.k)}</span>`;
      return `<pre>${copy_html(b.x)}${lang}<code>${esc(b.x)}</code></pre>`;
    }
    case "Rule": {
      return "<hr>";
    }
    case "Quot": {
      return `<blockquote>${b.x.map(block_html).join("")}</blockquote>`;
    }
    case "List": {
      const tag = b.k ? "ol" : "ul";
      const start = b.k && b.n !== 1 ? ` start="${b.n}"` : "";
      const items = b.x.map((item) => `<li>${item_html(item, b.t)}</li>`);
      return `<${tag}${start}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${spans_html(cell)}</${tag}>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "Diff": {
      return diff_html(b.k, b.x);
    }
    case "File": {
      return file_html(b.k, b.n, b.x);
    }
  }
}

// a list item's blocks; in a tight list its paragraphs bare (lines, not
// paragraphs spaced apart)
function item_html(blocks: Md.Block[], tight: boolean): string {
  return blocks.map((b) => (tight && b.$ === "Para" ? b.x.map(spans_html).join("<br>") : block_html(b))).join("");
}

// a diff: its file and its lines added and dropped over its lines, each
// its number, its mark and its text (style.css hangs a wrap after the
// number); a ⋯ between hunks
function diff_html(file: string, hunks: Md.Line[][]): string {
  const all   = hunks.flat();
  const nw    = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds  = all.filter((l) => l.s === "+").length;
  const dels  = all.filter((l) => l.s === "-").length;
  const head  = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line  = (l: Md.Line) => `<span class="${MARKS[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}

// a read's lines: framed as a diff is, the lines shown over them, each
// its number and its text
function file_html(shown: string, from: number, lines: string[]): string {
  const nw   = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}

function spans_html(spans: Md.Span[]): string {
  return spans.map(span_html).join("");
}

function span_html(s: Md.Span): string {
  switch (s.$) {
    case "Text": { // the name, in the brand's font
      return esc(s.x).replaceAll("UniiChat", `<span class="brand">UniiChat</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${esc(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${esc(s.x)}</em>`;
    }
    case "Link": {
      return `<a href="${esc(s.k)}" target="_blank" rel="noopener">${esc(s.x)}</a>`;
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}
