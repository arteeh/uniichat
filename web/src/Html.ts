// Html
// ====
// What View.ts draws and Md.ts's tokens, as HTML, every text escaped, one
// element per row, knob or tab; and the account and settings pages'
// parts. A click's
// effect is in the markup: `data-act`, the View.Act it makes;
// `data-copy`, what Copy copies; `data-usd`, the credit it buys
// (main.ts), so `credit_html` works wherever it is put.

import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import { EFFORTS, LABELS, Pick, VENDORS } from "../../Pick.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import * as Theme from "../../Theme.ts";
import * as View from "../../View.ts";

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

// the line over the message box: fold/unfold (none on an agent's page),
// a rule, then the pick's knobs
export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[]): string[] {
  const parts = knobs.map((k) => `<button title="${esc(k.hint)}"${act_html({ $: "Move", move: k.move })}>${esc(k.text)}</button>`);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => (i === 0 ? [part] : [`<span class="dot">·</span>`, part]))];
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}

// Account
// =======

// buying credit: a button per amount, then the fine print (in the iOS
// app, the App Store's)
export function credit_html(app: boolean): string {
  const buttons = [10, 25, 50, 100].map((usd) => `<button data-usd="${usd}">$${usd}</button>`).join("");
  return `<div class="credit"><div class="usd">${buttons}</div>${fine_html(app)}</div>`;
}

// what buying credit costs and means, in one line (the terms say the rest)
export function fine_html(app: boolean): string {
  const fee = app ? "Paid at the App Store's price." : "+10% platform fee (min $0.80).";
  return `<p class="fine">${fee} Buying accepts the <a href="/terms.html" target="_blank">terms</a>.</p>`;
}

// the account page (/account): where the server bills, the balance and
// credit to add, the use by day and the purchases; then the account's
// own acts; deleting asks first, in place (main.ts)
export function account_html(a: View.Account, app: boolean, owner: boolean): string {
  const tops    = a.topups ?? [];
  const days    = View.account_days(a);
  const balance = a.credits === null ? "" : section_html("Balance", `<p class="big">${View.usd_show(a.credits)}</p>` + credit_html(app));
  const usage   = section_html("Usage", days.length === 0 ? `<p class="sub">Nothing yet.</p>` : table_html("days", ["Day", "Use", "Cost"], days.map((d) => [d.date, d.what, View.cost_show(d.usd)])));
  const buys    = tops.length === 0 ? "" : section_html("Purchases", table_html("buys", View.TOPUP, tops.map(View.topup_cells)));
  const money   = a.bills ? balance + usage + buys : "";
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const closes  = a.bills ? `<p>This also closes your BendAI account (same sign-in). Credit you bought and didn't use goes back to your card.</p>` : "";
  const kill    = `<form class="kill" hidden>${closes}<p>Type <b>${esc(a.name)}</b> to confirm.</p><input name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(a.name)}"><p class="why"></p><div><button type="button" class="chip keep">Cancel</button><button class="chip red" disabled>Delete for good</button></div></form>`;
  const acts    = [
    item(esc(a.name), "", `<button class="chip out">Sign out</button>`),
    ...(owner ? [item("Server settings", "Models, keys and more of this server.", `<a class="chip" href="/settings" data-go="/settings">Open</a>`)] : []),
    item("Export memory", "Chat and account, in one file.", `<a class="chip" href="/export">Download</a>`),
    item("Delete account", "Erases chat and memory for good.", `<button class="chip red del">Delete</button>`),
  ];
  const account = section_html("Sign-in and data", acts.join("") + kill);
  const links   = a.bills ? `<p class="foot"><a href="/pricing" target="_blank">Prices</a> · <a href="/terms.html" target="_blank">Terms</a> · <a href="/privacy.html" target="_blank">Privacy</a> · <a href="mailto:contact@higherorderco.com">Help</a></p>` : "";
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Account</h1>` + money + account + links;
}

// Settings
// ========
// The settings page (/settings, the server's owner's: Settings.ts): a
// row a setting or a key, each its control (named by its key; a key's
// "key.<name>"), where its value comes from and when a change applies,
// a button back to the default (a key: out) if config.json sets it,
// and a place for why a save was refused; one the page may not change
// (set by the environment, or a server path or command) shows its value
// only. main.ts reads the form and fills the picks' lists (picks_html).

// what each setting is, as the page says it: its name, a line about it
const SETTING: Record<string, [string, string]> = {
  vendors   : ["Vendors", "Whose models the server offers."],
  models    : ["Models", "The models offered, of those vendors."],
  pick      : ["Default model", "What a chat runs on until it picks another."],
  compactor : ["Compactor", "What writes the memory's summaries."],
  agents    : ["Subagents", "What subagents run on."],
  owner     : ["Owner", "Who may open this page: sign-in emails, comma-separated, named in config.json on the server only."],
  site      : ["Site", "The server's address, for sign-in links."],
  apple     : ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns      : ["APNs key ID", "The ID of the key the app's pushes are signed with."],
  workers   : ["Workers", "How many processes serve the users."],
  work      : ["Work folder", "Where the agents work on each device."],
  rules     : ["Rules", "A file added to every system prompt."],
  after     : ["After each turn", "A shell command the server runs."],
};

const KEY: Record<string, [string, string]> = {
  anthropic : ["Anthropic", "For claude-api's models."],
  openai    : ["OpenAI", "For openai-api's models and dictation."],
  resend    : ["Resend", "Emails sign-in links (none: the server prints them)."],
  apns      : ["APNs key", "The .p8 key the iOS app's pushes are signed with."],
};

// each vendor's key
export const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

const GROUPS: Array<[string, string[]]> = [
  ["Models", ["vendors", "models", "pick", "compactor", "agents"]],
  ["Server", ["owner", "site", "apple", "apns", "workers", "work", "rules", "after"]],
];

export function settings_html(page: Page): string {
  const rows = new Map(page.settings.map((r) => [r.key, r]));
  const groups = GROUPS.map(([title, keys]) => section_html(title, keys.map((k) => rows.get(k)).filter((r) => r !== undefined).map(setting_html).join("")));
  const keys = section_html("Keys", `<p class="sub">A key set here is kept in keys.json in the server's folder, readable by the server's user only. It is never shown again, only its last characters.</p>` + page.keys.map(key_html).join(""));
  const error = page.error === null ? "" : `<p class="why bad">${esc(page.error)}</p>`;
  const save = `<div class="save"><p class="why"></p><button class="chip go"${page.error === null ? "" : " disabled"}>Save</button></div>`;
  const head = `<a class="back" href="/account" data-go="/account">← Account</a><h1>Settings</h1><p class="sub">This server's settings, in config.json in its folder. Only its owner sees this page.</p>`;
  return head + error + `<form class="settings" autocomplete="off">` + groups.slice(0, 1).join("") + keys + groups.slice(1).join("") + save + `</form>`;
}

function setting_html(r: Row): string {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key;
  const off = r.from === "env" || !r.web;
  const control = off ? `<code class="value">${esc(r.value === "" ? "(none)" : r.value)}</code>` : control_html(r, id);
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(r.key)}</code></small></label>`;
  return `<div class="set" data-key="${esc(r.key)}">${label}<div class="field">${control}</div>${from_html(r)}<p class="err"></p></div>`;
}

function control_html(r: Row, id: string): string {
  switch (r.key) {
    case "vendors": {
      return checks_html("vendors", VENDORS, list(r.value)) + `<p class="warn"></p>`;
    }
    case "models": {
      return checks_html("models", LABELS, list(r.value));
    }
    case "pick":
    case "compactor":
    case "agents": {
      return `<select id="${id}" name="${r.key}" data-value="${esc(r.value)}"></select>`;
    }
  }
  return `<input id="${id}" name="${r.key}" value="${esc(r.value)}" placeholder="${esc(r.def)}" spellcheck="false" autocapitalize="off">`;
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

function checks_html(name: string, all: string[], on: string[]): string {
  const box = (x: string) => `<label class="opt"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}

// where a value comes from, when a change applies, and the button back
// to the default
function from_html(r: Row): string {
  const from = r.from === "env" ? `Set by <code>${esc(r.env)}</code> on the server` : r.from === "file" ? "From config.json" : "Default";
  const apply = r.from === "env" ? "changed there only" : !r.web ? "changed in config.json on the server only" : r.apply === "now" ? "applies at once" : "applies on a restart";
  const running = r.running === null ? "" : ` · running on <code>${esc(r.running === "" ? "(none)" : r.running)}</code> till then`;
  const reset = r.from === "file" && r.web ? ` <button type="button" class="reset">Use the default</button>` : "";
  return `<p class="from">${from} · ${apply}${running}${reset}</p>`;
}

function key_html(k: Key): string {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = k.name === "apns" ? `<textarea id="${id}" name="key.${k.name}" rows="3" placeholder="Paste a new key to set it" spellcheck="false"></textarea>` : `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "env" ? `Set by <code>${esc(k.env)}</code> on the server${tail}` : k.from === "file" ? `Set${tail}, in keys.json` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const control = k.from === "env" ? "" : `<div class="field">${field}</div>`;
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(k.env)}</code></small></label>`;
  return `<div class="set key" data-key="key.${esc(k.name)}">${label}${control}<p class="from">${from}${reset}</p><p class="err"></p></div>`;
}

// a pick list's options: each pick the vendors and models checked offer,
// by model; first `none` (agents: the chat's pick), and the value set if
// none is it, said
export function picks_html(vendors: string[], models: string[], value: string, none: string | null): string {
  const groups = Pick.models(vendors.filter((v) => (VENDORS as string[]).includes(v)) as typeof VENDORS, models).map(([vendor, model]) => {
    const opts = EFFORTS.flatMap((effort) => model.speeds.map((speed) => [vendor, model.label, effort, speed].join(":")));
    const items = opts.map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o.split(":").slice(1).join(" · "))}</option>`);
    return { opts, html: `<optgroup label="${esc(vendor + " · " + model.label)}">${items.join("")}</optgroup>` };
  });
  const all = groups.flatMap((g) => g.opts);
  const first = none === null ? "" : `<option value=""${value === "" ? " selected" : ""}>${esc(none)}</option>`;
  const odd = value === "" || all.includes(value) ? "" : `<option value="${esc(value)}" selected>${esc(value)} (not offered)</option>`;
  return odd + first + groups.map((g) => g.html).join("");
}

// a section of the account page: its title, then its markup
function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

// a table (cls: its class) of inline markdown cells
function table_html(cls: string, head: string[], rows: string[][]): string {
  const cells = (row: string[], tag: string) => row.map((x) => `<${tag}>${spans_html(Md.span_parse(x))}</${tag}>`).join("");
  const body  = rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("");
  return `<div class="wide ${cls}"><table><tr>${cells(head, "th")}</tr>${body}</table></div>`;
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
      const items = b.x.map((item) => `<li>${spans_html(item)}</li>`);
      return `<${tag}>${items.join("")}</${tag}>`;
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
