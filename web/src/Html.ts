import type { Vendor } from "../../AskAI.ts";
import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import { EFFORTS, LABELS, Pick, VENDORS } from "../../Pick.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import * as Theme from "../../Theme.ts";
import * as Timer from "../../Timer.ts";
import * as View from "../../View.ts";

// this browser's notifications (main.ts notify_state): off, on, blocked
// in its settings, or only once on the Home Screen (an iPhone's Safari)
export type Notify = "off" | "on" | "blocked" | "home";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

const TALL = 4000;

export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function copy_html(text: string): string {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}

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
    case "Box": {
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
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL && !row.text.includes("](/media/");
      const media = row.body.some((b) => b.$ === "Para" && b.x.some((s) => s.$ === "Pict"));
      const cut = row.kind === "tool" || (row.kind === "echo" && !media);
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : cut ? `<div class="cut">${body}</div><button class="unfold" aria-expanded="false">Show all</button>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      const queued = row.queued === true ? " queued" : "";
      return `<div class="msg ${row.kind}${queued}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}

function call_html(c: Call.Call): string {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}

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

const MODES: Array<[string, string]> = [
  ["standard", "Each message is summarized for Unii's memory. Cheapest, good for long working sessions."],
  ["conversation", "Messages stay word-for-word in Unii's view until you switch back. Use it for discussions. It costs more per turn."],
];

export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[], talk?: View.Talk | null): string[] {
  const knob = (move: string, hint: string, text: string, rows: string) => [
    `<button title="${esc(hint)}" data-knob="${move}" popovertarget="pick-${move}" aria-haspopup="menu">${esc(text)}</button>`,
    `<div id="pick-${move}" class="choices" popover role="menu" aria-label="${move[0].toUpperCase() + move.slice(1)}">${rows}</div>`,
  ];
  const parts = knobs.map((k) => k.choices.length === 0 ? [`<span class="knob" title="${esc(k.hint)}">${esc(k.text)}</span>`] : knob(k.move, k.hint, k.text, k.choices.map(choice_html).join("")));
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  const mode = ([name, hint]: [string, string], k: number) => {
    const here = (talk != null) === (k === 1);
    return `<button role="menuitemradio" aria-checked="${here}" title="${esc(hint)}"${here ? " autofocus" : act_html({ $: "Talk", on: k === 1 })}>${name}</button>`;
  };
  const [now, about] = MODES[talk == null ? 0 : 1];
  const modes = talk === undefined ? [] : knob("mode", about, now, MODES.map(mode).join(""));
  const used = talk == null ? 0 : Math.round(talk.used * 100);
  const heat = used >= 80 ? " hot" : used >= 50 ? " warm" : "";
  const rule = talk == null ? `<span class="rule"></span>` : `<span class="rule meter${heat}" style="--used:${used}%" title="Conversation: ${used}% of space used (${View.talk_tokens(talk)})" role="meter" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100" aria-label="Conversation space used"></span>`;
  const dot = `<span class="dot">·</span>`;
  const join = (groups: string[][]) => groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? g : [dot, ...g]));
  return [...join([all, modes]), rule, ...join(parts)];
}

function choice_html(c: View.Choice): string {
  const head = c.vendor === null ? "" : `<p>${esc(c.vendor)}</p>`;
  const act  = c.here ? " autofocus" : act_html({ $: "Move", move: c.move, to: c.to });
  return `${head}<button role="menuitemradio" aria-checked="${c.here}"${act}>${esc(c.text)}</button>`;
}

export function mcp_html(plugs: View.Plug[]): string[] {
  const one = (p: View.Plug) => {
    const act = act_html({ $: "Plug", name: p.name });
    const button = `<button class="chip" role="switch" aria-checked="${p.on}" aria-label="${esc(p.name)}"${act}>${p.on ? "Turn off" : "Turn on"}</button>`;
    return `<div class="item"><p>${esc(p.name)}<small>Its tools are ${p.on ? "on" : "off"} in this chat.</small></p>${button}</div>`;
  };
  const none = `<p class="sub">None set up. Add them as <code>mcp</code> in a device's own config.json: they run on that device.</p>`;
  return plugs.length === 0 ? [none] : plugs.map(one);
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}

export function timers_html(timers: Timer.Timer[]): string[] {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(Timer.timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}

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
  const mcp     = section_html("MCP servers", `<div class="mcp"></div>`);
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Settings</h1>` + mine + section_html("This browser", acts.join("")) + mcp + `<div class="owned"></div>`;
}

function prompt_html(name: string, text: string, note: string): string {
  const area = `<textarea name="${name}" rows="12" spellcheck="false">${esc(text)}</textarea>`;
  return `<form class="prompt"><p class="note">${esc(note)}</p>${area}<div><p class="why"></p><button class="chip">Save</button></div></form>`;
}

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

export const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

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
  const none = page.none === null ? "" : `<p class="why bad">${esc(page.none).replace(/`([^`]+)`/g, "<code>$1</code>")}.</p>`;
  const save = `<div class="save"><p class="why"></p><button class="chip go"${page.error === null ? "" : " disabled"}>Save</button></div>`;
  const head = `<p class="sub">The server's settings, in config.json in its folder.</p>`;
  const profiles = page.profiles === null ? "" : section_html("Profiles", `<p class="sub">Ranked models: a chat on a profile runs on the first and falls back to the next when one is out.</p><div class="set profiles" data-key="profiles"><div class="field"></div><p class="err"></p></div>`);
  return head + error + none + `<form class="settings" autocomplete="off">` + group(GROUPS[0]) + profiles + keys + group(GROUPS[1]) + save + `</form>`;
}

export function offered(vendors: string[], models: string[]): string[] {
  return Pick.models(VENDORS.filter((v) => vendors.includes(v)), models).map(([v, m]) => v + ":" + m.label);
}

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

export function list(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

export function list_changed(was: string[], now: string[]): string[] | null {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}

function checks_html(name: string, all: string[], on: string[], vendor: (x: string) => string): string {
  const box = (x: string) => `<label class="opt" data-vendor="${esc(vendor(x))}"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}

function from_html(r: Row): string {
  const from = r.from === "file" ? "From config.json" : "Default" + (r.why === "" ? "" : ": " + esc(r.why));
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

function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

function block_html(b: Md.Block): string {
  switch (b.$) {
    case "Para": {
      return `<p>${spans_html(b.x)}</p>`;
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
      const box = (c: boolean | null) => (c === null ? "" : `<input type="checkbox" disabled${c ? " checked" : ""}> `);
      const items = b.x.map((item, k) => `<li${b.c[k] == null ? "" : ` class="task"`}>${box(b.c[k] ?? null)}${item_html(item, b.t)}</li>`);
      return `<${tag}${start}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell, c) => `<${tag}${b.a[c] ? ` style="text-align:${b.a[c]}"` : ""}>${spans_html(cell)}</${tag}>`);
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

function item_html(blocks: Md.Block[], tight: boolean): string {
  return blocks.map((b) => (tight && b.$ === "Para" ? spans_html(b.x) : block_html(b))).join("");
}

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

function file_html(shown: string, from: number, lines: string[]): string {
  const nw   = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}

function chip_html(url: string, name: string): string {
  const shown = name.trim() || (url.split("/").pop() ?? "");
  return `<a class="file" href="${esc(url)}" download="${esc(shown)}" title="Download ${esc(shown)}"><span class="ic">📎</span><span class="fname">${esc(shown)}</span><small data-of="${esc(url)}"></small></a>`;
}

function spans_html(spans: Md.Span[]): string {
  return spans.map(span_html).join("");
}

function span_html(s: Md.Span): string {
  switch (s.$) {
    case "Text": {
      return esc(s.x).replaceAll("UniiChat", `<span class="brand">UniiChat</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${spans_html(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${spans_html(s.x)}</em>`;
    }
    case "Strk": {
      return `<del>${spans_html(s.x)}</del>`;
    }
    case "Link": {
      if (View.store_file(s.k)) {
        return chip_html(s.k, Md.spans_text(s.x));
      }
      return `<a href="${esc(s.k)}"${s.t === "" ? "" : ` title="${esc(s.t)}"`} target="_blank" rel="noopener">${spans_html(s.x)}</a>`;
    }
    case "Pict": {
      const [k, title, kind] = [esc(s.k), s.t === "" ? "" : ` title="${esc(s.t)}"`, View.media_kind(s.k)];
      return kind === "image" ? `<a class="media" href="${k}" target="_blank"><img src="${k}" alt="${esc(s.x)}"${title} loading="lazy"></a>`
        : kind === "video" ? `<video class="media" src="${k}"${title} controls preload="metadata"></video>`
        : kind === "audio" ? `<audio class="media" src="${k}"${title} controls preload="metadata"></audio>`
        : kind === "html" ? `<iframe class="media page" src="${k}" title="${esc(s.t || s.x)}" sandbox="allow-same-origin allow-popups" loading="lazy"></iframe>`
        : View.store_file(s.k) ? chip_html(s.k, s.x)
        : `<a href="${k}"${title} target="_blank" rel="noopener">${esc(s.x || s.k)}</a>`;
    }
    case "Brk": {
      return "<br>";
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}
