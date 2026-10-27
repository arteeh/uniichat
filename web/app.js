// Err.ts
function err_why(err) {
  return err instanceof Error ? err.message : String(err);
}

// Clip.ts
var CAP = 30000;
function clip_end(str, at) {
  if (str.length - at <= CAP) {
    return str.length;
  }
  const nl = str.lastIndexOf(`
`, at + CAP - 1);
  const low = str.charCodeAt(at + CAP) >> 10 === 55;
  return nl >= at ? nl + 1 : at + CAP - (low ? 1 : 0);
}
function clip_pages(str) {
  const pages = [];
  let at = 0;
  do {
    const end = clip_end(str, at);
    pages.push(str.slice(at, end));
    at = end;
  } while (at < str.length);
  return pages;
}
async function* stream_lines(stream) {
  const reader = stream.getReader();
  const utf8 = new TextDecoder;
  let rest = "";
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    const text = utf8.decode(got.value, { stream: true });
    const nl = text.lastIndexOf(`
`);
    if (nl >= 0) {
      yield (rest + text.slice(0, nl)).split(`
`);
      rest = "";
    }
    rest += text.slice(nl + 1);
  }
  yield [rest + utf8.decode()];
}

// Json.ts
function has(x, k) {
  return typeof x === "object" && x !== null && k in x;
}
function get(x, k) {
  return has(x, k) ? x[k] : undefined;
}
function text_of(x, or = "") {
  const shown = String(x);
  return x === undefined || x === null ? or : shown;
}
function rec(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function list(x) {
  return Array.isArray(x) ? x : [];
}

// Import.ts
var PIECE_KEPT_AS_BLOB = 2 ** 20;
var OLD = "Nothing new: these chats are in Unii's memory already.";
var NOT_EXPORT = "Not a Claude or ChatGPT export.";
var MIDWAY = "Meanwhile, UniiChat can answer with a partial tree.";
var DONE = "Your past chats are in Unii's memory: ask about them any time.";
var DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
var COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });
var EXPORTS = { Claude: "Settings › Privacy › Export data", ChatGPT: "Settings › Data controls › Export data" };
var INJECTED = /^(<[a-z_]+[ >]|# AGENTS\.md)/;
var SKIP = /^(<command-|<local-command|\[Request interrupted)/;
function import_file(path) {
  const session = /(^|\/)(projects|sessions|archived_sessions)\//.test(path);
  return session && path.endsWith(".jsonl") && !path.includes("subagents/");
}
async function import_session(file, form, app = "", where = "") {
  const s = { app, form, where, start: "", file, heads: [] };
  for await (const m of import_read(s)) {
    s.heads.push({ kind: m.kind, date: m.date, size: import_size(m), n: s.heads.length });
  }
  s.start = s.heads[0]?.date ?? "";
  return s.heads.length > 0 ? s : null;
}
async function* import_read(s) {
  let date = "";
  for await (const lines of stream_lines(s.file.stream())) {
    for (const line of lines) {
      const msgs = line_msgs(s, line, date);
      date = msgs.at(-1)?.date ?? date;
      yield* msgs;
    }
  }
}
function line_log(s, j, last) {
  s.app ||= j.type === "session_meta" ? "ChatGPT" : "Claude";
  return s.app === "ChatGPT" ? line_codex(s, j, last) : line_claude(s, j, last);
}
function line_msgs(s, line, last) {
  try {
    const j = JSON.parse(line);
    return s.form === "msgs" ? [j] : line_log(s, j, last);
  } catch {
    return [];
  }
}
function import_pick(sessions, want, done) {
  const old = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  const keep = (m, last) => (want.tools || m.kind === "user" || m.kind === "unii") && m.date >= want.since && import_new(m, last);
  const kept = (s, last) => s.heads.filter((m) => keep(m, last));
  return old.map((s) => ({ ...s, heads: kept(s, done[import_id(s)]) })).filter((s) => s.heads.length > 0);
}
function import_plan(sessions, want, done) {
  const all = import_pick(sessions, { ...want, since: "" }, done);
  const shown = import_pick(all, want, {});
  const picked = shown.filter((s) => !want.off.includes(import_id(s)));
  const first = all.map((s) => s.heads[0].date).sort()[0] ?? "";
  const sizes = picked.flatMap((s) => [import_size(import_note(s)), ...s.heads.map((m) => m.size)]);
  return { sessions: shown, picked, msgs: sizes.length - picked.length, first: first.slice(0, 10), sizes };
}
function import_new(m, last) {
  return last === undefined || (m.date ?? "") > last;
}
function import_name(s) {
  return s.app + " " + s.where + ", from " + new Date(s.start).toLocaleString("sv-SE").slice(0, 16);
}
function import_cells(s) {
  const day = DAY.format(new Date(s.start));
  const where = s.where.startsWith("session in ") ? path_short(s.where.slice(11)) : s.where.replace(/^chat "(.*)"$/, "$1") || "untitled";
  return [day, count_short(s.heads.length), where];
}
function count_short(n) {
  return COUNT.format(n).toLowerCase();
}
function path_short(path) {
  const parts = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").split("/");
  const head = parts[0] === "" ? 2 : 1;
  return parts.length - head > 3 ? [...parts.slice(0, head + 1), "…", ...parts.slice(-2)].join("/") : parts.join("/");
}
function import_note(s) {
  return { kind: "note", text: import_name(s) + " (imported)", date: s.start };
}
function import_id(s) {
  return import_key(import_note(s));
}
function import_key(note) {
  return note.date + " " + without_local_time(without_app(note.text));
}
function without_app(name) {
  return name.replace(/^.*?(?= session in | chat ")/, "");
}
function without_local_time(name) {
  return name.replace(/, from [^,]*$/, "");
}
async function* import_body(picked) {
  let part = "";
  for (const s of picked) {
    const kept = new Set(s.heads.map((m) => m.n));
    let n = 0;
    part += JSON.stringify(import_note(s)) + `
`;
    for await (const m of import_read(s)) {
      part += kept.has(n++) ? JSON.stringify(m) + `
` : "";
      if (part.length >= PIECE_KEPT_AS_BLOB) {
        yield part;
        part = "";
      }
    }
  }
  yield part;
}
function import_size(m) {
  return new TextEncoder().encode(m.kind + ": " + m.text).length;
}
function import_count(n, what) {
  return n.toLocaleString("en-US") + " " + what + (n === 1 ? "message" : "messages");
}
async function import_export(file) {
  const zip = await file.slice(0, 2).text() === "PK";
  const json = zip ? await zip_file(file, "conversations.json") : file;
  if (json === null) {
    throw new Error("No conversations.json in the zip.");
  }
  const chats = await json.text().then((text) => JSON.parse(text)).catch(() => null);
  if (!Array.isArray(chats) || !chats.every((chat) => get(chat, "mapping") !== undefined || Array.isArray(get(chat, "chat_messages")))) {
    throw new Error(NOT_EXPORT);
  }
  const sessions = await Promise.all(list(chats).map((chat) => chat_session(chat)));
  return sessions.filter((s) => s !== null);
}
function chat_session(chat) {
  const [app, msgs] = chat.mapping ? ["ChatGPT", chat_openai(chat, chat.mapping)] : ["Claude", chat_claude(chat)];
  const file = new Blob(msgs.map((m) => JSON.stringify(m) + `
`));
  return import_session(file, "msgs", app, 'chat "' + (chat.title ?? chat.name ?? "") + '"');
}
function chat_openai(chat, mapping) {
  const nodes = [];
  for (let id = chat.current_node;id; id = mapping[id]?.parent) {
    nodes.unshift(mapping[id]?.message);
  }
  let date = import_date(chat.create_time, "");
  return nodes.flatMap((m) => {
    if (m === null || m === undefined) {
      return [];
    }
    const role = m.author?.role;
    const type = String(m.content?.content_type);
    const kind = role === "user" ? "user" : role === "assistant" ? m.recipient === "all" ? "unii" : "tool" : role === "tool" ? "echo" : null;
    const skip = kind === null || m.metadata?.is_visually_hidden_from_conversation === true || type === "thoughts" || type === "reasoning_recap";
    date = import_date(m.create_time, date);
    return skip ? [] : msgs_of(kind, (kind === "tool" ? String(m.recipient) + " " : "") + parts_text(m.content?.parts ?? [m.content?.text]), date);
  });
}
function chat_claude(chat) {
  let date = import_date(chat.created_at, "");
  return (chat.chat_messages ?? []).flatMap((m) => {
    date = import_date(m.created_at, date);
    const kind = m.sender === "human" ? "user" : "unii";
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: text_of(m.text) }];
    const files = [...m.attachments ?? [], ...m.files ?? []].map((f) => ({ type: "text", text: "[file " + String(f.file_name) + "]" }));
    return blocks_msgs(kind, [...blocks, ...files], date);
  });
}
async function zip_file(zip, name) {
  const view = async (at, n) => new DataView(await zip.slice(at, at + n).arrayBuffer());
  const back = Math.min(zip.size, 65577);
  const tail = await view(zip.size - back, back);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 101010256) {
    end -= 1;
  }
  if (end < 0) {
    return null;
  }
  const wide = end >= 20 && tail.getUint32(end - 20, true) === 117853008;
  const z64 = wide ? await view(Number(tail.getBigUint64(end - 12, true)), 56) : null;
  const count = z64 === null ? tail.getUint16(end + 10, true) : Number(z64.getBigUint64(32, true));
  const size = z64 === null ? tail.getUint32(end + 12, true) : Number(z64.getBigUint64(40, true));
  const from = z64 === null ? tail.getUint32(end + 16, true) : Number(z64.getBigUint64(48, true));
  const dir = await view(from, size);
  for (let p = 0, k = 0;k < count; k++) {
    const entry = new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, dir.getUint16(p + 28, true)));
    const [, packed, at] = zip_sizes(dir, p);
    if (entry === name || entry.endsWith("/" + name)) {
      const head = await view(at, 30);
      const data = zip.slice(at + 30 + head.getUint16(26, true) + head.getUint16(28, true)).slice(0, packed);
      return dir.getUint16(p + 10, true) === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : data;
    }
    p += 46 + dir.getUint16(p + 28, true) + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return null;
}
function zip_sizes(dir, p) {
  const short = [p + 24, p + 20, p + 42].map((at) => dir.getUint32(at, true));
  const extra = p + 46 + dir.getUint16(p + 28, true);
  let x = extra;
  while (x + 4 <= extra + dir.getUint16(p + 30, true) && dir.getUint16(x, true) !== 1) {
    x += 4 + dir.getUint16(x + 2, true);
  }
  let k = 0;
  return short.map((n) => n === 4294967295 ? Number(dir.getBigUint64(x + 4 + 8 * k++, true)) : n);
}
function line_claude(s, j, last) {
  const date = import_date(j.timestamp, last);
  const own = (j.type === "user" || j.type === "assistant") && !j.isMeta && !j.isSidechain && !j.isCompactSummary;
  const content = j.message?.content;
  const blocks = !own ? [] : typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  s.where ||= j.cwd ? "session in " + j.cwd : "";
  if (j.type === "attachment" && j.attachment?.type === "queued_command") {
    return msgs_of("user", text_of(j.attachment.prompt), date);
  }
  return blocks_msgs(j.type === "user" ? "user" : "unii", blocks, date);
}
function blocks_msgs(kind, blocks, date) {
  const say = blocks.filter((b) => b.type === "image" || b.type === "text" && !SKIP.test(String(b.text)));
  const tools = blocks.flatMap((b) => b.type === "tool_use" ? msgs_of("tool", String(b.name) + " " + JSON.stringify(b.input), date) : b.type === "tool_result" ? msgs_of("echo", parts_text(b.content), date) : []);
  return [...msgs_of(kind, parts_text(say), date), ...tools];
}
function line_codex(s, j, last) {
  const p = j.payload ?? {};
  const date = import_date(j.timestamp, last);
  if (j.type === "session_meta") {
    s.where = p.source?.subagent ?? p.source?.internal ? "" : "session in " + text_of(p.cwd);
  }
  return j.type === "response_item" && s.where !== "" ? item_codex(p, date) : [];
}
function item_codex(p, date) {
  switch (p.type) {
    case "message": {
      const kind = p.role === "user" ? "user" : p.role === "assistant" ? "unii" : null;
      const parts = (p.content ?? []).filter((c) => !INJECTED.test(c.text ?? ""));
      return kind === null ? [] : msgs_of(kind, parts_text(parts), date);
    }
    case "function_call": {
      return msgs_of("tool", String(p.name) + " " + String(p.arguments), date);
    }
    case "custom_tool_call": {
      return msgs_of("tool", String(p.name) + " " + JSON.stringify({ input: p.input }), date);
    }
    case "local_shell_call": {
      return msgs_of("tool", "shell " + JSON.stringify({ command: p.action?.command }), date);
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      return msgs_of("echo", parts_text(p.output), date);
    }
  }
  return [];
}
function import_date(at, last) {
  const ms = typeof at === "number" ? at * 1000 : Date.parse(String(at));
  return Number.isNaN(ms) ? last : new Date(ms).toISOString();
}
function msgs_of(kind, text, date) {
  const pages = text.trim() === "" ? [] : clip_pages(text);
  return pages.map((page, k) => ({ kind, text: page, date, more: k < pages.length - 1 }));
}
function parts_text(content) {
  if (typeof content === "string") {
    return content;
  }
  return list(content).map((c) => {
    const text = get(c, "text");
    return typeof c === "string" ? c : typeof text === "string" ? text : String(get(c, "type") ?? get(c, "content_type")).includes("image") ? "[image]" : "";
  }).join(`
`);
}

// Theme.ts
var WHO = { work: "Report", note: "Note" };
var KIND = {
  user: { dim: false, it: false },
  work: { dim: false, it: false },
  unii: { dim: false, it: false },
  tool: { dim: true, it: false },
  echo: { dim: true, it: false },
  note: { dim: true, it: true },
  mind: { dim: true, it: true }
};
var TOOL = {
  zoom: "\uD83D\uDD0D",
  date: "\uD83D\uDCC5",
  shell: "⌨️",
  read: "\uD83D\uDCD6",
  write: "\uD83D\uDCC4",
  edit: "\uD83D\uDCDD",
  spawn: "\uD83E\uDD16",
  tell: "\uD83D\uDCAC",
  computer: "\uD83D\uDDB1️",
  schedule: "⏰",
  schedules: "⏰",
  unschedule: "⏰"
};
var TOOL_ANY = "\uD83D\uDD27";
var GLYPH = {
  tab: "◯",
  here: "●",
  input: "> ",
  open: "▾"
};
function tool_glyph(name) {
  return TOOL[name] ?? TOOL_ANY;
}
function theme_css() {
  return Object.entries(KIND).map(([k, look]) => look_css(k, look)).join("");
}
function look_css(kind, look) {
  const ink = look.dim ? "mid" : "ink";
  const style = look.it ? "italic" : "normal";
  const body = "--fg:var(--" + ink + ");--it:" + style;
  return ".msg." + kind + "{" + body + "}";
}

// Call.ts
var SHORT = 60;
var CALL = /^(\S+) (\{[\s\S]*)$/;
var MCP = /^mcp__.+?__/;
var THEIRS = /^(?:([A-Za-z0-9-]+)_)?([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__(.+)$/;
var READS = new Map([
  ["shell", (x) => ({ head: text_of(x.command), blocks: [] })],
  ["read", (x) => ({ head: text_of(x.path) + lines_show(x.offset, x.limit), blocks: [] })],
  ["write", (x) => ({ head: text_of(x.path), blocks: [] })],
  ["view_video", (x) => ({ head: text_of(x.path) + range_show(x.start, x.end, x.unit) + (x.step === undefined ? "" : " every " + text_of(x.step, "null")), blocks: [] })],
  ["edit", (x) => Array.isArray(x.edits) ? { head: edits_files(x.edits), blocks: [] } : input_shown(x)],
  ["zoom", (x) => ({ head: msg_show(x.id, x.n) + (x.at === undefined ? "" : " from char " + text_of(x.at, "null")), blocks: [] })],
  ["date", (x) => ({ head: msg_show(x.id, 1), blocks: [] })],
  ["spawn", (x) => ({ head: tasks_show(x.tasks, x.model, x.effort), blocks: list(x.tasks).flatMap(task_block) })],
  ["tell", (x) => ({ head: text_of(x.name), blocks: text_block(x.message) })],
  ["computer", (x) => ({ head: "", blocks: text_block(x.task) })],
  ["schedule", (x) => ({ head: (x.cron === undefined ? text_of(x.at) : "cron " + text_of(x.cron, "null")) + " " + text_of(x.zone), blocks: text_block(x.message) })]
]);
function report_read(text) {
  const m = /^\[([^\]\n]+)\]\s*([\s\S]*?)(?:\s*Full chat: zoom\("[^"\n]*"\))?\s*$/.exec(text);
  return m === null ? null : { name: m[1], text: m[2] };
}
function call_parse(text) {
  const m = CALL.exec(text);
  const input = m === null ? null : input_parse(m[2]);
  if (m === null || input === null) {
    return { name: "", head: text, device: "", blocks: [] };
  }
  const name = m[1].replace(MCP, "");
  const theirs = THEIRS.exec(name);
  if (theirs !== null) {
    return { name: tool_name(name), device: theirs[1] ?? "", ...input_shown(input) };
  }
  const { device, ...rest } = input;
  const shown = (READS.get(name) ?? input_shown)(rest);
  return { name, device: typeof device === "string" ? device : "", ...shown };
}
function tool_name(logged) {
  const name = logged.replace(MCP, "");
  const theirs = THEIRS.exec(name);
  return theirs === null ? name : theirs[2] + ": " + theirs[3];
}
function call_line(c) {
  const blocks = c.blocks.map((b) => (b.k === "" ? "" : b.k + ": ") + b.x);
  const where = c.device === "" ? [] : ["· " + c.device];
  return [c.head, ...blocks, ...where].join(" ").replace(/\s+/g, " ").trim();
}
function call_text(c) {
  const where = c.name.includes(": ") && c.device !== "" ? " · " + c.device : "";
  return [(c.name + " " + c.head).trim() + where, ...c.blocks.map((b) => b.x)].join(`
`);
}
function input_shown(input) {
  const keys = Object.keys(input);
  const args = [];
  const blocks = [];
  for (const k of keys) {
    const v = input[k];
    const json = JSON.stringify(v);
    const word = typeof v !== "string" || /^[^\s"\\]*$/.test(v);
    if (json.length <= SHORT && word) {
      args.push(json);
    } else {
      const x = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      blocks.push({ $: "Code", k: keys.length > 1 ? k : "", x });
    }
  }
  return { head: args.join(" "), blocks };
}
function text_block(x) {
  return typeof x === "string" && x !== "" ? [{ $: "Code", k: "", x: x.replace(/\n$/, "") }] : [];
}
function msg_show(id, n) {
  const many = typeof n === "number" && n > 1 ? "+" + n : "";
  return typeof id === "number" ? "#" + id + many : text_of(id);
}
function tasks_show(tasks, model, effort) {
  const all = list(tasks);
  const knobs = [...new Set([knobs_show(model, effort), ...all.map((t) => knobs_show(get(t, "model"), get(t, "effort")))])].filter((k) => k !== "").map((k) => " · " + k).join("");
  return all.length + (all.length === 1 ? " agent" : " agents") + knobs;
}
function knobs_show(model, effort) {
  return [model, effort].filter((k) => typeof k === "string").join(" ");
}
function task_block(t) {
  return typeof t === "string" ? text_block(t) : text_block(get(t, "task")).map((b) => ({ ...b, k: knobs_show(get(t, "model"), get(t, "effort")) }));
}
function lines_show(offset, limit) {
  const from = typeof offset === "number" ? offset : 1;
  const to = typeof limit === "number" ? String(from + limit - 1) : "";
  return offset === undefined && limit === undefined ? "" : ":" + from + "-" + to;
}
function range_show(start, end, unit) {
  const s = unit === "second" ? "s" : "";
  return start === undefined && end === undefined ? "" : " " + text_of(start, "0") + s + "-" + text_of(end) + (end === undefined ? "" : s);
}
function edits_files(edits) {
  const paths = edits.map((e) => get(e, "path")).filter((p) => typeof p === "string");
  return [...new Set(paths)].join(", ");
}
function input_parse(text) {
  const shut = [];
  let quote = false;
  let esc = false;
  let field = 0;
  for (let i = 0;i < text.length; i++) {
    const c = text[i];
    if (quote) {
      quote = esc || c !== '"';
      esc = !esc && c === "\\";
    } else if (c === '"') {
      quote = true;
    } else if (c === "{" || c === "[") {
      shut.push(c === "{" ? "}" : "]");
      field = shut.length === 1 ? i + 1 : field;
    } else if (c === "}" || c === "]") {
      shut.pop();
    } else if (c === "," && shut.length === 1) {
      field = i;
    }
  }
  const open = quote ? (esc ? text.slice(0, -1) : text) + '"' : text;
  const full = open.replace(/[\s,]*$/, "") + shut.reverse().join("");
  return object_parse(full) ?? object_parse(text.slice(0, field) + "}");
}
function object_parse(text) {
  try {
    const x = JSON.parse(text);
    return rec(x) ? x : null;
  } catch {
    return null;
  }
}

// Entities.ts
var LIST = `
AElig:c6 AMP:26 Aacute:c1 Abreve:102 Acirc:c2 Acy:410 Afr:1d504 Agrave:c0
Alpha:391 Amacr:100 And:2a53 Aogon:104 Aopf:1d538 ApplyFunction:2061
Aring:c5 Ascr:1d49c Assign:2254 Atilde:c3 Auml:c4 Backslash:2216 Barv:2ae7
Barwed:2306 Bcy:411 Because:2235 Bernoullis:212c Beta:392 Bfr:1d505
Bopf:1d539 Breve:2d8 Bscr:212c Bumpeq:224e CHcy:427 COPY:a9 Cacute:106
Cap:22d2 CapitalDifferentialD:2145 Cayleys:212d Ccaron:10c Ccedil:c7
Ccirc:108 Cconint:2230 Cdot:10a Cedilla:b8 CenterDot:b7 Cfr:212d Chi:3a7
CircleDot:2299 CircleMinus:2296 CirclePlus:2295 CircleTimes:2297
ClockwiseContourIntegral:2232 CloseCurlyDoubleQuote:201d
CloseCurlyQuote:2019 Colon:2237 Colone:2a74 Congruent:2261 Conint:222f
ContourIntegral:222e Copf:2102 Coproduct:2210
CounterClockwiseContourIntegral:2233 Cross:2a2f Cscr:1d49e Cup:22d3
CupCap:224d DD:2145 DDotrahd:2911 DJcy:402 DScy:405 DZcy:40f Dagger:2021
Darr:21a1 Dashv:2ae4 Dcaron:10e Dcy:414 Del:2207 Delta:394 Dfr:1d507
DiacriticalAcute:b4 DiacriticalDot:2d9 DiacriticalDoubleAcute:2dd
DiacriticalGrave:60 DiacriticalTilde:2dc Diamond:22c4 DifferentialD:2146
Dopf:1d53b Dot:a8 DotDot:20dc DotEqual:2250 DoubleContourIntegral:222f
DoubleDot:a8 DoubleDownArrow:21d3 DoubleLeftArrow:21d0
DoubleLeftRightArrow:21d4 DoubleLeftTee:2ae4 DoubleLongLeftArrow:27f8
DoubleLongLeftRightArrow:27fa DoubleLongRightArrow:27f9
DoubleRightArrow:21d2 DoubleRightTee:22a8 DoubleUpArrow:21d1
DoubleUpDownArrow:21d5 DoubleVerticalBar:2225 DownArrow:2193
DownArrowBar:2913 DownArrowUpArrow:21f5 DownBreve:311
DownLeftRightVector:2950 DownLeftTeeVector:295e DownLeftVector:21bd
DownLeftVectorBar:2956 DownRightTeeVector:295f DownRightVector:21c1
DownRightVectorBar:2957 DownTee:22a4 DownTeeArrow:21a7 Downarrow:21d3
Dscr:1d49f Dstrok:110 ENG:14a ETH:d0 Eacute:c9 Ecaron:11a Ecirc:ca Ecy:42d
Edot:116 Efr:1d508 Egrave:c8 Element:2208 Emacr:112 EmptySmallSquare:25fb
EmptyVerySmallSquare:25ab Eogon:118 Eopf:1d53c Epsilon:395 Equal:2a75
EqualTilde:2242 Equilibrium:21cc Escr:2130 Esim:2a73 Eta:397 Euml:cb
Exists:2203 ExponentialE:2147 Fcy:424 Ffr:1d509 FilledSmallSquare:25fc
FilledVerySmallSquare:25aa Fopf:1d53d ForAll:2200 Fouriertrf:2131 Fscr:2131
GJcy:403 GT:3e Gamma:393 Gammad:3dc Gbreve:11e Gcedil:122 Gcirc:11c Gcy:413
Gdot:120 Gfr:1d50a Gg:22d9 Gopf:1d53e GreaterEqual:2265
GreaterEqualLess:22db GreaterFullEqual:2267 GreaterGreater:2aa2
GreaterLess:2277 GreaterSlantEqual:2a7e GreaterTilde:2273 Gscr:1d4a2 Gt:226b
HARDcy:42a Hacek:2c7 Hat:5e Hcirc:124 Hfr:210c HilbertSpace:210b Hopf:210d
HorizontalLine:2500 Hscr:210b Hstrok:126 HumpDownHump:224e HumpEqual:224f
IEcy:415 IJlig:132 IOcy:401 Iacute:cd Icirc:ce Icy:418 Idot:130 Ifr:2111
Igrave:cc Im:2111 Imacr:12a ImaginaryI:2148 Implies:21d2 Int:222c
Integral:222b Intersection:22c2 InvisibleComma:2063 InvisibleTimes:2062
Iogon:12e Iopf:1d540 Iota:399 Iscr:2110 Itilde:128 Iukcy:406 Iuml:cf
Jcirc:134 Jcy:419 Jfr:1d50d Jopf:1d541 Jscr:1d4a5 Jsercy:408 Jukcy:404
KHcy:425 KJcy:40c Kappa:39a Kcedil:136 Kcy:41a Kfr:1d50e Kopf:1d542
Kscr:1d4a6 LJcy:409 LT:3c Lacute:139 Lambda:39b Lang:27ea Laplacetrf:2112
Larr:219e Lcaron:13d Lcedil:13b Lcy:41b LeftAngleBracket:27e8 LeftArrow:2190
LeftArrowBar:21e4 LeftArrowRightArrow:21c6 LeftCeiling:2308
LeftDoubleBracket:27e6 LeftDownTeeVector:2961 LeftDownVector:21c3
LeftDownVectorBar:2959 LeftFloor:230a LeftRightArrow:2194
LeftRightVector:294e LeftTee:22a3 LeftTeeArrow:21a4 LeftTeeVector:295a
LeftTriangle:22b2 LeftTriangleBar:29cf LeftTriangleEqual:22b4
LeftUpDownVector:2951 LeftUpTeeVector:2960 LeftUpVector:21bf
LeftUpVectorBar:2958 LeftVector:21bc LeftVectorBar:2952 Leftarrow:21d0
Leftrightarrow:21d4 LessEqualGreater:22da LessFullEqual:2266
LessGreater:2276 LessLess:2aa1 LessSlantEqual:2a7d LessTilde:2272 Lfr:1d50f
Ll:22d8 Lleftarrow:21da Lmidot:13f LongLeftArrow:27f5
LongLeftRightArrow:27f7 LongRightArrow:27f6 Longleftarrow:27f8
Longleftrightarrow:27fa Longrightarrow:27f9 Lopf:1d543 LowerLeftArrow:2199
LowerRightArrow:2198 Lscr:2112 Lsh:21b0 Lstrok:141 Lt:226a Map:2905 Mcy:41c
MediumSpace:205f Mellintrf:2133 Mfr:1d510 MinusPlus:2213 Mopf:1d544
Mscr:2133 Mu:39c NJcy:40a Nacute:143 Ncaron:147 Ncedil:145 Ncy:41d
NegativeMediumSpace:200b NegativeThickSpace:200b NegativeThinSpace:200b
NegativeVeryThinSpace:200b NestedGreaterGreater:226b NestedLessLess:226a
NewLine:a Nfr:1d511 NoBreak:2060 NonBreakingSpace:a0 Nopf:2115 Not:2aec
NotCongruent:2262 NotCupCap:226d NotDoubleVerticalBar:2226 NotElement:2209
NotEqual:2260 NotEqualTilde:2242+338 NotExists:2204 NotGreater:226f
NotGreaterEqual:2271 NotGreaterFullEqual:2267+338 NotGreaterGreater:226b+338
NotGreaterLess:2279 NotGreaterSlantEqual:2a7e+338 NotGreaterTilde:2275
NotHumpDownHump:224e+338 NotHumpEqual:224f+338 NotLeftTriangle:22ea
NotLeftTriangleBar:29cf+338 NotLeftTriangleEqual:22ec NotLess:226e
NotLessEqual:2270 NotLessGreater:2278 NotLessLess:226a+338
NotLessSlantEqual:2a7d+338 NotLessTilde:2274
NotNestedGreaterGreater:2aa2+338 NotNestedLessLess:2aa1+338 NotPrecedes:2280
NotPrecedesEqual:2aaf+338 NotPrecedesSlantEqual:22e0 NotReverseElement:220c
NotRightTriangle:22eb NotRightTriangleBar:29d0+338
NotRightTriangleEqual:22ed NotSquareSubset:228f+338
NotSquareSubsetEqual:22e2 NotSquareSuperset:2290+338
NotSquareSupersetEqual:22e3 NotSubset:2282+20d2 NotSubsetEqual:2288
NotSucceeds:2281 NotSucceedsEqual:2ab0+338 NotSucceedsSlantEqual:22e1
NotSucceedsTilde:227f+338 NotSuperset:2283+20d2 NotSupersetEqual:2289
NotTilde:2241 NotTildeEqual:2244 NotTildeFullEqual:2247 NotTildeTilde:2249
NotVerticalBar:2224 Nscr:1d4a9 Ntilde:d1 Nu:39d OElig:152 Oacute:d3 Ocirc:d4
Ocy:41e Odblac:150 Ofr:1d512 Ograve:d2 Omacr:14c Omega:3a9 Omicron:39f
Oopf:1d546 OpenCurlyDoubleQuote:201c OpenCurlyQuote:2018 Or:2a54 Oscr:1d4aa
Oslash:d8 Otilde:d5 Otimes:2a37 Ouml:d6 OverBar:203e OverBrace:23de
OverBracket:23b4 OverParenthesis:23dc PartialD:2202 Pcy:41f Pfr:1d513
Phi:3a6 Pi:3a0 PlusMinus:b1 Poincareplane:210c Popf:2119 Pr:2abb
Precedes:227a PrecedesEqual:2aaf PrecedesSlantEqual:227c PrecedesTilde:227e
Prime:2033 Product:220f Proportion:2237 Proportional:221d Pscr:1d4ab Psi:3a8
QUOT:22 Qfr:1d514 Qopf:211a Qscr:1d4ac RBarr:2910 REG:ae Racute:154
Rang:27eb Rarr:21a0 Rarrtl:2916 Rcaron:158 Rcedil:156 Rcy:420 Re:211c
ReverseElement:220b ReverseEquilibrium:21cb ReverseUpEquilibrium:296f
Rfr:211c Rho:3a1 RightAngleBracket:27e9 RightArrow:2192 RightArrowBar:21e5
RightArrowLeftArrow:21c4 RightCeiling:2309 RightDoubleBracket:27e7
RightDownTeeVector:295d RightDownVector:21c2 RightDownVectorBar:2955
RightFloor:230b RightTee:22a2 RightTeeArrow:21a6 RightTeeVector:295b
RightTriangle:22b3 RightTriangleBar:29d0 RightTriangleEqual:22b5
RightUpDownVector:294f RightUpTeeVector:295c RightUpVector:21be
RightUpVectorBar:2954 RightVector:21c0 RightVectorBar:2953 Rightarrow:21d2
Ropf:211d RoundImplies:2970 Rrightarrow:21db Rscr:211b Rsh:21b1
RuleDelayed:29f4 SHCHcy:429 SHcy:428 SOFTcy:42c Sacute:15a Sc:2abc
Scaron:160 Scedil:15e Scirc:15c Scy:421 Sfr:1d516 ShortDownArrow:2193
ShortLeftArrow:2190 ShortRightArrow:2192 ShortUpArrow:2191 Sigma:3a3
SmallCircle:2218 Sopf:1d54a Sqrt:221a Square:25a1 SquareIntersection:2293
SquareSubset:228f SquareSubsetEqual:2291 SquareSuperset:2290
SquareSupersetEqual:2292 SquareUnion:2294 Sscr:1d4ae Star:22c6 Sub:22d0
Subset:22d0 SubsetEqual:2286 Succeeds:227b SucceedsEqual:2ab0
SucceedsSlantEqual:227d SucceedsTilde:227f SuchThat:220b Sum:2211 Sup:22d1
Superset:2283 SupersetEqual:2287 Supset:22d1 THORN:de TRADE:2122 TSHcy:40b
TScy:426 Tab:9 Tau:3a4 Tcaron:164 Tcedil:162 Tcy:422 Tfr:1d517
Therefore:2234 Theta:398 ThickSpace:205f+200a ThinSpace:2009 Tilde:223c
TildeEqual:2243 TildeFullEqual:2245 TildeTilde:2248 Topf:1d54b
TripleDot:20db Tscr:1d4af Tstrok:166 Uacute:da Uarr:219f Uarrocir:2949
Ubrcy:40e Ubreve:16c Ucirc:db Ucy:423 Udblac:170 Ufr:1d518 Ugrave:d9
Umacr:16a UnderBar:5f UnderBrace:23df UnderBracket:23b5
UnderParenthesis:23dd Union:22c3 UnionPlus:228e Uogon:172 Uopf:1d54c
UpArrow:2191 UpArrowBar:2912 UpArrowDownArrow:21c5 UpDownArrow:2195
UpEquilibrium:296e UpTee:22a5 UpTeeArrow:21a5 Uparrow:21d1 Updownarrow:21d5
UpperLeftArrow:2196 UpperRightArrow:2197 Upsi:3d2 Upsilon:3a5 Uring:16e
Uscr:1d4b0 Utilde:168 Uuml:dc VDash:22ab Vbar:2aeb Vcy:412 Vdash:22a9
Vdashl:2ae6 Vee:22c1 Verbar:2016 Vert:2016 VerticalBar:2223 VerticalLine:7c
VerticalSeparator:2758 VerticalTilde:2240 VeryThinSpace:200a Vfr:1d519
Vopf:1d54d Vscr:1d4b1 Vvdash:22aa Wcirc:174 Wedge:22c0 Wfr:1d51a Wopf:1d54e
Wscr:1d4b2 Xfr:1d51b Xi:39e Xopf:1d54f Xscr:1d4b3 YAcy:42f YIcy:407 YUcy:42e
Yacute:dd Ycirc:176 Ycy:42b Yfr:1d51c Yopf:1d550 Yscr:1d4b4 Yuml:178
ZHcy:416 Zacute:179 Zcaron:17d Zcy:417 Zdot:17b ZeroWidthSpace:200b Zeta:396
Zfr:2128 Zopf:2124 Zscr:1d4b5 aacute:e1 abreve:103 ac:223e acE:223e+333
acd:223f acirc:e2 acute:b4 acy:430 aelig:e6 af:2061 afr:1d51e agrave:e0
alefsym:2135 aleph:2135 alpha:3b1 amacr:101 amalg:2a3f amp:26 and:2227
andand:2a55 andd:2a5c andslope:2a58 andv:2a5a ang:2220 ange:29a4 angle:2220
angmsd:2221 angmsdaa:29a8 angmsdab:29a9 angmsdac:29aa angmsdad:29ab
angmsdae:29ac angmsdaf:29ad angmsdag:29ae angmsdah:29af angrt:221f
angrtvb:22be angrtvbd:299d angsph:2222 angst:c5 angzarr:237c aogon:105
aopf:1d552 ap:2248 apE:2a70 apacir:2a6f ape:224a apid:224b apos:27
approx:2248 approxeq:224a aring:e5 ascr:1d4b6 ast:2a asymp:2248 asympeq:224d
atilde:e3 auml:e4 awconint:2233 awint:2a11 bNot:2aed backcong:224c
backepsilon:3f6 backprime:2035 backsim:223d backsimeq:22cd barvee:22bd
barwed:2305 barwedge:2305 bbrk:23b5 bbrktbrk:23b6 bcong:224c bcy:431
bdquo:201e becaus:2235 because:2235 bemptyv:29b0 bepsi:3f6 bernou:212c
beta:3b2 beth:2136 between:226c bfr:1d51f bigcap:22c2 bigcirc:25ef
bigcup:22c3 bigodot:2a00 bigoplus:2a01 bigotimes:2a02 bigsqcup:2a06
bigstar:2605 bigtriangledown:25bd bigtriangleup:25b3 biguplus:2a04
bigvee:22c1 bigwedge:22c0 bkarow:290d blacklozenge:29eb blacksquare:25aa
blacktriangle:25b4 blacktriangledown:25be blacktriangleleft:25c2
blacktriangleright:25b8 blank:2423 blk12:2592 blk14:2591 blk34:2593
block:2588 bne:3d+20e5 bnequiv:2261+20e5 bnot:2310 bopf:1d553 bot:22a5
bottom:22a5 bowtie:22c8 boxDL:2557 boxDR:2554 boxDl:2556 boxDr:2553
boxH:2550 boxHD:2566 boxHU:2569 boxHd:2564 boxHu:2567 boxUL:255d boxUR:255a
boxUl:255c boxUr:2559 boxV:2551 boxVH:256c boxVL:2563 boxVR:2560 boxVh:256b
boxVl:2562 boxVr:255f boxbox:29c9 boxdL:2555 boxdR:2552 boxdl:2510
boxdr:250c boxh:2500 boxhD:2565 boxhU:2568 boxhd:252c boxhu:2534
boxminus:229f boxplus:229e boxtimes:22a0 boxuL:255b boxuR:2558 boxul:2518
boxur:2514 boxv:2502 boxvH:256a boxvL:2561 boxvR:255e boxvh:253c boxvl:2524
boxvr:251c bprime:2035 breve:2d8 brvbar:a6 bscr:1d4b7 bsemi:204f bsim:223d
bsime:22cd bsol:5c bsolb:29c5 bsolhsub:27c8 bull:2022 bullet:2022 bump:224e
bumpE:2aae bumpe:224f bumpeq:224f cacute:107 cap:2229 capand:2a44
capbrcup:2a49 capcap:2a4b capcup:2a47 capdot:2a40 caps:2229+fe00 caret:2041
caron:2c7 ccaps:2a4d ccaron:10d ccedil:e7 ccirc:109 ccups:2a4c ccupssm:2a50
cdot:10b cedil:b8 cemptyv:29b2 cent:a2 centerdot:b7 cfr:1d520 chcy:447
check:2713 checkmark:2713 chi:3c7 cir:25cb cirE:29c3 circ:2c6 circeq:2257
circlearrowleft:21ba circlearrowright:21bb circledR:ae circledS:24c8
circledast:229b circledcirc:229a circleddash:229d cire:2257 cirfnint:2a10
cirmid:2aef cirscir:29c2 clubs:2663 clubsuit:2663 colon:3a colone:2254
coloneq:2254 comma:2c commat:40 comp:2201 compfn:2218 complement:2201
complexes:2102 cong:2245 congdot:2a6d conint:222e copf:1d554 coprod:2210
copy:a9 copysr:2117 crarr:21b5 cross:2717 cscr:1d4b8 csub:2acf csube:2ad1
csup:2ad0 csupe:2ad2 ctdot:22ef cudarrl:2938 cudarrr:2935 cuepr:22de
cuesc:22df cularr:21b6 cularrp:293d cup:222a cupbrcap:2a48 cupcap:2a46
cupcup:2a4a cupdot:228d cupor:2a45 cups:222a+fe00 curarr:21b7 curarrm:293c
curlyeqprec:22de curlyeqsucc:22df curlyvee:22ce curlywedge:22cf curren:a4
curvearrowleft:21b6 curvearrowright:21b7 cuvee:22ce cuwed:22cf cwconint:2232
cwint:2231 cylcty:232d dArr:21d3 dHar:2965 dagger:2020 daleth:2138 darr:2193
dash:2010 dashv:22a3 dbkarow:290f dblac:2dd dcaron:10f dcy:434 dd:2146
ddagger:2021 ddarr:21ca ddotseq:2a77 deg:b0 delta:3b4 demptyv:29b1
dfisht:297f dfr:1d521 dharl:21c3 dharr:21c2 diam:22c4 diamond:22c4
diamondsuit:2666 diams:2666 die:a8 digamma:3dd disin:22f2 div:f7 divide:f7
divideontimes:22c7 divonx:22c7 djcy:452 dlcorn:231e dlcrop:230d dollar:24
dopf:1d555 dot:2d9 doteq:2250 doteqdot:2251 dotminus:2238 dotplus:2214
dotsquare:22a1 doublebarwedge:2306 downarrow:2193 downdownarrows:21ca
downharpoonleft:21c3 downharpoonright:21c2 drbkarow:2910 drcorn:231f
drcrop:230c dscr:1d4b9 dscy:455 dsol:29f6 dstrok:111 dtdot:22f1 dtri:25bf
dtrif:25be duarr:21f5 duhar:296f dwangle:29a6 dzcy:45f dzigrarr:27ff
eDDot:2a77 eDot:2251 eacute:e9 easter:2a6e ecaron:11b ecir:2256 ecirc:ea
ecolon:2255 ecy:44d edot:117 ee:2147 efDot:2252 efr:1d522 eg:2a9a egrave:e8
egs:2a96 egsdot:2a98 el:2a99 elinters:23e7 ell:2113 els:2a95 elsdot:2a97
emacr:113 empty:2205 emptyset:2205 emptyv:2205 emsp:2003 emsp13:2004
emsp14:2005 eng:14b ensp:2002 eogon:119 eopf:1d556 epar:22d5 eparsl:29e3
eplus:2a71 epsi:3b5 epsilon:3b5 epsiv:3f5 eqcirc:2256 eqcolon:2255
eqsim:2242 eqslantgtr:2a96 eqslantless:2a95 equals:3d equest:225f equiv:2261
equivDD:2a78 eqvparsl:29e5 erDot:2253 erarr:2971 escr:212f esdot:2250
esim:2242 eta:3b7 eth:f0 euml:eb euro:20ac excl:21 exist:2203
expectation:2130 exponentiale:2147 fallingdotseq:2252 fcy:444 female:2640
ffilig:fb03 fflig:fb00 ffllig:fb04 ffr:1d523 filig:fb01 fjlig:66+6a
flat:266d fllig:fb02 fltns:25b1 fnof:192 fopf:1d557 forall:2200 fork:22d4
forkv:2ad9 fpartint:2a0d frac12:bd frac13:2153 frac14:bc frac15:2155
frac16:2159 frac18:215b frac23:2154 frac25:2156 frac34:be frac35:2157
frac38:215c frac45:2158 frac56:215a frac58:215d frac78:215e frasl:2044
frown:2322 fscr:1d4bb gE:2267 gEl:2a8c gacute:1f5 gamma:3b3 gammad:3dd
gap:2a86 gbreve:11f gcirc:11d gcy:433 gdot:121 ge:2265 gel:22db geq:2265
geqq:2267 geqslant:2a7e ges:2a7e gescc:2aa9 gesdot:2a80 gesdoto:2a82
gesdotol:2a84 gesl:22db+fe00 gesles:2a94 gfr:1d524 gg:226b ggg:22d9
gimel:2137 gjcy:453 gl:2277 glE:2a92 gla:2aa5 glj:2aa4 gnE:2269 gnap:2a8a
gnapprox:2a8a gne:2a88 gneq:2a88 gneqq:2269 gnsim:22e7 gopf:1d558 grave:60
gscr:210a gsim:2273 gsime:2a8e gsiml:2a90 gt:3e gtcc:2aa7 gtcir:2a7a
gtdot:22d7 gtlPar:2995 gtquest:2a7c gtrapprox:2a86 gtrarr:2978 gtrdot:22d7
gtreqless:22db gtreqqless:2a8c gtrless:2277 gtrsim:2273 gvertneqq:2269+fe00
gvnE:2269+fe00 hArr:21d4 hairsp:200a half:bd hamilt:210b hardcy:44a
harr:2194 harrcir:2948 harrw:21ad hbar:210f hcirc:125 hearts:2665
heartsuit:2665 hellip:2026 hercon:22b9 hfr:1d525 hksearow:2925 hkswarow:2926
hoarr:21ff homtht:223b hookleftarrow:21a9 hookrightarrow:21aa hopf:1d559
horbar:2015 hscr:1d4bd hslash:210f hstrok:127 hybull:2043 hyphen:2010
iacute:ed ic:2063 icirc:ee icy:438 iecy:435 iexcl:a1 iff:21d4 ifr:1d526
igrave:ec ii:2148 iiiint:2a0c iiint:222d iinfin:29dc iiota:2129 ijlig:133
imacr:12b image:2111 imagline:2110 imagpart:2111 imath:131 imof:22b7
imped:1b5 in:2208 incare:2105 infin:221e infintie:29dd inodot:131 int:222b
intcal:22ba integers:2124 intercal:22ba intlarhk:2a17 intprod:2a3c iocy:451
iogon:12f iopf:1d55a iota:3b9 iprod:2a3c iquest:bf iscr:1d4be isin:2208
isinE:22f9 isindot:22f5 isins:22f4 isinsv:22f3 isinv:2208 it:2062 itilde:129
iukcy:456 iuml:ef jcirc:135 jcy:439 jfr:1d527 jmath:237 jopf:1d55b
jscr:1d4bf jsercy:458 jukcy:454 kappa:3ba kappav:3f0 kcedil:137 kcy:43a
kfr:1d528 kgreen:138 khcy:445 kjcy:45c kopf:1d55c kscr:1d4c0 lAarr:21da
lArr:21d0 lAtail:291b lBarr:290e lE:2266 lEg:2a8b lHar:2962 lacute:13a
laemptyv:29b4 lagran:2112 lambda:3bb lang:27e8 langd:2991 langle:27e8
lap:2a85 laquo:ab larr:2190 larrb:21e4 larrbfs:291f larrfs:291d larrhk:21a9
larrlp:21ab larrpl:2939 larrsim:2973 larrtl:21a2 lat:2aab latail:2919
late:2aad lates:2aad+fe00 lbarr:290c lbbrk:2772 lbrace:7b lbrack:5b
lbrke:298b lbrksld:298f lbrkslu:298d lcaron:13e lcedil:13c lceil:2308
lcub:7b lcy:43b ldca:2936 ldquo:201c ldquor:201e ldrdhar:2967 ldrushar:294b
ldsh:21b2 le:2264 leftarrow:2190 leftarrowtail:21a2 leftharpoondown:21bd
leftharpoonup:21bc leftleftarrows:21c7 leftrightarrow:2194
leftrightarrows:21c6 leftrightharpoons:21cb leftrightsquigarrow:21ad
leftthreetimes:22cb leg:22da leq:2264 leqq:2266 leqslant:2a7d les:2a7d
lescc:2aa8 lesdot:2a7f lesdoto:2a81 lesdotor:2a83 lesg:22da+fe00 lesges:2a93
lessapprox:2a85 lessdot:22d6 lesseqgtr:22da lesseqqgtr:2a8b lessgtr:2276
lesssim:2272 lfisht:297c lfloor:230a lfr:1d529 lg:2276 lgE:2a91 lhard:21bd
lharu:21bc lharul:296a lhblk:2584 ljcy:459 ll:226a llarr:21c7 llcorner:231e
llhard:296b lltri:25fa lmidot:140 lmoust:23b0 lmoustache:23b0 lnE:2268
lnap:2a89 lnapprox:2a89 lne:2a87 lneq:2a87 lneqq:2268 lnsim:22e6 loang:27ec
loarr:21fd lobrk:27e6 longleftarrow:27f5 longleftrightarrow:27f7
longmapsto:27fc longrightarrow:27f6 looparrowleft:21ab looparrowright:21ac
lopar:2985 lopf:1d55d loplus:2a2d lotimes:2a34 lowast:2217 lowbar:5f
loz:25ca lozenge:25ca lozf:29eb lpar:28 lparlt:2993 lrarr:21c6 lrcorner:231f
lrhar:21cb lrhard:296d lrm:200e lrtri:22bf lsaquo:2039 lscr:1d4c1 lsh:21b0
lsim:2272 lsime:2a8d lsimg:2a8f lsqb:5b lsquo:2018 lsquor:201a lstrok:142
lt:3c ltcc:2aa6 ltcir:2a79 ltdot:22d6 lthree:22cb ltimes:22c9 ltlarr:2976
ltquest:2a7b ltrPar:2996 ltri:25c3 ltrie:22b4 ltrif:25c2 lurdshar:294a
luruhar:2966 lvertneqq:2268+fe00 lvnE:2268+fe00 mDDot:223a macr:af male:2642
malt:2720 maltese:2720 map:21a6 mapsto:21a6 mapstodown:21a7 mapstoleft:21a4
mapstoup:21a5 marker:25ae mcomma:2a29 mcy:43c mdash:2014 measuredangle:2221
mfr:1d52a mho:2127 micro:b5 mid:2223 midast:2a midcir:2af0 middot:b7
minus:2212 minusb:229f minusd:2238 minusdu:2a2a mlcp:2adb mldr:2026
mnplus:2213 models:22a7 mopf:1d55e mp:2213 mscr:1d4c2 mstpos:223e mu:3bc
multimap:22b8 mumap:22b8 nGg:22d9+338 nGt:226b+20d2 nGtv:226b+338
nLeftarrow:21cd nLeftrightarrow:21ce nLl:22d8+338 nLt:226a+20d2
nLtv:226a+338 nRightarrow:21cf nVDash:22af nVdash:22ae nabla:2207 nacute:144
nang:2220+20d2 nap:2249 napE:2a70+338 napid:224b+338 napos:149 napprox:2249
natur:266e natural:266e naturals:2115 nbsp:a0 nbump:224e+338 nbumpe:224f+338
ncap:2a43 ncaron:148 ncedil:146 ncong:2247 ncongdot:2a6d+338 ncup:2a42
ncy:43d ndash:2013 ne:2260 neArr:21d7 nearhk:2924 nearr:2197 nearrow:2197
nedot:2250+338 nequiv:2262 nesear:2928 nesim:2242+338 nexist:2204
nexists:2204 nfr:1d52b ngE:2267+338 nge:2271 ngeq:2271 ngeqq:2267+338
ngeqslant:2a7e+338 nges:2a7e+338 ngsim:2275 ngt:226f ngtr:226f nhArr:21ce
nharr:21ae nhpar:2af2 ni:220b nis:22fc nisd:22fa niv:220b njcy:45a
nlArr:21cd nlE:2266+338 nlarr:219a nldr:2025 nle:2270 nleftarrow:219a
nleftrightarrow:21ae nleq:2270 nleqq:2266+338 nleqslant:2a7d+338
nles:2a7d+338 nless:226e nlsim:2274 nlt:226e nltri:22ea nltrie:22ec
nmid:2224 nopf:1d55f not:ac notin:2209 notinE:22f9+338 notindot:22f5+338
notinva:2209 notinvb:22f7 notinvc:22f6 notni:220c notniva:220c notnivb:22fe
notnivc:22fd npar:2226 nparallel:2226 nparsl:2afd+20e5 npart:2202+338
npolint:2a14 npr:2280 nprcue:22e0 npre:2aaf+338 nprec:2280 npreceq:2aaf+338
nrArr:21cf nrarr:219b nrarrc:2933+338 nrarrw:219d+338 nrightarrow:219b
nrtri:22eb nrtrie:22ed nsc:2281 nsccue:22e1 nsce:2ab0+338 nscr:1d4c3
nshortmid:2224 nshortparallel:2226 nsim:2241 nsime:2244 nsimeq:2244
nsmid:2224 nspar:2226 nsqsube:22e2 nsqsupe:22e3 nsub:2284 nsubE:2ac5+338
nsube:2288 nsubset:2282+20d2 nsubseteq:2288 nsubseteqq:2ac5+338 nsucc:2281
nsucceq:2ab0+338 nsup:2285 nsupE:2ac6+338 nsupe:2289 nsupset:2283+20d2
nsupseteq:2289 nsupseteqq:2ac6+338 ntgl:2279 ntilde:f1 ntlg:2278
ntriangleleft:22ea ntrianglelefteq:22ec ntriangleright:22eb
ntrianglerighteq:22ed nu:3bd num:23 numero:2116 numsp:2007 nvDash:22ad
nvHarr:2904 nvap:224d+20d2 nvdash:22ac nvge:2265+20d2 nvgt:3e+20d2
nvinfin:29de nvlArr:2902 nvle:2264+20d2 nvlt:3c+20d2 nvltrie:22b4+20d2
nvrArr:2903 nvrtrie:22b5+20d2 nvsim:223c+20d2 nwArr:21d6 nwarhk:2923
nwarr:2196 nwarrow:2196 nwnear:2927 oS:24c8 oacute:f3 oast:229b ocir:229a
ocirc:f4 ocy:43e odash:229d odblac:151 odiv:2a38 odot:2299 odsold:29bc
oelig:153 ofcir:29bf ofr:1d52c ogon:2db ograve:f2 ogt:29c1 ohbar:29b5
ohm:3a9 oint:222e olarr:21ba olcir:29be olcross:29bb oline:203e olt:29c0
omacr:14d omega:3c9 omicron:3bf omid:29b6 ominus:2296 oopf:1d560 opar:29b7
operp:29b9 oplus:2295 or:2228 orarr:21bb ord:2a5d order:2134 orderof:2134
ordf:aa ordm:ba origof:22b6 oror:2a56 orslope:2a57 orv:2a5b oscr:2134
oslash:f8 osol:2298 otilde:f5 otimes:2297 otimesas:2a36 ouml:f6 ovbar:233d
par:2225 para:b6 parallel:2225 parsim:2af3 parsl:2afd part:2202 pcy:43f
percnt:25 period:2e permil:2030 perp:22a5 pertenk:2031 pfr:1d52d phi:3c6
phiv:3d5 phmmat:2133 phone:260e pi:3c0 pitchfork:22d4 piv:3d6 planck:210f
planckh:210e plankv:210f plus:2b plusacir:2a23 plusb:229e pluscir:2a22
plusdo:2214 plusdu:2a25 pluse:2a72 plusmn:b1 plussim:2a26 plustwo:2a27 pm:b1
pointint:2a15 popf:1d561 pound:a3 pr:227a prE:2ab3 prap:2ab7 prcue:227c
pre:2aaf prec:227a precapprox:2ab7 preccurlyeq:227c preceq:2aaf
precnapprox:2ab9 precneqq:2ab5 precnsim:22e8 precsim:227e prime:2032
primes:2119 prnE:2ab5 prnap:2ab9 prnsim:22e8 prod:220f profalar:232e
profline:2312 profsurf:2313 prop:221d propto:221d prsim:227e prurel:22b0
pscr:1d4c5 psi:3c8 puncsp:2008 qfr:1d52e qint:2a0c qopf:1d562 qprime:2057
qscr:1d4c6 quaternions:210d quatint:2a16 quest:3f questeq:225f quot:22
rAarr:21db rArr:21d2 rAtail:291c rBarr:290f rHar:2964 race:223d+331
racute:155 radic:221a raemptyv:29b3 rang:27e9 rangd:2992 range:29a5
rangle:27e9 raquo:bb rarr:2192 rarrap:2975 rarrb:21e5 rarrbfs:2920
rarrc:2933 rarrfs:291e rarrhk:21aa rarrlp:21ac rarrpl:2945 rarrsim:2974
rarrtl:21a3 rarrw:219d ratail:291a ratio:2236 rationals:211a rbarr:290d
rbbrk:2773 rbrace:7d rbrack:5d rbrke:298c rbrksld:298e rbrkslu:2990
rcaron:159 rcedil:157 rceil:2309 rcub:7d rcy:440 rdca:2937 rdldhar:2969
rdquo:201d rdquor:201d rdsh:21b3 real:211c realine:211b realpart:211c
reals:211d rect:25ad reg:ae rfisht:297d rfloor:230b rfr:1d52f rhard:21c1
rharu:21c0 rharul:296c rho:3c1 rhov:3f1 rightarrow:2192 rightarrowtail:21a3
rightharpoondown:21c1 rightharpoonup:21c0 rightleftarrows:21c4
rightleftharpoons:21cc rightrightarrows:21c9 rightsquigarrow:219d
rightthreetimes:22cc ring:2da risingdotseq:2253 rlarr:21c4 rlhar:21cc
rlm:200f rmoust:23b1 rmoustache:23b1 rnmid:2aee roang:27ed roarr:21fe
robrk:27e7 ropar:2986 ropf:1d563 roplus:2a2e rotimes:2a35 rpar:29
rpargt:2994 rppolint:2a12 rrarr:21c9 rsaquo:203a rscr:1d4c7 rsh:21b1 rsqb:5d
rsquo:2019 rsquor:2019 rthree:22cc rtimes:22ca rtri:25b9 rtrie:22b5
rtrif:25b8 rtriltri:29ce ruluhar:2968 rx:211e sacute:15b sbquo:201a sc:227b
scE:2ab4 scap:2ab8 scaron:161 sccue:227d sce:2ab0 scedil:15f scirc:15d
scnE:2ab6 scnap:2aba scnsim:22e9 scpolint:2a13 scsim:227f scy:441 sdot:22c5
sdotb:22a1 sdote:2a66 seArr:21d8 searhk:2925 searr:2198 searrow:2198 sect:a7
semi:3b seswar:2929 setminus:2216 setmn:2216 sext:2736 sfr:1d530 sfrown:2322
sharp:266f shchcy:449 shcy:448 shortmid:2223 shortparallel:2225 shy:ad
sigma:3c3 sigmaf:3c2 sigmav:3c2 sim:223c simdot:2a6a sime:2243 simeq:2243
simg:2a9e simgE:2aa0 siml:2a9d simlE:2a9f simne:2246 simplus:2a24
simrarr:2972 slarr:2190 smallsetminus:2216 smashp:2a33 smeparsl:29e4
smid:2223 smile:2323 smt:2aaa smte:2aac smtes:2aac+fe00 softcy:44c sol:2f
solb:29c4 solbar:233f sopf:1d564 spades:2660 spadesuit:2660 spar:2225
sqcap:2293 sqcaps:2293+fe00 sqcup:2294 sqcups:2294+fe00 sqsub:228f
sqsube:2291 sqsubset:228f sqsubseteq:2291 sqsup:2290 sqsupe:2292
sqsupset:2290 sqsupseteq:2292 squ:25a1 square:25a1 squarf:25aa squf:25aa
srarr:2192 sscr:1d4c8 ssetmn:2216 ssmile:2323 sstarf:22c6 star:2606
starf:2605 straightepsilon:3f5 straightphi:3d5 strns:af sub:2282 subE:2ac5
subdot:2abd sube:2286 subedot:2ac3 submult:2ac1 subnE:2acb subne:228a
subplus:2abf subrarr:2979 subset:2282 subseteq:2286 subseteqq:2ac5
subsetneq:228a subsetneqq:2acb subsim:2ac7 subsub:2ad5 subsup:2ad3 succ:227b
succapprox:2ab8 succcurlyeq:227d succeq:2ab0 succnapprox:2aba succneqq:2ab6
succnsim:22e9 succsim:227f sum:2211 sung:266a sup:2283 sup1:b9 sup2:b2
sup3:b3 supE:2ac6 supdot:2abe supdsub:2ad8 supe:2287 supedot:2ac4
suphsol:27c9 suphsub:2ad7 suplarr:297b supmult:2ac2 supnE:2acc supne:228b
supplus:2ac0 supset:2283 supseteq:2287 supseteqq:2ac6 supsetneq:228b
supsetneqq:2acc supsim:2ac8 supsub:2ad4 supsup:2ad6 swArr:21d9 swarhk:2926
swarr:2199 swarrow:2199 swnwar:292a szlig:df target:2316 tau:3c4 tbrk:23b4
tcaron:165 tcedil:163 tcy:442 tdot:20db telrec:2315 tfr:1d531 there4:2234
therefore:2234 theta:3b8 thetasym:3d1 thetav:3d1 thickapprox:2248
thicksim:223c thinsp:2009 thkap:2248 thksim:223c thorn:fe tilde:2dc times:d7
timesb:22a0 timesbar:2a31 timesd:2a30 tint:222d toea:2928 top:22a4
topbot:2336 topcir:2af1 topf:1d565 topfork:2ada tosa:2929 tprime:2034
trade:2122 triangle:25b5 triangledown:25bf triangleleft:25c3
trianglelefteq:22b4 triangleq:225c triangleright:25b9 trianglerighteq:22b5
tridot:25ec trie:225c triminus:2a3a triplus:2a39 trisb:29cd tritime:2a3b
trpezium:23e2 tscr:1d4c9 tscy:446 tshcy:45b tstrok:167 twixt:226c
twoheadleftarrow:219e twoheadrightarrow:21a0 uArr:21d1 uHar:2963 uacute:fa
uarr:2191 ubrcy:45e ubreve:16d ucirc:fb ucy:443 udarr:21c5 udblac:171
udhar:296e ufisht:297e ufr:1d532 ugrave:f9 uharl:21bf uharr:21be uhblk:2580
ulcorn:231c ulcorner:231c ulcrop:230f ultri:25f8 umacr:16b uml:a8 uogon:173
uopf:1d566 uparrow:2191 updownarrow:2195 upharpoonleft:21bf
upharpoonright:21be uplus:228e upsi:3c5 upsih:3d2 upsilon:3c5
upuparrows:21c8 urcorn:231d urcorner:231d urcrop:230e uring:16f urtri:25f9
uscr:1d4ca utdot:22f0 utilde:169 utri:25b5 utrif:25b4 uuarr:21c8 uuml:fc
uwangle:29a7 vArr:21d5 vBar:2ae8 vBarv:2ae9 vDash:22a8 vangrt:299c
varepsilon:3f5 varkappa:3f0 varnothing:2205 varphi:3d5 varpi:3d6
varpropto:221d varr:2195 varrho:3f1 varsigma:3c2 varsubsetneq:228a+fe00
varsubsetneqq:2acb+fe00 varsupsetneq:228b+fe00 varsupsetneqq:2acc+fe00
vartheta:3d1 vartriangleleft:22b2 vartriangleright:22b3 vcy:432 vdash:22a2
vee:2228 veebar:22bb veeeq:225a vellip:22ee verbar:7c vert:7c vfr:1d533
vltri:22b2 vnsub:2282+20d2 vnsup:2283+20d2 vopf:1d567 vprop:221d vrtri:22b3
vscr:1d4cb vsubnE:2acb+fe00 vsubne:228a+fe00 vsupnE:2acc+fe00
vsupne:228b+fe00 vzigzag:299a wcirc:175 wedbar:2a5f wedge:2227 wedgeq:2259
weierp:2118 wfr:1d534 wopf:1d568 wp:2118 wr:2240 wreath:2240 wscr:1d4cc
xcap:22c2 xcirc:25ef xcup:22c3 xdtri:25bd xfr:1d535 xhArr:27fa xharr:27f7
xi:3be xlArr:27f8 xlarr:27f5 xmap:27fc xnis:22fb xodot:2a00 xopf:1d569
xoplus:2a01 xotime:2a02 xrArr:27f9 xrarr:27f6 xscr:1d4cd xsqcup:2a06
xuplus:2a04 xutri:25b3 xvee:22c1 xwedge:22c0 yacute:fd yacy:44f ycirc:177
ycy:44b yen:a5 yfr:1d536 yicy:457 yopf:1d56a yscr:1d4ce yucy:44e yuml:ff
zacute:17a zcaron:17e zcy:437 zdot:17c zeetrf:2128 zeta:3b6 zfr:1d537
zhcy:436 zigrarr:21dd zopf:1d56b zscr:1d4cf zwj:200d zwnj:200c
`;
var ENTITIES = new Map(LIST.trim().split(/\s+/).map((e) => {
  const [name, codes] = e.split(":");
  return [name, String.fromCodePoint(...codes.split("+").map((c) => parseInt(c, 16)))];
}));

// Names.ts
var ADJS = `
red blue green yellow orange purple pink brown black white gray silver golden
amber azure bronze copper jade lemon lime mint navy peach plum ruby violet
cherry honey big small tiny huge giant little tall short long round flat thick
thin deep soft hard smooth rough fuzzy fluffy shiny crunchy crispy leafy spiky
hot cold warm cool icy frosty snowy rainy sunny cloudy windy stormy foggy
misty sweet sour salty spicy juicy minty nutty creamy smoky tasty fresh bright
dark quiet loud happy jolly merry calm brave bold clever wise kind gentle
lucky proud quick swift fast slow eager busy sleepy silly funny shy neat noble
grand royal mighty strong steady nimble lively cozy old new young ancient
wooden stone paper iron magic cosmic lunar solar polar wild
`.split(/\s+/).filter(Boolean);
var NOUNS = `
ant bat bear bee beetle bird bison camel cat cheetah chicken clam cobra cougar
cow crab crane crow deer dog dolphin donkey dove dragon duck eagle eel elk
falcon finch fish flamingo fox frog gazelle gecko giraffe goat goose gorilla
hamster hare hawk hedgehog heron hippo horse hyena iguana jaguar jay kangaroo
kitten koala lamb lemur leopard lion lizard llama lobster moose moth mouse
mule octopus orca otter owl ox oyster panda parrot pelican penguin pig pigeon
pony puffin puma rabbit raccoon raven rhino robin salmon seal shark sheep
shrimp skunk sloth snail snake sparrow spider squid squirrel swan tiger toad
toucan trout tuna turkey turtle walrus wasp whale wolf wombat yak zebra apple
banana bagel cookie mango melon muffin noodle pancake pepper potato pretzel
radish taco waffle
`.split(/\s+/).filter(Boolean);
var NAME = "(?:" + ADJS.map(name_word).join("|") + ")-?(?:" + NOUNS.map(name_word).join("|") + ")";
function name_word(word) {
  return word[0].toUpperCase() + word.slice(1);
}

// Md.ts
var NAME2 = new RegExp("\\[(" + NAME + ")\\]", "g");
var ONLY = new RegExp("^(?:" + NAME + ")$");
var MEDIA = new Map([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
  ["weba", "audio/webm"],
  ["html", "text/html"]
]);
var MEDIA_AS = new Map([["jpg", "jpeg"], ["m4v", "mp4"], ["oga", "ogg"], ["htm", "html"]]);
var MEDIA_URL = /\/media\/[0-9a-f]{16}\.[a-z0-9]{1,10}(?=\))/y;
var LIST2 = /^ {0,3}([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
var FENCE = /^ {0,3}(`{3,}|~{3,})/;
var TASK = /^\[([ xX])\](?=[ \t]|$)[ \t]?/;
var PUNCT = /[\p{P}\p{S}]/u;
var AUTO = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/iy;
var MAIL = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
var BARE = /https?:\/\/|www\./iy;
var LOCAL = /[A-Za-z0-9._+-]/;
var EMAIL = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/y;
var ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;
var SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
var HEAD = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
var QUOT = /^ {0,3}>[ \t]?/;
var ROW = /^\s*\|.*\|\s*$/;
var PIPE = /(?<!\\)\|/;
var CELL = /^[ \t]*:?-+:?[ \t]*$/;
var NEW = /^\+\+\+ (.*)$/;
var READ = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
var FAILED = "error: ";
var HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
var MARKS = /^(?:\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\s*>\s?)*/;
var LINK_PARENS_MAX = 32;
var NESTING_MAX = 16;
var LABEL_SCAN_MAX = 1000;
var DEFS = new Map;
var COLLECT = false;
var UNSHUT = { lines: [], from: new Map };
function Text(x) {
  return { $: "Text", x };
}
function Name(x) {
  return { $: "Name", x };
}
function spans_by(s, re, mark) {
  const out = [];
  let at = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) {
      out.push(Text(s.slice(at, i)));
    }
    out.push(mark(m));
    at = i + m[0].length;
  }
  if (at < s.length) {
    out.push(Text(s.slice(at)));
  }
  return out;
}
function span_parse(s) {
  if (COLLECT) {
    return [];
  }
  const head = { x: Text(""), m: null, prev: null, next: null };
  let tail = head;
  let marks = null;
  const brackets = [];
  let [links, dead] = [0, 0];
  const ticks = ticks_at(s);
  const unshut = new Map;
  let [i, text] = [0, ""];
  const add = (x, m = null) => {
    const node = { x, m, prev: tail, next: null };
    tail.next = node;
    tail = node;
    return node;
  };
  const flush = () => {
    if (text !== "") {
      add(Text(text));
      text = "";
    }
  };
  const put = (x) => {
    flush();
    add(x);
  };
  const mark = (c, n, open, close) => {
    flush();
    const node = add(Text(c === "[" || c === "![" ? c : c.repeat(n)));
    const m = { c, n, len: n, open, close, at: i, node, prev: marks, next: null };
    node.m = m;
    if (marks !== null) {
      marks.next = m;
    }
    marks = m;
    return m;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && (s[i + 1] === `
` || PUNCT.test(s[i + 1]) && s.charCodeAt(i + 1) < 128)) {
      if (s[i + 1] === `
`) {
        text = text.trimEnd();
        put({ $: "Brk" });
      } else {
        text += s[i + 1];
      }
      i += 2;
    } else if (c === `
`) {
      text = text.trimEnd();
      put({ $: "Brk" });
      for (i++;s[i] === " " || s[i] === "\t"; i++)
        ;
    } else if (c === "&" && (ENTITY.lastIndex = i, ENTITY.test(s)) && entity(s.slice(i, ENTITY.lastIndex)) !== null) {
      text += entity(s.slice(i, ENTITY.lastIndex));
      i = ENTITY.lastIndex;
    } else if (c === "`") {
      const n = run_len(s, i, c);
      const end = ticks(i + n, n);
      if (end < 0) {
        text += s.slice(i, i + n);
      } else {
        const x = s.slice(i + n, end).replace(/\n/g, " ");
        put({ $: "Code", x: x.length > 2 && x[0] === " " && x.endsWith(" ") && x.trim() !== "" ? x.slice(1, -1) : x });
      }
      i = end < 0 ? i + n : end + n;
    } else if (c === "<" && (AUTO.lastIndex = i, AUTO.test(s))) {
      const k = s.slice(i + 1, AUTO.lastIndex - 1);
      put(link_safe(k) ? { $: "Link", x: [Text(k)], k, t: "" } : Text(s.slice(i, AUTO.lastIndex)));
      i = AUTO.lastIndex;
    } else if (c === "<" && (MAIL.lastIndex = i, MAIL.test(s))) {
      const k = s.slice(i + 1, MAIL.lastIndex - 1);
      put({ $: "Link", x: [Text(k)], k: "mailto:" + k, t: "" });
      i = MAIL.lastIndex;
    } else if (c === "[" || c === "!" && s[i + 1] === "[") {
      brackets.push(mark(c === "[" ? "[" : "![", 1, false, false));
      links += c === "[" ? 1 : 0;
      i += c === "[" ? 1 : 2;
    } else if (c === "]" && brackets.length > 0) {
      flush();
      const o = brackets[brackets.length - 1];
      brackets.pop();
      links -= o.c === "[" ? 1 : 0;
      const on = !(o.c === "[" && brackets.length < dead);
      dead = Math.min(dead, brackets.length);
      const got = on ? link_tail(s, i + 1, unshut) ?? link_ref(s, i + 1, o.at + o.c.length) : null;
      if (got !== null && link_safe(got.k)) {
        emphasis(o);
        const x = nodes_spans(o.node.next);
        tail = o.node;
        o.node.next = null;
        o.node.x = o.c === "![" ? { $: "Pict", x: spans_text(x), k: got.k, t: got.t } : { $: "Link", x, k: got.k, t: got.t };
        o.node.m = null;
        marks = mark_drop(marks, o);
        dead = o.c === "[" ? brackets.length : dead;
        i = got.end;
      } else if (got !== null) {
        emphasis(o);
        tail = o.node;
        o.node.next = null;
        o.node.x = Text(s.slice(o.at, got.end));
        o.node.m = null;
        marks = mark_drop(marks, o);
        i = got.end;
      } else {
        const name = o.c === "[" && o.node.next !== null && o.node.next === tail && tail.x.$ === "Text" && ONLY.test(tail.x.x) ? tail.x.x : null;
        marks = mark_drop(marks, o);
        o.node.m = null;
        if (name !== null) {
          tail = o.node;
          o.node.next = null;
          o.node.x = Name(name);
        } else {
          text += c;
        }
        i++;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      const n = run_len(s, i, c);
      const [open, close] = flanks(s, i, n, c);
      if (c === "~" && n > 2 || !open && !close) {
        text += s.slice(i, i + n);
      } else {
        mark(c, n, open, close);
      }
      i += n;
    } else if ((c === "h" || c === "H" || c === "w" || c === "W") && (i === 0 || /[\s(*_~]/.test(s[i - 1])) && links === 0 && (BARE.lastIndex = i, BARE.test(s))) {
      const k = url_bare(s, i);
      const url = /^www\./i.test(k) ? "http://" + k : k;
      const ok = /^www\./i.test(k) ? /^www\.[A-Za-z0-9_-]/i.test(k) : k.length > BARE.lastIndex - i;
      put(ok ? { $: "Link", x: [Text(k)], k: url, t: "" } : Text(k));
      i += k.length;
    } else if (c === "@" && text !== "" && LOCAL.test(s[i - 1]) && links === 0 && (EMAIL.lastIndex = i + 1, EMAIL.test(s)) && !/[-_]$/.test(s.slice(i + 1, EMAIL.lastIndex))) {
      let at = text.length;
      while (at > 0 && LOCAL.test(text[at - 1])) {
        at--;
      }
      const name = text.slice(at);
      const domain = s.slice(i + 1, EMAIL.lastIndex);
      text = text.slice(0, -name.length);
      put({ $: "Link", x: [Text(name + "@" + domain)], k: "mailto:" + name + "@" + domain, t: "" });
      i = EMAIL.lastIndex;
    } else {
      text += c;
      i++;
    }
  }
  flush();
  emphasis(null);
  return nodes_spans(head.next);
  function emphasis(bottom) {
    const floor = new Map;
    let closer = bottom === null ? marks_first(marks) : bottom.next;
    while (closer !== null) {
      if (closer.c === "[" || closer.c === "![" || !closer.close) {
        closer = closer.next;
        continue;
      }
      const key = closer.c + closer.open + closer.len % 3;
      let opener = closer.prev;
      const low = floor.has(key) ? floor.get(key) ?? null : bottom;
      while (opener !== null && opener !== bottom && opener !== low) {
        const three = opener.c !== "~" && (opener.close || closer.open) && (opener.len + closer.len) % 3 === 0 && (opener.len % 3 !== 0 || closer.len % 3 !== 0);
        if (opener.c === closer.c && opener.open && !three && (opener.c !== "~" || opener.n === closer.n)) {
          break;
        }
        opener = opener.prev;
      }
      if (opener === null || opener === bottom || opener === low) {
        floor.set(key, closer.prev);
        const next = closer.next;
        if (!closer.open) {
          marks = mark_drop(marks, closer);
        }
        closer = next;
        continue;
      }
      const c = closer.c;
      const use = c === "~" ? closer.n : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      [opener.n, closer.n] = [opener.n - use, closer.n - use];
      opener.node.x = Text(c.repeat(opener.n));
      closer.node.x = Text(c.repeat(closer.n));
      const inner = nodes_spans(opener.node.next === closer.node ? null : opener.node.next, closer.node);
      const x = use === 2 && c !== "~" ? inner.flatMap((y) => y.$ === "Bold" ? y.x : [y]) : inner;
      const made = { x: c === "~" ? { $: "Strk", x } : use === 2 ? { $: "Bold", x } : { $: "Ital", x }, m: null, prev: opener.node, next: closer.node };
      opener.node.next = made;
      closer.node.prev = made;
      for (let m = opener.next;m !== closer && m !== null; ) {
        const next = m.next;
        marks = mark_drop(marks, m);
        m = next;
      }
      if (opener.n === 0) {
        node_drop(opener.node);
        marks = mark_drop(marks, opener);
      }
      if (closer.n === 0) {
        const next = closer.next;
        node_drop(closer.node);
        marks = mark_drop(marks, closer);
        closer = next;
      }
    }
    while (marks !== null && marks !== bottom) {
      marks.node.m = null;
      marks = mark_drop(marks, marks);
    }
  }
  function node_drop(node) {
    const prev = node.prev ?? head;
    prev.next = node.next;
    if (node.next !== null) {
      node.next.prev = node.prev;
    } else {
      tail = prev;
    }
  }
}
function mark_drop(marks, m) {
  if (m.prev !== null) {
    m.prev.next = m.next;
  }
  if (m.next !== null) {
    m.next.prev = m.prev;
  }
  const last = marks === m ? m.prev : marks;
  m.prev = m.next = null;
  return last;
}
function marks_first(marks) {
  let m = marks;
  while (m?.prev) {
    m = m.prev;
  }
  return m;
}
function nodes_spans(from, upto = null) {
  const out = [];
  for (let n = from;n !== null && n !== upto; n = n.next) {
    spans_push(out, n.x);
  }
  return out;
}
function link_ref(s, i, from) {
  if (DEFS.size === 0) {
    return null;
  }
  const full = s[i] === "[" ? /^\[((?:[^\[\]\\]|\\.){0,999})\]/.exec(s.slice(i, i + 2000)) : null;
  if ((full === null || full[1] === "") && i - 1 - from > 999) {
    return null;
  }
  const def = DEFS.get(def_label(full === null || full[1] === "" ? s.slice(from, i - 1) : full[1]));
  return def === undefined ? null : { ...def, end: i + (full?.[0].length ?? 0) };
}
function def_label(s) {
  return s.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}
function entity(s) {
  const num = /^&#([xX]?)([0-9a-fA-F]+);$/.exec(s);
  if (num !== null) {
    const n = parseInt(num[2], num[1] === "" ? 10 : 16);
    return String.fromCodePoint(n === 0 || n > 1114111 || n >= 55296 && n <= 57343 ? 65533 : n);
  }
  return ENTITIES.get(s.slice(1, -1)) ?? null;
}
function url_of(k) {
  return text_unescape(k).replace(/ /g, "%20");
}
function text_unescape(s) {
  return s.replace(/\\([!-/:-@[-`{-~])|&#?[0-9A-Za-z]{1,32};/g, (m, esc) => esc ?? entity(m) ?? m);
}
function spans_push(spans, span) {
  const last = spans[spans.length - 1];
  if (span.$ === "Text" && last?.$ === "Text") {
    spans[spans.length - 1] = Text(last.x + span.x);
  } else if (span.$ !== "Text" || span.x !== "") {
    spans.push(span);
  }
}
function spans_text(spans) {
  return spans.map((x) => x.$ === "Brk" ? " " : x.$ === "Name" ? "[" + x.x + "]" : typeof x.x === "string" ? x.x : spans_text(x.x)).join("");
}
function run_len(s, i, c) {
  let j = i;
  while (s[j] === c) {
    j++;
  }
  return j - i;
}
function ticks_at(s) {
  const runs = new Map;
  for (let i = s.indexOf("`");i >= 0; i = s.indexOf("`", i)) {
    const n = run_len(s, i, "`");
    const at = runs.get(n) ?? [];
    runs.set(n, at);
    at.push(i);
    i += n;
  }
  const seen = new Map;
  return (from, n) => {
    const list = runs.get(n) ?? [];
    let k = seen.get(n) ?? 0;
    while (k < list.length && list[k] < from) {
      k++;
    }
    seen.set(n, k);
    return k < list.length ? list[k] : -1;
  };
}
function flanks(s, i, n, c) {
  const before = s[i - 1] ?? " ";
  const after = s[i + n] ?? " ";
  const space = (x) => /\s/.test(x);
  const left = !space(after) && (!PUNCT.test(after) || space(before) || PUNCT.test(before));
  const right = !space(before) && (!PUNCT.test(before) || space(after) || PUNCT.test(after));
  return c === "_" ? [left && (!right || PUNCT.test(before)), right && (!left || PUNCT.test(after))] : [left, right];
}
function link_tail(s, i, unshut) {
  if (s[i] !== "(") {
    return null;
  }
  let j = i + 1;
  const skip = () => {
    while (s[j] === " " || s[j] === "\t" || s[j] === `
`) {
      j++;
    }
  };
  skip();
  let k = "";
  if (s[j] === "<") {
    let e = j + 1;
    for (;e < s.length && s[e] !== ">" && s[e] !== "<" && s[e] !== `
`; e++) {
      e += s[e] === "\\" ? 1 : 0;
    }
    if (s[e] !== ">") {
      return null;
    }
    [k, j] = [s.slice(j + 1, e), e + 1];
  } else {
    let depth = 0;
    const from = j;
    for (;j < s.length && !/[\s\x00-\x1f]/.test(s[j]); j++) {
      if (s[j] === "\\" && j + 1 < s.length) {
        j++;
      } else if (s[j] === "(" && ++depth > LINK_PARENS_MAX) {
        return null;
      } else if (s[j] === ")" && depth-- === 0) {
        break;
      }
    }
    if (depth > 0) {
      return null;
    }
    k = s.slice(from, j);
  }
  const gap = j;
  skip();
  let t = "";
  const q = s[j] === '"' || s[j] === "'" ? s[j] : s[j] === "(" ? ")" : null;
  if (q !== null && j > gap) {
    const end = title_end(s, j + 1, q, unshut);
    if (end < 0) {
      return null;
    }
    [t, j] = [s.slice(j + 1, end), end + 1];
    skip();
  }
  if (s[j] !== ")") {
    return null;
  }
  return { k: url_of(k), t: text_unescape(t), end: j + 1 };
}
function title_end(s, j, q, unshut) {
  if (j >= (unshut.get(q) ?? Infinity)) {
    return -1;
  }
  for (let e = j;e < s.length; e++) {
    if (s[e] === "\\") {
      e++;
    } else if (s[e] === q) {
      return e;
    } else if (q === ")" && s[e] === "(") {
      return -1;
    }
  }
  unshut.set(q, j);
  return -1;
}
function link_safe(k) {
  return /^(?:https?:\/\/|mailto:)[^\s\x00-\x1f]*$/i.test(k) || /^\/(?![\/\\])[^\s\x00-\x1f]*$/.test(k) || k === "/";
}
function url_bare(s, i) {
  let [j, open, shut] = [i, 0, 0];
  for (;j < s.length && !/[\s<\x00-\x1f\x7f]/.test(s[j]); j++) {
    open += s[j] === "(" ? 1 : 0;
    shut += s[j] === ")" ? 1 : 0;
  }
  while (j > i) {
    const amp = s[j - 1] === ";" ? entity_back(s, i, j - 1) : -1;
    if (amp >= 0) {
      j = amp;
    } else if (`?!.,:*_~'";`.includes(s[j - 1])) {
      j--;
    } else if (s[j - 1] === ")" && shut > open) {
      [j, shut] = [j - 1, shut - 1];
    } else {
      break;
    }
  }
  return s.slice(i, j);
}
function entity_back(s, i, semi) {
  let k = semi;
  while (k > i && /[A-Za-z0-9]/.test(s[k - 1])) {
    k--;
  }
  return k < semi && k > i && s[k - 1] === "&" ? k - 1 : -1;
}
function md_flat(s) {
  return spans_text(span_parse(s));
}
function md_plain(s) {
  const paras = s.replace(/\r/g, "").split(/\n(?:[ \t]*\n)+/);
  const kept = paras.filter((p) => p.trim() !== "");
  return kept.map((p) => ({ $: "Para", x: p.split(`
`).flatMap((l, k) => [...k === 0 ? [] : [{ $: "Brk" }], ...plain_line(l)]) }));
}
function plain_line(s) {
  const out = [];
  let at = 0;
  for (const [from, to, x, k] of md_pasted(s)) {
    out.push(...spans_by(s.slice(at, from), NAME2, (m) => Name(m[1])), { $: "Pict", x, k, t: "" });
    at = to;
  }
  return [...out, ...spans_by(s.slice(at), NAME2, (m) => Name(m[1]))];
}
function md_pasted(s) {
  const out = [];
  for (let k = s.indexOf("](/media/");k >= 0; k = s.indexOf("](/media/", k + 1)) {
    MEDIA_URL.lastIndex = k + 2;
    const url = MEDIA_URL.exec(s);
    const a = label_open(s, k);
    const bang = s[a - 1] === "!";
    const from = bang ? a - 1 : a;
    const file = url !== null && !MEDIA.has(url[0].slice(url[0].lastIndexOf(".") + 1));
    if (url !== null && s[a] === "[" && (bang || file) && from >= (out.at(-1)?.[1] ?? 0)) {
      out.push([from, MEDIA_URL.lastIndex + 1, s.slice(a + 1, k), url[0]]);
    }
  }
  return out;
}
function md_output(s, name = "result") {
  const lines = s.replace(/\r/g, "").split(`
`);
  const read = READ.exec(lines[lines.length - 1]);
  if (read !== null) {
    return [{ $: "File", k: name === "result" ? read[1] : name + " · " + read[1], n: Number(read[2]), x: lines.slice(0, -1) }];
  }
  const out = [];
  let [i, at] = [0, 0];
  while (i < lines.length) {
    const [diff, next] = diff_parse(lines, i);
    if (diff !== null) {
      out.push(...output_lines(lines.slice(at, i), name), diff);
      at = next;
    }
    i = next;
  }
  return [...out, ...output_lines(lines.slice(at), name)];
}
function label_open(s, close) {
  let a = close - 1;
  while (a >= 0 && close - a <= LABEL_SCAN_MAX && s[a] !== "[" && s[a] !== "]" && s[a] !== `
`) {
    a--;
  }
  return a;
}
function md_shown(s, name = "result") {
  const out = [];
  const failed = s.startsWith(FAILED);
  let error_owed = failed;
  let rest = [];
  const said = () => {
    out.push(...md_output(rest.join(`
`), name));
    rest = [];
  };
  for (const line of s.slice(failed ? FAILED.length : 0).replace(/\r/g, "").split(`
`)) {
    const media = md_pasted(line);
    if (media.length === 1 && media[0][0] === 0 && media[0][1] === line.length) {
      said();
      out.push({ $: "Para", x: [{ $: "Pict", x: media[0][2], k: media[0][3], t: "" }] });
    } else {
      rest.push(error_owed ? FAILED + line : line);
      error_owed = false;
    }
  }
  rest.push(...error_owed ? [FAILED.trim()] : []);
  said();
  return out;
}
function output_lines(lines, name) {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: name, n: 1, x: lines.slice(from, upto + 1) }];
}
function diff_parse(lines, i) {
  const file = NEW.exec(lines[i + 1] ?? "");
  const hunks = [];
  if (file === null || !lines[i].startsWith("--- ")) {
    return [null, i + 1];
  }
  let j = i + 2;
  for (let h = HUNK.exec(lines[j] ?? "");h !== null; h = HUNK.exec(lines[j] ?? "")) {
    const [hunk, next] = hunk_parse(lines, j + 1, h);
    if (hunk === null) {
      return [null, i + 1];
    }
    hunks.push(hunk);
    j = next;
  }
  return hunks.length === 0 ? [null, i + 1] : [{ $: "Diff", k: file[1], x: hunks }, j];
}
function hunk_parse(lines, j, h) {
  let [olds, news] = [Number(h[2] ?? 1), Number(h[4] ?? 1)];
  let [o, n] = [Number(h[1]), Number(h[3])];
  const out = [];
  for (;olds > 0 || news > 0; j++) {
    const s = lines[j]?.[0];
    const x = lines[j]?.slice(1) ?? "";
    if (s === " " && olds > 0 && news > 0) {
      out.push({ s, n: n++, x });
      [o, olds, news] = [o + 1, olds - 1, news - 1];
    } else if (s === "-" && olds > 0) {
      out.push({ s, n: o++, x });
      olds--;
    } else if (s === "+" && news > 0) {
      out.push({ s, n: n++, x });
      news--;
    } else if (s !== "\\") {
      return [null, j];
    }
  }
  return [out, j];
}
function md_parse(src) {
  const lines = src.replace(/\r/g, "").split(`
`);
  try {
    COLLECT = src.includes("]:");
    if (COLLECT) {
      blocks_parse(lines, 0);
      COLLECT = false;
    }
    return blocks_parse(lines, 0)[0];
  } finally {
    COLLECT = false;
    DEFS = new Map;
    UNSHUT = { lines: [], from: new Map };
  }
}
function def_at(lines, i) {
  const first = indent(lines[i]);
  if (first > 3 || lines[i][first] !== "[") {
    return null;
  }
  let [r, c] = [i, first + 1];
  const ch = () => c < lines[r].length ? lines[r][c] : `
`;
  const down = () => r + 1 < lines.length && lines[r + 1].trim() !== "" && ([r, c] = [r + 1, 0], true);
  const blanks = () => {
    while (ch() === " " || ch() === "\t") {
      c++;
    }
  };
  let label = "";
  for (let x = ch();x !== "]"; x = ch()) {
    if (x === "[" || label.length > 999 || x === `
` && !down()) {
      return null;
    }
    label += x === "\\" && c + 1 < lines[r].length ? x + lines[r][++c] : x;
    c += x === `
` ? 0 : 1;
  }
  c++;
  if (ch() !== ":" || label.trim() === "" || label.length > 999) {
    return null;
  }
  c++;
  blanks();
  if (ch() === `
` && down()) {
    blanks();
  }
  let k = "";
  const from = c;
  if (ch() === "<") {
    for (c++;ch() !== ">"; c++) {
      if (ch() === "<" || ch() === `
`) {
        return null;
      }
      c += ch() === "\\" ? 1 : 0;
    }
    k = lines[r].slice(from + 1, c++);
  } else {
    let depth = 0;
    for (;!/[\s\x00-\x1f]/.test(ch()) && !(ch() === ")" && depth === 0); c++) {
      depth += ch() === "(" ? 1 : ch() === ")" ? -1 : 0;
      c += ch() === "\\" && c + 1 < lines[r].length ? 1 : 0;
    }
    k = lines[r].slice(from, c);
    if (k === "" || depth !== 0 || ch() === ")") {
      return null;
    }
  }
  const def = { label, k: url_of(k), t: "", next: r + 1 };
  const bare = lines[r].slice(c).trim() === "";
  const at = c;
  blanks();
  const moved = ch() === `
` && down();
  blanks();
  const q = ch() === '"' || ch() === "'" ? ch() : ch() === "(" ? ")" : null;
  if (q === null || !moved && c === at) {
    return bare ? def : null;
  }
  const end = title_end_lines(lines, r, c + 1, q);
  if (end === null || lines[end[0]].slice(end[1] + 1).trim() !== "") {
    return bare ? def : null;
  }
  const t = end[0] === r ? lines[r].slice(c + 1, end[1]) : [lines[r].slice(c + 1), ...lines.slice(r + 1, end[0]), lines[end[0]].slice(0, end[1])].join(`
`);
  return { ...def, t: text_unescape(t), next: end[0] + 1 };
}
function title_end_lines(lines, r, c, q) {
  if (UNSHUT.lines !== lines) {
    UNSHUT = { lines, from: new Map };
  }
  const [after, upto] = UNSHUT.from.get(q) ?? [Infinity, 0];
  if (r > after && r < upto) {
    return null;
  }
  let j = r;
  for (;j < lines.length && (j === r || lines[j].trim() !== ""); j++) {
    const l = lines[j];
    for (let e = j === r ? c : 0;e < l.length; e++) {
      if (l[e] === "\\") {
        e++;
      } else if (l[e] === q) {
        return [j, e];
      } else if (q === ")" && l[e] === "(") {
        return null;
      }
    }
  }
  UNSHUT.from.set(q, [r, j]);
  return null;
}
function blocks_parse(lines, d) {
  const out = [];
  let [i, gap, apart] = [0, false, false];
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i, d);
    if (block === undefined) {} else if (block === null) {
      gap = out.length > 0;
    } else {
      [apart, gap] = [apart || gap, false];
      out.push(block);
    }
    i = next;
  }
  return [out, apart];
}
function block_parse(lines, i, d) {
  const line = lines[i];
  const head = HEAD.exec(line);
  const runs = (test) => lines_run(lines, i, test);
  if (line.trim() === "") {
    return [null, i + 1];
  }
  const fence = fence_open(line);
  if (fence !== null) {
    const end = runs((l) => !fence_shuts(l, fence));
    const k = line.trim().slice(fence.length).trim();
    const pad = indent(line);
    const x = lines.slice(i + 1, end).map((l) => l.slice(Math.min(pad, indent(l)))).join(`
`);
    return [{ $: "Code", k, x }, end + 1];
  }
  if (head !== null) {
    const x = span_parse(head_text(head[2] ?? ""));
    return [{ $: "Head", k: head[1].length, x }, i + 1];
  }
  if (is_rule(line)) {
    return [{ $: "Rule" }, i + 1];
  }
  if (QUOT.test(line) && d < NESTING_MAX) {
    let [para, fenced] = item_line(line.replace(QUOT, ""), false);
    const end = runs((l, j) => {
      const lazy = !QUOT.test(l) && para && l.trim() !== "" && !block_starts(lines, j);
      if (QUOT.test(l)) {
        [para, fenced] = item_line(l.replace(QUOT, ""), fenced);
      }
      return QUOT.test(l) || lazy;
    });
    const body = lines.slice(i, end).map((l) => l.replace(QUOT, ""));
    return [{ $: "Quot", x: blocks_parse(body, d + 1)[0] }, end];
  }
  if (list_kind(line) !== null && d < NESTING_MAX) {
    return list_parse(lines, i, d);
  }
  const a = table_head(lines, i);
  if (a !== null) {
    const end = lines_run(lines, i + 1, (l, j) => l.trim() !== "" && !block_starts(lines, j));
    const rows = [line, ...lines.slice(i + 2, end)].map((l) => row_cells(l, a.length));
    return [{ $: "Tabl", x: rows, a }, end];
  }
  if (indent(untab(line)) >= 4) {
    const end = runs((l) => l.trim() === "" || indent(untab(l)) >= 4);
    const body = lines.slice(i, end).map((l) => untab(l).slice(4));
    while (body[body.length - 1].trim() === "") {
      body.pop();
    }
    return [{ $: "Code", k: "", x: body.join(`
`) }, end];
  }
  const def = def_at(lines, i);
  if (def !== null) {
    const label = def_label(def.label);
    DEFS.set(label, DEFS.get(label) ?? { k: def.k, t: def.t });
    return [undefined, def.next];
  }
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j) && !SETEXT.test(l));
  const x = span_parse(lines.slice(i, end).join(`
`).trim());
  const under = SETEXT.exec(lines[end] ?? "");
  return under === null ? [{ $: "Para", x }, end] : [{ $: "Head", k: under[1][0] === "=" ? 1 : 2, x }, end + 1];
}
function fence_open(line) {
  const m = FENCE.exec(line);
  return m === null || m[1][0] === "`" && line.slice(line.indexOf(m[1]) + m[1].length).includes("`") ? null : m[1];
}
function fence_shuts(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length;
}
function table_head(lines, i) {
  const [head, bar] = [lines[i], lines[i + 1] ?? ""];
  const cells = cells_split(bar);
  const ok = bar.includes("-") && cells.every((x) => CELL.test(x)) && PIPE.test(head) && (bar.includes("|") || ROW.test(head)) && cells.length === cells_split(head).length;
  return !ok ? null : cells.map((c) => {
    const [l, r] = [c.trim().startsWith(":"), c.trim().endsWith(":")];
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
}
function head_text(x) {
  const t = x.trimEnd();
  let k = t.length;
  while (k > 0 && t[k - 1] === "#") {
    k--;
  }
  return k === 0 ? "" : t[k - 1] === " " || t[k - 1] === "\t" ? t.slice(0, k).trimEnd() : t;
}
function is_rule(l) {
  if (indent(l) > 3) {
    return false;
  }
  let [mark, n] = ["", 0];
  for (const x of l) {
    if (x === " " || x === "\t") {
      continue;
    }
    mark ||= "-*_".includes(x) ? x : "";
    if (x !== mark) {
      return false;
    }
    n++;
  }
  return n >= 3;
}
function list_parse(lines, i, d) {
  const kind = list_kind(lines[i]);
  const items = [];
  const boxes = [];
  let [end, w, blank, open, para, fenced, loose] = [i, 0, 0, true, false, false, false];
  for (let j = i;j < lines.length; j++) {
    const l = untab(lines[j]);
    const at = indent(l);
    if (at === l.length) {
      [blank, para] = [blank + 1, false];
      continue;
    }
    if (list_kind(l) === kind && (items.length === 0 || at < w)) {
      const mark = LIST2.exec(l)?.[0] ?? "";
      const rest = l.slice(mark.length);
      const pad = indent(rest);
      w = mark.length + (rest.trim() === "" || pad > 4 ? 1 : pad);
      open = rest.trim() !== "" || (lines[j + 1] ?? "").trim() !== "";
      loose = loose || blank > 0 && items.length > 0;
      const task = TASK.exec(l.slice(w));
      boxes.push(task === null ? null : task[1] !== " ");
      items.push([l.slice(w + (task?.[0].length ?? 0))]);
      [para, fenced] = item_line(l.slice(w), false);
    } else if (open && at >= w) {
      for (;blank > 0; blank--) {
        items[items.length - 1].push("");
      }
      items[items.length - 1].push(l.slice(w));
      [para, fenced] = item_line(l.slice(w), fenced);
    } else if (open && para && blank === 0 && !LIST2.test(l) && !block_starts(lines, j)) {
      items[items.length - 1].push(l.trimStart());
    } else {
      break;
    }
    [blank, end] = [0, j + 1];
  }
  const first = LIST2.exec(lines[i])?.[1] ?? "";
  const k = /\d/.test(first);
  const parts = items.map((x) => blocks_parse(x, d + 1));
  const t = !loose && !parts.some((p) => p[1]);
  return [{ $: "List", k, n: k ? Number(first.slice(0, -1)) : 1, t, x: parts.map((p) => p[0]), c: boxes }, end];
}
function item_line(s, fenced) {
  const x = is_rule(s) ? "" : s.replace(MARKS, "");
  if (FENCE.test(x)) {
    return [false, !fenced];
  }
  return [!fenced && x.trim() !== "" && !HEAD.test(x) && !is_rule(x) && !ROW.test(x), fenced];
}
function untab(l) {
  return l.replace(/^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/, (pre) => {
    let out = "";
    for (const c of pre) {
      out += c === "\t" ? " ".repeat(4 - out.length % 4) : c;
    }
    return out;
  });
}
function indent(l) {
  return l.search(/\S|$/);
}
function lines_run(lines, i, test) {
  let j = i + 1;
  while (j < lines.length && test(lines[j], j)) {
    j++;
  }
  return j;
}
function block_starts(lines, j) {
  const l = lines[j];
  const m = LIST2.exec(l);
  const item = m !== null && l.slice(m[0].length).trim() !== "" && (!/\d/.test(m[1]) || Number(m[1].slice(0, -1)) === 1);
  return fence_open(l) !== null || HEAD.test(l) || is_rule(l) || QUOT.test(l) || item || table_head(lines, j) !== null;
}
function list_kind(l) {
  const m = LIST2.exec(l);
  return m === null || is_rule(l) ? null : m[1].slice(-1);
}
function row_cells(line, n) {
  const cells = cells_split(line);
  const all = Array.from({ length: n }, (_, k) => cells[k] ?? "");
  return all.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}
function cells_split(line) {
  return line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/);
}

// Pick.ts
var VENDORS = ["claude-api", "openai-api", "openai-sub", "claude-sub"];
var OPUS = { label: "opus-5.5", id: "claude-opus-5-5", speeds: ["slow", "fast"], window: 1e6 };
var SONNET = { label: "sonnet-5.5", id: "claude-sonnet-5-5", speeds: ["slow"], window: 1e6 };
var HAIKU = { label: "haiku-5.5", id: "claude-haiku-5-5", speeds: ["slow"], window: 1e6 };
var OPENAI = [
  { label: "gpt-6-luna", id: "gpt-6-luna", speeds: ["slow", "fast"], window: 272000 },
  { label: "gpt-6.1-sol", id: "gpt-6.1-sol", speeds: ["slow", "fast"], window: 500000 },
  { label: "gpt-6-astra", id: "gpt-6-astra", speeds: ["slow", "fast", "ultrafast"], window: 272000 }
];
var PLAN = OPENAI.map((m) => ({ ...m, speeds: m.speeds.filter((s) => s !== "ultrafast") }));
var MODELS = {
  "claude-api": [OPUS, SONNET, HAIKU],
  "openai-api": OPENAI,
  "openai-sub": PLAN,
  "claude-sub": [{ ...OPUS, speeds: ["slow"] }, SONNET, HAIKU]
};
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var SPEEDS = ["slow", "fast", "ultrafast"];
var LABELS = [...new Set(Object.values(MODELS).flat().map((m) => m.label))];
var Pick;
((Pick2) => {
  function model(vendor, label) {
    return MODELS[vendor].find((m) => m.label === label);
  }
  Pick2.model = model;
  function on(pick, vendor, model) {
    const below = SPEEDS.slice(0, SPEEDS.indexOf(pick.speed) + 1);
    const speed = below.filter((s) => model.speeds.includes(s)).pop() ?? "slow";
    return { ...pick, vendor, model: model.label, speed };
  }
  Pick2.on = on;
  function models(vendors, labels) {
    return vendors.flatMap((v) => MODELS[v].filter((m) => labels.includes(m.label)).map((m) => [v, m]));
  }
  Pick2.models = models;
  function options(pick, move, offer) {
    const speeds = Pick.model(pick.vendor, pick.model)?.speeds ?? [];
    const { profile: _, ...plain } = pick;
    const all = Pick.models(offer.vendors, offer.models).map(([v, m]) => [m.label, Pick.on(plain, v, m)]);
    const profiles = Object.keys(offer.profiles ?? {}).flatMap((name) => {
      const on = Pick.profile(name, offer, pick.effort, pick.speed);
      return on === null ? [] : [[name, on]];
    });
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
  Pick2.options = options;
  function move(pick, move, offer, to) {
    const list = Pick.options(pick, move, offer);
    const n = list.length;
    const at = list.findIndex(([, p]) => Pick.label(p) === Pick.label(pick) && p.profile === pick.profile);
    const d = move === "prev" || move === "down" ? -1 : 1;
    const ends = move === "up" || move === "down";
    const next = ends ? Math.max(0, Math.min(n - 1, at + d)) : (at + d + n) % n;
    const mine = ([, p]) => p.profile === undefined && p.vendor === pick.vendor;
    const same = list.filter(([part, p]) => part === to || p.profile === undefined && p.vendor + ":" + part === to);
    const like = list.filter(([part]) => part.toLowerCase().includes(String(to).toLowerCase()));
    const one = like.length === 1 ? like[0] : like.filter(mine).length === 1 ? like.find(mine) : undefined;
    const hit = to === undefined ? list[next] : same.find(mine) ?? same[0] ?? one;
    return hit === undefined ? null : hit[1];
  }
  Pick2.move = move;
  function to_model(pick, label, vendors, { models }) {
    const all = Pick.models(vendors, models).filter(([, m]) => m.label === label);
    const hit = all.find(([v]) => v === pick.vendor) ?? all[0];
    return hit === undefined ? null : Pick.on(pick, hit[0], hit[1]);
  }
  Pick2.to_model = to_model;
  function twin(vendor, label, vendors) {
    return vendors.some((v) => v !== vendor && Pick.model(v, label) !== undefined);
  }
  Pick2.twin = twin;
  function label(pick) {
    return [pick.vendor, pick.model, pick.effort, pick.speed].join(":");
  }
  Pick2.label = label;
  function ask(pick) {
    const model = Pick.model(pick.vendor, pick.model);
    return { ...pick, model: model?.id ?? pick.model };
  }
  Pick2.ask = ask;
  function named(run) {
    const model = MODELS[run.vendor].find((m) => m.id === run.model);
    return { ...run, model: model?.label ?? run.model };
  }
  Pick2.named = named;
  function falls(run, falls) {
    const own = { vendor: run.vendor, model: run.model, effort: run.effort, speed: run.speed };
    const list = falls.map((f) => {
      const on = Pick.on(own, f.vendor, f.model);
      return Pick.ask({ ...on, effort: f.effort ?? on.effort, speed: f.speed ?? on.speed });
    });
    return [own, ...list].filter((p, k, all) => all.findIndex((q) => q.vendor === p.vendor && q.model === p.model) === k);
  }
  Pick2.falls = falls;
  function profile(name, offer, effort, speed) {
    const profiles = offer.profiles ?? {};
    const first = Object.hasOwn(profiles, name) ? profiles[name][0] : undefined;
    if (first === undefined) {
      return null;
    }
    const on = Pick.on({ vendor: first.vendor, model: first.model.label, effort, speed }, first.vendor, first.model);
    return { ...on, effort: first.effort ?? effort, speed: first.speed ?? on.speed, profile: name };
  }
  Pick2.profile = profile;
  function read(x, offer) {
    const [profile, effort, speed, label] = [get(x, "profile"), get(x, "effort"), get(x, "speed"), get(x, "model")];
    if (profile !== undefined) {
      return typeof profile === "string" && typeof effort === "string" && EFFORTS.includes(effort) ? Pick.profile(profile, offer, effort, String(speed)) : null;
    }
    const vendor = offer.vendors.find((v) => v === get(x, "vendor"));
    if (vendor === undefined || typeof label !== "string" || !offer.models.includes(label)) {
      return null;
    }
    const model = Pick.model(vendor, label);
    if (model === undefined || typeof effort !== "string" || !EFFORTS.includes(effort) || typeof speed !== "string" || !model.speeds.includes(speed)) {
      return null;
    }
    return { vendor, model: label, effort, speed };
  }
  Pick2.read = read;
  function window2(pick, offer) {
    const falls = pick.profile === undefined ? [] : offer.profiles?.[pick.profile] ?? [];
    const models = [Pick.model(pick.vendor, pick.model), ...falls.map((f) => f.model)];
    return Math.min(...models.map((m) => m?.window ?? 272000));
  }
  Pick2.window = window2;
  function load(saved, offer, def) {
    return Pick.read(saved ?? def, offer) ?? def;
  }
  Pick2.load = load;
})(Pick ||= {});

// View.ts
var PACE = 0.0001;
var OPENING = 1;
var SUMMARIES = "summaries";
var MAIN = "UniiChat";
var TURN = "Unii's turn";
var WIRE = 3;
var PING = 1e4;
var RETRY = 1000;
var TICK = "+";
var ACTIVE = "active";
var IDLE = "idle";
var USE_PING = 20000;
var FRAME = 2 ** 22;
var HINT = "Message UniiChat";
var AI = "Unii is an AI, not a person, and can make mistakes.";
var NOTICE = 3 * 60 * 60 * 1000;
var WAIT = "compressing…";
var SUMS = "compressing earlier messages…";
var UNSENT = "Sends once connected.";
var MEDIA2 = MEDIA;
var MEDIA_AS2 = MEDIA_AS;
var STORED = /^[0-9a-f]{16}\.([a-z0-9]{1,10})$/;
function media_kind(url) {
  const m = /^\/(?:media|image)\/[0-9a-f]{16}\.([a-z0-9]{1,10})$/.exec(url);
  return m === null ? null : ext_kind(m[1]);
}
function ext_kind(ext) {
  const type = MEDIA2.get(ext);
  return type === undefined ? null : type === "text/html" ? "html" : type.split("/")[0];
}
function store_file(url) {
  return url.startsWith("/media/") && STORED.test(url.slice("/media/".length)) && media_kind(url) === null;
}
function media_ext(file) {
  const dot = file.lastIndexOf(".");
  const ext = dot < 0 ? "" : file.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return MEDIA_AS2.get(ext) ?? ext;
}
function size_show(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  const k = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024))));
  const n = bytes / 1024 ** k;
  return (k === 0 ? String(bytes) : n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + units[k];
}
var IMAGE = 2 ** 20;
var PIXELS = 2 ** 28;
var TOOL2 = "tool: ";
var FOLD = "The whole chat, folded into the fewest blocks.";
function Cap(text) {
  return { $: "Cap", text };
}
var TOKEN = 3;
function talk_tokens(talk) {
  const k = (bytes) => Math.round(bytes / TOKEN / 1000) + "K";
  return "about " + k(talk.size) + " of " + k(talk.room) + " tokens";
}
function view_new() {
  return {
    busy: false,
    wait: "",
    agents: [],
    runs: {},
    pick: null,
    vendors: [],
    models: LABELS,
    importing: null,
    limits: {},
    queue: {},
    sums: null,
    again: null,
    timers: [],
    mcp: [],
    talk: null,
    parts: [],
    turn: Infinity,
    fold: null,
    nodes: new Map,
    whole: new Map,
    open: new Map,
    live: [],
    minds: new Map,
    pages: new Map,
    page: null,
    notes: [],
    tab: uuid(),
    out: [],
    ws: null,
    up: false,
    flush: () => {}
  };
}
function view_hear(v, msg) {
  switch (msg.$) {
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn = msg.turn;
      return v.fold === null ? [] : [{ $: "root" }];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "root": {
      v.fold = v.fold === null ? null : msg.parts;
      return [];
    }
    case "entry": {
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state);
      for (const page of v.pages.values()) {
        page.pick = v.runs[page.name] ?? page.pick;
      }
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      if (msg.found) {
        page.log = [];
        page.pick = msg.pick ?? page.pick;
        return [];
      }
      v.pages.delete(msg.name);
      if (v.page === page) {
        v.page = null;
      }
      v.notes.push("No agent " + msg.name + ".");
      return [];
    }
    case "note": {
      v.notes.push(msg.text);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      return [];
    }
    default: {
      return [];
    }
  }
}
function view_act(v, act) {
  switch (act.$) {
    case "Send": {
      const text = act.text.trim();
      const images = act.images ?? [];
      const word = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const goal = word === "/goal" ? text.slice(word.length).trim() : null;
      if (!view_typing(v)) {
        return [];
      }
      if (text === "" && images.length === 0) {
        return v.busy ? [{ $: "stop", name: TURN }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null) {
        v.notes.push(word + " is no command; nothing was sent. The terminal's /help lists its commands; the site's are in its ☰ menu.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      v.fold = null;
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
      const from = v.out.flatMap((p) => p.msg.$ === "pick" ? [p.msg.to] : []).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + [act.move, act.to].join(" ").trim() + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Fold": {
      v.open.clear();
      v.fold = act.on ? [] : null;
      return act.on ? [{ $: "root" }] : [];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [], pick: v.runs[act.name] ?? null };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Talk": {
      return [{ $: "talk", on: act.on }];
    }
    case "Plug": {
      const asked = v.out.flatMap((p) => p.msg.$ === "mcp" && p.msg.name === act.name ? [p.msg.on] : []).at(-1);
      const on = asked ?? v.mcp.find((p) => p.name === act.name)?.on;
      if (on === undefined) {
        const names = v.mcp.map((p) => p.name).join(", ");
        v.notes.push("No MCP server " + act.name + (names === "" ? "; none is set up." : "; one of: " + names + "."));
        return [];
      }
      return [{ $: "mcp", name: act.name, on: !on }];
    }
  }
}
function view_body(v) {
  if (v.page !== null) {
    return page_rows(v, v.page);
  }
  if (v.fold !== null) {
    const tops = v.fold.flatMap(([id, n]) => part_rows(v, id, n, Infinity, false));
    return [Cap(FOLD), ...tops];
  }
  return [Cap(AI), ...view_rows(v, v.parts).flat()];
}
function view_rows(v, parts) {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}
function view_tail(v, live = view_stream(v)) {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const name = v.page === null ? TURN : v.page.name;
  const queued = (v.queue[name] ?? []).flatMap((q) => entry_rows(null, q.kind, q.text).map((row) => row.$ === "Msg" ? { ...row, queued: true } : row));
  const after = [...queued, ...kept, ...load];
  const limit = v.limits[name];
  if (limit !== undefined) {
    return [...rows, Cap(limit_show(limit)), ...after];
  }
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...after];
  }
  return [Cap(v.wait === SUMMARIES ? sums_show(v.sums, v.again) : "waiting for " + v.wait + "…"), ...after];
}
function sums_show(sums, again, now = Date.now()) {
  const head = sums === null ? SUMS : SUMS.replace(/…$/, "") + ": " + sums.done + " of " + sums.total;
  if (again === null) {
    return head;
  }
  const at = new Date(again.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" };
  const when = again.limit ? "at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" }) : "in " + Math.max(1, Math.ceil((again.until - now) / 60000)) + " min";
  const why = again.why.length > 120 ? again.why.slice(0, 120) + "…" : again.why.replace(/\.$/, "");
  return head + " · compactor: " + why + ", asking again " + when;
}
function limit_show(limit, now = Date.now()) {
  const at = new Date(limit.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" };
  return "waiting for the usage limit, " + (limit.known ? "resumes" : "tries again") + " at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" });
}
function view_stream(v) {
  return v.page === null ? v.live : v.page.live;
}
function progress_show(p) {
  const n = (k) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}
function view_tabs(v) {
  const at = v.page === null ? null : v.page.name;
  const names = at === null || v.agents.includes(at) ? v.agents : [...v.agents, at];
  return [null, ...names].map((name) => {
    const here = name === at;
    const text = (here ? GLYPH.here : GLYPH.tab) + " " + (name ?? MAIN);
    return { name, here, text };
  });
}
function view_fold(v) {
  if (v.page !== null) {
    return null;
  }
  return v.fold === null ? "fold all" : "unfold all";
}
function view_typing(v) {
  return v.page === null;
}
function view_pick(v) {
  return v.pick === null ? [] : view_knobs(v, v.pick, true);
}
function view_shown(v) {
  if (v.page === null) {
    return view_pick(v);
  }
  return v.page.pick === null ? [] : view_knobs(v, v.page.pick, false);
}
function view_knobs(v, pick, menus) {
  const { model, effort, speed, profile } = pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  const whose = Pick.twin(pick.vendor, model, v.vendors) ? ", " + pick.vendor : "";
  const choices = (move) => menus ? view_choices(pick, move, v) : [];
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: choices("model") },
    { text: effort, move: "effort", hint: effort + " effort", choices: choices("effort") },
    { text: speed, move: "speed", hint: speed, choices: choices("speed") }
  ];
}
function view_choices(pick, move, v) {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}
function view_learn(v, pack) {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}
function view_entry(v, msg) {
  const { $, agent, id, ...entry } = msg;
  const last = v.parts[v.parts.length - 1];
  if (agent !== undefined) {
    const log = v.pages.get(agent)?.log;
    if (Array.isArray(log)) {
      log.push(entry);
    }
  } else if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...v.minds.get(at) ?? [], msg.text]);
  }
}
function view_live(v, agent) {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}
function link_open(v, link) {
  const ws = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - heard > PING) {
      drop();
    }
  }, PING / 2);
  async function drop() {
    const up = v.up;
    ws.onmessage = null;
    ws.onclose = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
    if (await link.lost(up)) {
      setTimeout(() => link_open(v, link), RETRY);
    }
  }
  function flush() {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        upload(post, post.msg);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post, msg) {
    const { body, ...rest } = msg;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data));
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.pages.clear();
    }
    link.hear(msg);
    if (join) {
      view_act(v, { $: "Goto", name: v.page?.name ?? null }).forEach((out) => link_send(v, out));
      flush();
    }
  };
  ws.onclose = () => void drop();
}
function link_send(v, msg, done = (a) => link_note(v, a), said = "") {
  v.out.push({ msg: { id: uuid(), ...msg }, ws: null, done, said });
  v.flush();
}
function uuid() {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b, k) => (k === 6 ? b & 15 | 64 : k === 8 ? b & 63 | 128 : b).toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
function link_note(v, a) {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}
async function post(url, body, auth = {}) {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => res.ok ? {} : { error: "HTTP " + res.status });
  return { ...rec(out) ? out : {}, ok: res?.ok === true, status: res?.status ?? 0 };
}
function part_due(v, part, before) {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}
function part_window(v, [id, n]) {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}
function part_rows(v, id, n, t, talk) {
  const key = id + "+" + n;
  const entry = v.whole.get(id);
  const half = n / 2;
  if (n === 1 && id >= t && entry !== undefined) {
    const minds = v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...whole_rows(id, entry, v.whole.get(id - 1)), ...after];
  }
  const open = talk && n === 1 && ["user", "unii"].includes(entry?.kind ?? "");
  if (!(v.open.get(key) ?? open)) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const text = n === 1 ? "fold" : GLYPH.open + " " + n + "x · fold";
  if (n > 1) {
    const rows = [...part_rows(v, id, half, t, talk), ...part_rows(v, id + half, half, t, talk)];
    return [{ $: "Box", id, n, text, rows }];
  }
  const rows = entry === undefined ? [] : whole_rows(id, entry, v.whole.get(id - 1));
  return [{ $: "Box", id, n, text, rows }];
}
var ROWS = new WeakMap;
var APART = new WeakMap;
function whole_rows(id, entry, before) {
  const of = entry_of(entry, before);
  const made = of.apart ? APART : ROWS;
  const rows = made.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images, of);
  made.set(entry, rows);
  return rows;
}
function sum_rows(id, n, node = { text: WAIT, to: "" }) {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}
function page_rows(v, page, from = 0) {
  const head = Cap(page.name + (v.agents.includes(page.name) ? " · at work" : " · done"));
  const log = page.log ?? [];
  return [head, ...log.slice(from).flatMap((e, k) => whole_rows(null, e, log[from + k - 1]))];
}
function live_push(live, kind, text, fresh = false) {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}
function live_set(live, now) {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => k < held.length ? Object.assign(held[k], l) : l);
  live.splice(0, live.length, ...next);
}
function sum_call(n, text) {
  const call = n === 1 && text.startsWith(TOOL2) ? call_parse(text.slice(TOOL2.length)) : null;
  return call === null || call.name === "" ? null : call;
}
function entry_of(entry, before) {
  return { tool: entry.tool ?? "", apart: entry.kind === "echo" && entry.of !== undefined && before?.of !== entry.of };
}
function entry_rows(id, kind, text, images = [], of = { tool: "", apart: false }) {
  const call = kind === "tool" ? call_parse(text) : null;
  const report = kind === "work" ? report_read(text) : null;
  const label = of.apart ? "↳ " + (of.tool === "" ? "" : tool_name(of.tool) + " ") + "result" : "result";
  const body = call === null ? entry_body(kind, report?.text ?? text, label, of.tool) : [];
  const named = body.some((b) => b.$ === "File" && b.k.startsWith(label));
  const who = report?.name ?? WHO[kind] ?? (kind === "echo" && of.apart && !named ? label : "");
  const pics = images.filter((name) => !text.includes("/media/" + name));
  return call === null && body.length === 0 && pics.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images: pics }];
}
function entry_body(kind, text, label, tool) {
  switch (kind) {
    case "user":
    case "work": {
      return md_plain(text);
    }
    case "echo": {
      return tool_name(tool) === "show" ? md_shown(text, label) : md_output(text, label);
    }
    default: {
      return md_parse(text);
    }
  }
}

// web/src/Dom.ts
function must(x, what) {
  if (x === null || x === undefined) {
    throw new Error("no " + what);
  }
  return x;
}
function find(root, sel, type) {
  const el = root.querySelector(sel);
  if (!(el instanceof type)) {
    throw new Error("no " + sel);
  }
  return el;
}

// web/src/Box.ts
var BOX = document.createElement("div");
var HOOKS = { input: () => {}, files: () => {} };
var LAST = null;
var COMPOSING = false;
var SIDE = 150;
var LEAST = 24;
var BLOCKS = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);
function box_new(el, hooks) {
  BOX = el;
  HOOKS = hooks;
  try {
    el.contentEditable = "plaintext-only";
  } catch {
    el.contentEditable = "true";
  }
  el.addEventListener("beforeinput", (ev) => {
    const t = ev.inputType;
    if (t.startsWith("format") || t.startsWith("insertFromPaste") || t === "insertFromDrop" || t === "insertLink" || t === "insertHorizontalRule" || t.endsWith("List")) {
      ev.preventDefault();
    } else if (t === "insertParagraph" || t === "insertLineBreak") {
      ev.preventDefault();
      box_insert(`
`);
    }
  });
  el.addEventListener("compositionstart", () => COMPOSING = true);
  el.addEventListener("compositionend", () => {
    COMPOSING = false;
    changed();
  });
  el.addEventListener("input", () => COMPOSING ? HOOKS.input() : changed());
  el.addEventListener("keydown", (ev) => {
    if ((ev.key === "Backspace" || ev.key === "Delete") && !ev.isComposing && !ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      const item = beside(ev.key === "Backspace");
      if (item !== null) {
        ev.preventDefault();
        item.remove();
        changed();
      }
    }
  });
  el.addEventListener("paste", (ev) => {
    ev.preventDefault();
    const data = ev.clipboardData;
    if (data === null) {
      return;
    }
    const files = [...data.files];
    const html = data.getData("text/html");
    const pieces = html === "" ? null : html_pieces(html);
    if (pieces !== null && pieces.some((p) => typeof p !== "string")) {
      pieces.forEach((p) => typeof p === "string" ? box_insert(p) : box_put(item_new(p.name, p.url, "ok")));
    } else if (files.length === 0 || data.getData("text/plain").trim() !== "") {
      box_insert(data.getData("text/plain").replace(/\r\n?/g, `
`));
    }
    if (files.length > 0) {
      HOOKS.files(files);
    }
  });
  const copy = (ev, cut) => {
    const sel = getSelection();
    if (sel === null || sel.rangeCount === 0 || sel.isCollapsed || ev.clipboardData === null) {
      return;
    }
    const range = sel.getRangeAt(0);
    const [a, b] = offsets([[range.startContainer, range.startOffset], [range.endContainer, range.endOffset]]).at;
    const div = document.createElement("div");
    div.append(range.cloneContents());
    ev.preventDefault();
    ev.clipboardData.setData("text/plain", box_text().slice(a, b));
    ev.clipboardData.setData("text/html", div.innerHTML);
    if (cut) {
      range.deleteContents();
      changed();
    }
  };
  el.addEventListener("copy", (ev) => copy(ev, false));
  el.addEventListener("cut", (ev) => copy(ev, true));
  el.addEventListener("dragstart", (ev) => ev.preventDefault());
  el.addEventListener("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    caret_at(ev.clientX, ev.clientY);
    const files = [...ev.dataTransfer?.files ?? []];
    if (files.length > 0) {
      HOOKS.files(files);
    } else {
      box_insert(ev.dataTransfer?.getData("text/plain") ?? "");
    }
  });
  document.addEventListener("selectionchange", () => {
    const sel = getSelection();
    if (sel !== null && sel.rangeCount > 0 && BOX.contains(sel.getRangeAt(0).startContainer)) {
      LAST = sel.getRangeAt(0).cloneRange();
    }
  });
  tidy();
}
function box_text() {
  return offsets([]).text;
}
function box_blank() {
  return BOX.textContent === "" && BOX.querySelector(".item") === null;
}
function box_focused() {
  return document.activeElement === BOX;
}
function box_focus() {
  BOX.focus();
}
function box_set(text) {
  BOX.replaceChildren();
  let buf = "";
  text.split(`
`).forEach((line, k) => {
    buf += k === 0 ? "" : `
`;
    const media = md_pasted(line);
    if (media.length === 1 && media[0][0] === 0 && media[0][1] === line.length) {
      BOX.append(...buf === "" ? [] : [buf], item_new(media[0][2], media[0][3], "ok"));
      buf = "";
    } else {
      buf += line;
    }
  });
  if (buf !== "") {
    BOX.append(buf);
  }
  tidy();
  LAST = null;
  if (box_focused()) {
    box_place(Infinity, Infinity);
  }
  HOOKS.input();
}
function box_caret() {
  const sel = getSelection();
  const range = sel !== null && sel.rangeCount > 0 && BOX.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
  if (range === null) {
    const n = box_text().length;
    return [n, n];
  }
  const at = offsets([[range.startContainer, range.startOffset], [range.endContainer, range.endOffset]]).at;
  return [at[0], at[1]];
}
function box_place(a, b) {
  const range = document.createRange();
  const [start, end] = [point(a), point(b)];
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  LAST = range.cloneRange();
}
function box_insert(text) {
  if (text !== "") {
    put(document.createTextNode(text));
  }
}
function box_put(item) {
  put(item);
}
function item_new(name, url, state, kind = media_kind(url) ?? "file", size = null) {
  const item = document.createElement("span");
  item.className = "item";
  item.contentEditable = "false";
  item.title = name;
  item.dataset.name = name;
  item.setAttribute("role", "img");
  item.setAttribute("aria-label", name);
  if (kind === "image" && url !== "") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.draggable = false;
    img.addEventListener("load", () => item_fit(item, img.naturalWidth, img.naturalHeight), { once: true });
    item.append(img);
  } else if (kind === "video" && url !== "") {
    const video = document.createElement("video");
    video.src = url + "#t=0.1";
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.addEventListener("loadedmetadata", () => item_fit(item, video.videoWidth, video.videoHeight), { once: true });
    item.append(video);
  } else {
    const tile = document.createElement("span");
    tile.className = "tile";
    tile.textContent = (kind === "audio" ? "♪ " : kind === "html" ? "\uD83D\uDCC4 " : kind === "file" ? "\uD83D\uDCCE " : "") + name;
    if (kind === "file") {
      const small = document.createElement("small");
      small.textContent = size === null ? "" : size_show(size);
      if (size === null && url.startsWith("/media/")) {
        small.dataset.of = url;
      }
      tile.append(small);
      box_sizes(tile);
    }
    item.append(tile);
  }
  const note = document.createElement("span");
  note.className = "state";
  item.append(note);
  item_state(item, state, "", state === "ok" && url.startsWith("/media/") ? url : "");
  return item;
}
function item_fit(item, w, h) {
  if (!(w > 0 && h > 0)) {
    return;
  }
  const k = Math.min(1, SIDE / Math.max(w, h));
  item.style.width = Math.max(LEAST, Math.round(w * k)) + "px";
  item.style.height = Math.max(LEAST, Math.round(h * k)) + "px";
}
function item_state(item, state, note, url = "") {
  item.dataset.state = state;
  must(item.querySelector(".state"), "the item's state").textContent = note;
  if (url !== "") {
    const bang = media_kind(url) === null ? "" : "!";
    item.dataset.md = bang + "[" + (item.dataset.name ?? "").replace(/[[\]\\\n]/g, "") + "](" + url + ")";
  }
}
var SIZES = new Map;
function box_sizes(el) {
  for (const small of el.querySelectorAll("[data-of]:empty")) {
    const url = small.dataset.of ?? "";
    const got = SIZES.get(url) ?? size_ask(url);
    SIZES.set(url, got);
    got.then((text) => {
      small.textContent ||= text;
    });
  }
}
async function size_ask(url) {
  const res = await fetch(url, { headers: { range: "bytes=0-0" } }).catch(() => null);
  res?.body?.cancel().catch(() => {});
  const total = /\/(\d+)$/.exec(res?.headers.get("content-range") ?? "")?.[1] ?? (res?.ok ? res.headers.get("content-length") : null);
  return total == null ? "" : size_show(Number(total));
}
function box_items() {
  return [...BOX.querySelectorAll(".item")];
}
function put(node) {
  const sel = getSelection();
  const now = sel !== null && sel.rangeCount > 0 && BOX.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
  const range = now ?? (LAST !== null && BOX.contains(LAST.startContainer) ? LAST : null) ?? end_range();
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
  LAST = range.cloneRange();
  changed();
}
function end_range() {
  const range = document.createRange();
  const last = BOX.lastChild;
  range.setStart(BOX, last?.nodeName === "BR" ? BOX.childNodes.length - 1 : BOX.childNodes.length);
  return range;
}
function changed() {
  tidy();
  HOOKS.input();
}
function tidy() {
  for (const n of [...BOX.childNodes]) {
    if (!box_may_hold(n)) {
      as_text(n);
    }
  }
  BOX.normalize();
  end_break_as_text_ends();
  BOX.classList.toggle("blank", box_blank());
}
function box_may_hold(n) {
  return n.nodeType === Node.TEXT_NODE || n instanceof HTMLElement && n.classList.contains("item");
}
function as_text(n) {
  if (n.nodeName === "BR") {
    if (n !== BOX.lastChild) {
      n.replaceWith(`
`);
    }
    return;
  }
  const line = n instanceof HTMLElement && BLOCKS.has(n.nodeName) && n.previousSibling !== null ? `
` : "";
  const items = n instanceof HTMLElement ? [...n.querySelectorAll(".item")] : [];
  n.replaceWith(line + (items.length > 0 ? "" : n.textContent ?? ""), ...items);
}
function end_break_as_text_ends() {
  const last = BOX.lastChild;
  const before = last?.nodeName === "BR" ? last.previousSibling : last;
  const ends = before?.nodeType === Node.TEXT_NODE && (before.textContent ?? "").endsWith(`
`);
  if (ends && last?.nodeName !== "BR") {
    BOX.append(document.createElement("br"));
  } else if (!ends && last?.nodeName === "BR") {
    last.remove();
  }
}
function offsets(points) {
  const at = points.map(() => -1);
  let [text, after] = ["", false];
  const kids = [...BOX.childNodes];
  kids.forEach((n, k) => {
    points.forEach(([node, off], i) => {
      if (at[i] < 0 && node === BOX && off === k) {
        at[i] = text.length;
      }
    });
    if (n.nodeType === Node.TEXT_NODE) {
      const data = n.textContent ?? "";
      const gap = after && data !== "" && !data.startsWith(`
`) ? `
` : "";
      points.forEach(([node, off], i) => {
        if (at[i] < 0 && node === n) {
          at[i] = text.length + (off === 0 ? 0 : gap.length) + off;
        }
      });
      text += gap + data;
      after = after && data === "";
    } else if (n instanceof HTMLElement && n.classList.contains("item")) {
      points.forEach(([node], i) => {
        if (at[i] < 0 && n.contains(node)) {
          at[i] = text.length;
        }
      });
      const md = n.dataset.md;
      if (md !== undefined) {
        text += (text === "" || text.endsWith(`
`) ? "" : `
`) + md;
        after = true;
      }
    }
  });
  return { text, at: at.map((x) => x < 0 ? text.length : x) };
}
function point(n) {
  const kids = [...BOX.childNodes];
  let [text, after] = ["", false];
  for (const [k, c] of kids.entries()) {
    if (c.nodeType === Node.TEXT_NODE) {
      const data = c.textContent ?? "";
      const gap = after && data !== "" && !data.startsWith(`
`) ? 1 : 0;
      if (n <= text.length + gap + data.length) {
        return [c, Math.max(0, n - text.length - gap)];
      }
      text += (gap ? `
` : "") + data;
      after = after && data === "";
    } else if (c instanceof HTMLElement && c.classList.contains("item") && c.dataset.md !== undefined) {
      text += (text === "" || text.endsWith(`
`) ? "" : `
`) + c.dataset.md;
      after = true;
      if (n <= text.length) {
        return [BOX, k + 1];
      }
    }
  }
  return [BOX, BOX.lastChild?.nodeName === "BR" ? kids.length - 1 : kids.length];
}
function beside(back) {
  const sel = getSelection();
  if (sel === null || sel.anchorNode === null || sel.rangeCount === 0 || !sel.isCollapsed || !BOX.contains(sel.anchorNode)) {
    return null;
  }
  const [node, off] = [sel.anchorNode, sel.anchorOffset];
  let next;
  if (node.nodeType === Node.TEXT_NODE) {
    if (back ? off > 0 : off < (node.textContent ?? "").length) {
      return null;
    }
    next = back ? node.previousSibling : node.nextSibling;
  } else {
    next = node === BOX ? (back ? BOX.childNodes[off - 1] : BOX.childNodes[off]) ?? null : null;
  }
  while (next !== null && next.nodeType === Node.TEXT_NODE && next.textContent === "") {
    next = back ? next.previousSibling : next.nextSibling;
  }
  return next instanceof HTMLElement && next.classList.contains("item") ? next : null;
}
function caret_at(x, y) {
  const doc = document;
  const pos = doc.caretPositionFromPoint?.(x, y) ?? null;
  const range = pos !== null ? document.createRange() : document.caretRangeFromPoint?.(x, y) ?? null;
  if (pos !== null && range !== null) {
    range.setStart(pos.offsetNode, pos.offset);
  }
  if (range !== null && BOX.contains(range.startContainer)) {
    range.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    LAST = range.cloneRange();
  }
}
function html_pieces(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  let text = "";
  const line = () => text += text === "" || text.endsWith(`
`) ? "" : `
`;
  const walk = (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      text += (n.textContent ?? "").replace(/[ \t\r\n]+/g, n.parentElement?.closest("pre") ? "$&" : " ");
      return;
    }
    if (!(n instanceof Element) || ["SCRIPT", "STYLE", "TEMPLATE", "HEAD"].includes(n.nodeName)) {
      return;
    }
    const media = html_media(n);
    if (media !== null) {
      out.push(text, media);
      text = "";
      return;
    }
    if (n.nodeName === "BR") {
      text += `
`;
      return;
    }
    const block = BLOCKS.has(n.nodeName);
    if (block) {
      line();
    }
    n.childNodes.forEach(walk);
    if (block) {
      line();
    }
  };
  if (doc.body === null) {
    return null;
  }
  doc.body.childNodes.forEach(walk);
  out.push(text.replace(/^\n+|\n+$/g, ""));
  return out.filter((p) => p !== "");
}
function html_media(el) {
  const md = el instanceof HTMLElement ? el.dataset.md : undefined;
  const got = md === undefined ? [] : md_pasted(md);
  if (md !== undefined && got.length === 1 && got[0][1] === md.length) {
    return { name: got[0][2], url: got[0][3] };
  }
  const src = ["IMG", "VIDEO", "AUDIO", "SOURCE", "IFRAME"].includes(el.nodeName) ? el.getAttribute("src") : el.nodeName === "A" ? el.getAttribute("href") : null;
  const url = src === null ? null : new URL(src, location.href);
  const ok = url !== null && (el.nodeName === "A" ? store_file(url.pathname) : media_kind(url.pathname) !== null);
  if (url === null || url.origin !== location.origin || !ok) {
    return null;
  }
  const name = el.getAttribute("download") || el.getAttribute("alt") || el.getAttribute("title") || (url.pathname.split("/").pop() ?? "");
  return { name, url: url.pathname };
}

// Timer.ts
var AHEAD = 8 * 366;
var DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
var CLOCKS = new Map;
function clock(zone) {
  const had = CLOCKS.get(zone);
  if (had !== undefined) {
    return had;
  }
  try {
    const fields = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" };
    const made = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", ...fields });
    CLOCKS.set(zone, made);
    return made;
  } catch {
    return null;
  }
}
function wall(ms, zone) {
  const c = clock(zone);
  if (c === null) {
    throw new Error("no time zone " + zone);
  }
  const parts = Object.fromEntries(c.formatToParts(ms).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute), wd: DAYS[parts.weekday] };
}
function wall_show(ms, zone) {
  const w = wall(ms, zone);
  const two = (n) => String(n).padStart(2, "0");
  return w.y + "-" + two(w.mo) + "-" + two(w.d) + " " + two(w.h) + ":" + two(w.mi);
}
function timer_when(t) {
  const next = wall_show(Date.parse(t.at), t.zone) + " " + t.zone;
  return t.cron === null ? "once, " + next : "cron " + t.cron + ", next " + next;
}

// web/src/Html.ts
var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var TALL = 4000;
var SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
var CHECK = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;
var MARKS2 = { " ": "", "-": "del", "+": "add" };
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}
function act_html(act) {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}
function copy_html(text) {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}
var MADE = new WeakMap;
function row_html(row) {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}
function row_make(row) {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, call_line(row.call), "");
      return `<div class="block"${open} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": {
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const copy = copy_html(row.call === null ? row.text : call_text(row.call));
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split(`
`).length > TALL && !row.text.includes("](/media/");
      const media = row.body.some((b) => b.$ === "Para" && b.x.some((s) => s.$ === "Pict"));
      const cut = row.kind === "tool" || row.kind === "echo" && !media;
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
function call_html(c) {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}
function head_html(c, text, device) {
  const icon = `<span class="ic">${tool_glyph(c.name)}</span>`;
  const verb = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}
function images_html(names) {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}
var MODES = [
  ["standard", "Each message is summarized for Unii's memory. Cheapest, good for long working sessions."],
  ["conversation", "Messages stay word-for-word in Unii's view until you switch back. Use it for discussions. It costs more per turn."]
];
function pick_html(fold, on, knobs, talk) {
  const knob = (move, hint, text, rows) => [
    `<button title="${esc(hint)}" data-knob="${move}" popovertarget="pick-${move}" aria-haspopup="menu">${esc(text)}</button>`,
    `<div id="pick-${move}" class="choices" popover role="menu" aria-label="${move[0].toUpperCase() + move.slice(1)}">${rows}</div>`
  ];
  const parts = knobs.map((k) => k.choices.length === 0 ? [`<span class="knob" title="${esc(k.hint)}">${esc(k.text)}</span>`] : knob(k.move, k.hint, k.text, k.choices.map(choice_html).join("")));
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  const mode = ([name, hint], k) => {
    const here = talk != null === (k === 1);
    return `<button role="menuitemradio" aria-checked="${here}" title="${esc(hint)}"${here ? " autofocus" : act_html({ $: "Talk", on: k === 1 })}>${name}</button>`;
  };
  const [now, about] = MODES[talk == null ? 0 : 1];
  const modes = talk === undefined ? [] : knob("mode", about, now, MODES.map(mode).join(""));
  const used = talk == null ? 0 : Math.round(talk.used * 100);
  const heat = used >= 80 ? " hot" : used >= 50 ? " warm" : "";
  const rule = talk == null ? `<span class="rule"></span>` : `<span class="rule meter${heat}" style="--used:${used}%" title="Conversation: ${used}% of space used (${talk_tokens(talk)})" role="meter" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100" aria-label="Conversation space used"></span>`;
  return [...all, ...modes, rule, ...parts.flatMap((part, i) => i === 0 ? part : [`<span class="dot">·</span>`, ...part])];
}
function choice_html(c) {
  const head = c.vendor === null ? "" : `<p>${esc(c.vendor)}</p>`;
  const act = c.here ? " autofocus" : act_html({ $: "Move", move: c.move, to: c.to });
  return `${head}<button role="menuitemradio" aria-checked="${c.here}"${act}>${esc(c.text)}</button>`;
}
function mcp_html(plugs) {
  const one = (p) => {
    const act = act_html({ $: "Plug", name: p.name });
    const button = `<button class="chip" role="switch" aria-checked="${p.on}" aria-label="${esc(p.name)}"${act}>${p.on ? "Turn off" : "Turn on"}</button>`;
    return `<div class="item"><p>${esc(p.name)}<small>Its tools are ${p.on ? "on" : "off"} in this chat.</small></p>${button}</div>`;
  };
  const none = `<p class="sub">None set up. Add them as <code>mcp</code> in a device's own config.json: they run on that device.</p>`;
  return plugs.length === 0 ? [none] : plugs.map(one);
}
function tabs_html(tabs) {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}
function timers_html(timers) {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}
function account_html(prompts, notify = null) {
  const item = (what, note, act) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const acts = [
    item("This browser", "Signed in to this server.", `<button class="chip out">Sign out</button>`),
    ...notify === null ? [] : [notify_html(notify)],
    item("Export memory", "The chat and its summaries, in one file.", `<a class="chip" href="/export">Download</a>`)
  ];
  const unread = item("Could not read the prompts.", "", `<button class="chip retry">Try again</button>`);
  const mine = section_html("Prompts", prompts === null ? unread : prompt_html("prompt", prompts.prompt.text, "The user prompt: Unii's system prompt in every turn; its subagents get it too once you change it. Add who you are and how you want work done at its end. prompt.md in the server's folder; empty: the built-in one.") + prompt_html("compact", prompts.compact.text, "The compaction prompt: all a summary of the memory gets, nothing else. compact.md in the server's folder; empty: the built-in one."));
  const mcp = section_html("MCP servers", `<div class="mcp"></div>`);
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Settings</h1>` + mine + section_html("This browser", acts.join("")) + mcp + `<div class="owned"></div>`;
}
function prompt_html(name, text, note) {
  const area = `<textarea name="${name}" rows="12" spellcheck="false">${esc(text)}</textarea>`;
  return `<form class="prompt"><p class="note">${esc(note)}</p>${area}<div><p class="why"></p><button class="chip">Save</button></div></form>`;
}
function notify_html(notify) {
  const note = {
    off: "Replies on this device, when UniiChat isn't open.",
    on: "Replies on this device, when UniiChat isn't open.",
    blocked: "Blocked in this browser's settings for this site.",
    home: "On iPhone and iPad: Share, then Add to Home Screen, and open it from there."
  }[notify];
  const button = notify === "home" ? "" : `<button class="chip notify"${notify === "blocked" ? " disabled" : ""}>${notify === "on" ? "Turn off" : "Turn on"}</button>`;
  return `<div class="item"><p>Notifications<small>${note}</small></p>${button}</div>`;
}
var SETTING = {
  vendors: ["Vendors", "Whose models the server offers."],
  models: ["Models", "The models offered, of those vendors."],
  pick: ["Default model", "What a chat runs on until it picks another."],
  compactor: ["Compactor model", "What writes the memory's summaries. Sonnet medium summarizes more faithfully than Haiku, using more of a plan's limits."],
  compactor_context: ["Compactor context", "How much of the chat each summary sees, in KB (1 to 128). More context lets it copy more into a summary that its message doesn't say. New summaries only."],
  agents: ["Subagent model", "What subagents run on."],
  site: ["Site", "The server's address, for sign-in links and the installer."],
  apple: ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns: ["APNs key ID", "The ID of the key the app's pushes are signed with."]
};
var KEY = {
  anthropic: ["Anthropic key", "For claude-api's models."],
  openai: ["OpenAI key", "For openai-api's models and dictation."],
  apns: ["APNs key", "The .p8 key the iOS app's pushes are signed with."]
};
var VENDOR_KEY = { "claude-api": "anthropic", "openai-api": "openai" };
var PICKS = ["pick", "compactor", "agents"];
var GROUPS = [
  ["Models", ["vendors", "models", "pick", "compactor", "compactor_context", "agents"]],
  ["Server", ["site", "apple", "apns"]]
];
function settings_html(page) {
  const rows = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, keys]) => {
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
function offered(vendors, models) {
  return Pick.models(VENDORS.filter((v) => vendors.includes(v)), models).map(([v, m]) => v + ":" + m.label);
}
function profiles_html(profiles, offered) {
  const model = (m, i, j) => {
    const [vendor = "", label = m, ...rest] = m.split(":");
    const more = rest.length === 0 ? "" : ` <small>${esc(rest.join(" · "))}</small>`;
    return `<li data-j="${j}"><button type="button" class="grip" data-i="${i}" data-j="${j}" aria-label="Move ${esc(label)}">⠿</button><span>${esc(label)}${more} <small>${esc(vendor)}</small></span><button type="button" class="out" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(label)}">×</button></li>`;
  };
  const add = (list, i) => {
    const left = offered.filter((m) => !list.some((x) => x.split(":").slice(0, 2).join(":") === m));
    const groups = [...new Set(left.map((m) => m.split(":")[0]))].map((v) => `<optgroup label="${esc(v)}">${left.filter((m) => m.startsWith(v + ":")).map((m) => `<option value="${esc(m)}">${esc(m.split(":")[1])}</option>`).join("")}</optgroup>`);
    return left.length === 0 ? "" : `<select class="add" data-i="${i}" aria-label="Add model"><option value="">Add model</option>${groups.join("")}</select>`;
  };
  const one = ([name, list], i) => `<div class="prof" data-i="${i}"><div class="name"><input class="pname" data-i="${i}" value="${esc(name)}" aria-label="Name" placeholder="Enter the profile name here" maxlength="60" spellcheck="false" autocapitalize="off"><button type="button" class="chip red pdel" data-i="${i}">Delete</button></div><ol>${list.map((m, j) => model(m, i, j)).join("")}</ol>${add(list, i)}</div>`;
  return profiles.map(one).join("") + `<button type="button" class="chip pnew">Add profile</button>`;
}
function setting_html(r) {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(r.key)}</code></small></label>`;
  return `<div class="set" data-key="${esc(r.key)}">${label}<div class="field">${control_html(r)}</div>${from_html(r)}<p class="err"></p></div>`;
}
function control_html(r) {
  switch (r.key) {
    case "vendors": {
      return checks_html("vendors", VENDORS, list2(r.value), () => "") + `<p class="warn"></p>`;
    }
    case "models": {
      return checks_html("models", LABELS, list2(r.value), (x) => Pick.models(VENDORS, [x]).map(([vendor]) => vendor).join(" "));
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
function list2(text) {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}
function list_changed(was, now) {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}
function checks_html(name, all, on, vendor) {
  const box = (x) => `<label class="opt" data-vendor="${esc(vendor(x))}"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}
function from_html(r) {
  const from = r.from === "file" ? "From config.json" : "Default" + (r.why === "" ? "" : ": " + esc(r.why));
  const apply = r.apply === "now" ? "applies at once" : "applies on a restart";
  const running = r.running === null ? "" : ` · running on <code>${esc(r.running === "" ? "(none)" : r.running)}</code> till then`;
  const reset = r.from === "file" ? ` <button type="button" class="reset">Use the default</button>` : "";
  return `<p class="from">${from} · ${apply}${running}${reset}</p>`;
}
function key_html(k) {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = k.name === "apns" ? `<textarea id="${id}" name="key.${k.name}" rows="3" placeholder="Paste a new key to set it" spellcheck="false"></textarea>` : `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "file" ? `Set${tail}, in keys.json` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(k.env)}</code></small></label>`;
  return `<div class="set key" data-key="key.${esc(k.name)}">${label}<div class="field">${field}</div><p class="from">${from}${reset}</p><p class="err"></p></div>`;
}
function picks_html(key, vendors, models, value, none, profiles = []) {
  const [vendor = "", model = "", effort = "", speed = ""] = value === "" ? [] : value.split(":");
  const known = VENDORS.includes(vendor);
  const offered = VENDORS.filter((v) => vendors.includes(v));
  const labels = known ? Pick.models([vendor], models).map(([, m]) => m.label) : [];
  const speeds = known ? Pick.model(vendor, model)?.speeds ?? [] : [];
  const select = (part, name, all, on, first) => {
    const opts = [...first === null ? [] : [["", first]], ...all.includes(on) || on === "" && first !== null ? [] : [[on, on + " (not offered)"]], ...all.map((x) => [x, x])];
    const items = opts.map(([v, text]) => `<option value="${esc(v)}"${v === on ? " selected" : ""}>${esc(text)}</option>`).join("");
    return `<select id="set-${key}-${part}" name="${key}.${part}" aria-label="${name}">${items}</select>`;
  };
  const head = select("vendor", "Vendor", [...offered, ...profiles], vendor, none);
  return vendor === "" || profiles.includes(vendor) ? head : head + select("model", "Model", labels, model, null) + select("effort", "Effort", EFFORTS, effort, null) + select("speed", "Speed", speeds, speed, null);
}
function pick_mend(parts, models, profiles = []) {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!VENDORS.includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor, model) ?? Pick.models([vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, effort || "medium", m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}
function section_html(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}
function block_html(b) {
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
      const box = (c) => c === null ? "" : `<input type="checkbox" disabled${c ? " checked" : ""}> `;
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
function item_html(blocks, tight) {
  return blocks.map((b) => tight && b.$ === "Para" ? spans_html(b.x) : block_html(b)).join("");
}
function diff_html(file, hunks) {
  const all = hunks.flat();
  const nw = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds = all.filter((l) => l.s === "+").length;
  const dels = all.filter((l) => l.s === "-").length;
  const head = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line = (l) => `<span class="${MARKS2[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}
function file_html(shown, from, lines) {
  const nw = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}
function chip_html(url, name) {
  const shown = name.trim() || (url.split("/").pop() ?? "");
  return `<a class="file" href="${esc(url)}" download="${esc(shown)}" title="Download ${esc(shown)}"><span class="ic">\uD83D\uDCCE</span><span class="fname">${esc(shown)}</span><small data-of="${esc(url)}"></small></a>`;
}
function spans_html(spans) {
  return spans.map(span_html).join("");
}
function span_html(s) {
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
      if (store_file(s.k)) {
        return chip_html(s.k, spans_text(s.x));
      }
      return `<a href="${esc(s.k)}"${s.t === "" ? "" : ` title="${esc(s.t)}"`} target="_blank" rel="noopener">${spans_html(s.x)}</a>`;
    }
    case "Pict": {
      const [k, title, kind] = [esc(s.k), s.t === "" ? "" : ` title="${esc(s.t)}"`, media_kind(s.k)];
      return kind === "image" ? `<a class="media" href="${k}" target="_blank"><img src="${k}" alt="${esc(s.x)}"${title} loading="lazy"></a>` : kind === "video" ? `<video class="media" src="${k}"${title} controls preload="metadata"></video>` : kind === "audio" ? `<audio class="media" src="${k}"${title} controls preload="metadata"></audio>` : kind === "html" ? `<iframe class="media page" src="${k}" title="${esc(s.t || s.x)}" sandbox="allow-same-origin allow-popups" loading="lazy"></iframe>` : store_file(s.k) ? chip_html(s.k, s.x) : `<a href="${k}"${title} target="_blank" rel="noopener">${esc(s.x || s.k)}</a>`;
    }
    case "Brk": {
      return "<br>";
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}

// web/src/Tree.ts
var LEGEND = { VIEW: "What Unii's prompt holds now, in order: old messages as summaries, recent ones whole.", TREE: "" };
var S = {
  want: null,
  asked: 0,
  run: null
};
function tree_show(which) {
  const was = S.want;
  S.want = which;
  tabs(which);
  if (S.run !== null) {
    S.run.show(which);
    focus(which);
    return;
  }
  if (was !== null) {
    return;
  }
  const me = ++S.asked;
  fetch("/api/tree").then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))).then((meta) => {
    if (me === S.asked && S.want !== null) {
      S.run = start(meta);
      S.run.show(S.want);
      focus(S.want);
    }
  }, () => {
    if (me === S.asked && S.want !== null) {
      S.want = null;
      $(".legend").textContent = "Could not read the memory. Try again in a moment.";
    }
  });
}
function tree_hide() {
  if (S.want === null) {
    return;
  }
  S.want = null;
  S.asked++;
  S.run?.stop();
  S.run = null;
  $(".view").replaceChildren();
  $(".bracket").replaceChildren();
  $(".view").classList.remove("on");
  $(".bracket").classList.remove("on", "drag");
}
function $(sel) {
  return document.querySelector("#tree " + sel);
}
function focus(which) {
  $(which === "TREE" ? ".bracket" : ".view").focus({ preventScroll: true });
}
function tabs(which) {
  $(".prev").hidden = $(".next").hidden = which !== "TREE";
  $(".legend").innerHTML = LEGEND[which];
  document.querySelectorAll("#tree .tab").forEach((a) => a.classList.toggle("here", a.dataset.tab === which));
  $(".view").classList.toggle("on", which === "VIEW");
  $(".bracket").classList.toggle("on", which === "TREE");
}
function start(meta) {
  const ac = new AbortController, signal = ac.signal;
  const { count: N, has: B, parts: V } = meta;
  const tree = $(".bracket"), back = $(".prev"), next = $(".next");
  $(".view").replaceChildren(...meta.view.flatMap(({ h, t }) => {
    const [a, b] = [document.createElement("h4"), document.createElement("pre")];
    a.textContent = h;
    b.textContent = t;
    return [a, b];
  }));
  tree.replaceChildren(...["ROOT", ...B.map((_, l) => "LVL" + l)].map((name) => {
    const col = document.createElement("div"), h3 = document.createElement("h3");
    col.className = "col";
    h3.tabIndex = 0;
    h3.textContent = name;
    col.append(h3);
    return col;
  }));
  tree.scrollTop = 0;
  let which = "TREE";
  const cols = [...tree.children], em = parseFloat(getComputedStyle(tree).fontSize), G = 0.75 * em, Y = 2.6 * em, HC = 9 * em;
  const HL = 1.5 * 11.5, HM = 0.7 * 11.5, PB = 0.7 * em, calm = matchMedia("(prefers-reduced-motion: reduce)");
  tree.style.setProperty("--card", HC + "px");
  const T = B.length - 1, vt = Math.max(-1, ...V.map((p) => p[0])), seen = new Set(V.map((p) => p.join(".")));
  const has = (l, i) => l < 0 ? i < N : B[l][i] === "1", at = (l, i) => i * 2 ** Math.max(0, l), len = (l) => 2 ** Math.max(0, l);
  const note = document.createElement("p");
  note.className = "note";
  const lo = (list, ok) => {
    let a = 0, z = list.length;
    while (a < z) {
      const m = a + z >> 1;
      ok(list[m]) ? z = m : a = m + 1;
    }
    return a;
  };
  const step = () => cols[1].offsetLeft - cols[0].offsetLeft || 1;
  const got = new Map, shown = new Map;
  let L = vt, plan, moving = 0, wait, width = 0, started = false, left = 0, sliding = false, done = () => {}, goal = null, big = null;
  const height = (_l, _i) => HC;
  const level_nodes = (L) => Array.from({ length: L < 0 ? N : B[L].length }, (_, i) => [L, i]);
  const layout = (L) => {
    const level = level_nodes(L), A = level.map((p) => at(...p)), slot = level.map((p) => height(...p) + G), P = new Float64Array(level.length + 1);
    const find = (m) => lo(A, (a) => a > m) - 1;
    const sums = () => slot.forEach((s, k) => P[k + 1] = P[k] + s);
    const ups = [];
    for (let l = L + 1;l <= T; l++) {
      sums();
      ups[l] = [];
      for (let i = 0;i < B[l].length; i++) {
        const a = find(i * 2 ** l), b = find((i + 1) * 2 ** l - 1) + 1, short = height(l, i) + G - (P[b] - P[a]);
        short > 0 && (slot[b - 1] += short);
        ups[l].push([i, a, b]);
      }
    }
    sums();
    const bases = cols.map(() => []);
    const halves = (l, i, y, h, d) => {
      if (l < 0)
        return;
      const n = len(l) / len(l - 1), g = Math.min(G, 0.08 * h), k = (h - (n - 1) * g) / n;
      if (k < 2)
        return;
      for (let j = 0;j < n; j++) {
        const c = at(l, i) / len(l - 1) + j, t = y + j * (k + g);
        bases[l].push([l - 1, c, t, k, at(l - 1, c), at(l - 1, c) + len(l - 1), d]);
        halves(l - 1, c, t, k, d + 1);
      }
    };
    level.forEach(([l, i], k) => {
      const t = P[k] + (slot[k] - G - height(l, i)) / 2;
      bases[L + 1].push([l, i, t, height(l, i), A[k], A[k] + len(l), 0]);
      halves(l, i, t, height(l, i), 1);
    });
    ups.forEach((list, l) => list.forEach(([i, a, b]) => bases[l + 1].push([l, i, (P[a] + P[b] - G - height(l, i)) / 2, height(l, i), at(l, i), at(l, i) + len(l), 0])));
    const cards = bases.map((list, c) => list.map((q, x) => {
      const v = link(bases, c, x);
      return [...q, v, v[2] < 0 ? q[2] : Math.min(q[2], q[2] + v[1]), v[2] < 0 ? q[2] + q[3] : Math.max(q[2] + q[3], q[2] + v[1] + v[2] + 1)];
    }));
    return { level, A, P, slot, find, cards, total: P[level.length] };
  };
  const link = (cards, c, x) => {
    const [l, i, y, h, a, b] = cards[c][x], mid = y + h / 2, kids = cards[c - 1] ?? [];
    const up = c <= T && at(l, i) < B[c].length * 2 ** c ? 1 : 0;
    const k0 = kids[lo(kids, (q) => q[4] >= a)], k1 = kids[lo(kids, (q) => q[4] >= b) - 1];
    if (!k0 || k0[4] !== a || !k1)
      return [up, 0, -1, 0];
    const y0 = Math.min(k0[2] + k0[3] / 2, mid), y1 = Math.max(k1[2] + k1[3] / 2, mid);
    return [up, y0 - y, y1 - y0, mid - y0];
  };
  const make = (l, i) => {
    const s = document.createElement("div");
    let x = got.get(l + "." + i);
    s.className = seen.has(l + "." + i) ? "s wait in" : "s wait";
    s.tabIndex = 0;
    s.li = [l, i];
    s.append(document.createElement("h4"), document.createElement("pre"));
    s.firstChild.textContent = l < 0 ? "ROOT #" + i : "LVL" + l + " #" + at(l, i) + (l > 0 ? "-" + (at(l, i) + len(l) - 1) : "");
    if (!has(l, i)) {
      s.classList.add("none");
      x = { h: s.firstChild.textContent, t: "Not summarized yet." };
    }
    if (x) {
      fill(s, x);
    }
    return s;
  };
  const fill = (s, x) => {
    s.classList.remove("wait");
    if (x.k !== undefined && /^\w+$/.test(x.k)) {
      s.classList.add(x.k);
    }
    s.firstChild.textContent = x.h;
    s.lastChild.textContent = x.t;
    s.fresh = true;
  };
  const near = () => [Math.floor(tree.scrollLeft / step()) - 1, (tree.scrollLeft + tree.clientWidth) / step()];
  const load = () => {
    const { scrollTop: y, clientHeight: sh } = tree, [c0, c1] = near(), want = [...shown].filter(([, s]) => !s.thin).map(([k]) => k);
    plan.cards.forEach((list, c) => {
      for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - 4 * sh);x < list.length && list[x][8] <= y + 5 * sh; x++) {
        list[x][6] < 2 && want.push(list[x][0] + "." + list[x][1]);
      }
    });
    const keys = [...new Set(want)].filter((k) => !got.has(k) && has(...k.split(".").map(Number)));
    for (let j = 0;j < keys.length; j += 200) {
      const part = keys.slice(j, j + 200), put = (list) => {
        if (signal.aborted)
          return;
        part.forEach((k, x) => {
          const one = list[x] ?? { h: k, t: "(none)" };
          got.set(k, one);
          const s = shown.get(k);
          if (s !== undefined) {
            fill(s, one);
          }
        });
        moving || draw();
      };
      part.forEach((k) => got.set(k, null));
      fetch("/api/tree?get=" + part.join(","), { signal }).then((r) => r.json()).then(put, () => put(part.map((k) => ({ h: k, t: "Could not load this: reload the page." }))));
    }
  };
  const draw = (y = tree.scrollTop, e = 1, old) => {
    if (signal.aborted)
      return;
    const p = plan, sh = tree.clientHeight, keep = new Set, [c0, c1] = near();
    cols.forEach((col, c) => {
      col.style.height = Y + Math.max(p.total, e < 1 ? old?.total ?? 0 : 0) + 4 * em + "px";
      const list = p.cards[c];
      for (let x = c < c0 || c > c1 ? list.length : lo(list, (q) => q[9] >= y - sh / 2);x < list.length && list[x][8] <= y + 1.5 * sh; x++) {
        const [l, i, t, h, , , , [up, ...v]] = list[x], k = l + "." + i, w = e < 1 && old !== undefined && (old.get(k) ?? from(old, l, i));
        const s = shown.get(k) ?? make(l, i);
        s.parentNode !== col && col.append(s);
        shown.set(k, s);
        keep.add(k);
        s.v = [t, h, ...v].map((z, j) => w ? w[j] + (z - w[j]) * e : z);
        s.classList.toggle("up", up === 1);
        s.classList.toggle("dn", v[1] >= 0);
        pos(s);
      }
    });
    shown.forEach((s, k) => keep.has(k) || (s === big && shut(true), s.remove(), shown.delete(k)));
    const upto = L < 0 ? N : B[L].length * 2 ** L;
    upto < N ? note.textContent = (N - upto === 1 ? "Message #" + upto + " isn't" : "Messages #" + upto + "-" + (N - 1) + " aren't") + " in a LVL" + L + " summary yet: each holds " + 2 ** L + "." : note.remove();
    if (upto < N) {
      note.style.top = Y + p.total + "px";
      if (note.parentNode !== cols[L + 1]) {
        cols[L + 1].append(note);
      }
    }
    y !== tree.scrollTop && (tree.scrollTop = y);
    back.disabled = tree.scrollLeft < 1;
    next.disabled = tree.scrollLeft + tree.clientWidth >= tree.scrollWidth - 1;
    load();
    const fresh = [...shown.values()].filter((s) => s.fresh && !s.one);
    fresh.map((s) => s.lastChild.scrollHeight > s.lastChild.clientHeight + 1).forEach((cut, j) => {
      const s = fresh[j];
      s.fresh = false;
      s.classList.toggle("more", cut);
      cut ? s.setAttribute("aria-expanded", String(s === big)) : s.removeAttribute("aria-expanded");
    });
  };
  const pos = (s) => {
    const [t, hc, a, h, m] = s.v, d = s === big ? s.dy : 0, f = Math.max(0, Math.min(1, 2 * hc / HC - 1)), one = hc < HC - 1;
    s.style.top = Y + t + d + "px";
    s === big || (s.style.height = hc + "px");
    [["--t", a - d], ["--h", h], ["--m", m], ["--c", hc / 2 - d], ["--hm", Math.max(0, (1 - f) * (hc - HL) / 2 + f * HM)], ["--pb", f * PB]].forEach(([name, z]) => s.style.setProperty(name, z + "px"));
    s.style.setProperty("--o", String(f));
    if (one !== (s.one ?? false)) {
      s.one = one;
      s.classList.toggle("one", one);
      s.tabIndex = one ? -1 : 0;
      s.fresh = !s.classList.contains("wait");
    }
    s.classList.toggle("line", f < 0.2);
    s.thin = hc < HL;
    s.classList.toggle("thin", s.thin);
  };
  const from = (old, l, i) => {
    for (let u = l + 1;u <= T; u++) {
      const w = old.get(u + "." + Math.floor(at(l, i) / len(u)));
      if (w)
        return [w[0] + w[1] / 2, 0, 0, -1, 0];
    }
    return null;
  };
  const ease = (s) => {
    s.getBoundingClientRect();
    s.classList.add("ease");
    clearTimeout(s.eased);
    s.eased = setTimeout(() => s.classList.remove("ease"), 200);
  };
  const grow = (s) => {
    const pre = s.lastChild;
    s.classList.add("big");
    s.style.height = "auto";
    pre.style.flex = "none";
    const need = s.offsetHeight, top0 = Y + s.v[0], { scrollTop: st, clientHeight: sh } = tree;
    s.style.height = pre.style.flex = "";
    const hb = Math.min(need, Math.max(HC, sh - Y - G));
    if (hb <= HC + 1)
      return s.classList.remove("big", "more"), s.removeAttribute("aria-expanded");
    let top = top0 + (HC - hb) / 2;
    top = Math.max(st + Y, Math.min(top, st + sh - G - hb));
    top = Math.max(Y, Math.min(top, Y + plan.total - G - hb));
    big = s;
    s.dy = top - top0;
    s.setAttribute("aria-expanded", "true");
    ease(s);
    s.style.height = hb + "px";
    pos(s);
  };
  const shut = (now) => {
    const s = big;
    if (!s)
      return;
    big = null;
    s.classList.remove("big");
    s.setAttribute("aria-expanded", "false");
    s.lastChild.scrollTop = 0;
    now ? s.classList.remove("ease") : ease(s);
    s.style.height = "";
    pos(s);
  };
  const press = (s) => {
    if (s.one)
      return shut(), slide(cols.indexOf(s.parentNode));
    const sel = must(getSelection(), "a selection");
    if (s === big)
      return (sel.isCollapsed || !s.contains(sel.anchorNode)) && shut();
    shut();
    s.classList.contains("more") && grow(s);
  };
  const anchor = () => {
    const { level, A, P, slot } = plan, k = Math.max(0, Math.min(plan.level.length - 1, lo(P, (z) => z > tree.scrollTop) - 1)), d = tree.scrollTop - P[k];
    return level.length ? { key: level[k].join("."), d, m: A[k] + Math.min(0.999, d / slot[k]) * len(level[k][0]) } : null;
  };
  const place = (a, p) => {
    if (!a)
      return 0;
    const k = p.find(Math.floor(a.m)), [l, i] = p.level[k];
    return p.P[k] + (l + "." + i === a.key ? Math.min(a.d, p.slot[k]) : (a.m - p.A[k]) / len(l) * p.slot[k]);
  };
  const redo = () => {
    if (!moving && !sliding) {
      const a = anchor();
      plan = layout(L);
      draw(place(a, plan));
    }
  };
  const pack = () => {
    if (signal.aborted)
      return;
    const to = Math.max(-1, Math.min(T, Math.round(tree.scrollLeft / step()) - 1));
    left = tree.scrollLeft;
    sliding = false;
    goal = null;
    if (to === L)
      return moving || redo();
    shut(true);
    const a = anchor(), old = new Map, y0 = tree.scrollTop, t0 = performance.now(), me = ++moving, D = calm.matches ? 0 : 300;
    plan.cards.forEach((list) => list.forEach((q) => old.set(q[0] + "." + q[1], [q[2], q[3], ...q[7].slice(1)])));
    shown.forEach((s, k) => old.set(k, s.v));
    old.total = plan.total;
    L = to;
    plan = layout(L);
    const y1 = place(a, plan);
    const frame = (now) => {
      const e = D ? Math.min(1, (now - t0) / D) : 1, f = 1 - (1 - e) ** 3;
      if (me === moving) {
        if (e < 1) {
          draw(y0 + (y1 - y0) * f, f, old);
          requestAnimationFrame(frame);
        } else {
          done();
        }
      }
    };
    done = () => me === moving && (moving = 0, draw(y1));
    requestAnimationFrame(frame);
  };
  const end = "onscrollend" in tree;
  tree.addEventListener(end ? "scrollend" : "scroll", () => {
    if (drag?.on)
      return;
    tree.classList.remove("drag");
    clearTimeout(wait);
    wait = setTimeout(pack, end ? 0 : 150);
  }, { signal });
  tree.addEventListener("scroll", () => {
    if (tree.scrollLeft !== left) {
      [left, sliding, moving] = [tree.scrollLeft, true, 0];
      shut(true);
    }
    moving || draw();
  }, { signal });
  plan = layout(L);
  const show = () => {
    which === "TREE" || shut(true);
    if (which === "TREE" && tree.clientWidth > 0) {
      if (cols[0].offsetWidth !== width) {
        width = cols[0].offsetWidth;
        shut(true);
        shown.forEach((s) => s.fresh = !s.classList.contains("wait"));
      }
      if (!started) {
        started = true;
        tree.scrollLeft = (L + 1) * step();
      }
      redo();
    }
  };
  addEventListener("resize", show, { signal });
  const slide = (c) => {
    goal = Math.max(0, Math.min(cols.length - 1, c));
    done();
    tree.scrollTo({ left: goal * step(), behavior: calm.matches ? "instant" : "smooth" });
  };
  let drag = null, dragged = false;
  tree.addEventListener("pointerdown", (e) => {
    dragged = false;
    const bar = e.target === tree && e.offsetX >= tree.clientWidth;
    drag = e.pointerType === "mouse" && e.button === 0 && !bar && !e.target.closest(".big, h3") ? { x: e.clientX, y: e.clientY, left: tree.scrollLeft, id: e.pointerId, on: false } : null;
  }, { signal });
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id)
      return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx))
        return void (drag = null);
      if (Math.abs(dx) < 8)
        return;
      drag.on = dragged = true;
      shut(true);
      tree.classList.add("drag");
    }
    getSelection()?.removeAllRanges();
    tree.scrollLeft = drag.left - dx;
  }, { signal });
  const drop = (e) => {
    if (!drag || e.pointerId !== drag.id)
      return;
    const on = drag.on;
    drag = null;
    if (!on)
      return;
    const c = Math.max(0, Math.min(Math.round(tree.scrollLeft / step()), Math.ceil((tree.scrollWidth - tree.clientWidth) / step())));
    if (Math.abs(tree.scrollLeft - c * step()) < 1) {
      tree.classList.remove("drag");
      pack();
    } else {
      slide(c);
    }
  };
  addEventListener("pointerup", drop, { signal });
  addEventListener("pointercancel", drop, { signal });
  tree.addEventListener("click", (e) => dragged && (dragged = false, e.stopPropagation(), e.preventDefault()), { capture: true, signal });
  const here = () => goal ?? Math.round(tree.scrollLeft / step());
  back.addEventListener("click", () => slide(here() - 1), { signal });
  next.addEventListener("click", () => slide(Math.min(here() + 1, Math.ceil((tree.scrollWidth - tree.clientWidth) / step()))), { signal });
  const go = (t) => {
    const col = t.closest("h3")?.parentNode;
    col && slide(cols.indexOf(col));
  };
  tree.addEventListener("click", (e) => {
    const s = e.target.closest(".s");
    if (s) {
      press(s);
    } else {
      shut();
      go(e.target);
    }
  }, { signal });
  tree.addEventListener("keydown", (e) => {
    const t = e.target;
    if ((e.key === "Enter" || e.key === " ") && t.matches("h3, .s")) {
      e.preventDefault();
      t.matches("h3") ? go(t) : press(t);
    }
  }, { signal });
  addEventListener("click", (e) => tree.contains(e.target) || shut(), { signal });
  addEventListener("keydown", (e) => e.key === "Escape" && big && (big.focus({ preventScroll: true }), shut()), { signal });
  let viewed = false;
  return {
    show: (w) => {
      if (w === "VIEW" && !viewed) {
        viewed = true;
        $(".view").scrollTop = 0;
      }
      which = w;
      show();
    },
    stop: () => (moving = 0, clearTimeout(wait), ac.abort())
  };
}

// web/src/Viewer.ts
var MAX = 8;
var SLOP = 10;
var DOUBLE = 320;
var NEAR = 32;
var PICS = "#log .pics a > img, #log a.media > img";
var D = document.createElement("dialog");
var STAGE = D;
var IMG = document.createElement("img");
var V = {
  pic: null,
  n: -1,
  w: 0,
  h: 0,
  s: 1,
  x: 0,
  y: 0,
  fit: 1,
  swipe: 0,
  theme: []
};
var PTS = new Map;
var G = null;
var TAP = null;
function viewer_new() {
  D = find(document, "#viewer", HTMLDialogElement);
  STAGE = find(D, ".stage", HTMLElement);
  IMG = find(STAGE, "img", HTMLImageElement);
  D.addEventListener("close", closed);
  find(D, ".shut", HTMLElement).onclick = () => D.close();
  find(D, ".prev", HTMLElement).onclick = () => step(-1);
  find(D, ".next", HTMLElement).onclick = () => step(1);
  D.addEventListener("keydown", key);
  D.addEventListener("wheel", wheel, { passive: false });
  STAGE.addEventListener("pointerdown", down);
  STAGE.addEventListener("pointermove", move);
  STAGE.addEventListener("pointerup", up);
  STAGE.addEventListener("pointercancel", up);
  IMG.addEventListener("dragstart", (ev) => ev.preventDefault());
  D.addEventListener("gesturestart", (ev) => ev.preventDefault());
  new ResizeObserver(refit).observe(STAGE);
}
function viewer_on() {
  return D.open;
}
function viewer_pic(el) {
  const link = el.closest("#log a.media, #log .pics a");
  const img = link?.querySelector("img");
  if (link != null && img != null) {
    const src = link.getAttribute("href") ?? img.src;
    return { src, name: img.alt.trim() || base(src), log: true };
  }
  const item = el.closest(".composer .item");
  const pic = item?.querySelector("img");
  if (item != null && pic != null) {
    return { src: pic.src, name: item.dataset.name ?? base(pic.src), log: false };
  }
  return null;
}
function viewer_open(pic, push = true, el = null) {
  if (push) {
    history.pushState({ pic }, "", location.href);
  }
  if (V.pic?.src !== pic.src) {
    const img = el?.closest("a")?.querySelector("img");
    V.n = img == null ? -1 : [...document.querySelectorAll(PICS)].indexOf(img);
    show(pic);
  }
  if (!D.open) {
    const metas = [...document.querySelectorAll("meta[name=theme-color]")];
    V.theme = metas.map((m) => m.content);
    D.showModal();
    metas.forEach((m) => m.content = getComputedStyle(D).backgroundColor);
  }
}
function viewer_sync() {
  const state = history.state;
  const pic = get(state, "pic");
  const [src, name] = [get(pic, "src"), get(pic, "name")];
  if (typeof src === "string" && typeof name === "string") {
    viewer_open({ src, name, log: get(pic, "log") === true }, false);
  } else if (D.open) {
    D.close();
  }
}
function closed() {
  const metas = [...document.querySelectorAll("meta[name=theme-color]")];
  metas.forEach((m, k) => m.content = V.theme[k] ?? m.content);
  V.pic = null;
  PTS.clear();
  G = TAP = null;
  IMG.removeAttribute("src");
  const state = history.state;
  if (get(state, "pic") != null) {
    history.back();
  }
}
function show(pic) {
  V.pic = pic;
  V.w = V.h = V.swipe = 0;
  must(D.querySelector(".name"), ".name").textContent = pic.name;
  must(D.querySelector(".zoom"), ".zoom").textContent = "";
  const get = find(D, ".get", HTMLAnchorElement);
  get.href = pic.src;
  get.download = file_name(pic);
  const [list, k] = place();
  find(D, ".prev", HTMLElement).hidden = k <= 0;
  find(D, ".next", HTMLElement).hidden = k < 0 || k >= list.length - 1;
  find(D, ".why", HTMLElement).hidden = true;
  IMG.classList.add("wait");
  IMG.alt = pic.name;
  IMG.src = pic.src;
  const loaded = () => {
    if (V.pic !== pic) {
      return;
    }
    V.w = IMG.naturalWidth || STAGE.clientWidth;
    V.h = IMG.naturalHeight || STAGE.clientHeight;
    IMG.style.width = V.w + "px";
    IMG.style.height = V.h + "px";
    IMG.classList.remove("wait");
    fit();
  };
  IMG.decode().then(loaded, () => {
    if (V.pic !== pic) {
      return;
    }
    if (IMG.complete && IMG.naturalWidth > 0) {
      loaded();
    } else {
      find(D, ".why", HTMLElement).hidden = false;
    }
  });
}
function place() {
  if (V.pic === null || !V.pic.log) {
    return [[], -1];
  }
  const list = [...document.querySelectorAll(PICS)].flatMap((img) => viewer_pic(img) ?? []);
  const src = V.pic.src;
  const at = list.flatMap((p, k) => p.src === src ? [k] : []);
  const k = at.reduce((best, k) => best < 0 || Math.abs(k - V.n) < Math.abs(best - V.n) ? k : best, -1);
  V.n = k;
  return [list, k];
}
function step(d) {
  const [list, k] = place();
  const to = k < 0 ? undefined : list[k + d];
  if (to === undefined) {
    return false;
  }
  history.replaceState({ pic: to }, "", location.href);
  V.n = k + d;
  show(to);
  return true;
}
function fit() {
  V.fit = fit_scale();
  V.s = V.fit;
  hold();
  draw();
}
function fit_scale() {
  return V.w === 0 ? 1 : Math.min(1, STAGE.clientWidth / V.w, STAGE.clientHeight / V.h);
}
function refit() {
  if (V.w === 0) {
    return;
  }
  const was = fitted();
  V.fit = fit_scale();
  V.s = was ? V.fit : Math.max(V.fit, V.s);
  hold();
  draw();
}
function fitted() {
  return V.s <= V.fit * 1.001;
}
function zoom_at(x, y, s) {
  const to = Math.min(Math.max(s, V.fit), Math.max(MAX, V.fit));
  V.x = x - (x - V.x) * to / V.s;
  V.y = y - (y - V.y) * to / V.s;
  V.s = to;
  hold();
  draw();
}
function hold() {
  const [w, h] = [V.w * V.s, V.h * V.s];
  const [sw, sh] = [STAGE.clientWidth, STAGE.clientHeight];
  V.x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, V.x));
  V.y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, V.y));
}
function draw() {
  IMG.style.transform = `translate(${V.x + V.swipe}px, ${V.y}px) scale(${V.s})`;
  D.classList.toggle("big", !fitted());
  must(D.querySelector(".zoom"), ".zoom").textContent = V.w === 0 ? "" : Math.round(V.s * 100) + "%";
}
function toggle(x, y) {
  const big = V.fit < 0.999 ? 1 : V.fit * 2.5;
  ease();
  zoom_at(x, y, fitted() ? big : V.fit);
}
function ease() {
  D.classList.add("ease");
  setTimeout(() => D.classList.remove("ease"), 220);
}
function at(x, y) {
  const r = STAGE.getBoundingClientRect();
  return [x - r.left, y - r.top];
}
function down(ev) {
  if (ev.pointerType === "mouse" && ev.button !== 0 || ev.target.closest("button") !== null) {
    return;
  }
  ev.preventDefault();
  STAGE.setPointerCapture(ev.pointerId);
  PTS.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  D.classList.remove("ease");
  if (PTS.size === 1) {
    G = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp, moved: false, many: false, on: ev.target === IMG, mouse: ev.pointerType === "mouse" };
  } else if (G !== null) {
    G.many = true;
  }
}
function move(ev) {
  const was = PTS.get(ev.pointerId);
  if (was === undefined || G === null) {
    return;
  }
  const now = { x: ev.clientX, y: ev.clientY };
  if (Math.hypot(now.x - G.x, now.y - G.y) > SLOP) {
    G.moved = true;
  }
  if (PTS.size === 1) {
    PTS.set(ev.pointerId, now);
    if (!G.moved) {
      return;
    }
    const [list, k] = fitted() && !G.many ? place() : [[], -1];
    if (k >= 0 && list.length > 1) {
      V.swipe += now.x - was.x;
    } else {
      V.x += now.x - was.x;
      V.y += now.y - was.y;
      hold();
    }
    draw();
    return;
  }
  const [a, b] = [...PTS.values()];
  const [mx, my] = at((a.x + b.x) / 2, (a.y + b.y) / 2);
  const span = Math.hypot(a.x - b.x, a.y - b.y);
  PTS.set(ev.pointerId, now);
  const [c, d] = [...PTS.values()];
  const [nx, ny] = at((c.x + d.x) / 2, (c.y + d.y) / 2);
  V.swipe = 0;
  V.x += nx - mx;
  V.y += ny - my;
  zoom_at(nx, ny, span === 0 ? V.s : V.s * Math.hypot(c.x - d.x, c.y - d.y) / span);
}
function up(ev) {
  if (!PTS.delete(ev.pointerId) || PTS.size > 0) {
    return;
  }
  const g = G;
  G = null;
  if (V.swipe !== 0) {
    const swipe = V.swipe;
    V.swipe = 0;
    if (ev.type === "pointerup" && Math.abs(swipe) > Math.min(80, STAGE.clientWidth / 5) && step(swipe < 0 ? 1 : -1)) {
      return;
    }
    ease();
    draw();
    return;
  }
  if (ev.type !== "pointerup" || g === null || g.moved || g.many || ev.timeStamp - g.t > 500) {
    return;
  }
  const tap = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
  if (TAP !== null && tap.t - TAP.t < DOUBLE && Math.hypot(tap.x - TAP.x, tap.y - TAP.y) < NEAR) {
    TAP = null;
    toggle(...at(tap.x, tap.y));
    return;
  }
  TAP = tap;
  if (g.mouse && !g.on) {
    D.close();
  }
}
function wheel(ev) {
  ev.preventDefault();
  if (V.w === 0 || !STAGE.contains(ev.target)) {
    return;
  }
  const px = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? STAGE.clientHeight : 1);
  zoom_at(...at(ev.clientX, ev.clientY), V.s * Math.exp(-px * (ev.ctrlKey ? 0.01 : 0.002)));
}
function key(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) {
    return;
  }
  const [x, y] = [STAGE.clientWidth / 2, STAGE.clientHeight / 2];
  const on = ev.target.closest("a, button") !== null;
  switch (ev.key) {
    case "ArrowLeft":
    case "ArrowRight": {
      step(ev.key === "ArrowLeft" ? -1 : 1);
      break;
    }
    case "+":
    case "=": {
      ease();
      zoom_at(x, y, V.s * 1.5);
      break;
    }
    case "-": {
      ease();
      zoom_at(x, y, V.s / 1.5);
      break;
    }
    case "0": {
      ease();
      fit();
      break;
    }
    case "ArrowUp":
    case "ArrowDown":
    case "PageUp":
    case "PageDown":
    case "Home":
    case "End": {
      break;
    }
    case " ": {
      if (on) {
        return;
      }
      break;
    }
    default: {
      return;
    }
  }
  ev.preventDefault();
}
function base(src) {
  const last = src.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || "picture";
  } catch {
    return last;
  }
}
function file_name(pic) {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(base(pic.src))?.[1];
  return ext === undefined || /\.[a-z0-9]{1,10}$/i.test(pic.name) ? pic.name : pic.name + "." + ext;
}

// web/src/main.ts
var APP = window.webkit?.messageHandlers?.unii ?? null;
var DESK = matchMedia("(hover: hover)");
var NONE = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";
var SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;
var v = view_new();
var BOX2 = $2(".composer .field", HTMLElement);
var UPS = new Map;
var BACK = $2("#import [name=back]", HTMLInputElement);
var P = {
  rec: null,
  shown: "",
  frame: 0,
  rows: true,
  toast: 0,
  push: null,
  used: { ws: null, on: false, at: 0 },
  after: false,
  at: ""
};
var SCROLL = {
  end: true,
  stick: true,
  y: 0,
  open: new Set,
  still: false,
  away: null
};
var RENEW = {
  build: document.documentElement.dataset.build ?? "",
  due: false,
  going: false,
  since: false,
  dirty: new Set,
  saving: 0,
  gave: null,
  back: null
};
var IMPORT = {
  found: new Map,
  done: {},
  off: new Set,
  step: ""
};
function $2(sel, type = HTMLElement) {
  return find(document, sel, type);
}
function kept(fact) {
  return "unii." + fact;
}
async function boot() {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  if (APP === null) {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
  }
  const tree = location.pathname === TREE ? TREE + (tree_view() ? "#view" : "") : null;
  const state = history.state;
  const pic = get(state, "pic") != null;
  history.replaceState(null, "", PAGES.includes(location.pathname) ? "/settings" : tree ?? "/");
  if (pic) {
    history.back();
  }
  if (await boot_me() === null) {
    solo("Sign in", "This UniiChat server is private. On the computer it runs on, run <code>unii serve link</code> and open the link it prints here.");
    return;
  }
  chat();
  signed();
  route();
  connect();
  for (const ev of ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"]) {
    addEventListener(ev, () => in_use(), { capture: true, passive: true });
  }
  addEventListener("focus", () => in_use());
  document.addEventListener("visibilitychange", () => {
    in_use();
    if (document.hidden && RENEW.due && !RENEW.going && renew_free(true)) {
      RENEW.going = true;
      renew(true);
    }
  });
  addEventListener("blur", () => in_use(true));
  addEventListener("pagehide", () => in_use(true));
}
async function boot_me() {
  for (let k = 0;; k++) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      if (k > 0) {
        $2("#toast").hidden = true;
      }
      return res.ok ? res.json() : null;
    }
    if (k === 0) {
      toast("Can't reach UniiChat. Reconnecting…", true);
    }
    await new Promise((ok) => setTimeout(ok, RETRY));
  }
}
var PAGES = ["/settings", "/account"];
var TREE = "/tree";
function tree_view() {
  return location.hash.toLowerCase() === "#view";
}
function solo(title, sub) {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}
function chat() {
  const file = $2("input[type=file]", HTMLInputElement);
  box_new(BOX2, { input: typed, files: attach });
  BOX2.addEventListener("blur", () => draw2(false));
  BOX2.onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && DESK.matches) {
      ev.preventDefault();
      submit();
    }
  };
  $2("form").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $2(".attach").onclick = () => file.click();
  $2("#pick").onkeydown = roam;
  $2("#pick").addEventListener("focusout", left);
  $2("#menu .out").onclick = signout;
  $2(".mic").onclick = mic;
  file.onchange = () => {
    attach([...file.files ?? []]);
    file.value = "";
  };
  onpopstate = popped;
  viewer_new();
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    if (view_typing(v) && (ev.dataTransfer?.files.length ?? 0) > 0) {
      attach([...ev.dataTransfer?.files ?? []]);
    }
  };
  document.onclick = click;
  must(visualViewport, "visualViewport").onresize = () => {
    if (box_focused() && box_caret()[0] === box_text().length) {
      BOX2.scrollTop = BOX2.scrollHeight;
    }
    draw2(true);
  };
  document.onscroll = () => {
    if (at_end()) {
      SCROLL.end = true;
    } else if (scrollY < SCROLL.y) {
      SCROLL.end = false;
    }
    SCROLL.y = scrollY;
    mine_show();
  };
  $2(".mine").onclick = mine;
  $2(".down").onclick = down2;
  const keep = new ResizeObserver(() => {
    if (SCROLL.still) {
      SCROLL.still = false;
    } else if (SCROLL.end && !$2("#log").hidden && !at_end()) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  });
  keep.observe($2("#log"));
  keep.observe($2("footer"));
  let width = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth !== width) {
      width = innerWidth;
      measured = new WeakSet;
      folds();
    }
    frames(true);
  });
  draw2(true);
}
function signed() {
  document.body.className = "";
  BOX2.dataset.placeholder = HINT;
  box_set(sessionStorage.getItem(kept("draft")) ?? "");
  renewed();
}
function typed() {
  sessionStorage.setItem(kept("draft"), box_text());
  for (const [item, xhr] of UPS) {
    if (!item.isConnected) {
      UPS.delete(item);
      xhr.abort();
    }
  }
  draw2(true);
}
function submit() {
  if (box_items().some((item) => item.dataset.state === "bad")) {
    P.after = false;
    toast(FAILED2);
    return;
  }
  if (UPS.size > 0) {
    P.after = true;
    toast("Sends once uploaded.");
    return;
  }
  P.after = false;
  const text = box_text().trim();
  act({ $: "Send", text });
  box_set("");
}
function back(sent, out) {
  if (out.error === undefined) {
    return;
  }
  if (box_blank()) {
    box_set(sent.text);
  }
  toast(out.error);
}
var FAILED2 = "A file in the message didn't upload: delete it (Backspace after it), then send.";
function attach(files) {
  for (const file of files) {
    const name = file.name.replace(/[[\]\\\n]/g, "") || "file";
    const ext = media_ext(file.name);
    const kind = ext !== "" ? ext_kind(ext) ?? "file" : file.type.startsWith("image/") ? "image" : "file";
    const item = item_new(name, kind === "image" || kind === "video" ? URL.createObjectURL(file) : "", "up", kind, file.size);
    box_put(item);
    upload(item, file);
  }
}
function upload(item, file) {
  const xhr = new XMLHttpRequest;
  UPS.set(item, xhr);
  item_state(item, "up", "0%");
  item.style.setProperty("--part", "0%");
  xhr.open("POST", "/api/media?name=" + encodeURIComponent(file.name));
  xhr.upload.onprogress = (ev) => {
    const part = Math.round((ev.lengthComputable ? ev.loaded / ev.total : 0) * 100) + "%";
    item_state(item, "up", part);
    item.style.setProperty("--part", part);
  };
  xhr.onloadend = () => {
    const out = upload_answer(xhr);
    if (UPS.get(item) !== xhr) {
      return;
    }
    UPS.delete(item);
    if ("name" in out) {
      item_state(item, "ok", "", "/media/" + out.name);
    } else {
      item_state(item, "bad", "Failed");
      toast(out.error);
    }
    typed();
    if (P.after && UPS.size === 0) {
      submit();
    }
  };
  xhr.send(file);
}
function upload_answer(xhr) {
  let out = null;
  try {
    out = JSON.parse(xhr.responseText);
  } catch {}
  if (typeof out === "object" && out !== null && "name" in out && typeof out.name === "string") {
    return { name: out.name };
  }
  const why = typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : xhr.status === 0 ? "Can't reach UniiChat." : "HTTP " + xhr.status;
  return { error: "Could not upload: " + why };
}
function act(a) {
  const said = a.$ === "Send" ? a.text.trim() : "";
  SCROLL.end = SCROLL.end || a.$ === "Send";
  P.rows = true;
  for (const msg of view_act(v, a)) {
    link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw2(a.$ === "Send");
}
function click(ev) {
  const target = ev.target;
  const el = target.closest("[data-act], [data-copy], [data-go], [data-knob], .choices > button");
  const sel = getSelection();
  const pic = viewer_pic(target);
  if (pic !== null && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) && (sel === null || sel.isCollapsed)) {
    ev.preventDefault();
    if (!DESK.matches) {
      BOX2.blur();
    }
    viewer_open(pic, true, target);
    return;
  }
  const cut = target.closest(".unfold") ?? (el === null && target.closest("a") === null ? target.closest(".msg.long:not(.shown) > .cut") : null);
  if (cut !== null && (sel === null || sel.isCollapsed)) {
    unfold(must(cut.parentElement, "the cut's message"));
    return;
  }
  if (el === null || sel !== null && !sel.isCollapsed && el.contains(sel.focusNode)) {
    return;
  }
  if (el.dataset.knob !== undefined) {
    place2(el);
    return;
  }
  el.closest(".choices")?.hidePopover();
  const { act: a, copy: text, go: path } = el.dataset;
  const menu = el.closest("#menu") !== null;
  if (menu) {
    $2("#menu").hidePopover();
  }
  if (path !== undefined || a !== undefined && menu) {
    ev.preventDefault();
    go(path ?? "/");
  }
  if (a !== undefined) {
    act(JSON.parse(a));
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}
function place2(knob) {
  const menu = $2("#pick-" + knob.dataset.knob);
  const box = knob.getBoundingClientRect();
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const left = box.left + box.width / 2 < w / 2 ? Math.max(8, box.left) : null;
  const right = Math.max(8, w - box.right);
  menu.style.left = left === null ? "auto" : left + "px";
  menu.style.right = left === null ? right + "px" : "auto";
  menu.style.bottom = h - box.top + 4 + "px";
  menu.style.maxWidth = (left === null ? w - right : w - left) - 8 + "px";
  menu.style.maxHeight = box.top - 12 + "px";
}
function roam(ev) {
  const menu = ev.target.closest(".choices");
  if (menu !== null && ev.key === "Tab" && ev.shiftKey && ev.target === menu.querySelector("button")) {
    ev.preventDefault();
    menu.hidePopover();
    menu.previousElementSibling.focus();
    return;
  }
  if (menu === null || !["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
    return;
  }
  ev.preventDefault();
  const rows = [...menu.querySelectorAll("button")];
  const n = rows.length;
  const at = rows.indexOf(document.activeElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1 + n, Home: 0, End: n - 1 };
  rows[to[ev.key] % n].focus();
}
function left(ev) {
  const menu = ev.target.closest(".choices:popover-open");
  const to = ev.relatedTarget;
  if (menu !== null && to !== null && !menu.contains(to) && to !== menu.previousElementSibling) {
    menu.hidePopover();
  }
}
var FOLD2 = 10;
var measured = new WeakSet;
function folds() {
  for (const cut of document.querySelectorAll("#log .msg > .cut")) {
    const msg = must(cut.parentElement, "the cut's message");
    if (!measured.has(msg)) {
      measured.add(msg);
      msg.classList.toggle("long", cut.scrollHeight > FOLD2 * parseFloat(getComputedStyle(cut).lineHeight));
    }
    fold_show(msg, SCROLL.open.has(msg.dataset.a ?? ""));
  }
}
function fold_show(msg, open) {
  msg.classList.toggle("shown", open);
  const button = must(msg.querySelector(":scope > .unfold"), "the message's unfold");
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "Show less" : "Show all";
}
function unfold(msg) {
  const open = !msg.classList.contains("shown");
  const id = msg.dataset.a ?? "";
  open ? SCROLL.open.add(id) : SCROLL.open.delete(id);
  const [top, follow] = [msg.getBoundingClientRect().top, SCROLL.end];
  SCROLL.end = false;
  fold_show(msg, open);
  scrollBy(0, msg.getBoundingClientRect().top - top);
  SCROLL.end = follow || at_end();
  SCROLL.still = follow;
}
var FRAMED = new WeakSet;
function frames(all = false) {
  for (const f of document.querySelectorAll("#log iframe.page")) {
    const fit = () => {
      const root = f.contentDocument?.documentElement;
      if (root !== undefined && f.contentDocument?.URL !== "about:blank") {
        f.style.height = Math.ceil(root.getBoundingClientRect().height) + 2 + "px";
      }
    };
    if (!FRAMED.has(f)) {
      FRAMED.add(f);
      f.addEventListener("load", fit);
    } else if (all) {
      fit();
    }
  }
}
function copied(button) {
  button.innerHTML = CHECK;
  setTimeout(() => button.innerHTML = SHEETS, 1200);
}
async function mic() {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    toast("UniiChat can't use the microphone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  draw2(false);
  meter(stream, rec);
}
function meter(stream, rec) {
  const audio = new AudioContext;
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $2(".voice canvas", HTMLCanvasElement);
  const pen = must(canvas.getContext("2d"), "a 2d canvas");
  const levels = [];
  const start = performance.now();
  const frame = (now) => {
    if (P.rec !== rec) {
      audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $2(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0;i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function words(audio) {
  const act = { $: "voice", type: audio.type, body: () => audio };
  link_send(v, act, heard);
  draw2(false);
}
function heard(out) {
  draw2(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(box_text().slice(0, box_caret()[0])) ? " " : "";
  box_insert(gap + text);
  box_focus();
}
function connect() {
  link_open(v, {
    open: (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post: (path, body) => fetch(path, { method: "POST", body }),
    hear,
    lost
  });
}
function in_use(off = false) {
  const on = !off && document.visibilityState === "visible" && document.hasFocus();
  const ws = v.ws;
  if (ws === null || !v.up || ws.readyState !== WebSocket.OPEN || ws === P.used.ws && on === P.used.on && (!on || Date.now() - P.used.at < USE_PING)) {
    return;
  }
  ws.send(on ? ACTIVE : IDLE);
  P.used = { ws, on, at: Date.now() };
}
async function lost(up) {
  draw2(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}
function hear(msg) {
  if (v.ws !== P.used.ws) {
    in_use();
  }
  const was = view_pick(v);
  const agents = v.agents.join();
  for (const out of view_hear(v, msg)) {
    link_send(v, out);
  }
  const now = view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() !== agents : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    renew_due(msg.build);
  }
  import_welcome();
  draw2(true);
}
function importer() {
  const form = $2("#import form", HTMLFormElement);
  const dir = $2("#import [name=dir]", HTMLInputElement);
  $2(".imp").onclick = () => void import_open(false);
  const zip = $2("#import [name=zip]", HTMLInputElement);
  $2(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    const pick = find(src, ".pickzip", HTMLButtonElement);
    pick.onclick = () => zip.click();
    pick.title = "From the website: " + EXPORTS[src.dataset.app ?? ""] + ", which emails you a zip.";
  }
  $2(".into").onclick = () => {
    IMPORT.step = "";
    import_draw("");
  };
  $2("#import").onclick = (ev) => ev.target.closest(".skip") && $2("#import").hidePopover();
  $2("#import .prog .sub").textContent = MIDWAY;
  $2("#import .flow").onclick = import_flow;
  $2("#import").ontoggle = (ev) => {
    if (ev.newState === "closed") {
      IMPORT.step = IMPORT.step === "start" || IMPORT.step === "done" ? "" : IMPORT.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target;
    if (box.name === "session") {
      box.checked ? IMPORT.off.delete(box.value) : IMPORT.off.add(box.value);
    }
    import_draw("");
  };
  dir.onchange = async () => {
    const all = [...dir.files ?? []];
    const files = all.filter((f) => import_file(f.webkitRelativePath));
    const found = [];
    let moved = 0;
    const reading = (k) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $2("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => import_session(b, "log"), () => {
        return;
      });
      moved += s === undefined ? 1 : 0;
      found.push(...s ? [s] : []);
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + e.message);
      }
    }
    zip.value = "";
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    import_send();
  };
}
function import_flow() {
  link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error && toast(out.error));
}
async function import_open(first) {
  $2("#menu").hidePopover();
  IMPORT.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $2("#import form .skip").textContent = first ? "Start fresh" : "Close";
  IMPORT.step = first ? "start" : IMPORT.step === "done" ? "" : IMPORT.step;
  import_draw("");
  $2("#import").showPopover();
}
function import_took(name, read, status) {
  IMPORT.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}
async function import_welcome() {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}
function import_send() {
  const picked = import_plan2().picked;
  IMPORT.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(import_body(picked), (part) => new Blob([part])));
  link_send(v, { $: "import", body }, import_sent);
}
function import_sent(out) {
  IMPORT.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    IMPORT.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $2("#import").showPopover();
}
function import_plan2() {
  const form = new FormData($2("#import form", HTMLFormElement));
  const want = { off: [...IMPORT.off], since: import_since(), tools: form.has("tools") };
  const found = [...IMPORT.found.values()].flatMap((read) => read.sessions);
  return import_plan(found, want, IMPORT.done);
}
function import_since() {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 86400000).toISOString().slice(0, 10) : "";
}
function import_bar() {
  const run = v.importing;
  IMPORT.step = run !== null ? "seen" : IMPORT.step === "seen" ? "done" : IMPORT.step;
  const done = IMPORT.step === "done";
  const going = ["send", "run", "seen", "done"].includes(IMPORT.step);
  const part = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why = Boolean(run?.why);
  const said = run !== null ? progress_show(run) : done ? DONE : IMPORT.step === "send" ? "Sending…" : "Starting…";
  $2("#import .start").hidden = IMPORT.step !== "start";
  $2("#import form").hidden = going || IMPORT.step === "start";
  $2("#import .prog").hidden = !going;
  $2("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $2("#import progress", HTMLProgressElement).value = part;
  $2(".imping progress", HTMLProgressElement).value = part;
  $2(".imping").hidden = run === null;
  $2(".imping").classList.toggle("why", why);
  $2(".imping span").textContent = why ? "Import paused" : "Building memory";
  $2(".imping").title = $2("#import .pct").textContent = said;
  $2("#import .prog .sub").hidden = why || done;
  $2("#import .flow").textContent = why ? "Resume" : "Pause";
  $2("#import .flow", HTMLButtonElement).hidden = run === null;
  return going;
}
function import_draw(status) {
  if (import_bar()) {
    return;
  }
  const reads = [...IMPORT.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan = import_plan2();
  const msgs = plan.msgs;
  const left = reads.reduce((n, read) => n + read.moved, 0);
  const moved = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const found = sessions.length === 0 ? "" : plan.first === "" ? OLD : import_count(msgs, "new ");
  const day = (at) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 86400000));
  BACK.max = String(Math.floor(Date.now() / 86400000));
  $2("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $2("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", 100 * (BACK.valueAsNumber - Number(BACK.min)) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $2("#import .want").hidden = plan.first === "";
  $2("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $2("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list = must(src.querySelector(".sessions"), "#import .sessions");
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${esc(s.where + ", " + import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${esc(import_id(s))}">${import_cells(s).map((c) => `<span>${esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => box.checked = !IMPORT.off.has(box.value));
    const on = shown.filter((s) => !IMPORT.off.has(import_id(s))).length;
    find(src, ".pick", HTMLElement).hidden = shown.length === 0;
    must(src.querySelector(".pick summary"), "#import .pick summary").textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $2("#import .guess").textContent = status;
  const [go, dir] = [$2("#import .go", HTMLButtonElement), $2(".pickdir", HTMLButtonElement)];
  go.hidden = msgs === 0;
  go.disabled = status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => find(src, ".pickzip", HTMLButtonElement).disabled = dir.disabled);
}
function import_srcs() {
  return [...document.querySelectorAll("#import .src")];
}
async function import_copy(file) {
  const reader = file.stream().getReader();
  const parts = [];
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}
var MARKUP = new WeakMap;
function markup(el, htmls) {
  const had = new Map;
  for (const child of el.children) {
    const html = MARKUP.get(child);
    const same = had.get(html) ?? [];
    same.push(child);
    had.set(html, same);
  }
  const kids = htmls.map((html) => had.get(html)?.shift() ?? html_parse(html));
  for (const left of had.values()) {
    left.forEach((child) => child.remove());
  }
  let at = el.firstElementChild;
  for (const kid of kids) {
    if (kid === at) {
      at = at.nextElementSibling;
    } else {
      el.insertBefore(kid, at);
    }
  }
}
function html_parse(html) {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = must(made.content.firstElementChild, "an element in " + html.slice(0, 40));
  MARKUP.set(child, html);
  return child;
}
function draw2(stick) {
  SCROLL.stick = SCROLL.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(() => {
      paint();
      mine_show();
    });
  }
}
function paint() {
  if ($2("#log").hidden) {
    P.frame = 0;
    SCROLL.stick = true;
    bars();
    return;
  }
  const doc = document.documentElement;
  const follow = SCROLL.stick && SCROLL.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = shown_key();
  P.frame = 0;
  SCROLL.stick = true;
  bars();
  if (P.rows) {
    markup($2("#log .rows"), view_body(v).map(row_html));
    box_sizes($2("#log .rows"));
    P.rows = false;
  }
  markup($2("#log .tail"), view_tail(v).map(row_html));
  box_sizes($2("#log .tail"));
  folds();
  frames();
  const back = RENEW.back === null ? null : document.querySelector(`#log [data-a="${RENEW.back.a}"]`);
  if (back !== null && RENEW.back !== null) {
    P.shown = shown;
    scrollBy(0, back.getBoundingClientRect().top - RENEW.back.top);
    RENEW.back = null;
    SCROLL.end = at_end();
    return;
  }
  if (shown !== P.shown) {
    P.shown = shown;
    SCROLL.end = v.fold === null;
    scrollTo(0, v.fold === null ? doc.scrollHeight : 0);
    return;
  }
  if (follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    SCROLL.end = at_end();
  }
}
function shown_key() {
  return (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
}
function at_end() {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}
function bars() {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  if (RENEW.due && !RENEW.going && renew_free()) {
    RENEW.going = true;
    setTimeout(() => void renew());
  }
  const on = view_typing(v);
  const stop = on && v.busy && box_blank();
  const tabs = view_tabs(v);
  const send = $2(".send", HTMLButtonElement);
  $2(".net").hidden = v.up;
  $2(".timers").hidden = v.timers.length === 0;
  $2(".timers span").textContent = String(v.timers.length);
  markup($2("#timers ul"), timers_html(v.timers));
  if (v.timers.length === 0 && $2("#timers").matches(":popover-open")) {
    $2("#timers").hidePopover();
  }
  send.classList.toggle("stop", stop);
  $2(".composer").hidden = !on;
  $2(".mic", HTMLButtonElement).disabled = v.out.some((p) => p.msg.$ === "voice");
  $2(".mic").classList.toggle("rec", P.rec !== null);
  $2(".composer").classList.toggle("rec", P.rec !== null);
  const knob = document.activeElement?.dataset?.knob;
  markup($2("#pick"), pick_html(view_fold(v), v.fold === null, view_shown(v), v.page === null ? v.talk : undefined));
  if (knob !== undefined) {
    $2("#pick [data-knob=" + knob + "]").focus();
  }
  mcp_draw();
  $2("#tabs").hidden = tabs.length < 2;
  markup($2("#tabs"), tabs_html(tabs));
  import_bar();
}
function anchor() {
  for (const r of document.querySelectorAll("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}
function mine() {
  const rows = [...document.querySelectorAll("#log .msg.user")];
  const el = rows.findLast(mine_above);
  if (el !== undefined) {
    SCROLL.end = false;
    el.scrollIntoView();
  }
  mine_show();
}
function mine_show() {
  const first = document.querySelector("#log .msg.user");
  $2(".mine").hidden = first === null || !mine_above(first);
  $2(".down").hidden = SCROLL.end || innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}
function down2() {
  scrollTo(0, document.documentElement.scrollHeight);
  SCROLL.end = true;
  mine_show();
}
function mine_above(el) {
  return el.getBoundingClientRect().top < $2("header").getBoundingClientRect().bottom;
}
function go(path) {
  if (location.pathname + location.hash !== path) {
    history.pushState(null, "", path);
  }
  route();
}
function route() {
  const page = PAGES.includes(location.pathname);
  const tree = location.pathname === TREE;
  const chat = !page && !tree;
  if (!chat && !$2("#log").hidden && SCROLL.away === null) {
    SCROLL.away = { y: scrollY, end: SCROLL.end };
  }
  $2("#log").hidden = !chat;
  document.body.classList.toggle("account", page);
  document.body.classList.toggle("tree", tree);
  $2("#account").hidden = !page;
  $2("#tree").hidden = !tree;
  P.at = location.pathname + location.hash;
  P.shown = chat && SCROLL.away !== null ? shown_key() : location.pathname;
  if (chat && SCROLL.away !== null) {
    SCROLL.end = SCROLL.away.end;
    P.rows = true;
    paint();
    scrollTo(0, SCROLL.end ? document.documentElement.scrollHeight : SCROLL.away.y);
    SCROLL.y = scrollY;
    SCROLL.away = null;
  }
  if (page) {
    account();
  }
  if (tree) {
    tree_show(tree_view() ? "VIEW" : "TREE");
  } else {
    tree_hide();
  }
  draw2(chat && SCROLL.end);
}
function popped() {
  if (location.pathname + location.hash !== P.at) {
    route();
  }
  viewer_sync();
  draw2(true);
}
async function account() {
  const el = $2("#account");
  const [got, set] = await Promise.all([fetch("/api/prompts").catch(() => null), fetch("/api/settings").catch(() => null)]);
  const prompts = got !== null && got.ok ? await got.json().catch(() => null) : null;
  const push = await notify_state().catch(() => null);
  el.innerHTML = account_html(prompts, push);
  RENEW.dirty.clear();
  el.oninput = (ev) => {
    const form = ev.target.closest("form");
    if (form !== null) {
      RENEW.dirty.add(form);
    }
  };
  el.querySelectorAll("form.prompt").forEach((form) => form.onsubmit = (ev) => {
    ev.preventDefault();
    account_prompt(form);
  });
  mcp_draw();
  el.querySelectorAll(".retry").forEach((retry) => retry.onclick = () => void account());
  $2("#account .out").onclick = () => void signout();
  const bell = document.querySelector("#account .notify");
  bell?.addEventListener("click", () => {
    bell.disabled = true;
    notify(push !== "on");
  });
  const page = set?.ok ? await set.json().catch(() => null) : null;
  if (page === null) {
    $2("#account .owned").innerHTML = `<p class="sub">Could not read the server's settings. Try again in a moment.</p>`;
    return;
  }
  settings_draw(page);
}
function mcp_draw() {
  const box = document.querySelector("#account .mcp");
  if (box === null || v.pick === null) {
    return;
  }
  const active = document.activeElement;
  const on = active !== null && box.contains(active) ? active.getAttribute("aria-label") : null;
  markup(box, mcp_html(v.mcp));
  [...box.querySelectorAll("[role=switch]")].find((b) => b.getAttribute("aria-label") === on)?.focus();
}
async function signout() {
  await notify_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
  await post("/api/logout", {});
  location.href = "/";
}
async function account_prompt(form) {
  const area = find(form, "textarea", HTMLTextAreaElement);
  const why = must(form.querySelector(".why"), "the prompt's why");
  const save = find(form, "button", HTMLButtonElement);
  const sent = area.value;
  save.disabled = true;
  RENEW.saving++;
  const out = await post("/api/prompts", { [area.name]: sent });
  RENEW.saving--;
  save.disabled = false;
  const saved = get(out[area.name], "text");
  if (out.error === undefined && area.value === sent) {
    area.value = text_of(saved, sent);
  }
  why.textContent = text_of(out.error, area.value === saved ? "Saved." : "Not saved yet: Save again.");
  form.classList.toggle("bad", out.error !== undefined);
  if (out.error === undefined && area.value === sent) {
    RENEW.dirty.delete(form);
    RENEW.since = true;
  }
  draw2(false);
}
async function notify_state() {
  P.push = null;
  if (APP !== null) {
    return null;
  }
  if (navigator.serviceWorker === undefined || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) ? "home" : null;
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  const wait = new Promise((ok) => setTimeout(ok, 3000, undefined));
  const reg = await navigator.serviceWorker.getRegistration() ?? await Promise.race([navigator.serviceWorker.ready, wait]);
  const sub = await notify_sub();
  const query = sub === null ? "" : "?endpoint=" + encodeURIComponent(sub.endpoint);
  const res = await fetch("/api/webpush" + query).catch(() => null);
  const out = res?.ok ? await res.json() : null;
  if (reg === undefined || out === null || out.key === null) {
    return null;
  }
  P.push = { reg, key: out.key };
  return out.on && notify_keyed(sub, out.key) ? "on" : "off";
}
function notify_keyed(sub, key) {
  const had = sub?.options.applicationServerKey;
  return had != null && notify_bytes(key).join() === new Uint8Array(had).join();
}
function notify_bytes(key) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
async function notify_sub() {
  const reg = await navigator.serviceWorker?.getRegistration();
  return await reg?.pushManager.getSubscription() ?? null;
}
async function notify(on) {
  const push = P.push;
  if (push === null) {
    return;
  }
  const what = on ? "on" : "off";
  try {
    const out = on ? await notify_on(push.reg, push.key) : await notify_off(push.reg);
    toast(text_of(out.error, "Notifications are " + what + "."));
  } catch (err) {
    const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
    toast(denied ? "Notifications are blocked in this browser's settings." : "Could not turn notifications " + what + ": " + err_why(err));
  }
  account();
}
async function notify_on(reg, key) {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || get(err, "name") !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return post("/api/webpush", sub.toJSON());
}
async function notify_off(reg) {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}
function settings_draw(page) {
  $2("#account .owned").innerHTML = settings_html(page);
  const form = $2("#account form.settings", HTMLFormElement);
  const rows = new Map(page.settings.map((r) => [r.key, r]));
  const unset = new Set;
  const profs = Object.entries(page.profiles ?? {});
  const box = form.querySelector(".profiles .field");
  const names = () => profs.map(([name]) => name.trim()).filter((name) => name !== "");
  const listed = (key) => {
    const boxes = [...form.querySelectorAll(`input[name="${key}"]`)];
    return boxes.length === 0 ? list2(rows.get(key)?.value ?? "") : boxes.filter((b) => b.checked).map((b) => b.value);
  };
  const picks = () => {
    const vendors = listed("vendors");
    form.querySelectorAll(".opt[data-vendor]:not([data-vendor=''])").forEach((o) => o.hidden = !(o.dataset.vendor ?? "").split(" ").some((v) => vendors.includes(v)));
    for (const key of PICKS) {
      const value = form.querySelector(`input[name="${key}"]`);
      const four = value?.parentElement?.querySelector(".four");
      if (value && four) {
        const focus = document.activeElement?.name;
        four.innerHTML = picks_html(key, vendors, listed("models"), value.value, key === "agents" ? "The chat's pick" : null, names());
        four.querySelector(`select[name="${focus}"]`)?.focus();
      }
    }
    const keyless = vendors.filter((v) => {
      const name = VENDOR_KEY[v];
      const key = page.keys.find((k) => k.name === name);
      const typed = form.querySelector(`[name="key.${name}"]`)?.value.trim() ?? "";
      return key !== undefined && (key.from === "default" || unset.has("key." + name)) && typed === "";
    });
    const warn = form.querySelector(".warn");
    if (warn !== null) {
      warn.textContent = keyless.length === 0 ? "" : keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is.";
    }
  };
  form.oninput = (ev) => {
    const el = ev.target.closest(".set");
    if (el === null) {
      return;
    }
    unset.delete(el.dataset.key ?? "");
    el.classList.remove("unset");
    must(el.querySelector(".err"), "the setting's err").textContent = "";
    const value = el.querySelector("input[type=hidden]");
    if (value !== null) {
      value.value = pick_mend([...el.querySelectorAll("select")].map((s) => s.value), listed("models"), names());
    }
    picks();
    if (el.dataset.key === "vendors" || el.dataset.key === "models") {
      profs_draw();
    }
  };
  form.onclick = (ev) => {
    const btn = ev.target.closest(".reset");
    if (btn === null) {
      return;
    }
    const el = must(btn.closest(".set"), "the reset's setting");
    const key = el.dataset.key ?? "";
    const r = rows.get(key);
    el.querySelectorAll("input[type=checkbox]").forEach((b) => b.checked = list2(r?.def ?? "").includes(b.value));
    el.querySelectorAll("input:not([type=checkbox]), textarea").forEach((i) => i.value = r?.def ?? "");
    picks();
    unset.add(key);
    el.classList.add("unset");
    btn.hidden = true;
    must(el.querySelector(".from"), "the setting's from").insertAdjacentText("beforeend", key.startsWith("key.") ? " · removed once saved" : " · the default once saved");
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    settings_save(form, page, unset, listed, profs);
  };
  const profs_draw = (focus) => {
    if (box !== null) {
      box.innerHTML = profiles_html(profs, offered(listed("vendors"), listed("models")));
      (focus === undefined ? null : box.querySelector(focus) ?? box.querySelector(".pnew"))?.focus();
    }
  };
  const profs_changed = (focus) => {
    profs_draw(focus);
    must(box?.closest(".set")?.querySelector(".err"), "the profiles' err").textContent = "";
    picks();
  };
  const renamed = (was, now) => {
    for (const key of PICKS) {
      const value = form.querySelector(`input[name="${key}"]`);
      if (value !== null && was.trim() !== "" && now !== "" && value.value === was.trim()) {
        value.value = now;
      }
    }
  };
  box?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    const [i, j] = [Number(b?.dataset.i), Number(b?.dataset.j)];
    if (b?.classList.contains("pnew")) {
      profs.push(["", []]);
      profs_changed(`.pname[data-i="${profs.length - 1}"]`);
    } else if (b?.classList.contains("pdel")) {
      profs.splice(i, 1);
      profs_changed(".pnew");
    } else if (b?.classList.contains("out")) {
      profs[i][1].splice(j, 1);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("change", (ev) => {
    const add = ev.target.closest("select.add");
    if (add !== null && add.value !== "") {
      const i = Number(add.dataset.i);
      profs[i][1].push(add.value);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("input", (ev) => {
    const name = ev.target.closest("input.pname");
    if (name !== null) {
      const i = Number(name.dataset.i);
      renamed(profs[i][0], name.value.trim());
      profs[i][0] = name.value;
    }
  });
  box?.addEventListener("keydown", (ev) => {
    const grip = ev.target.closest(".grip");
    if (grip === null || ev.key !== "ArrowUp" && ev.key !== "ArrowDown") {
      return;
    }
    ev.preventDefault();
    const [i, j] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    const k = j + (ev.key === "ArrowUp" ? -1 : 1);
    const list = profs[i][1];
    if (k >= 0 && k < list.length) {
      [list[j], list[k]] = [list[k], list[j]];
      profs_changed(`.grip[data-i="${i}"][data-j="${k}"]`);
    }
  });
  box?.addEventListener("pointerdown", (ev) => {
    const grip = ev.target.closest(".grip");
    if (grip === null || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const li = must(grip.closest("li"), "the grip's row");
    const ol = must(li.parentElement, "the grip's list");
    const [i, from] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    li.classList.add("drag");
    const move = (e) => {
      const below = [...ol.children].find((c) => c !== li && e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      if (below !== li.nextElementSibling || below === undefined) {
        ol.insertBefore(li, below ?? null);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const to = [...ol.children].indexOf(li);
      const list = profs[i][1];
      list.splice(to, 0, ...list.splice(from, 1));
      profs_changed(`.grip[data-i="${i}"][data-j="${to}"]`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  profs_draw();
  picks();
}
async function settings_save(form, page, unset, listed, profs) {
  const set = {};
  const keys = {};
  for (const r of page.settings) {
    if (form.querySelector(`.set[data-key="${r.key}"]`) === null) {
      continue;
    }
    const field = form.querySelector(`input[name="${r.key}"]`);
    const now = r.key === "vendors" || r.key === "models" ? list_changed(list2(r.value), listed(r.key))?.join(",") ?? r.value : field?.value.trim() ?? r.value;
    if (unset.has(r.key)) {
      set[r.key] = null;
    } else if (now !== r.value) {
      set[r.key] = now;
    }
  }
  for (const k of page.keys) {
    const typed = form.querySelector(`[name="key.${k.name}"]`)?.value.trim() ?? "";
    if (unset.has("key." + k.name)) {
      keys[k.name] = null;
    } else if (typed !== "") {
      keys[k.name] = typed;
    }
  }
  const why = must(form.querySelector(".save .why"), "the save's why");
  form.querySelectorAll(".err").forEach((e) => e.textContent = "");
  let profiles;
  if (page.profiles != null) {
    const now = profs.map(([name, list]) => [name.trim(), list]);
    const all = now.map(([name]) => name);
    const bad = all.includes("") ? "Name each profile." : all.some((name, k) => all.indexOf(name) !== k) ? "Two profiles have the same name." : now.some(([, list]) => list.length === 0) ? "Add a model to each profile." : null;
    if (bad !== null) {
      const at = find(form, ".profiles", HTMLElement);
      must(at.querySelector(".err"), "the profiles' err").textContent = bad;
      at.scrollIntoView({ block: "center" });
      return;
    }
    const was = JSON.stringify(page.profiles);
    profiles = JSON.stringify(Object.fromEntries(now)) === was ? undefined : Object.fromEntries(now);
  }
  if (Object.keys(set).length === 0 && Object.keys(keys).length === 0 && profiles === undefined) {
    why.textContent = "Nothing changed.";
    return;
  }
  const go = find(form, ".go", HTMLButtonElement);
  go.disabled = true;
  why.textContent = "";
  RENEW.saving++;
  const out = await post("/api/settings", { version: page.version, set, keys, ...profiles === undefined ? {} : { profiles } });
  RENEW.saving--;
  go.disabled = false;
  if (!out.ok) {
    const at = out.key === undefined ? null : form.querySelector(`.set[data-key="${text_of(out.key, "null")}"]`);
    (at?.querySelector(".err") ?? why).textContent = text_of(out.error, "Could not save.");
    (at ?? why).scrollIntoView({ block: "center" });
    return;
  }
  const done = out;
  const later = done.saved.filter((key) => page.settings.find((r) => r.key === key)?.apply === "restart");
  settings_draw(done);
  RENEW.dirty.delete(form);
  RENEW.since = true;
  draw2(false);
  toast(later.length === 0 ? "Saved." : "Saved. " + later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
}
function renew_due(build) {
  if (build === undefined || build_same(build)) {
    RENEW.build ||= build ?? "";
    RENEW.due = false;
    return;
  }
  if (reloads_spent_on(build)) {
    RENEW.gave = v.ws;
    return;
  }
  RENEW.since = RENEW.due && RENEW.since;
  RENEW.due = true;
  draw2(false);
}
function build_same(build) {
  return RENEW.build === "" || build === RENEW.build;
}
function reloads_spent_on(build) {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  return was === build && Number(n) >= 2 && (RENEW.gave === null || RENEW.gave === v.ws);
}
function renew_free(hidden = false) {
  const page = location.pathname !== "/" && location.pathname !== TREE;
  const quiet = P.rec === null && UPS.size === 0 && v.out.length === 0 && !$2("#import").matches(":popover-open") && !viewer_on();
  const typing = !DESK.matches && box_focused() && !hidden;
  return quiet && !typing && (!page || RENEW.since && RENEW.dirty.size === 0 && RENEW.saving === 0);
}
async function renew(hidden = false) {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  const tries = was === v.build ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = await store?.keys().catch(() => []) ?? [];
  await Promise.all(store === null ? [] : keys.filter((k) => k.startsWith("unii-shell")).map((k) => store.delete(k)));
  if (tries > 0) {
    await Promise.all(["/", "/app.js", "/style.css", "/sw.js"].map((path) => fetch(path, { cache: "reload" }).catch(() => null)));
  }
  if (!RENEW.due || !renew_free(hidden)) {
    RENEW.going = false;
    return;
  }
  const chat = !$2("#log").hidden;
  const back = { at: chat && !SCROLL.end ? anchor() : null, y: chat ? null : scrollY, away: SCROLL.away, caret: box_caret(), focus: box_focused(), open: [...SCROLL.open] };
  sessionStorage.setItem(kept("back"), JSON.stringify(back));
  sessionStorage.setItem(kept("build"), (v.build ?? "") + " " + (tries + 1));
  location.reload();
}
function renewed() {
  const text = sessionStorage.getItem(kept("back"));
  sessionStorage.removeItem(kept("back"));
  const back = text === null ? null : JSON.parse(text);
  if (back === null) {
    return;
  }
  if (back.focus && DESK.matches) {
    box_focus();
  }
  box_place(back.caret[0], back.caret[1]);
  back.open.forEach((id) => SCROLL.open.add(id));
  RENEW.back = back.at;
  SCROLL.away = back.away;
  const end = Date.now() + 3000;
  const y = () => {
    const to = back.y;
    if (to !== null) {
      if (document.documentElement.scrollHeight >= to + innerHeight || Date.now() > end) {
        scrollTo(0, to);
      } else {
        setTimeout(y, 100);
      }
    }
  };
  y();
}
function toast(text, stay = false) {
  const el = $2("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = stay ? 0 : setTimeout(() => el.hidden = true, 7000);
}
function intro_play() {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end() {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK.matches) {
        BOX2.focus();
      }
    }
    el.id = "intro";
    el.innerHTML = SCENES;
    el.onclick = end;
    el.onanimationend = (ev) => {
      if (ev.target === el) {
        end();
      }
    };
    addEventListener("keydown", end);
    document.documentElement.append(el);
  });
}
var INTRO = intro_play();
boot();
