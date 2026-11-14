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

// an agent's picture: the logo, a premade head, or an upload
export function face_html(picture: string): string {
  if (picture === "logo") {
    return `<span class="pic logo"><i class="mark"></i></span>`;
  }
  const src = /^head-\d\d$/.test(picture) ? "/heads/" + picture + ".svg" : picture;
  return src === "" ? `<span class="pic"></span>` : `<img class="pic" src="${esc(src)}" alt="">`;
}

const TEAM = new Map<string, View.Mate>();

export function team_set(team: View.Mate[]): void {
  TEAM.clear();
  team.forEach((m) => TEAM.set(m.id, m));
}

// each agent, its subagents under it (#116): their face, name and the start
// of their task, their model and what they do now, and how long
export function list_html(team: View.Mate[], here: string | null, sub: string | null = null, now = Date.now()): string[] {
  return team.filter((m) => m.archived === 0).flatMap((m) => {
    const pill = m.unread > 0 ? `<span class="pill">${m.unread}</span>` : "";
    const on = m.id === here && sub === null ? ` aria-current="page"` : "";
    const subs = (m.subs ?? []).map((s) => {
      const to = "/a/" + esc(m.id) + "/s/" + esc(s.name);
      const mins = Math.round((now - s.at) / 60e3);
      const what = [s.model, s.effort, s.doing + (mins > 0 ? ", " + mins + " min" : "")].filter((x) => x !== "").join(" · ");
      const at = m.id === here && s.name === sub ? ` aria-current="page"` : "";
      return `<a class="mate kid" href="${to}" data-go="${to}"${at}><span class="face">${esc(s.face)}</span><span class="text"><span class="line"><b>${esc(s.name)}</b><small>${esc(s.task)}</small></span><small>${esc(what)}</small></span></a>`;
    });
    return [`<a class="mate" href="/a/${esc(m.id)}" data-go="/a/${esc(m.id)}"${on}>${face_html(m.picture)}<span class="text"><b>${esc(m.name)}</b><small>${esc(m.last)}</small></span>${pill}</a>`, ...subs];
  });
}

const MADE = new WeakMap<View.Row, { html: string; names: string }>();

// the names that link to their chat (#141): the team's, and the running
// subagents' of the chat shown, but not its own. Every name is matched, so
// one inside a longer one ("Ki" in "Ki Dev") stays part of it
const NAMES: { key: string; re: RegExp | null; to: Map<string, string> } = { key: "", re: null, to: new Map() };

const WORD_END = /[\p{L}\p{N}_]$/u;
const WORD_START = /^[\p{L}\p{N}_]/u;

export function names_set(team: View.Mate[], here: string, sub: string | null): boolean {
  const to = new Map<string, string>();
  for (const m of team.filter((m) => m.archived === 0)) {
    to.set(m.name, "/a/" + m.id);
  }
  const subs = team.find((m) => m.id === here)?.subs ?? [];
  for (const s of subs) {
    to.set(s.name, "/a/" + here + "/s/" + s.name);
  }
  const own = sub ?? team.find((m) => m.id === here)?.name ?? "";
  to.delete(own);
  const names = [...new Set([...team.map((m) => m.name), ...subs.map((s) => s.name), own])].filter((n) => n !== "").sort((a, b) => b.length - a.length);
  const key = JSON.stringify([[...to], names]);
  if (key === NAMES.key) {
    return false;
  }
  NAMES.key = key;
  NAMES.to = to;
  NAMES.re = names.length === 0 ? null : new RegExp("(?<![\\p{L}\\p{N}_])(" + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![\\p{L}\\p{N}_])", "u");
  return true;
}

export function row_html(row: View.Row): string {
  const made = MADE.get(row);
  if (made !== undefined && made.names === NAMES.key) {
    return made.html;
  }
  const html = row_make(row);
  MADE.set(row, { html, names: NAMES.key });
  return html;
}

function row_make(row: View.Row): string {
  switch (row.$) {
    case "Sum": {
      // a fold is one line; one message's line (a team copy) opens nothing
      const fold = row.n > 1;
      const open = fold ? act_html({ $: "Open", id: row.id, n: row.n }) : "";
      const lv = fold ? `<span class="lv">${row.msgs}x</span>` : "";
      return `<div class="block${fold ? "" : " one"}"${open} data-a="${row.id}">${lv}<div>${esc(row.text)}</div></div>`;
    }
    case "Box": {
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const rows = row.rows.map(row_html).join("");
      return `<div class="open" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const whole = row.call === null ? row.text : Call.call_text(row.call);
      const copy = copy_html(whole);
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL && !row.text.includes("](/media/");
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      const queued = (row.queued === true ? " queued" : "") + (row.writing === true ? " writing" : "");
      if (row.from !== undefined) {
        const mate = TEAM.get(row.from);
        const gist = Md.md_flat(Call.report_read(row.text)?.text ?? row.text);
        const head = `<summary>${face_html(mate?.picture ?? "")}<b>${esc(mate?.name ?? row.who)}</b><span>${esc(gist)}</span></summary>`;
        return `<div class="msg ${row.kind} said${queued}"${at}><details>${head}${copy}${body}${pics}</details></div>`;
      }
      return `<div class="msg ${row.kind}${queued}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      if (row.wait === true) {
        return `<p class="cap wait" role="status" aria-label="Working"><i></i><i></i><i></i></p>`;
      }
      return `<p class="cap${row.think === true ? " think" : ""}${row.earlier === true ? " earlier" : ""}">${esc(row.text)}</p>`;
    }
    case "Line": {
      return line_html(row);
    }
  }
}

// a tool call as one line: shell's command, write's or edit's path (cut
// on the left) with +N −M, else the tool and its main argument, and the
// device on the right; opened, the same row holds the whole input and
// then the whole result (#121)
function line_html(row: Extract<View.Row, { $: "Line" }>): string {
  const c = row.call;
  const at = row.id === null ? "" : ` data-a="${row.id}"`;
  const call = row.rows[0];
  const of = call.$ === "Msg" && call.of !== undefined ? ` data-of="${esc(call.of)}"` : "";
  const fail = row.echo?.startsWith("error") === true ? `<span class="bad" title="Failed">✕</span>` : "";
  const files = c.name === "write" || c.name === "edit";
  const lines = (row.echo ?? "").split("\n");
  const [adds, dels] = [lines.filter((l) => /^\+(?!\+\+)/.test(l)).length, lines.filter((l) => /^-(?!--)/.test(l)).length];
  const diff = files && row.echo !== null && fail === "" ? ` <b class="add">+${adds}</b> <b class="del">−${dels}</b>` : "";
  const what = files ? `<span class="arg path"><bdi>${esc(c.head)}</bdi></span>` : `<span class="arg">${esc(c.head.split("\n")[0])}</span>`;
  const name = c.name === "" ? "" : `<b>${esc(c.name)}</b>`;
  const where = c.device === "" ? "" : `<span class="on">· ${esc(c.device)}</span>`;
  const head = `<summary><span class="ic">${Theme.tool_glyph(c.name)}</span>${name}${what}${diff}${fail}${where}</summary>`;
  const phase = row.phase === undefined ? "" : " " + row.phase;
  return `<details class="msg tool line${phase}"${at}${of}>${head}<div class="full">${row.rows.map(line_part).join("")}</div></details>`;
}

// an opened line's part: the call's whole input, or the result as it is
function line_part(row: View.Row): string {
  if (row.$ !== "Msg") {
    return row_html(row);
  }
  const input = row.call === null ? "" : `<p class="call">${esc(row.call.head)}</p>` + row.call.blocks.map(block_html).join("");
  const out = row.call === null ? row.body.map(block_html).join("") : "";
  return input + out + images_html(row.images);
}

function call_html(c: Call.Call): string {
  const where = c.device === "" ? "" : `<span class="on">· ${esc(c.device)}</span>`;
  const verb  = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  return `<p class="call">${where}<span class="ic">${Theme.tool_glyph(c.name)}</span>${verb}${esc(c.head)}</p>` + c.blocks.map(block_html).join("");
}

function images_html(names: string[]): string {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}

const MODES: Array<[string, string]> = [
  ["standard", "Each message is summarized for the agent's memory. Cheapest, good for long working sessions."],
  ["conversation", "Messages stay word-for-word in the agent's view until you switch back. Use it for discussions. It costs more per turn."],
];

// modes: the standard/conversation button; talk: the context meter
export function pick_html(knobs: View.Knob[], talk: View.Talk | null, modes: boolean): string[] {
  const knob = (move: string, hint: string, text: string, rows: string) => [
    `<button title="${esc(hint)}" data-knob="${move}" popovertarget="pick-${move}" aria-haspopup="menu">${esc(text)}</button>`,
    `<div id="pick-${move}" class="choices" popover role="menu" aria-label="${move[0].toUpperCase() + move.slice(1)}">${rows}</div>`,
  ];
  const parts = knobs.map((k) => k.choices.length === 0 ? [`<span class="knob" title="${esc(k.hint)}">${esc(k.text)}</span>`] : knob(k.move, k.hint, k.text, k.choices.map(choice_html).join("")));
  const mode = ([name, hint]: [string, string], k: number) => {
    const here = (talk !== null) === (k === 1);
    return `<button role="menuitemradio" aria-checked="${here}" title="${esc(hint)}"${here ? " autofocus" : act_html({ $: "Talk", on: k === 1 })}>${name}</button>`;
  };
  const [now, about] = MODES[talk === null ? 0 : 1];
  const mode_knob = modes ? knob("mode", about, now, MODES.map(mode).join("")) : [];
  const used = talk === null ? 0 : View.talk_percent(talk);
  const heat = used >= 80 ? " hot" : used >= 50 ? " warm" : "";
  const rule = talk === null ? `<span class="rule"></span>` : `<span class="rule meter${heat}" style="--used:${used}%" title="Context: ${used}% used (${esc(View.talk_tokens(talk))})" role="meter" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100" aria-label="Context used"></span>`;
  const dot = `<span class="dot">·</span>`;
  const join = (groups: string[][]) => groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? g : [dot, ...g]));
  return [...join([mode_knob]), rule, ...join(parts)];
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
    return `<div class="item"><p>${esc(p.name)}</p>${button}</div>`;
  };
  const none = `<p class="sub">None set up. Add them as <code>mcp</code> in a device's own config.json: they run on that device.</p>`;
  return plugs.length === 0 ? [none] : plugs.map(one);
}

export function timers_html(timers: Timer.Timer[]): string[] {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(Timer.timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}

// an agent as its settings page reads and saves it
export type Agent = { id: string; name: string; about: string; picture: string; prompt: string; own: boolean; template: string; archived: number; leader: boolean; lines: number };

// what Leader mode adds to each request: about 400 B a line (#168)
export function leader_cost(lines: number, agents: number): string {
  if (agents === 0) {
    return "Adds nothing now: there are no other agents.";
  }
  const kb = (lines * agents * 400) / 1000;
  const size = kb < 10 ? String(Math.round(kb * 10) / 10) : String(Math.round(kb));
  return "Adds about " + size + " KB to every request (" + lines + (lines === 1 ? " line" : " lines") + " × " + agents + (agents === 1 ? " agent" : " agents") + ").";
}

export function agent_html(a: Agent | null, others: number): string {
  const heads = Array.from({ length: 24 }, (_, k) => "head-" + String(k + 1).padStart(2, "0"));
  const [leader, lines] = [a?.leader ?? false, a?.lines ?? View.LINES];
  const own = a !== null && a.picture.startsWith("/media/") ? [a.picture] : [];
  const faces = ["logo"].concat(own, heads).map((f) => face_pick_html(f, f === a?.picture));
  const upload = `<button type="button" class="chip upload">Upload a picture</button><input type="file" class="upfile" accept="image/png,image/jpeg,image/webp,image/gif" hidden>`;
  const set = (key: string, name: string, about: string, control: string) => `<div class="set" data-key="${key}"><label for="ag-${key}">${esc(name)}${about === "" ? "" : `<small>${esc(about)}</small>`}</label><div class="field">${control}</div><p class="err"></p></div>`;
  const archive = a === null ? "" : section_html("Archive", `<div class="item"><p>Archive ${esc(a.name)}<small>Settings can restore it.</small></p><button type="button" class="chip red archive">Archive</button></div>`);
  // an agent saves as it's edited (#125); a new one is made with Create
  const create = a === null ? `<div class="save"><p class="why"></p><button class="chip go">Create</button></div>` : "";
  return `<form class="settings agent" autocomplete="off">`
    + section_html("Picture", `<div class="faces">${faces.join("")}</div><p class="up">${upload}<span class="why"></span></p>`)
    + section_html("Agent",
      set("name", "Name", "", `<input id="ag-name" name="name" maxlength="24" value="${esc(a?.name ?? "")}" spellcheck="false">`)
      + set("about", "Description", "For the chat list and the other agents.", `<input id="ag-about" name="about" maxlength="120" value="${esc(a?.about ?? "")}">`)
      + set("prompt", "System prompt", "Who it is and what it does.", `<textarea id="ag-prompt" name="prompt" rows="6" spellcheck="true">${esc(a?.prompt ?? "")}</textarea>`)
      + set("leader", "Leader mode", "Each turn, the newest lines of every other agent's memory, to zoom into.", `<label class="opt"><input type="checkbox" id="ag-leader" name="leader"${leader ? " checked" : ""}> On</label>`)
      + `<div class="set lines" data-key="lines"${leader ? "" : " hidden"}><label for="ag-lines">Lines per agent<small class="cost">${esc(leader_cost(lines, others))}</small></label><div class="field"><input id="ag-lines" name="lines" type="number" min="1" max="${View.LINES_MOST}" step="1" value="${lines}"></div><p class="err"></p></div>`)
    + create + `</form>` + archive;
}

export function face_pick_html(picture: string, on: boolean): string {
  return `<label class="face"><input type="radio" name="picture" value="${esc(picture)}"${on ? " checked" : ""}>${face_html(picture)}</label>`;
}

export function archived_html(team: View.Mate[]): string {
  const gone = team.filter((m) => m.archived !== 0);
  const one = (m: View.Mate) => `<div class="item" data-id="${esc(m.id)}">${face_html(m.picture)}<p>${esc(m.name)}<small>${esc(m.about)}</small></p><button class="chip restore">Restore</button><button class="chip red delete">Delete</button></div>`;
  return gone.length === 0 ? "" : section_html("Archived agents", gone.map(one).join(""));
}

export function account_html(notify: Notify | null = null): string {
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const acts    = [
    item("This browser", "Signed in to this server.", `<button class="chip out">Sign out</button>`),
    ...(notify === null ? [] : [notify_html(notify)]),
    item("Export memory", `The chat of <span class="who"></span> and its summaries, in one file.`, `<a class="chip export" href="/export">Download</a>`),
  ];
  const mcp     = section_html("MCP servers", `<div class="mcp"></div>`);
  const history = section_html("History", item("Import history", `Past Claude and ChatGPT chats, into the memory of <span class="who"></span>.`, `<button class="chip imp">Import</button>`));
  return section_html("This browser", acts.join("")) + history + `<div class="archived"></div>` + mcp + `<div class="owned"></div>`;
}

function notify_html(notify: Notify): string {
  const note = {
    off     : "Replies on this device, when Ki isn't open.",
    on      : "Replies on this device, when Ki isn't open.",
    blocked : "Blocked in this browser's settings for this site.",
    home    : "On iPhone and iPad: Share, then Add to Home Screen, and open it from there.",
  }[notify];
  const button = notify === "home" ? "" : `<button class="chip notify"${notify === "blocked" ? " disabled" : ""}>${notify === "on" ? "Turn off" : "Turn on"}</button>`;
  return `<div class="item"><p>Notifications<small>${note}</small></p>${button}</div>`;
}

const SETTING: Record<string, [string, string]> = {
  vendors   : ["Models", ""],
  pick      : ["Default model", "For chats that haven't picked one."],
  compactor : ["Compactor model", "Writes the memory's summaries."],
  thinking  : ["Show thinking", ""],
  hops      : ["Hop limit", "Agent-to-agent messages in a row; 0: off."],
  compactor_context : ["Compactor context", "KB of chat each summary sees (1–128)."],
  site      : ["Site", "For sign-in links."],
};

const KEY: Record<string, [string, string]> = {
  anthropic : ["Anthropic key", "For claude-api."],
  openai    : ["OpenAI key", "For openai-api and dictation."],
};

export const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

export const PICKS = ["pick", "compactor"];

const GROUPS: Array<[string, string[]]> = [
  ["Chat", ["thinking"]],
  ["Agents", ["hops"]],
  ["Models", ["vendors", "pick", "compactor", "compactor_context"]],
  ["Server", ["site"]],
];

// the server's settings, each saved as it's changed (#125)
export function settings_html(page: Page): string {
  const rows = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, keys]: [string, string[]]) => {
    const shown = keys.flatMap((k) => rows.get(k) ?? []);
    return shown.length === 0 ? "" : section_html(title, shown.map((r) => setting_html(r, rows.get("models") ?? null)).join(""));
  };
  const shown = page.keys.filter((k) => k.from !== "env");
  const keys = shown.length === 0 ? "" : section_html("Keys", shown.map(key_html).join(""));
  const error = page.error === null ? "" : `<p class="why bad">${esc(page.error)}</p>`;
  const none = page.none === null ? "" : `<p class="why bad">${esc(page.none).replace(/`([^`]+)`/g, "<code>$1</code>")}.</p>`;
  const profiles = page.profiles === null ? "" : section_html("Profiles", `<p class="sub">Falls back to the next model when one is out.</p><div class="set profiles" data-key="profiles"><div class="field"></div><p class="err"></p></div>`);
  return error + none + `<form class="settings" autocomplete="off">` + group(GROUPS[0]) + group(GROUPS[1]) + group(GROUPS[2]) + profiles + keys + group(GROUPS[3]) + `</form>`;
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

// vendors and models are one table, keyed as both
function setting_html(r: Row, models: Row | null): string {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const both = r.key === "vendors" && models !== null;
  const key = both ? "vendors models" : r.key;
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const label = both ? `<p class="label">${esc(name)}</p>` : `<label for="${id}">${esc(name)}${about === "" ? "" : `<small>${esc(about)}</small>`}</label>`;
  const control = both ? models_html(list(r.value), list(models.value)) + `<p class="warn"></p>` : control_html(r);
  const from = both && models.from === "file" ? { ...r, from: models.from } : r;
  return `<div class="set" data-key="${esc(key)}">${label}<div class="field">${control}</div>${from_html(from)}<p class="err"></p></div>`;
}

// one column per family of models, its vendors' boxes in the head and
// its models under it, large to small (#123); a model none of whose
// vendors is on is grey, and keeps its own box
function models_html(vendors: string[], models: string[]): string {
  const fams: Array<{ vendors: Vendor[]; labels: string[] }> = [];
  for (const v of VENDORS) {
    const labels = Pick.models([v], LABELS).map(([, m]) => m.label);
    const fam = fams.find((f) => f.labels.some((l) => labels.includes(l)));
    if (fam === undefined) {
      fams.push({ vendors: [v], labels });
    } else {
      fam.vendors.push(v);
      fam.labels.push(...labels.filter((l) => !fam.labels.includes(l)));
    }
  }
  const box = (name: string, x: string, on: boolean, of: string) => `<label class="opt"${of === "" ? "" : ` data-vendor="${esc(of)}"`}><input type="checkbox" name="${name}" value="${esc(x)}"${on ? " checked" : ""}> ${esc(x)}</label>`;
  const model = (l: string | undefined) => (l === undefined ? "<td></td>" : `<td>${box("models", l, models.includes(l), Pick.models(VENDORS, [l]).map(([v]) => v).join(" "))}</td>`);
  const head = `<tr>${fams.map((f) => `<th>${f.vendors.map((v) => box("vendors", v, vendors.includes(v), "")).join("")}</th>`).join("")}</tr>`;
  const n = Math.max(...fams.map((f) => f.labels.length));
  const body = Array.from({ length: n }, (_, k) => `<tr>${fams.map((f) => model(f.labels[k])).join("")}</tr>`).join("");
  const odd = models.filter((x) => !LABELS.includes(x));
  return `<table class="models"><thead>${head}</thead><tbody>${body}</tbody></table>` + (odd.length === 0 ? "" : `<div class="opts">${odd.map((x) => box("models", x, true, "")).join("")}</div>`);
}

function control_html(r: Row): string {
  switch (r.key) {
    case "pick":
    case "compactor": {
      return `<input type="hidden" name="${r.key}" value="${esc(r.value)}"><div class="four"></div>`;
    }
    case "thinking": {
      return `<label class="opt"><input id="set-${r.key}" type="checkbox" name="${r.key}" value="on"${r.value === "on" ? " checked" : ""}> On</label>`;
    }
    case "hops": {
      return `<input id="set-${r.key}" name="${r.key}" type="number" min="0" max="100" step="1" inputmode="numeric" value="${esc(r.value)}" placeholder="${esc(r.def)}">`;
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

// a Reset when it isn't the default; a restart's need, once changed
function from_html(r: Row): string {
  const running = r.running === null ? "" : "Restart the server to use it. ";
  const reset = r.from === "file" ? `<button type="button" class="reset">Reset</button>` : "";
  return running === "" && reset === "" ? "" : `<p class="from">${running}${reset}</p>`;
}

function key_html(k: Key): string {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "file" ? `Set${tail}` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)}</small></label>`;
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

// linked: whether names may become links, not in a link already; glued:
// whether a letter is shown right before and after the spans, so a name
// in "x**Coder**" or "**Coder**s" is no whole word
function spans_html(spans: Md.Span[], linked = true, glued: [boolean, boolean] = [false, false]): string {
  const texts = spans.map((s) => Md.spans_text([s]));
  const before = [glued[0]];
  texts.forEach((t, i) => before.push(t === "" ? before[i] : WORD_END.test(t)));
  const after = [glued[1]];
  [...texts].reverse().forEach((t, i) => after.push(t === "" ? after[i] : WORD_START.test(t)));
  return spans.map((s, i) => span_html(s, linked, [before[i], after[spans.length - 1 - i]])).join("");
}

function text_html(x: string, linked: boolean, glued: [boolean, boolean]): string {
  const parts = linked && NAMES.re !== null ? x.split(NAMES.re) : [x];
  const last = parts.length - 2;
  return parts.map((p, k) => {
    const cut = (k === 1 && parts[0] === "" && glued[0]) || (k === last && parts[k + 1] === "" && glued[1]);
    const to = k % 2 === 1 && !cut ? NAMES.to.get(p) : undefined;
    return to === undefined ? esc(p).replace(/\bKi\b/g, `<span class="brand">Ki</span>`) : `<a class="name" href="${esc(to)}" data-go="${esc(to)}">${esc(p)}</a>`;
  }).join("");
}

function span_html(s: Md.Span, linked: boolean, glued: [boolean, boolean]): string {
  switch (s.$) {
    case "Text": {
      return text_html(s.x, linked, glued);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${spans_html(s.x, linked, glued)}</strong>`;
    }
    case "Ital": {
      return `<em>${spans_html(s.x, linked, glued)}</em>`;
    }
    case "Strk": {
      return `<del>${spans_html(s.x, linked, glued)}</del>`;
    }
    case "Link": {
      if (View.store_file(s.k)) {
        return chip_html(s.k, Md.spans_text(s.x));
      }
      return `<a href="${esc(s.k)}"${s.t === "" ? "" : ` title="${esc(s.t)}"`} target="_blank" rel="noopener">${spans_html(s.x, false)}</a>`;
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
  }
}
