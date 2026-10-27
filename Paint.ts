import type { Kind } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as Md from "./Md.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

type Ink = { d: boolean; b: boolean; i: boolean; u: boolean; t: boolean; k: string; c: string; g: string };

export type Run = { x: string; s: Ink };

export type Line = Run[];

export const INK: Ink = { d: false, b: false, i: false, u: false, t: false, k: "", c: "", g: "" };
export const DIM: Ink = { ...INK, d: true };

const MARK: Record<Md.Line["s"], Ink> = { " ": DIM, "-": { ...INK, c: Theme.ANSI.del }, "+": { ...INK, c: Theme.ANSI.add } };

const GUTTER = 7;

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

let SITE = "";

export function Run(x: string, s: Ink = INK): Run {
  return { x, s };
}

export function text_width(s: string): number {
  return Bun.stringWidth(s);
}

export function text_clean(s: string): string {
  return s.replace(/\t/g, "  ").replace(/\n/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

export function text_graphemes(s: string): string[] {
  return [...GRAPHEMES.segment(s)].map((g) => g.segment);
}

export function paint_site(url: string): void {
  SITE = url.replace(/\/+$/, "");
}

export function runs_wrap(runs: Line, w: number, hard: boolean): Line[] {
  const out: Line[] = [[]];
  let col = 0;
  for (const r of runs) {
    const whole  = col + text_width(r.x) <= w && (col > 0 || out.length === 1);
    const pieces = whole ? [r.x] : hard ? text_graphemes(r.x) : r.x.split(/(\s+)/).flatMap((p) => (text_width(p) <= w || /^https?:\/\//.test(p) ? [p] : text_graphemes(p)));
    for (const p of pieces) {
      const pw = text_width(p);
      if (col > 0 && col + pw > w) {
        out.push([]);
        col = 0;
      }
      if (!(!hard && /^\s+$/.test(p) && col === 0 && out.length > 1)) {
        out[out.length - 1].push(Run(p, r.s));
        col += pw;
      }
    }
  }
  return out;
}

function line_width(l: Line): number {
  return l.reduce((n, r) => n + text_width(r.x), 0);
}

export function line_ansi(l: Line): string {
  let out = "";
  let was: Ink | null = null;
  for (const r of l) {
    out += ink_ansi(was, r.s) + r.x;
    was = r.s;
  }
  return (was?.g ? out : out.trimEnd()) + ink_ansi(was, INK);
}

function ink_ansi(was: Ink | null, s: Ink): string {
  if (was !== null && was.d === s.d && was.b === s.b && was.i === s.i && was.u === s.u && was.t === s.t && was.k === s.k && was.c === s.c && was.g === s.g) {
    return "";
  }
  const end  = was !== null && was.k !== "" ? "\x1b]8;;\x1b\\" : "";
  const sgr  = "\x1b[0" + (s.b ? ";1" : "") + (s.i ? ";3" : "") + (s.u ? ";4" : "") + (s.t ? ";9" : "") + (s.d ? ";2" : "") + color_sgr(38, s.c) + color_sgr(48, s.g) + "m";
  const link = s.k === "" ? "" : "\x1b]8;;" + s.k + "\x1b\\";
  return end + sgr + link;
}

function color_sgr(at: number, c: string): string {
  if (c === "") {
    return "";
  }
  const i = Number(c);
  return ";" + (at - 8 + (i < 8 ? i : 60 + i - 8));
}

function fill_lines(body: Line[], iw: number): Line[] {
  const g    = Theme.ANSI.block;
  const pad  = { ...INK, g };
  const edge = (c: string) => [Run(c.repeat(Math.max(0, iw + 2)), { ...INK, c: g })];
  const ink  = (r: Run) => Run(r.x, { ...r.s, g, c: r.s.c || Theme.ANSI.ink });
  const mid  = body.map((l) => [Run(" ", pad), ...l.map(ink), Run(" ".repeat(Math.max(0, iw - line_width(l))) + " ", pad)]);
  return [edge("▄"), ...mid, edge("▀")];
}

function frame_lines(body: Line[], iw: number, edge: Ink, title: Line, dotted = false): Line[] {
  const [h, v] = dotted ? ["┄", "┆"] : ["─", "│"];
  const head = runs_wrap(title, iw + 1, true)[0];
  const bar  = h.repeat(Math.max(0, iw + 1 - line_width(head)));
  const top  = [Run("╭" + h, edge), ...head, Run(bar + "╮", edge)];
  const end  = [Run("╰" + h.repeat(Math.max(0, iw + 2)) + "╯", edge)];
  const pad  = (l: Line) => Run(" ".repeat(Math.max(0, iw - line_width(l))));
  const mid  = body.map((l) => [Run(v + " ", edge), ...l, pad(l), Run(" " + v, edge)]);
  return [top, ...mid, end];
}

function lines_join<T>(xs: T[], f: (x: T) => Line[]): Line[] {
  return xs.flatMap((x, k) => (k === 0 ? f(x) : [[], ...f(x)]));
}

export function rows_lines(rows: View.Row[], w: number): Line[] {
  return rows.flatMap((row, k) => [...(k > 0 ? [[]] : []), ...row_lines(row, w), ...images_lines(row)]);
}

function images_lines(row: View.Row): Line[] {
  const names = row.$ === "Msg" ? row.images : [];
  return names.map((name) => [Run("  [image " + name + "]", DIM)]);
}

function row_lines(row: View.Row, w: number): Line[] {
  switch (row.$) {
    case "Sum": {
      const head = row.call === null ? [] : verb_runs(row.call);
      const text = row.call === null ? row.text : Call.call_line(row.call);
      return fill_lines(sum_lines(row.id, row.n, head, text, w - 2), w - 2);
    }
    case "Box": {
      const bar = [Run(" " + row.n + "x · /close " + View.block_name(row.id, row.n) + " ", { ...DIM, b: true })];
      return frame_lines(rows_lines(row.rows, w - 4), w - 4, DIM, bar);
    }
    case "Msg": {
      return row.call === null ? msg_lines(row.kind, row.who, row.body, w, row.queued === true) : fill_lines(call_lines(row.call, w - 2), w - 2);
    }
    case "Cap": {
      return runs_wrap([Run(text_clean(row.text), { ...DIM, i: true })], w, false);
    }
  }
}

function sum_lines(id: number, n: number, head: Line, text: string, w: number): Line[] {
  const room = w - GUTTER - 2;
  const cmd  = Run("/open " + View.block_name(id, n), DIM);
  const rows = runs_wrap([...head, Run(text_clean(text))], room, false);
  const last = rows.pop() ?? [];
  const ends = line_width(last) + 2 + text_width(cmd.x) <= room ? [[...last, Run("  "), cmd]] : [last, [cmd]];
  const lvl  = { ...DIM, b: true };
  return [...rows, ...ends].map((l, k) => [Run(" " + (k === 0 ? n + "x" : "").padEnd(GUTTER), lvl), ...l]);
}

function msg_lines(kind: Kind, who: string, body: Md.Block[], w: number, queued: boolean): Line[] {
  const look = Theme.KIND[kind];
  const ink  = { ...INK, d: look.dim, i: look.it };
  if (body.length === 0) {
    return [];
  }
  if (Theme.FILLED.includes(kind)) {
    return fill_lines(blocks_lines(body, w - 2, ink), w - 2);
  }
  if (Theme.FRAMED.includes(kind)) {
    const edge = kind === "user" ? { ...INK, c: Theme.ANSI.you } : INK;
    return frame_lines(blocks_lines(body, w - 4, ink), w - 4, edge, who === "" ? [] : [Run(" " + who + " ", { ...edge, b: true })], queued);
  }
  const name = who === "" ? [] : [[Run(who, { ...DIM, b: true })]];
  return [...name, ...blocks_lines(body, w, ink)];
}

function call_lines(c: Call.Call, w: number): Line[] {
  const verb  = verb_runs(c);
  const where = c.device === "" ? [] : [Run(c.device, DIM)];
  const one   = !c.head.includes("\n") && line_width(verb) + text_width(c.head) + 2 + line_width(where) <= w;
  const top   = one ? [...verb, Run(text_clean(c.head))] : verb;
  const gap   = Run(" ".repeat(Math.max(1, w - line_width(top) - line_width(where))));
  const heads = one || c.head === "" ? [] : c.head.split("\n").flatMap((l) => runs_wrap([Run(text_clean(l))], w, true));
  return [[...top, gap, ...where], ...heads, ...c.blocks.flatMap((b) => code_lines(b.k, b.x, w, DIM, false))];
}

function verb_runs(c: Call.Call): Line {
  const ink = { ...INK, b: true };
  return [Run(Theme.tool_glyph(c.name) + " ", ink), ...(c.name === "" ? [] : [Run(c.name + " ", ink)])];
}

function blocks_lines(blocks: Md.Block[], w: number, ink: Ink): Line[] {
  return lines_join(blocks, (b) => block_lines(b, w, ink));
}

function block_lines(b: Md.Block, w: number, ink: Ink): Line[] {
  switch (b.$) {
    case "Para": {
      return runs_lines(spans_runs(b.x, ink)).flatMap((l) => runs_wrap(l, w, false));
    }
    case "Head": {
      return runs_lines(spans_runs(b.x, { ...ink, b: true })).flatMap((l) => runs_wrap(l, w, false));
    }
    case "Code": {
      return code_lines(b.k, b.x, w, ink, true);
    }
    case "Rule": {
      return [[Run("─".repeat(Math.max(0, w)), DIM)]];
    }
    case "Quot": {
      return blocks_lines(b.x, w - 2, { ...ink, d: true }).map((l) => [Run("│ ", DIM), ...l]);
    }
    case "List": {
      const mark = (k: number) => (b.c[k] == null ? (b.k ? b.n + k + ". " : "• ") : b.c[k] ? "[x] " : "[ ] ");
      const items = b.x.map((item, k) => item_lines(item, mark(k), b.t, w, ink));
      return b.t ? items.flat() : lines_join(items, (x) => x);
    }
    case "Tabl": {
      return table_lines(b.x, b.a, w, ink);
    }
    case "Diff": {
      return diff_lines(b.k, b.x, w);
    }
    case "File": {
      return file_lines(b.k, b.n, b.x, w);
    }
  }
}

function item_lines(blocks: Md.Block[], mark: string, tight: boolean, w: number, ink: Ink): Line[] {
  const mw   = text_width(mark);
  const rows = tight ? blocks.flatMap((b) => block_lines(b, w - mw, ink)) : blocks_lines(blocks, w - mw, ink);
  return (rows.length === 0 ? [[]] : rows).map((l, k) => [Run(k === 0 ? mark : " ".repeat(mw), ink), ...l]);
}

function code_lines(label: string, text: string, w: number, ink: Ink, fill: boolean): Line[] {
  const code = { ...INK, d: ink.d };
  const iw   = fill ? w - 2 : w - 4;
  const head = label === "" ? [] : [[Run(label, { ...ink, d: true })]];
  const body = text.split("\n").flatMap((l) => runs_wrap([Run(text_clean(l), code)], iw, true));
  return [...head, ...(fill ? fill_lines(body, iw) : frame_lines(body, iw, code, []))];
}

function diff_lines(file: string, hunks: Md.Line[][], w: number): Line[] {
  const all   = hunks.flat();
  const adds  = all.filter((l) => l.s === "+").length;
  const dels  = all.filter((l) => l.s === "-").length;
  const nw    = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const title = [Run(" " + text_clean(file) + " ", { ...INK, b: true }), Run("+" + adds, MARK["+"]), Run(" "), Run("-" + dels, MARK["-"]), Run(" ")];
  const line  = (l: Md.Line) => runs_wrap([Run(text_clean(l.x), MARK[l.s])], w - nw - 7, true).map((r, k) => [Run((k === 0 ? String(l.n) : "").padStart(nw) + " ", DIM), Run((k === 0 ? l.s : " ") + " ", MARK[l.s]), ...r]);
  const gap   = [[Run(" ".repeat(nw) + " ⋯", DIM)]];
  const body  = hunks.flatMap((h, k) => [...(k === 0 ? [] : gap), ...h.flatMap(line)]);
  return frame_lines(body, w - 4, DIM, title);
}

function file_lines(shown: string, from: number, lines: string[], w: number): Line[] {
  const nw    = String(from + lines.length - 1).length;
  const title = [Run(" " + text_clean(shown) + " ", { ...INK, b: true })];
  const line  = (x: string, k: number) => runs_wrap([Run(text_clean(x))], w - nw - 5, true).map((r, j) => [Run((j === 0 ? String(from + k) : "").padStart(nw) + " ", DIM), ...r]);
  return frame_lines(lines.flatMap(line), w - 4, DIM, title);
}

function table_lines(rows: Md.Span[][][], align: string[], w: number, ink: Ink): Line[] {
  const cells  = rows.map((row, k) => row.map((c) => spans_runs(c, { ...ink, b: k === 0 })));
  const cols   = cells.reduce((n, row) => Math.max(n, row.length), 0);
  const want   = Array.from({ length: cols }, (_, c) => cells.reduce((n, row) => Math.max(n, line_width(row[c] ?? [])), 0));
  const widths = table_fit(want, w - 2 * (cols - 1));
  const rule   = [Run("─".repeat(Math.max(0, Math.min(w, widths.reduce((a, b) => a + b + 2, -2)))), DIM)];
  return cells.flatMap((row, k) => (k === 0 ? row_lines(row) : [rule, ...row_lines(row)]));
  function row_lines(row: Line[]): Line[] {
    const wrap = widths.map((cw, c) => runs_wrap(row[c] ?? [], cw, false));
    const tall = wrap.reduce((n, x) => Math.max(n, x.length), 0);
    return Array.from({ length: tall }, (_, k) => wrap.flatMap((x, c) => cell_line(x[k] ?? [], widths[c], align[c] ?? "")));
  }
  function cell_line(l: Line, cw: number, a: string): Line {
    const pad = Math.max(0, cw - line_width(l));
    const before = a === "right" ? pad : a === "center" ? Math.floor(pad / 2) : 0;
    return [Run(" ".repeat(before)), ...l, Run(" ".repeat(pad - before + 2))];
  }
}

function table_fit(want: number[], w: number): number[] {
  const order = want.map((_, c) => c).sort((a, b) => want[a] - want[b]);
  const out   = [...want];
  let left = w;
  for (const [k, c] of order.entries()) {
    out[c] = Math.max(1, Math.min(want[c], Math.floor(left / (order.length - k))));
    left  -= out[c];
  }
  return out;
}

function spans_runs(spans: Md.Span[], ink: Ink): Line {
  return spans.flatMap((s) => span_runs(s, ink));
}

function span_runs(s: Md.Span, ink: Ink): Run[] {
  switch (s.$) {
    case "Text":
    case "Code": {
      return [Run(text_clean(s.x), ink)];
    }
    case "Bold": {
      return spans_runs(s.x, { ...ink, b: true });
    }
    case "Ital": {
      return spans_runs(s.x, { ...ink, i: true });
    }
    case "Strk": {
      return spans_runs(s.x, { ...ink, t: true });
    }
    case "Link": {
      return View.store_file(s.k) ? spans_runs([{ $: "Pict", x: Md.spans_text(s.x), k: s.k, t: s.t }], ink) : spans_runs(s.x, { ...ink, u: true, k: text_clean(site_url(s.k)) });
    }
    case "Pict": {
      const url = text_clean(site_url(s.k));
      const file = View.store_file(s.k);
      return [Run((file ? "📎 " : "🖼 ") + (text_clean(s.x) || (file ? "file" : "image")) + " ", ink), Run(url, { ...ink, u: true, k: url })];
    }
    case "Name": {
      return [Run("[" + text_clean(s.x) + "]", { ...ink, b: true, u: true })];
    }
    case "Brk": {
      return [Run("\n", ink)];
    }
  }
}

function runs_lines(runs: Line): Line[] {
  const out: Line[] = [[]];
  runs.forEach((r) => (r.x === "\n" ? out.push([]) : out[out.length - 1].push(r)));
  return out;
}

function site_url(k: string): string {
  return k.startsWith("/") ? SITE + k : k;
}

export function rule_line(v: View.View, w: number): Line {
  return rule_text(View.view_shown(v).map((knob) => knob.text).join(" · "), w);
}

export function rule_text(text: string, w: number): Line {
  const tag = text === "" ? "" : " " + text + " ";
  return [Run("─".repeat(Math.max(0, w - text_width(tag) - 1)) + tag + "─", DIM)];
}

export function tabs_line(v: View.View, w: number): Line {
  const tabs = View.view_tabs(v).map((tab) => Run(tab.text, tab.here ? { ...INK, b: true } : DIM));
  const line = tabs.flatMap((r, k) => (k === 0 ? [r] : [Run("  "), r]));
  const hint = [Run("  · Tab to cycle", DIM)];
  return tabs.length > 1 && line_width([...line, ...hint]) <= w ? [...line, ...hint] : line;
}
