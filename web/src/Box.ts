// Box
// ===
// The message box: the text typed, and the files pasted, dropped or
// picked into it, each an item right where it was put (a picture or a
// video's first frame in its own aspect ratio, 150 px at most; a sound's,
// a page's or any other file's tile, its name and size, one fixed size),
// deleted as one character (Backspace after it, Delete before it); a
// picture's, clicked, opens whole (Viewer.ts).
// Behind it, markdown: the text as typed, each item ![name](/media/…) (a
// file that isn't media a link, [name](/media/…)) on a line of its own
// (box_text), which is what is sent and kept as the draft; box_set draws
// such a text back, a line that is one item as that item. An item
// uploading (main.ts) has no url yet: it shows how far it is and is no
// part of the text; one refused says so till deleted. The box holds only
// text, items and, at its end, a <br> that shows an empty last line
// (tidy): pasted or dropped HTML comes as its text and its media, never
// its formatting.

import * as Md from "../../Md.ts";
import * as View from "../../View.ts";

// Types
// =====

// what the box tells: its text changed (typed, or an item put or
// deleted); files to upload, at the caret (pasted, dropped)
export type Hooks = { input: () => void; files: (files: File[]) => void };

// an item's state: uploading, uploaded (its markdown kept), refused
export type State = "up" | "ok" | "bad";

// a piece of pasted HTML: text, or a file of the media store it shows
type Piece = string | { name: string; url: string };

// Globals
// =======

let BOX: HTMLElement = document.createElement("div");
let HOOKS: Hooks = { input: () => {}, files: () => {} };

// where the caret last was in the box (a click on a button takes the
// focus away, not where its file goes); whether an IME is composing
let LAST: Range | null = null;
let COMPOSING = false;

// the longest side of a picture's or a video's item (item_fit); the least
// an item's frame takes, so one a few pixels big can still be seen and
// deleted (the picture stays its own size in it)
const SIDE = 150;
const LEAST = 24;

// HTML's elements that start a line of their own (a pasted page's text)
const BLOCKS = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL", "TABLE", "SECTION", "ARTICLE", "HEADER", "FOOTER"]);

// Box
// ===

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
  // copied or cut: its markdown as text; its markup (its items' too) for
  // a paste back here
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
  // nothing dragged out of it or around in it; dropped in, at the point
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

// the box's text: its markdown, each item uploaded on a line of its own
// (one uploading or refused left out)
export function box_text(): string {
  return offsets([]).text;
}

// whether the box holds nothing: no text, no item
export function box_blank(): boolean {
  return BOX.textContent === "" && BOX.querySelector(".item") === null;
}

export function box_focused(): boolean {
  return document.activeElement === BOX;
}

export function box_focus(): void {
  BOX.focus();
}

// the box as a text says (box_text's form), the caret at its end
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

// the selection, as offsets in box_text (none in the box: its end)
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

// the selection set from offsets in box_text (past its end: at its end)
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

// text put in at the caret (or where it last was; else at the end), in
// place of what is selected, the caret after it
export function box_insert(text: string): void {
  if (text !== "") {
    put(document.createTextNode(text));
  }
}

// an item put in at the caret, as box_insert puts text
export function box_put(item: HTMLElement): void {
  put(item);
}

// a new item: its name; its url (/media/…, or a picked file's blob: url
// while it uploads; "": none to show) and its kind (image, video, audio,
// html, file: by its url, else as given); a file's size, if known (else
// asked of the server: box_sizes)
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

// a picture's or a video's item, once its size is known (its preview
// loaded; till then the tiles' size): its own aspect ratio, its longest
// side SIDE px, or its own size if smaller, never cropped nor stretched
// (style.css)
function item_fit(item: HTMLElement, w: number, h: number): void {
  if (!(w > 0 && h > 0)) {
    return;
  }
  const k = Math.min(1, SIDE / Math.max(w, h));
  item.style.width = Math.max(LEAST, Math.round(w * k)) + "px";
  item.style.height = Math.max(LEAST, Math.round(h * k)) + "px";
}

// an item's state, the note on it (how far it is, why refused), and once
// uploaded its url (its markdown, then: a link if it isn't media)
export function item_state(item: HTMLElement, state: State, note: string, url = ""): void {
  item.dataset.state = state;
  item.querySelector<HTMLElement>(".state")!.textContent = note;
  if (url !== "") {
    const bang = View.media_kind(url) === null ? "" : "!";
    item.dataset.md = bang + "[" + (item.dataset.name ?? "").replace(/[[\]\\\n]/g, "") + "](" + url + ")";
  }
}

// the sizes of the store's files shown in el not known yet (a file's tile
// here, a file's chip in a message: Html.ts chip_html, `data-of` its
// url), each asked of the server once a page (one it can't tell stays
// unsized, not asked again at each draw): the total its Range of one
// byte says
const SIZES = new Map<string, Promise<string>>();

export function box_sizes(el: ParentNode): void {
  for (const small of el.querySelectorAll<HTMLElement>("[data-of]:empty")) {
    const url = small.dataset.of!;
    const got = SIZES.get(url) ?? size_ask(url);
    SIZES.set(url, got);
    got.then((text) => {
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

// the items in the box now
export function box_items(): HTMLElement[] {
  return [...BOX.querySelectorAll<HTMLElement>(".item")];
}

// Inside
// ======

// a node put in at the caret (where it last was; else the end), in place
// of what is selected; the caret after it; told
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

// after any change: kept tidy, told
function changed(): void {
  tidy();
  HOOKS.input();
}

// the box as only text, items and an end's <br>: whatever a browser put
// in that is none of those, its text (an element that starts a line, a
// new line before it); a <br> but the end's, a new line; adjacent texts
// joined. A <br> at the end only if its text ends in a new line (else
// that empty last line wouldn't show, nor take the caret). Marked blank
// for its placeholder
function tidy(): void {
  for (const n of [...BOX.childNodes]) {
    if (n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.classList.contains("item"))) {
      continue;
    }
    if (n.nodeName === "BR") {
      if (n !== BOX.lastChild) {
        n.replaceWith("\n");
      }
      continue;
    }
    const line = n instanceof HTMLElement && BLOCKS.has(n.nodeName) && n.previousSibling !== null ? "\n" : "";
    const items = n instanceof HTMLElement ? [...n.querySelectorAll<HTMLElement>(".item")] : [];
    n.replaceWith(line + (items.length > 0 ? "" : n.textContent ?? ""), ...items);
  }
  BOX.normalize();
  const last = BOX.lastChild;
  const before = last?.nodeName === "BR" ? last.previousSibling : last;
  const ends = before?.nodeType === Node.TEXT_NODE && (before.textContent ?? "").endsWith("\n");
  if (ends && last?.nodeName !== "BR") {
    BOX.append(document.createElement("br"));
  } else if (!ends && last?.nodeName === "BR") {
    last.remove();
  }
  BOX.classList.toggle("blank", box_blank());
}

// the box's text (box_text), and where in it each point asked is (a
// node and an offset in it, as a Range's): an item uploaded its own
// line, a new line put before and after it where none is
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

// where an offset in box_text is in the box: a text's node and offset,
// else the box's child after the item there; past the end, the end (but
// its <br>)
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

// the item right before the caret (back) or right after it; none if the
// selection isn't one point in the box
function beside(back: boolean): HTMLElement | null {
  const sel = getSelection();
  if (sel === null || sel.rangeCount === 0 || !sel.isCollapsed || !BOX.contains(sel.anchorNode)) {
    return null;
  }
  const [node, off] = [sel.anchorNode!, sel.anchorOffset];
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

// the caret put at a point of the screen (a drop's)
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

// pasted HTML as its text and the media store's files it shows (an
// item's markdown copied from this box, a message's media copied from
// the chat), in order; null: it isn't readable as HTML
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

// a pasted element that is a file of the media store (an item of this
// box; an image, video, audio or page of this site's /media/, or a file's
// chip: Html.ts chip_html), as a piece; else null
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
  const name = el.getAttribute("download") || el.getAttribute("alt") || el.getAttribute("title") || url.pathname.split("/").pop()!;
  return { name, url: url.pathname };
}
