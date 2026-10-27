import * as Md from "../../Md.ts";
import * as View from "../../View.ts";
import { must } from "./Dom.ts";

export type Hooks = { input: () => void; files: (files: File[]) => void };

export type State = "up" | "ok" | "bad";

type Piece = string | { name: string; url: string };

let BOX: HTMLElement = document.createElement("div");
let HOOKS: Hooks = { input: () => {}, files: () => {} };

let LAST: Range | null = null;
let COMPOSING = false;

const SIDE = 150;
const LEAST = 24;

const BLOCKS = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);

export function box_new(el: HTMLElement, hooks: Hooks): void {
  BOX = el;
  HOOKS = hooks;
  // (an older browser has no plaintext-only: then nothing but beforeinput
  // keeps formatting out)
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
      box_insert("\n");
    }
  });
  el.addEventListener("compositionstart", () => (COMPOSING = true));
  el.addEventListener("compositionend", () => {
    COMPOSING = false;
    changed();
  });
  el.addEventListener("input", () => (COMPOSING ? HOOKS.input() : changed()));
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
      pieces.forEach((p) => (typeof p === "string" ? box_insert(p) : box_put(item_new(p.name, p.url, "ok"))));
    } else if (files.length === 0 || data.getData("text/plain").trim() !== "") {
      box_insert(data.getData("text/plain").replace(/\r\n?/g, "\n"));
    }
    if (files.length > 0) {
      HOOKS.files(files);
    }
  });
  const copy = (ev: ClipboardEvent, cut: boolean) => {
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
    const files = [...(ev.dataTransfer?.files ?? [])];
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

export function box_text(): string {
  return offsets([]).text;
}

export function box_blank(): boolean {
  return BOX.textContent === "" && BOX.querySelector(".item") === null;
}

export function box_focused(): boolean {
  return document.activeElement === BOX;
}

export function box_focus(): void {
  BOX.focus();
}

export function box_set(text: string): void {
  BOX.replaceChildren();
  let buf = "";
  text.split("\n").forEach((line, k) => {
    buf += k === 0 ? "" : "\n";
    const media = Md.md_pasted(line);
    if (media.length === 1 && media[0][0] === 0 && media[0][1] === line.length) {
      BOX.append(...(buf === "" ? [] : [buf]), item_new(media[0][2], media[0][3], "ok"));
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

export function box_caret(): [number, number] {
  const sel = getSelection();
  const range = sel !== null && sel.rangeCount > 0 && BOX.contains(sel.getRangeAt(0).startContainer) ? sel.getRangeAt(0) : null;
  if (range === null) {
    const n = box_text().length;
    return [n, n];
  }
  const at = offsets([[range.startContainer, range.startOffset], [range.endContainer, range.endOffset]]).at;
  return [at[0], at[1]];
}

export function box_place(a: number, b: number): void {
  const range = document.createRange();
  const [start, end] = [point(a), point(b)];
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  LAST = range.cloneRange();
}

export function box_insert(text: string): void {
  if (text !== "") {
    put(document.createTextNode(text));
  }
}

export function box_put(item: HTMLElement): void {
  put(item);
}

export function item_new(name: string, url: string, state: State, kind = View.media_kind(url) ?? "file", size: number | null = null): HTMLElement {
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
    tile.textContent = (kind === "audio" ? "♪ " : kind === "html" ? "📄 " : kind === "file" ? "📎 " : "") + name;
    if (kind === "file") {
      const small = document.createElement("small");
      small.textContent = size === null ? "" : View.size_show(size);
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

function item_fit(item: HTMLElement, w: number, h: number): void {
  if (!(w > 0 && h > 0)) {
    return;
  }
  const k = Math.min(1, SIDE / Math.max(w, h));
  item.style.width = Math.max(LEAST, Math.round(w * k)) + "px";
  item.style.height = Math.max(LEAST, Math.round(h * k)) + "px";
}

export function item_state(item: HTMLElement, state: State, note: string, url = ""): void {
  item.dataset.state = state;
  must(item.querySelector(".state"), "the item's state").textContent = note;
  if (url !== "") {
    const bang = View.media_kind(url) === null ? "" : "!";
    item.dataset.md = bang + "[" + (item.dataset.name ?? "").replace(/[[\]\\\n]/g, "") + "](" + url + ")";
  }
}

const SIZES = new Map<string, Promise<string>>();

export function box_sizes(el: ParentNode): void {
  for (const small of el.querySelectorAll<HTMLElement>("[data-of]:empty")) {
    const url = small.dataset.of ?? "";
    const got = SIZES.get(url) ?? size_ask(url);
    SIZES.set(url, got);
    void got.then((text) => {
      small.textContent ||= text;
    });
  }
}

async function size_ask(url: string): Promise<string> {
  const res = await fetch(url, { headers: { range: "bytes=0-0" } }).catch(() => null);
  res?.body?.cancel().catch(() => {});
  const total = /\/(\d+)$/.exec(res?.headers.get("content-range") ?? "")?.[1] ?? (res?.ok ? res.headers.get("content-length") : null);
  return total == null ? "" : View.size_show(Number(total));
}

export function box_items(): HTMLElement[] {
  return [...BOX.querySelectorAll<HTMLElement>(".item")];
}

function put(node: Node): void {
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

function end_range(): Range {
  const range = document.createRange();
  const last = BOX.lastChild;
  range.setStart(BOX, last?.nodeName === "BR" ? BOX.childNodes.length - 1 : BOX.childNodes.length);
  return range;
}

function changed(): void {
  tidy();
  HOOKS.input();
}

function tidy(): void {
  for (const n of [...BOX.childNodes]) {
    if (!box_may_hold(n)) {
      as_text(n);
    }
  }
  BOX.normalize();
  end_break_as_text_ends();
  BOX.classList.toggle("blank", box_blank());
}

function box_may_hold(n: ChildNode): boolean {
  return n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.classList.contains("item"));
}

function as_text(n: ChildNode): void {
  if (n.nodeName === "BR") {
    if (n !== BOX.lastChild) {
      n.replaceWith("\n");
    }
    return;
  }
  const line = n instanceof HTMLElement && BLOCKS.has(n.nodeName) && n.previousSibling !== null ? "\n" : "";
  const items = n instanceof HTMLElement ? [...n.querySelectorAll<HTMLElement>(".item")] : [];
  n.replaceWith(line + (items.length > 0 ? "" : n.textContent ?? ""), ...items);
}

function end_break_as_text_ends(): void {
  const last = BOX.lastChild;
  const before = last?.nodeName === "BR" ? last.previousSibling : last;
  const ends = before?.nodeType === Node.TEXT_NODE && (before.textContent ?? "").endsWith("\n");
  if (ends && last?.nodeName !== "BR") {
    BOX.append(document.createElement("br"));
  } else if (!ends && last?.nodeName === "BR") {
    last.remove();
  }
}

function offsets(points: Array<[Node, number]>): { text: string; at: number[] } {
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
      const gap = after && data !== "" && !data.startsWith("\n") ? "\n" : "";
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
        text += (text === "" || text.endsWith("\n") ? "" : "\n") + md;
        after = true;
      }
    }
  });
  return { text, at: at.map((x) => (x < 0 ? text.length : x)) };
}

function point(n: number): [Node, number] {
  const kids = [...BOX.childNodes];
  let [text, after] = ["", false];
  for (const [k, c] of kids.entries()) {
    if (c.nodeType === Node.TEXT_NODE) {
      const data = c.textContent ?? "";
      const gap = after && data !== "" && !data.startsWith("\n") ? 1 : 0;
      if (n <= text.length + gap + data.length) {
        return [c, Math.max(0, n - text.length - gap)];
      }
      text += (gap ? "\n" : "") + data;
      after = after && data === "";
    } else if (c instanceof HTMLElement && c.classList.contains("item") && c.dataset.md !== undefined) {
      text += (text === "" || text.endsWith("\n") ? "" : "\n") + c.dataset.md;
      after = true;
      if (n <= text.length) {
        return [BOX, k + 1];
      }
    }
  }
  return [BOX, BOX.lastChild?.nodeName === "BR" ? kids.length - 1 : kids.length];
}

function beside(back: boolean): HTMLElement | null {
  const sel = getSelection();
  if (sel === null || sel.anchorNode === null || sel.rangeCount === 0 || !sel.isCollapsed || !BOX.contains(sel.anchorNode)) {
    return null;
  }
  const [node, off] = [sel.anchorNode, sel.anchorOffset];
  let next: Node | null;
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

function caret_at(x: number, y: number): void {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
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

function html_pieces(html: string): Piece[] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Piece[] = [];
  let text = "";
  const line = () => (text += text === "" || text.endsWith("\n") ? "" : "\n");
  const walk = (n: Node): void => {
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
      text += "\n";
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

function html_media(el: Element): Piece | null {
  const md = el instanceof HTMLElement ? el.dataset.md : undefined;
  const got = md === undefined ? [] : Md.md_pasted(md);
  if (md !== undefined && got.length === 1 && got[0][1] === md.length) {
    return { name: got[0][2], url: got[0][3] };
  }
  const src = ["IMG", "VIDEO", "AUDIO", "SOURCE", "IFRAME"].includes(el.nodeName) ? el.getAttribute("src") : el.nodeName === "A" ? el.getAttribute("href") : null;
  const url = src === null ? null : new URL(src, location.href);
  const ok = url !== null && (el.nodeName === "A" ? View.store_file(url.pathname) : View.media_kind(url.pathname) !== null);
  if (url === null || url.origin !== location.origin || !ok) {
    return null;
  }
  const name = el.getAttribute("download") || el.getAttribute("alt") || el.getAttribute("title") || (url.pathname.split("/").pop() ?? "");
  return { name, url: url.pathname };
}
