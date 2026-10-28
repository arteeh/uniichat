import { ENTITIES } from "./Entities.ts";
import * as Names from "./Names.ts";

export type Span =
  | { $: "Text"; x: string }
  | { $: "Code"; x: string }
  | { $: "Bold"; x: Span[] }
  | { $: "Ital"; x: Span[] }
  | { $: "Strk"; x: Span[] }
  | { $: "Link"; x: Span[]; k: string; t: string }
  | { $: "Pict"; x: string; k: string; t: string }
  | { $: "Name"; x: string }
  | { $: "Brk" };

export type Code = { $: "Code"; k: string; x: string };

export type Line = { s: " " | "-" | "+"; n: number; x: string };

export type Block =
  | { $: "Para"; x: Span[] }
  | { $: "Head"; k: number; x: Span[] }
  | Code
  | { $: "Rule" }
  | { $: "Quot"; x: Block[] }
  | { $: "List"; k: boolean; n: number; t: boolean; x: Block[][]; c: Array<boolean | null> }
  | { $: "Tabl"; x: Span[][][]; a: string[] }
  | { $: "Diff"; k: string; x: Line[][] }
  | { $: "File"; k: string; n: number; x: string[] }

const ONLY  = new RegExp("^(?:" + Names.NAME + ")$");
export const MEDIA: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"], ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"], ["webm", "video/webm"], ["mov", "video/quicktime"],
  ["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"], ["ogg", "audio/ogg"], ["opus", "audio/ogg"], ["wav", "audio/wav"], ["weba", "audio/webm"],
  ["html", "text/html"],
]);
export const MEDIA_AS: ReadonlyMap<string, string> = new Map([["jpg", "jpeg"], ["m4v", "mp4"], ["oga", "ogg"], ["htm", "html"]]);
const MEDIA_URL = /\/media\/[0-9a-f]{16}\.[a-z0-9]{1,10}(?=\))/y;
const STORED = /^\/media\/[0-9a-f]{16}\.[a-z0-9]{1,10}$/;
const LIST  = /^ {0,3}([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TASK  = /^\[([ xX])\](?=[ \t]|$)[ \t]?/;
const PUNCT = /[\p{P}\p{S}]/u;
const AUTO  = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/iy;
const MAIL  = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const BARE  = /https?:\/\/|www\./iy;
const LOCAL = /[A-Za-z0-9._+-]/;
const EMAIL = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/y;
const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const HEAD  = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const QUOT  = /^ {0,3}>[ \t]?/;
const ROW   = /^\s*\|.*\|\s*$/;
const PIPE  = /(?<!\\)\|/;
const CELL  = /^[ \t]*:?-+:?[ \t]*$/;
const NEW   = /^\+\+\+ (.*)$/;
const READ  = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
const FAILED = "error: ";
const HUNK  = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MARKS = /^(?:\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\s*>\s?)*/;

const LINK_PARENS_MAX = 32;

const NESTING_MAX = 16;

const LABEL_SCAN_MAX = 1000;

let DEFS = new Map<string, { k: string; t: string }>();
let COLLECT = false;

let UNSHUT: { lines: string[]; from: Map<string, [number, number]> } = { lines: [], from: new Map() };

function Text(x: string): Span {
  return { $: "Text", x };
}

function Name(x: string): Span {
  return { $: "Name", x };
}

type Node = { x: Span; m: Mark | null; prev: Node | null; next: Node | null };

type Mark = { c: string; n: number; len: number; open: boolean; close: boolean; at: number; node: Node; prev: Mark | null; next: Mark | null };

function span_parse(s: string): Span[] {
  if (COLLECT) {
    return [];
  }
  const head: Node = { x: Text(""), m: null, prev: null, next: null };
  let tail = head;
  let marks: Mark | null = null;
  const brackets: Mark[] = [];
  let [links, dead] = [0, 0];
  const ticks = ticks_at(s);
  const unshut = new Map<string, number>();
  let [i, text] = [0, ""];
  const add = (x: Span, m: Mark | null = null): Node => {
    const node: Node = { x, m, prev: tail, next: null };
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
  const put = (x: Span) => {
    flush();
    add(x);
  };
  const mark = (c: string, n: number, open: boolean, close: boolean) => {
    flush();
    const node = add(Text(c === "[" || c === "![" ? c : c.repeat(n)));
    const m: Mark = { c, n, len: n, open, close, at: i, node, prev: marks, next: null };
    node.m = m;
    if (marks !== null) {
      marks.next = m;
    }
    marks = m;
    return m;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && (s[i + 1] === "\n" || (PUNCT.test(s[i + 1]) && s.charCodeAt(i + 1) < 128))) {
      if (s[i + 1] === "\n") {
        text = text.trimEnd();
        put({ $: "Brk" });
      } else {
        text += s[i + 1];
      }
      i += 2;
    } else if (c === "\n") {
      text = text.trimEnd();
      put({ $: "Brk" });
      for (i++; s[i] === " " || s[i] === "\t"; i++);
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
    } else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
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
        const x = STORED.test(got.k) ? [Text(s.slice(o.at + o.c.length, i))] : nodes_spans(o.node.next);
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
      if ((c === "~" && n > 2) || (!open && !close)) {
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

  function emphasis(bottom: Mark | null): void {
    const floor = new Map<string, Mark | null>();
    let closer = bottom === null ? marks_first(marks) : bottom.next;
    while (closer !== null) {
      if (closer.c === "[" || closer.c === "![" || !closer.close) {
        closer = closer.next;
        continue;
      }
      const key = closer.c + closer.open + (closer.len % 3);
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
      // (bold right in bold is drawn as one, as GitHub does)
      const x = use === 2 && c !== "~" ? inner.flatMap((y) => (y.$ === "Bold" ? y.x : [y])) : inner;
      const made: Node = { x: c === "~" ? { $: "Strk", x } : use === 2 ? { $: "Bold", x } : { $: "Ital", x }, m: null, prev: opener.node, next: closer.node };
      opener.node.next = made;
      closer.node.prev = made;
      for (let m = opener.next; m !== closer && m !== null; ) {
        const next: Mark | null = m.next;
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

  function node_drop(node: Node): void {
    const prev = node.prev ?? head;
    prev.next = node.next;
    if (node.next !== null) {
      node.next.prev = node.prev;
    } else {
      tail = prev;
    }
  }
}

function mark_drop(marks: Mark | null, m: Mark): Mark | null {
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

function marks_first(marks: Mark | null): Mark | null {
  let m = marks;
  while (m?.prev) {
    m = m.prev;
  }
  return m;
}

function nodes_spans(from: Node | null, upto: Node | null = null): Span[] {
  const out: Span[] = [];
  for (let n = from; n !== null && n !== upto; n = n.next) {
    spans_push(out, n.x);
  }
  return out;
}

function link_ref(s: string, i: number, from: number): { k: string; t: string; end: number } | null {
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

function def_label(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

function entity(s: string): string | null {
  const num = /^&#([xX]?)([0-9a-fA-F]+);$/.exec(s);
  if (num !== null) {
    const n = parseInt(num[2], num[1] === "" ? 10 : 16);
    return String.fromCodePoint(n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n);
  }
  return ENTITIES.get(s.slice(1, -1)) ?? null;
}

function url_of(k: string): string {
  return text_unescape(k).replace(/ /g, "%20");
}

function text_unescape(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])|&#?[0-9A-Za-z]{1,32};/g, (m: string, esc: string | undefined) => esc ?? entity(m) ?? m);
}

function spans_push(spans: Span[], span: Span): void {
  const last = spans[spans.length - 1];
  if (span.$ === "Text" && last?.$ === "Text") {
    spans[spans.length - 1] = Text(last.x + span.x);
  } else if (span.$ !== "Text" || span.x !== "") {
    spans.push(span);
  }
}

export function spans_text(spans: Span[]): string {
  return spans.map((x) => (x.$ === "Brk" ? " " : x.$ === "Name" ? "[" + x.x + "]" : typeof x.x === "string" ? x.x : spans_text(x.x))).join("");
}

function run_len(s: string, i: number, c: string): number {
  let j = i;
  while (s[j] === c) {
    j++;
  }
  return j - i;
}

function ticks_at(s: string): (from: number, n: number) => number {
  const runs = new Map<number, number[]>();
  for (let i = s.indexOf("`"); i >= 0; i = s.indexOf("`", i)) {
    const n = run_len(s, i, "`");
    const at = runs.get(n) ?? [];
    runs.set(n, at);
    at.push(i);
    i += n;
  }
  const seen = new Map<number, number>();
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

// whether a run of n c's at i may open and may close emphasis (GFM's
// left- and right-flanking runs; _ not inside a word)
function flanks(s: string, i: number, n: number, c: string): [boolean, boolean] {
  const before = s[i - 1] ?? " ";
  const after  = s[i + n] ?? " ";
  const space  = (x: string) => /\s/.test(x);
  const left   = !space(after) && (!PUNCT.test(after) || space(before) || PUNCT.test(before));
  const right  = !space(before) && (!PUNCT.test(before) || space(after) || PUNCT.test(after));
  return c === "_" ? [left && (!right || PUNCT.test(before)), right && (!left || PUNCT.test(after))] : [left, right];
}

function link_tail(s: string, i: number, unshut: Map<string, number>): { k: string; t: string; end: number } | null {
  if (s[i] !== "(") {
    return null;
  }
  let j = i + 1;
  const skip = () => {
    while (s[j] === " " || s[j] === "\t" || s[j] === "\n") {
      j++;
    }
  };
  skip();
  let k = "";
  if (s[j] === "<") {
    let e = j + 1;
    for (; e < s.length && s[e] !== ">" && s[e] !== "<" && s[e] !== "\n"; e++) {
      e += s[e] === "\\" ? 1 : 0;
    }
    if (s[e] !== ">") {
      return null;
    }
    [k, j] = [s.slice(j + 1, e), e + 1];
  } else {
    let depth = 0;
    const from = j;
    for (; j < s.length && !/[\s\x00-\x1f]/.test(s[j]); j++) {
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

function title_end(s: string, j: number, q: string, unshut: Map<string, number>): number {
  if (j >= (unshut.get(q) ?? Infinity)) {
    return -1;
  }
  for (let e = j; e < s.length; e++) {
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

function link_safe(k: string): boolean {
  return /^(?:https?:\/\/|mailto:)[^\s\x00-\x1f]*$/i.test(k) || /^\/(?![\/\\])[^\s\x00-\x1f]*$/.test(k) || k === "/";
}

// a bare url at i: to a space, a control character or <, its end's
// punctuation dropped, and a ) more than it opens (GFM's extended
// autolinks): its parentheses counted once, its end then trimmed back
function url_bare(s: string, i: number): string {
  let [j, open, shut] = [i, 0, 0];
  for (; j < s.length && !/[\s<\x00-\x1f\x7f]/.test(s[j]); j++) {
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

function entity_back(s: string, i: number, semi: number): number {
  let k = semi;
  while (k > i && /[A-Za-z0-9]/.test(s[k - 1])) {
    k--;
  }
  return k < semi && k > i && s[k - 1] === "&" ? k - 1 : -1;
}

export function md_flat(s: string): string {
  return spans_text(span_parse(s));
}

export function md_pasted(s: string): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = [];
  for (let k = s.indexOf("](/media/"); k >= 0; k = s.indexOf("](/media/", k + 1)) {
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

export function md_output(s: string, name = "result"): Block[] {
  const lines = s.replace(/\r/g, "").split("\n");
  const read  = READ.exec(lines[lines.length - 1]);
  if (read !== null) {
    return [{ $: "File", k: name === "result" ? read[1] : name + " · " + read[1], n: Number(read[2]), x: lines.slice(0, -1) }];
  }
  const out: Block[] = [];
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

function label_open(s: string, close: number): number {
  let a = close - 1;
  while (a >= 0 && close - a <= LABEL_SCAN_MAX && s[a] !== "[" && s[a] !== "]" && s[a] !== "\n") {
    a--;
  }
  return a;
}

export function md_shown(s: string, name = "result"): Block[] {
  const out: Block[] = [];
  const failed = s.startsWith(FAILED);
  let error_owed = failed;
  let rest: string[] = [];
  const said = () => {
    out.push(...md_output(rest.join("\n"), name));
    rest = [];
  };
  for (const line of s.slice(failed ? FAILED.length : 0).replace(/\r/g, "").split("\n")) {
    const media = md_pasted(line);
    if (media.length === 1 && media[0][0] === 0 && media[0][1] === line.length) {
      said();
      out.push({ $: "Para", x: [{ $: "Pict", x: media[0][2], k: media[0][3], t: "" }] });
    } else {
      rest.push(error_owed ? FAILED + line : line);
      error_owed = false;
    }
  }
  rest.push(...(error_owed ? [FAILED.trim()] : []));
  said();
  return out;
}

function output_lines(lines: string[], name: string): Block[] {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: name, n: 1, x: lines.slice(from, upto + 1) }];
}

function diff_parse(lines: string[], i: number): [Block | null, number] {
  const file  = NEW.exec(lines[i + 1] ?? "");
  const hunks : Line[][] = [];
  if (file === null || !lines[i].startsWith("--- ")) {
    return [null, i + 1];
  }
  let j = i + 2;
  for (let h = HUNK.exec(lines[j] ?? ""); h !== null; h = HUNK.exec(lines[j] ?? "")) {
    const [hunk, next] = hunk_parse(lines, j + 1, h);
    if (hunk === null) {
      return [null, i + 1];
    }
    hunks.push(hunk);
    j = next;
  }
  return hunks.length === 0 ? [null, i + 1] : [{ $: "Diff", k: file[1], x: hunks }, j];
}

function hunk_parse(lines: string[], j: number, h: RegExpExecArray): [Line[] | null, number] {
  let [olds, news] = [Number(h[2] ?? 1), Number(h[4] ?? 1)];
  let [o, n] = [Number(h[1]), Number(h[3])];
  const out: Line[] = [];
  for (; olds > 0 || news > 0; j++) {
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

export function md_parse(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  try {
    COLLECT = src.includes("]:");
    if (COLLECT) {
      blocks_parse(lines, 0);
      COLLECT = false;
    }
    return blocks_parse(lines, 0)[0];
  } finally {
    COLLECT = false;
    DEFS = new Map();
    UNSHUT = { lines: [], from: new Map() };
  }
}

function def_at(lines: string[], i: number): { label: string; k: string; t: string; next: number } | null {
  const first = indent(lines[i]);
  if (first > 3 || lines[i][first] !== "[") {
    return null;
  }
  let [r, c] = [i, first + 1];
  const ch = () => (c < lines[r].length ? lines[r][c] : "\n");
  const down = () => r + 1 < lines.length && lines[r + 1].trim() !== "" && ([r, c] = [r + 1, 0], true);
  const blanks = () => {
    while (ch() === " " || ch() === "\t") {
      c++;
    }
  };
  let label = "";
  for (let x = ch(); x !== "]"; x = ch()) {
    if (x === "[" || label.length > 999 || (x === "\n" && !down())) {
      return null;
    }
    label += x === "\\" && c + 1 < lines[r].length ? x + lines[r][++c] : x;
    c += x === "\n" ? 0 : 1;
  }
  c++;
  if (ch() !== ":" || label.trim() === "" || label.length > 999) {
    return null;
  }
  c++;
  blanks();
  if (ch() === "\n" && down()) {
    blanks();
  }
  let k = "";
  const from = c;
  if (ch() === "<") {
    for (c++; ch() !== ">"; c++) {
      if (ch() === "<" || ch() === "\n") {
        return null;
      }
      c += ch() === "\\" ? 1 : 0;
    }
    k = lines[r].slice(from + 1, c++);
  } else {
    let depth = 0;
    for (; !/[\s\x00-\x1f]/.test(ch()) && !(ch() === ")" && depth === 0); c++) {
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
  const moved = ch() === "\n" && down();
  blanks();
  const q = ch() === '"' || ch() === "'" ? ch() : ch() === "(" ? ")" : null;
  if (q === null || (!moved && c === at)) {
    return bare ? def : null;
  }
  const end = title_end_lines(lines, r, c + 1, q);
  if (end === null || lines[end[0]].slice(end[1] + 1).trim() !== "") {
    return bare ? def : null;
  }
  const t = end[0] === r ? lines[r].slice(c + 1, end[1]) : [lines[r].slice(c + 1), ...lines.slice(r + 1, end[0]), lines[end[0]].slice(0, end[1])].join("\n");
  return { ...def, t: text_unescape(t), next: end[0] + 1 };
}

function title_end_lines(lines: string[], r: number, c: number, q: string): [number, number] | null {
  if (UNSHUT.lines !== lines) {
    UNSHUT = { lines, from: new Map() };
  }
  const [after, upto] = UNSHUT.from.get(q) ?? [Infinity, 0];
  if (r > after && r < upto) {
    return null;
  }
  let j = r;
  for (; j < lines.length && (j === r || lines[j].trim() !== ""); j++) {
    const l = lines[j];
    for (let e = j === r ? c : 0; e < l.length; e++) {
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

function blocks_parse(lines: string[], d: number): [Block[], boolean] {
  const out: Block[] = [];
  let [i, gap, apart] = [0, false, false];
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i, d);
    if (block === undefined) {
    } else if (block === null) {
      gap = out.length > 0;
    } else {
      [apart, gap] = [apart || gap, false];
      out.push(block);
    }
    i = next;
  }
  return [out, apart];
}

function block_parse(lines: string[], i: number, d: number): [Block | null | undefined, number] {
  const line = lines[i];
  const head = HEAD.exec(line);
  const runs = (test: (l: string, j: number) => boolean) => lines_run(lines, i, test);
  if (line.trim() === "") {
    return [null, i + 1];
  }
  const fence = fence_open(line);
  if (fence !== null) {
    // its lines as far in as its fence, that far less (GFM)
    const end = runs((l) => !fence_shuts(l, fence));
    const k = line.trim().slice(fence.length).trim();
    const pad = indent(line);
    const x = lines.slice(i + 1, end).map((l) => l.slice(Math.min(pad, indent(l)))).join("\n");
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
    // its lines, and those right under its paragraph that start no block
    // (GFM's lazy lines)
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
    return [{ $: "Code", k: "", x: body.join("\n") }, end];
  }
  const def = def_at(lines, i);
  if (def !== null) {
    const label = def_label(def.label);
    DEFS.set(label, DEFS.get(label) ?? { k: def.k, t: def.t });
    return [undefined, def.next];
  }
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j) && !SETEXT.test(l));
  const x = span_parse(lines.slice(i, end).join("\n").trim());
  const under = SETEXT.exec(lines[end] ?? "");
  return under === null ? [{ $: "Para", x }, end] : [{ $: "Head", k: under[1][0] === "=" ? 1 : 2, x }, end + 1];
}

function fence_open(line: string): string | null {
  const m = FENCE.exec(line);
  return m === null || (m[1][0] === "`" && line.slice(line.indexOf(m[1]) + m[1].length).includes("`")) ? null : m[1];
}

function fence_shuts(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length;
}

function table_head(lines: string[], i: number): string[] | null {
  const [head, bar] = [lines[i], lines[i + 1] ?? ""];
  const cells = cells_split(bar);
  const ok = bar.includes("-") && cells.every((x) => CELL.test(x)) && PIPE.test(head) && (bar.includes("|") || ROW.test(head)) && cells.length === cells_split(head).length;
  return !ok ? null : cells.map((c) => {
    const [l, r] = [c.trim().startsWith(":"), c.trim().endsWith(":")];
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
}

function head_text(x: string): string {
  const t = x.trimEnd();
  let k = t.length;
  while (k > 0 && t[k - 1] === "#") {
    k--;
  }
  return k === 0 ? "" : t[k - 1] === " " || t[k - 1] === "\t" ? t.slice(0, k).trimEnd() : t;
}

function is_rule(l: string): boolean {
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

function list_parse(lines: string[], i: number, d: number): [Block, number] {
  const kind  = list_kind(lines[i]);
  const items : string[][] = [];
  const boxes : Array<boolean | null> = [];
  let [end, w, blank, open, para, fenced, loose] = [i, 0, 0, true, false, false, false];
  for (let j = i; j < lines.length; j++) {
    const l  = untab(lines[j]);
    const at = indent(l);
    if (at === l.length) {
      [blank, para] = [blank + 1, false];
      continue;
    }
    if (list_kind(l) === kind && (items.length === 0 || at < w)) {
      const mark = LIST.exec(l)?.[0] ?? "";
      const rest = l.slice(mark.length);
      const pad  = indent(rest);
      w     = mark.length + (rest.trim() === "" || pad > 4 ? 1 : pad);
      open  = rest.trim() !== "" || (lines[j + 1] ?? "").trim() !== "";
      loose = loose || (blank > 0 && items.length > 0);
      const task = TASK.exec(l.slice(w));
      boxes.push(task === null ? null : task[1] !== " ");
      items.push([l.slice(w + (task?.[0].length ?? 0))]);
      [para, fenced] = item_line(l.slice(w), false);
    } else if (open && at >= w) {
      for (; blank > 0; blank--) {
        items[items.length - 1].push("");
      }
      items[items.length - 1].push(l.slice(w));
      [para, fenced] = item_line(l.slice(w), fenced);
    } else if (open && para && blank === 0 && !LIST.test(l) && !block_starts(lines, j)) {
      items[items.length - 1].push(l.trimStart());
    } else {
      break;
    }
    [blank, end] = [0, j + 1];
  }
  const first = LIST.exec(lines[i])?.[1] ?? "";
  const k     = /\d/.test(first);
  const parts = items.map((x) => blocks_parse(x, d + 1));
  const t     = !loose && !parts.some((p) => p[1]);
  return [{ $: "List", k, n: k ? Number(first.slice(0, -1)) : 1, t, x: parts.map((p) => p[0]), c: boxes }, end];
}

function item_line(s: string, fenced: boolean): [boolean, boolean] {
  const x = is_rule(s) ? "" : s.replace(MARKS, "");
  if (FENCE.test(x)) {
    return [false, !fenced];
  }
  return [!fenced && x.trim() !== "" && !HEAD.test(x) && !is_rule(x) && !ROW.test(x), fenced];
}

function untab(l: string): string {
  return l.replace(/^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/, (pre) => {
    let out = "";
    for (const c of pre) {
      out += c === "\t" ? " ".repeat(4 - (out.length % 4)) : c;
    }
    return out;
  });
}

function indent(l: string): number {
  return l.search(/\S|$/);
}

function lines_run(lines: string[], i: number, test: (l: string, j: number) => boolean): number {
  let j = i + 1;
  while (j < lines.length && test(lines[j], j)) {
    j++;
  }
  return j;
}

function block_starts(lines: string[], j: number): boolean {
  const l = lines[j];
  const m = LIST.exec(l);
  const item = m !== null && l.slice(m[0].length).trim() !== "" && (!/\d/.test(m[1]) || Number(m[1].slice(0, -1)) === 1);
  return fence_open(l) !== null || HEAD.test(l) || is_rule(l) || QUOT.test(l) || item || table_head(lines, j) !== null;
}

function list_kind(l: string): string | null {
  const m = LIST.exec(l);
  return m === null || is_rule(l) ? null : m[1].slice(-1);
}

function row_cells(line: string, n: number): Span[][] {
  const cells = cells_split(line);
  const all = Array.from({ length: n }, (_, k) => cells[k] ?? "");
  return all.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}

function cells_split(line: string): string[] {
  return line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/);
}
