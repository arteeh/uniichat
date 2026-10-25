// Md
// ==
// Markdown as GitHub reads it (GFM), as tokens both views draw (Html.ts,
// Paint.ts): fenced and indented code, headings, rules, quotes, lists
// (nested, tasks), tables (aligned), paragraphs (each line its own);
// code spans, emphasis (nested), strikethrough, links, autolinks, bare
// urls, images, escapes, and agent names (`[FireAnt]`, linked to its
// chat, unless a link's `(…)` follows). Raw HTML stays text, and a link
// goes only to http(s), mailto or a path here (link_safe). Spans are read
// by a scanner (span_parse), never a regex that backtracks, as a message
// can be long. `md_plain` reads text as it is:
// paragraphs, lines, names and media pasted only. `md_output` reads a tool's result
// as a file's lines: a read's as its lines, a unified diff (Machine.ts
// writes them, git too) as its file and hunks, any other text as lines
// named "result", so every result looks as a read does. Tokens hold
// raw text; each emitter escapes it. A block is read by its first line
// and runs while the next pass its test. A span is the first mark at its
// point.

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
// what a text read as it is (md_plain) marks: names, and the media store's
// files pasted in it (![name](/media/…))
const PLAIN = new RegExp(NAME.source + /|!\[([^\]\n]*)\]\((\/media\/[0-9a-f]{16}\.[a-z0-9]+)\)/.source, "g");
const LIST  = /^ {0,3}([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const TASK  = /^\[([ xX])\](?=[ \t]|$)[ \t]?/;
const PUNCT = /[\p{P}\p{S}]/u;
// an autolink, <scheme:…>, at the scanner's point
const AUTO  = /<((?:https?:\/\/|mailto:)[^\s<>]*)>/iy;
const BARE  = /https?:\/\//iy;
const HEAD  = /^(#{1,6})\s+(.*)$/;
const RULE  = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOT  = /^\s*>\s?/;
const ROW   = /^\s*\|.*\|\s*$/;
const PIPE  = /(?<!\\)\|/;
const BAR   = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
const NEW   = /^\+\+\+ (.*)$/;
const READ  = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
const HUNK  = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MARKS = /^(?:\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\s*>\s?)*/;

// how many parentheses deep a link's url may be (more: no link, so a
// long line of them is read once)
const DEPTH = 32;

// how many lists and quotes deep a list is still read (past it, its
// lines are text: a list in a list costs every line under it a copy)
const DEEP  = 16;

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

// a mark the scanner holds open: a run of *, _ or ~ that may open
// emphasis (n of its len left; close: it may close one too), or a [ or
// ![ (at: where; on: it may still make a link, none in a link), and the
// spans after it
type Open = { c: string; n: number; len: number; close: boolean; at: number; on: boolean; x: Span[] };

// a text's spans, read left to right: a closing mark folds the spans
// after its opener into a span (GFM's delimiter runs and brackets, its
// rule of 3; a mark never closes across a [); marks left open are text.
// Each step looks at most at a line, or moves past what it read
export function span_parse(s: string): Span[] {
  const stack: Open[] = [{ c: "", n: 0, len: 0, close: false, at: 0, on: false, x: [] }];
  // where no opener for a closer's key is (below it), so none is looked for again
  const floor = new Map<string, number>();
  const ticks = ticks_at(s);
  let [i, text] = [0, ""];
  const put = (span: Span) => {
    flush();
    spans_push(stack[stack.length - 1].x, span);
  };
  const flush = () => {
    if (text !== "") {
      spans_push(stack[stack.length - 1].x, Text(text));
      text = "";
    }
  };
  // the marks above j given up as text, into j
  const fold = (j: number) => {
    flush();
    while (stack.length - 1 > j) {
      const o = stack.pop()!;
      const into = stack[stack.length - 1].x;
      spans_push(into, Text(o.c === "[" || o.c === "![" ? o.c : o.c.repeat(o.n)));
      o.x.forEach((x) => spans_push(into, x));
    }
    floor.forEach((f, key) => floor.set(key, Math.min(f, j)));
  };
  // the top mark closed (its spans made a span)
  const drop = () => {
    stack.pop();
    fold(stack.length - 1);
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && (s[i + 1] === "\n" || PUNCT.test(s[i + 1]) && s.charCodeAt(i + 1) < 128)) {
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
    } else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      flush();
      stack.push({ c: c === "[" ? "[" : "![", n: 1, len: 1, close: false, at: i, on: true, x: [] });
      i += c === "[" ? 1 : 2;
    } else if (c === "]") {
      let j = stack.length - 1;
      while (j > 0 && stack[j].c !== "[" && stack[j].c !== "![") {
        j--;
      }
      if (j === 0) {
        text += c;
        i++;
        continue;
      }
      const o = stack[j];
      const tail = o.on ? link_tail(s, i + 1) : null;
      fold(j);
      drop();
      if (tail !== null && link_safe(tail.k)) {
        put(o.c === "![" ? { $: "Pict", x: spans_text(o.x), k: tail.k, t: tail.t } : { $: "Link", x: o.x, k: tail.k, t: tail.t });
        stack.forEach((up) => (up.on = up.on && up.c !== "["));
        i = tail.end;
      } else if (tail !== null) {
        put(Text(s.slice(o.at, tail.end)));
        i = tail.end;
      } else if (o.c === "[" && o.x.length === 1 && o.x[0].$ === "Text" && ONLY.test(o.x[0].x)) {
        put(Name(o.x[0].x));
        i++;
      } else {
        put(Text(o.c));
        o.x.forEach((x) => put(x));
        text += c;
        i++;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      const n = run_len(s, i, c);
      const [open, close] = flanks(s, i, n, c);
      const d = { c, n, len: n, close, at: i, on: false, x: [] };
      const key = c + open + (n % 3);
      while (close && d.n > 0 && !(c === "~" && n > 2)) {
        let j = stack.length - 1;
        const low = floor.get(key) ?? 0;
        for (; j > low; j--) {
          const o = stack[j];
          if (o.c === "[" || o.c === "![") {
            j = 0;
            break;
          }
          const three = c !== "~" && (o.close || open) && (o.len + n) % 3 === 0 && (o.len % 3 !== 0 || n % 3 !== 0);
          if (o.c === c && !three && (c !== "~" || o.n === d.n)) {
            break;
          }
        }
        if (j <= low) {
          floor.set(key, stack.length - 1);
          break;
        }
        fold(j);
        const o = stack[j];
        const use = c === "~" ? d.n : o.n >= 2 && d.n >= 2 ? 2 : 1;
        const span: Span = c === "~" ? { $: "Strk", x: o.x } : use === 2 ? { $: "Bold", x: o.x } : { $: "Ital", x: o.x };
        [o.n, d.n] = [o.n - use, d.n - use];
        if (o.n === 0) {
          drop();
          put(span);
        } else {
          o.x = [span];
        }
      }
      if (d.n > 0 && open && !(c === "~" && n > 2)) {
        flush();
        stack.push(d);
      } else {
        text += c.repeat(d.n);
      }
      i += n;
    } else if ((c === "h" || c === "H") && (i === 0 || /[\s(*_~]/.test(s[i - 1])) && (BARE.lastIndex = i, BARE.test(s)) && !stack.some((o) => o.c === "[")) {
      const k = url_bare(s, i);
      put(k.length > BARE.lastIndex - i ? { $: "Link", x: [Text(k)], k, t: "" } : Text(k));
      i += k.length;
    } else {
      text += c;
      i++;
    }
  }
  fold(0);
  return stack[0].x;
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
// parentheses balanced), its title, and where it ends; null if none
function link_tail(s: string, i: number): { k: string; t: string; end: number } | null {
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
    const end = s.slice(j, s.indexOf("\n", j) < 0 ? undefined : s.indexOf("\n", j)).search(/(?<!\\)>/);
    if (end < 0 || s.slice(j + 1, j + end).includes("<")) {
      return null;
    }
    [k, j] = [s.slice(j + 1, j + end), j + end + 1];
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
    const line = s.indexOf("\n", j + 1);
    const end = s.slice(j + 1, line < 0 ? undefined : line).indexOf(q);
    if (end < 0) {
      return null;
    }
    [t, j] = [s.slice(j + 1, j + 1 + end), j + end + 2];
    skip();
  }
  if (s[j] !== ")") {
    return null;
  }
  return { k: k.replace(/\\([!-/:-@[-`{-~])/g, "$1"), t, end: j + 1 };
}

// whether a link may go to k: http, https or mailto, or a path on this
// site (one /, not // nor /\: another site)
export function link_safe(k: string): boolean {
  return /^(?:https?:\/\/|mailto:)[^\s\x00-\x1f]*$/i.test(k) || /^\/(?![\/\\])[^\s\x00-\x1f]*$/.test(k) || k === "/";
}

// a bare url at i: to a space, a control character or <, its end's punctuation dropped, and a
// ) it doesn't open (GFM's extended autolinks)
function url_bare(s: string, i: number): string {
  let j = i;
  while (j < s.length && !/[\s<\x00-\x1f\x7f]/.test(s[j])) {
    j++;
  }
  let k = s.slice(i, j);
  for (let was = ""; was !== k; ) {
    was = k;
    k = k.replace(/[?!.,:*_~'";]+$/, "");
    if (k.endsWith(")") && k.split(")").length > k.split("(").length) {
      k = k.slice(0, -1);
    }
  }
  return k;
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

function plain_line(s: string): Span[] {
  return spans_by(s, PLAIN, (m) => (m[1] !== undefined ? Name(m[1]) : { $: "Pict", x: m[2], k: m[3], t: "" }));
}

// a tool's result: a read's lines a File, each unified diff in it a
// Diff, the text around them a File named "result" (none if blank)
export function md_output(s: string): Block[] {
  const lines = s.replace(/\r/g, "").split("\n");
  const read  = READ.exec(lines[lines.length - 1]);
  if (read !== null) {
    return [{ $: "File", k: read[1], n: Number(read[2]), x: lines.slice(0, -1) }];
  }
  const out: Block[] = [];
  let [i, at] = [0, 0];
  while (i < lines.length) {
    const [diff, next] = diff_parse(lines, i);
    if (diff !== null) {
      out.push(...output_lines(lines.slice(at, i)), diff);
      at = next;
    }
    i = next;
  }
  return [...out, ...output_lines(lines.slice(at))];
}

// a result's text as a File named "result", its blank lines at either
// end dropped; none if all blank
function output_lines(lines: string[]): Block[] {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: "result", n: 1, x: lines.slice(from, upto + 1) }];
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
  return blocks_parse(src.replace(/\r/g, "").split("\n"), 0)[0];
}

// the blocks of lines d lists or quotes deep, and whether a blank line
// parts two of them (a list item's: a loose list)
function blocks_parse(lines: string[], d: number): [Block[], boolean] {
  const out: Block[] = [];
  let [i, gap, apart] = [0, false, false];
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i, d);
    if (block === null) {
      gap = out.length > 0;
    } else {
      [apart, gap] = [apart || gap, false];
      out.push(block);
    }
    i = next;
  }
  return [out, apart];
}

// null: a blank line; and the line after the block
function block_parse(lines: string[], i: number, d: number): [Block | null, number] {
  const line = lines[i];
  const head = HEAD.exec(line);
  const runs = (test: (l: string, j: number) => boolean) => lines_run(lines, i, test);
  if (line.trim() === "") {
    return [null, i + 1];
  }
  const fence = fence_open(line);
  if (fence !== null) {
    const end = runs((l) => !fence_shuts(l, fence));
    const k = line.trim().slice(fence.length).trim();
    const x = lines.slice(i + 1, end).join("\n");
    return [{ $: "Code", k, x }, end + 1];
  }
  if (head !== null) {
    const x = span_parse(head[2].replace(/(^|\s+)#+\s*$/, ""));
    return [{ $: "Head", k: head[1].length, x }, i + 1];
  }
  if (RULE.test(line)) {
    return [{ $: "Rule" }, i + 1];
  }
  if (QUOT.test(line)) {
    const end = runs((l) => QUOT.test(l));
    const body = lines.slice(i, end).map((l) => l.replace(QUOT, ""));
    return [{ $: "Quot", x: blocks_parse(body, d + 1)[0] }, end];
  }
  if (list_kind(line) !== null && d < DEEP) {
    return list_parse(lines, i, d);
  }
  const a = table_head(lines, i);
  if (a !== null) {
    const end = lines_run(lines, i + 1, (l, j) => PIPE.test(l) && l.trim() !== "" && !block_starts(lines, j));
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
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j));
  return [{ $: "Para", x: span_parse(lines.slice(i, end).join("\n").trimStart()) }, end];
}

// a fence's mark (``` or ~~~, or longer) if line opens code; a ``` one
// has no ` after it
function fence_open(line: string): string | null {
  const m = FENCE.exec(line);
  return m === null || (m[1][0] === "`" && line.slice(line.indexOf(m[1]) + m[1].length).includes("`")) ? null : m[1];
}

// whether line ends code its fence opened: the same mark, as long or longer
function fence_shuts(line: string, fence: string): boolean {
  const m = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
  return m !== null && m[1][0] === fence[0] && m[1].length >= fence.length;
}

// a table's columns' alignments, if a table starts at line i: its head,
// a row with a |, over its bar, as many cells, of dashes (: at an end
// aligns it); the old form, | at both ends, without the count
function table_head(lines: string[], i: number): string[] | null {
  const [head, bar] = [lines[i], lines[i + 1] ?? ""];
  const cells = bar.trim().replace(/^\||\|$/g, "").split("|");
  const ok = BAR.test(bar) && (ROW.test(head) || (PIPE.test(head) && bar.includes("|") && cells.length === row_cells(head, 0).length));
  return !ok ? null : cells.map((c) => {
    const [l, r] = [c.trim().startsWith(":"), c.trim().endsWith(":")];
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
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
  const x = RULE.test(s) ? "" : s.replace(MARKS, "");
  if (FENCE.test(x)) {
    return [false, !fenced];
  }
  return [!fenced && x.trim() !== "" && !HEAD.test(x) && !RULE.test(x) && !ROW.test(x), fenced];
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
  return fence_open(l) !== null || HEAD.test(l) || RULE.test(l) || QUOT.test(l) || item || table_head(lines, j) !== null;
}

// a list item's kind: its bullet (-, *, +) or its number's end (., ));
// null: no item (a rule, as "- - -", is none). A list is of one kind
function list_kind(l: string): string | null {
  const m = LIST.exec(l);
  return m === null || RULE.test(l) ? null : m[1].slice(-1);
}

// a table row's cells, split at each | but an escaped one (\|); n of
// them (0: as many as it has), so each row has the head's
function row_cells(line: string, n: number): Span[][] {
  const cells = line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/);
  const all = n === 0 ? cells : Array.from({ length: n }, (_, k) => cells[k] ?? "");
  return all.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}
