// Md
// ==
// Markdown as GitHub reads it (GFM), as tokens both views draw (Html.ts,
// Paint.ts): fenced and indented code, headings, rules, quotes, lists
// (nested, tasks), tables (aligned), paragraphs (each line its own);
// code spans, emphasis (nested), strikethrough, links, autolinks, bare
// urls, images, escapes, and agent names (`[FireAnt]`, linked to its
// chat, unless a link's `(…)` follows). Raw HTML stays text, and a link
// goes only to http(s), mailto or a path here (link_safe). Spans are read
// by a scanner (span_parse), and every line by checks that look at each
// character a bounded number of times, as a message can be long (100 KB
// and more, read again as it streams). `md_plain` reads text as it is:
// paragraphs, lines, names and the media store's files pasted only. `md_output` reads a tool's result
// as a file's lines: a read's as its lines, a unified diff (Machine.ts
// writes them, git too) as its file and hunks, any other text as lines
// named "result", so every result looks as a read does. Tokens hold
// raw text; each emitter escapes it. A block is read by its first line
// and runs while the next pass its test. A span is the first mark at its
// point.

import { ENTITIES } from "./Entities.ts";
import * as Names from "./Names.ts";

// Types
// =====

export type Span =
  | { $: "Text"; x: string }                     // x
  | { $: "Code"; x: string }                     // `x`
  | { $: "Bold"; x: Span[] }                     // **x**, __x__
  | { $: "Ital"; x: Span[] }                     // *x*, _x_
  | { $: "Strk"; x: Span[] }                     // ~~x~~
  | { $: "Link"; x: Span[]; k: string; t: string } // [x](k "t") (k: link_safe), <k>, or a bare url
  | { $: "Pict"; x: string; k: string; t: string } // ![x](k "t"): an image, x its alt text
  | { $: "Name"; x: string }                     // [x]: an agent, x its name
  | { $: "Brk" };                                // a line's end

// k: a label, or ""
export type Code = { $: "Code"; k: string; x: string }; // ```k x ```

// a line of a diff: kept (" "), dropped ("-") or added ("+"), its number
// in the old file if dropped, else in the new one
export type Line = { s: " " | "-" | "+"; n: number; x: string };

export type Block =
  | { $: "Para"; x: Span[] }               // its lines, a Brk between
  | { $: "Head"; k: number; x: Span[] }    // # x (k: the level, 1 to 6)
  | Code
  | { $: "Rule" }                          // ---
  | { $: "Quot"; x: Block[] }              // > x
  | { $: "List"; k: boolean; n: number; t: boolean; x: Block[][]; c: Array<boolean | null> } // - x (k: numbered, 1. x, from n; t: tight; each item its blocks; c: each a task's box, checked or not, or null)
  | { $: "Tabl"; x: Span[][][]; a: string[] } // | x | (rows of cells; 1st: head; a: each column's alignment, "left", "center", "right" or "")
  | { $: "Diff"; k: string; x: Line[][] }  // --- k, +++ k, then hunks (@@ -1,2 +1,3 @@)
  | { $: "File"; k: string; n: number; x: string[] } // a file's lines x, from line n, named k (a read's "lines 4-7 of 15", else "result")

// Constants
// =========

const NAME  = new RegExp("\\[(" + Names.NAME + ")\\]", "g");
const ONLY  = new RegExp("^(?:" + Names.NAME + ")$");
// a media store's file, right after a pasted file's ](: its url
const MEDIA_URL = /\/media\/[0-9a-f]{16}\.[a-z0-9]{1,10}(?=\))/y;
const LIST  = /^ {0,3}([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TASK  = /^\[([ xX])\](?=[ \t]|$)[ \t]?/;
const PUNCT = /[\p{P}\p{S}]/u;
// an autolink, <scheme:…>, at the scanner's point
const AUTO  = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/iy;
const MAIL  = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const BARE  = /https?:\/\/|www\./iy;
// a character of a bare email address's name, and its domain after its @
const LOCAL = /[A-Za-z0-9._+-]/;
const EMAIL = /[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+/y;
const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/y;
// a setext heading's underline: = for a level 1, - for a level 2
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const HEAD  = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const QUOT  = /^ {0,3}>[ \t]?/;
const ROW   = /^\s*\|.*\|\s*$/;
const PIPE  = /(?<!\\)\|/;
// a table's bar's cell: dashes, a : at either end aligning its column
const CELL  = /^[ \t]*:?-+:?[ \t]*$/;
const NEW   = /^\+\+\+ (.*)$/;
const READ  = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
// before a failed tool's result (Agent.ts, ClaudeSub.ts)
const FAILED = "error: ";
const HUNK  = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MARKS = /^(?:\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\s*>\s?)*/;

// how many parentheses deep a link's url may be (more: no link, so a
// long line of them is read once)
const DEPTH = 32;

// how many lists and quotes deep one is still read (past it, its lines
// are text: a list or quote in one costs every line under it a copy)
const DEEP  = 16;

// Globals
// =======

// the reference definitions of the text md_parse reads, by label
// (def_label), found by a first read of its blocks (COLLECT: no spans
// read then), so a link may come before its definition
let DEFS = new Map<string, { k: string; t: string }>();
let COLLECT = false;

// a definition's title that found no end from a line on to a blank line
// (title_end_lines), by its lines, its delimiter: none starts between
// them either, so it is never looked for again
let UNSHUT: { lines: string[]; from: Map<string, [number, number]> } = { lines: [], from: new Map() };

// Constructors
// ============

export function Text(x: string): Span {
  return { $: "Text", x };
}

export function Name(x: string): Span {
  return { $: "Name", x };
}

// Parse
// =====

// the text between the matches of re, and each match as mark reads it
function spans_by(s: string, re: RegExp, mark: (m: RegExpMatchArray) => Span): Span[] {
  const out: Span[] = [];
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

// the scanner's list: a node a span made (text, a mark's text, or a span
// done), the nodes around it; a mark's node its mark (Mark)
type Node = { x: Span; m: Mark | null; prev: Node | null; next: Node | null };

// a mark the scanner holds: a run of *, _ or ~ (n of its len left; open,
// close: whether it may open and close emphasis), or a [ or ![, at its
// node, from source index at; the marks before and after it (GFM's
// delimiter stack)
type Mark = { c: string; n: number; len: number; open: boolean; close: boolean; at: number; node: Node; prev: Mark | null; next: Mark | null };

// a text's spans, read left to right as GFM's spec reads them: code
// spans, autolinks, entities and escapes first; a ] makes a link (inline
// or by a reference definition: DEFS) of its [, emphasis inside it
// matched then; emphasis left is matched at the end, outermost last
// (its delimiter runs, rule of 3); marks left are text. Every step moves
// on past what it read, or looks at most to a line's end
export function span_parse(s: string): Span[] {
  if (COLLECT) {
    return [];
  }
  const head: Node = { x: Text(""), m: null, prev: null, next: null };
  let tail = head;
  let marks: Mark | null = null;
  // the [ and ![ open; the [ among them (a link has no link in it, nor a
  // bare url); below dead, none may make a link any more (one was made)
  const brackets: Mark[] = [];
  let [links, dead] = [0, 0];
  const ticks = ticks_at(s);
  // where no unescaped end of a title, by its delimiter, is after (link_tail)
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
      const o = brackets.pop()!;
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
        // a link where no link may go: its source, as text
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
      // (a run that can neither open nor close is text: an _ in a word)
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
      // a bare email address: its name, read already, then its domain
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

  // emphasis matched over the marks after bottom (null: all), each
  // closer with the nearest opener it may close (GFM's process emphasis);
  // the marks after bottom then dropped, their nodes text
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
      const low = floor.has(key) ? floor.get(key)! : bottom;
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
    node.prev!.next = node.next;
    if (node.next !== null) {
      node.next.prev = node.prev;
    } else {
      tail = node.prev!;
    }
  }
}

// the marks' list (marks: its last) without m; its last after
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

// the spans of the nodes from `from` up to `upto` (null: the end), text
// joined
function nodes_spans(from: Node | null, upto: Node | null = null): Span[] {
  const out: Span[] = [];
  for (let n = from; n !== null && n !== upto; n = n.next) {
    spans_push(out, n.x);
  }
  return out;
}

// a reference link's target right after its ] at i: [ref] (or [] for
// the link's own text, from `from` to i), or none (a shortcut, [text]
// alone); its definition's url and title (DEFS), and where it ends; null
// if none. A label is 999 characters at most
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

// a label as definitions match it: its case and its runs of blanks not
// told apart
function def_label(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

// an entity (&amp;, &#35;, &#x23;) as the text it names; null: none
function entity(s: string): string | null {
  const num = /^&#([xX]?)([0-9a-fA-F]+);$/.exec(s);
  if (num !== null) {
    const n = parseInt(num[2], num[1] === "" ? 10 : 16);
    return String.fromCodePoint(n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n);
  }
  return ENTITIES.get(s.slice(1, -1)) ?? null;
}

// a link's url as written (its escapes and entities read), its spaces (a
// <url> may have them) as %20
function url_of(k: string): string {
  return text_unescape(k).replace(/ /g, "%20");
}

// a text's entities and escapes as what they stand for (a link's url and
// title)
function text_unescape(s: string): string {
  return s.replace(/\\([!-/:-@[-`{-~])|&#?[0-9A-Za-z]{1,32};/g, (m, esc) => esc ?? entity(m) ?? m);
}

// a span put after spans: text joins the text before it
function spans_push(spans: Span[], span: Span): void {
  const last = spans[spans.length - 1];
  if (span.$ === "Text" && last?.$ === "Text") {
    spans[spans.length - 1] = Text(last.x + span.x);
  } else if (span.$ !== "Text" || span.x !== "") {
    spans.push(span);
  }
}

// spans as plain text (a summary's, an image's alt)
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

// where each run of backticks starts, by its length: ticks(from, n), the
// first run of exactly n at or after from (-1: none); asked in order
function ticks_at(s: string): (from: number, n: number) => number {
  const runs = new Map<number, number[]>();
  for (let i = s.indexOf("`"); i >= 0; i = s.indexOf("`", i)) {
    const n = run_len(s, i, "`");
    runs.set(n, runs.get(n) ?? []);
    runs.get(n)!.push(i);
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

// a link's (k "t") right after its ] at i: its url (in <> or bare, its
// parentheses balanced), its title, and where it ends; null if none.
// `unshut`: where no end of a title (by its delimiter) is after, found
// by a look that failed, so it is looked for once
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
      } else if (s[j] === "(" && ++depth > DEPTH) {
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

// where a title from j ends: its delimiter q, unescaped (in a (title)
// no unescaped "(" either); -1: none (`unshut`: q's none from there on)
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

// whether a link may go to k: http, https or mailto, or a path on this
// site (one /, not // nor /\: another site)
export function link_safe(k: string): boolean {
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

// where an entity-like &name; ends at `semi` (its ; at semi) starts, its
// & after i; -1 if none
function entity_back(s: string, i: number, semi: number): number {
  let k = semi;
  while (k > i && /[A-Za-z0-9]/.test(s[k - 1])) {
    k--;
  }
  return k < semi && k > i && s[k - 1] === "&" ? k - 1 : -1;
}

// a line's text, its marks dropped (a summary is plain text: View.ts)
export function md_flat(s: string): string {
  return spans_text(span_parse(s));
}

export function md_plain(s: string): Block[] {
  const paras = s.replace(/\r/g, "").split(/\n(?:[ \t]*\n)+/);
  const kept = paras.filter((p) => p.trim() !== "");
  return kept.map((p) => ({ $: "Para", x: p.split("\n").flatMap((l, k) => [...(k === 0 ? [] : [{ $: "Brk" } as Span]), ...plain_line(l)]) }));
}

// a line's names, and the files pasted in it (md_pasted) as media
function plain_line(s: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const [from, to, x, k] of md_pasted(s)) {
    out.push(...spans_by(s.slice(at, from), NAME, (m) => Name(m[1])), { $: "Pict", x, k, t: "" });
    at = to;
  }
  return [...out, ...spans_by(s.slice(at), NAME, (m) => Name(m[1]))];
}

// the media store's files pasted in a text, ![name](/media/…) (a file
// that isn't media is sent as a link, [name](/media/…), main.ts), each
// its start and end, its name and its url: each found from its
// "](/media/", its [ looked for back to the bracket before (so each
// character is looked at once or twice), on its line, its name 999
// characters at most
export function md_pasted(s: string): Array<[number, number, string, string]> {
  const out: Array<[number, number, string, string]> = [];
  for (let k = s.indexOf("](/media/"); k >= 0; k = s.indexOf("](/media/", k + 1)) {
    MEDIA_URL.lastIndex = k + 2;
    const url = MEDIA_URL.exec(s);
    let a = k - 1;
    while (a >= 0 && k - a <= 1000 && s[a] !== "[" && s[a] !== "]" && s[a] !== "\n") {
      a--;
    }
    const from = s[a - 1] === "!" ? a - 1 : a;
    if (url !== null && s[a] === "[" && from >= (out.at(-1)?.[1] ?? 0)) {
      out.push([from, MEDIA_URL.lastIndex + 1, s.slice(a + 1, k), url[0]]);
    }
  }
  return out;
}

// a tool's result: a read's lines a File, each unified diff in it a
// Diff, the text around them a File named "result" (none if blank); or
// named `name` (a result apart from its call: "↳ shell result"), a
// read's too, before its lines
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

// a show tool's result (Machine.ts): each line that is a file of the
// media store, ![name](/media/…) (or a file's [name](/media/…): Device.ts
// show), drawn as a message draws it, a
// paragraph of its own; the lines between (a file refused, saying why) as
// md_output's. One refused marks the whole result failed ("error: "
// before its first line): dropped, its own line says it
export function md_shown(s: string, name = "result"): Block[] {
  const out: Block[] = [];
  const failed = s.startsWith(FAILED);
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
      rest.push(line);
    }
  }
  said();
  return out;
}

// a result's text as a File named so, its blank lines at either end
// dropped; none if all blank
function output_lines(lines: string[], name: string): Block[] {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: name, n: 1, x: lines.slice(from, upto + 1) }];
}

// null: no diff starts at line i (its "---" and "+++" lines, then hunks,
// each exactly as long as its header counts); and the line after it
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

// null: the lines from j don't fill the header's counts
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

// a link's reference definition at line i (GFM's): [label]: url "title".
// Its label, 999 characters at most, over lines too; its url on the
// label's line or the next; its title (if any: else only blanks after
// the url) on the url's line or the next, over lines; then only blanks
// to its line's end; never over a blank line. Its label, url, title and
// the line after it; null: none
function def_at(lines: string[], i: number): { label: string; k: string; t: string; next: number } | null {
  const first = indent(lines[i]);
  if (first > 3 || lines[i][first] !== "[") {
    return null;
  }
  let [r, c] = [i, first + 1];
  const ch = () => (c < lines[r].length ? lines[r][c] : "\n");
  // onto the next line, if it goes on (no blank one)
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
  // its title: after a blank, on this line or (none more on it) the next
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

// where a definition's title from line r, column c ends (its delimiter
// q, unescaped; in a (title) no unescaped "(" either), over lines but no
// blank one; null: none. One that runs to a blank line or the end says
// so (UNSHUT), so a title after it on those lines isn't looked for again
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

// the blocks of lines d lists or quotes deep, and whether a blank line
// parts two of them (a list item's: a loose list)
function blocks_parse(lines: string[], d: number): [Block[], boolean] {
  const out: Block[] = [];
  let [i, gap, apart] = [0, false, false];
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i, d);
    if (block === undefined) {
      // (a definition: no block, no gap)
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

// null: a blank line; undefined: a link's definition (kept in DEFS); and
// the line after the block
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
  if (QUOT.test(line) && d < DEEP) {
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
  if (list_kind(line) !== null && d < DEEP) {
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
  // a definition makes no block (the first of a label counts)
  const def = def_at(lines, i);
  if (def !== null) {
    const label = def_label(def.label);
    DEFS.set(label, DEFS.get(label) ?? { k: def.k, t: def.t });
    return [undefined, def.next];
  }
  // a paragraph; with a line of = or - under it, a heading (setext)
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j) && !SETEXT.test(l));
  const x = span_parse(lines.slice(i, end).join("\n").trim());
  const under = SETEXT.exec(lines[end] ?? "");
  return under === null ? [{ $: "Para", x }, end] : [{ $: "Head", k: under[1][0] === "=" ? 1 : 2, x }, end + 1];
}

// a fence's mark (``` or ~~~, or longer) if line opens code; a ``` one
// has no ` after it
function fence_open(line: string): string | null {
  const m = FENCE.exec(line);
  return m === null || (m[1][0] === "`" && line.slice(line.indexOf(m[1]) + m[1].length).includes("`")) ? null : m[1];
}

// whether line ends code its fence opened: the same mark, as long or longer
function fence_shuts(line: string, fence: string): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length;
}

// a table's columns' alignments, if a table starts at line i: its head,
// a row with a |, over its bar, as many cells, of dashes (: at an end
// aligns it)
function table_head(lines: string[], i: number): string[] | null {
  const [head, bar] = [lines[i], lines[i + 1] ?? ""];
  const cells = cells_split(bar);
  const ok = bar.includes("-") && cells.every((x) => CELL.test(x)) && PIPE.test(head) && (bar.includes("|") || ROW.test(head)) && cells.length === cells_split(head).length;
  return !ok ? null : cells.map((c) => {
    const [l, r] = [c.trim().startsWith(":"), c.trim().endsWith(":")];
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
}

// a heading's text, its closing #s dropped (a run of them after a blank,
// or all it has)
function head_text(x: string): string {
  const t = x.trimEnd();
  let k = t.length;
  while (k > 0 && t[k - 1] === "#") {
    k--;
  }
  return k === 0 ? "" : t[k - 1] === " " || t[k - 1] === "\t" ? t.slice(0, k).trimEnd() : t;
}

// whether a line is a rule: three or more of one of - * _, blanks
// between, at most 3 spaces in
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

// a list: its items, of one kind (one bullet, or one number's end).
// An item runs on over the lines as far in as its text (its paragraphs,
// its sub-lists), blank lines between them too, and over the lines
// right under its paragraph that start no block. It is tight but a
// blank line parts two items or two of an item's blocks. Numbered, it
// counts from its first item's number (GFM's list items and lists)
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
      const mark = LIST.exec(l)![0];
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
  const first = LIST.exec(lines[i])![1];
  const k     = /\d/.test(first);
  const parts = items.map((x) => blocks_parse(x, d + 1));
  const t     = !loose && !parts.some((p) => p[1]);
  return [{ $: "List", k, n: k ? Number(first.slice(0, -1)) : 1, t, x: parts.map((p) => p[0]), c: boxes }, end];
}

// an item's line s: whether a paragraph is open after it (a line under
// it can go on with it), and whether a fence is (fenced: before it)
function item_line(s: string, fenced: boolean): [boolean, boolean] {
  const x = is_rule(s) ? "" : s.replace(MARKS, "");
  if (FENCE.test(x)) {
    return [false, !fenced];
  }
  return [!fenced && x.trim() !== "" && !HEAD.test(x) && !is_rule(x) && !ROW.test(x), fenced];
}

// a line, the tabs in its indent and after its list marks as spaces, to
// the next 4th column
function untab(l: string): string {
  return l.replace(/^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/, (pre) => [...pre].reduce((out, c) => out + (c === "\t" ? " ".repeat(4 - (out.length % 4)) : c), ""));
}

// a line's leading blanks
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

// whether line j starts a block block_parse reads, but a paragraph: one
// ends a paragraph, a rule too ("---" right under a line), a table only
// with its bar under it, a list item only with text, numbered only at 1
function block_starts(lines: string[], j: number): boolean {
  const l = lines[j];
  const m = LIST.exec(l);
  const item = m !== null && l.slice(m[0].length).trim() !== "" && (!/\d/.test(m[1]) || Number(m[1].slice(0, -1)) === 1);
  return fence_open(l) !== null || HEAD.test(l) || is_rule(l) || QUOT.test(l) || item || table_head(lines, j) !== null;
}

// a list item's kind: its bullet (-, *, +) or its number's end (., ));
// null: no item (a rule, as "- - -", is none). A list is of one kind
function list_kind(l: string): string | null {
  const m = LIST.exec(l);
  return m === null || is_rule(l) ? null : m[1].slice(-1);
}

// a table row's cells, n of them, so each row has the head's
function row_cells(line: string, n: number): Span[][] {
  const cells = cells_split(line);
  const all = Array.from({ length: n }, (_, k) => cells[k] ?? "");
  return all.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}

// a row's cells: split at each | but an escaped one (\\|), a | at either
// end dropped
function cells_split(line: string): string[] {
  return line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/);
}
