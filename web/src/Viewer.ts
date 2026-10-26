// Viewer
// ======
// A picture seen whole, over the chat, inside the page (index.html's
// #viewer, a modal dialog): a plain click or tap on one of the chat's
// pictures (a message's attachment, a markdown picture, a show result's)
// or on a picture in the message box opens it (main.ts click); a click
// with Ctrl, ⌘ or Shift, or the middle button, still opens the file in a
// new tab, as a link. No new window: on Android an installed app's link
// into itself opened a second copy of the app, and back closed that.
// It opens fitted to the screen (never past the picture's own size),
// its name and a download above it. A pinch or the wheel zooms where it
// points, a drag pans, a double tap or click goes from fitted to the
// picture's own size (100%; one fitted at 100% already, 2.5×) and
// back; fitted, a swipe, ‹ › or the arrow keys go to the chat's picture
// before or after. It is no page of its own but a history entry over the
// page shown (the same address, the picture in its state), so back,
// Escape or ✕ close it, the chat under it untouched; a reload drops it
// (main.ts boot replaces the state, and steps back off its entry).

// Types
// =====

// a picture: its url (the original file), its name, and whether it is
// one of the chat's (log: ‹ › go to its neighbours) or the box's
export type Pic = { src: string; name: string; log: boolean };

// Constants
// =========

// the most it zooms, times the picture's own size
const MAX = 8;

// a tap moves less than SLOP px; a second within DOUBLE ms and NEAR px
// of the first is a double tap
const SLOP = 10;
const DOUBLE = 320;
const NEAR = 32;

// the chat's pictures, in its order: Html.ts images_html's and .media's
const PICS = "#log .pics a > img, #log a.media > img";

// Globals
// =======

let D = document.createElement("dialog");
let STAGE: HTMLElement = D;
let IMG = document.createElement("img");

// the picture shown (null: closed), where it was in the chat's list (n),
// its own size (w, h; 0: not loaded), the scale and offset drawn (s, x,
// y), the scale that fits it (fit), how far a swipe has it moved aside
// (swipe), the theme colors the page had before it opened (theme)
const V = {
  pic   : null as Pic | null,
  n     : -1,
  w     : 0,
  h     : 0,
  s     : 1,
  x     : 0,
  y     : 0,
  fit   : 1,
  swipe : 0,
  theme : [] as string[],
};

// the pointers down on the stage, where each was last; the gesture they
// make (from its first pointer down to the last up): where and when it
// began, whether it moved past SLOP or ever had two pointers, whether it
// began on the picture; the last tap
const PTS = new Map<number, { x: number; y: number }>();
let G: { x: number; y: number; t: number; moved: boolean; many: boolean; on: boolean; mouse: boolean } | null = null;
let TAP: { x: number; y: number; t: number } | null = null;

// Viewer
// ======

export function viewer_new(): void {
  D = document.querySelector<HTMLDialogElement>("#viewer")!;
  STAGE = D.querySelector<HTMLElement>(".stage")!;
  IMG = STAGE.querySelector("img")!;
  D.addEventListener("close", closed);
  D.querySelector<HTMLElement>(".shut")!.onclick = () => D.close();
  D.querySelector<HTMLElement>(".prev")!.onclick = () => step(-1);
  D.querySelector<HTMLElement>(".next")!.onclick = () => step(1);
  D.addEventListener("keydown", key);
  D.addEventListener("wheel", wheel, { passive: false });
  STAGE.addEventListener("pointerdown", down);
  STAGE.addEventListener("pointermove", move);
  STAGE.addEventListener("pointerup", up);
  STAGE.addEventListener("pointercancel", up);
  // (the browser's own drag of an image would end the gesture; Safari's
  // pinch, its own gesture events, would zoom the page)
  IMG.addEventListener("dragstart", (ev) => ev.preventDefault());
  D.addEventListener("gesturestart", (ev) => ev.preventDefault());
  new ResizeObserver(refit).observe(STAGE);
}

// whether a picture is open
export function viewer_on(): boolean {
  return D.open;
}

// the picture a click on el opens: one of the chat's (its link's file),
// or a picture in the message box; null: none
export function viewer_pic(el: Element): Pic | null {
  const link = el.closest<HTMLAnchorElement>("#log a.media, #log .pics a");
  const img = link?.querySelector("img");
  if (link != null && img != null) {
    const src = link.getAttribute("href") ?? img.src;
    return { src, name: img.alt.trim() || base(src), log: true };
  }
  const item = el.closest<HTMLElement>(".composer .item");
  const pic = item?.querySelector("img");
  if (item != null && pic != null) {
    return { src: pic.src, name: item.dataset.name ?? base(pic.src), log: false };
  }
  return null;
}

// opens pic (clicked: el, which of the chat's pictures it is, the same
// file may be there twice): a history entry over the page shown (push),
// or the one back or forward come to already holds it (viewer_sync)
export function viewer_open(pic: Pic, push = true, el: Element | null = null): void {
  if (push) {
    history.pushState({ pic }, "", location.href);
  }
  if (V.pic?.src !== pic.src) {
    const img = el?.closest("a")?.querySelector("img");
    V.n = img == null ? -1 : [...document.querySelectorAll(PICS)].indexOf(img);
    show(pic);
  }
  if (!D.open) {
    // the phone's bars dark as the viewer (the page's theme colors kept)
    const metas = [...document.querySelectorAll<HTMLMetaElement>("meta[name=theme-color]")];
    V.theme = metas.map((m) => m.content);
    D.showModal();
    metas.forEach((m) => (m.content = getComputedStyle(D).backgroundColor));
  }
}

// back or forward came to a history entry: it opens the picture its
// state holds, or closes the one open (main.ts popped)
export function viewer_sync(): void {
  const pic = history.state?.pic;
  if (typeof pic?.src === "string" && typeof pic.name === "string") {
    viewer_open({ src: pic.src, name: pic.name, log: pic.log === true }, false);
  } else if (D.open) {
    D.close();
  }
}

// closed (✕, Escape, a phone's back as the browser closes a dialog, or
// back to the entry under it): its entry gone too, if still there
function closed(): void {
  const metas = [...document.querySelectorAll<HTMLMetaElement>("meta[name=theme-color]")];
  metas.forEach((m, k) => (m.content = V.theme[k] ?? m.content));
  V.pic = null;
  PTS.clear();
  G = TAP = null;
  IMG.removeAttribute("src");
  if (history.state?.pic != null) {
    history.back();
  }
}

// pic shown: its name, its file to download, its neighbours' buttons;
// drawn fitted once loaded
function show(pic: Pic): void {
  V.pic = pic;
  V.w = V.h = V.swipe = 0;
  D.querySelector(".name")!.textContent = pic.name;
  D.querySelector(".zoom")!.textContent = "";
  const get = D.querySelector<HTMLAnchorElement>(".get")!;
  get.href = pic.src;
  get.download = file_name(pic);
  const [list, k] = place();
  D.querySelector<HTMLElement>(".prev")!.hidden = k <= 0;
  D.querySelector<HTMLElement>(".next")!.hidden = k < 0 || k >= list.length - 1;
  D.querySelector<HTMLElement>(".why")!.hidden = true;
  IMG.classList.add("wait");
  IMG.alt = pic.name;
  IMG.src = pic.src;
  const loaded = () => {
    if (V.pic !== pic) {
      return;
    }
    // (an SVG without a size of its own: the stage's)
    V.w = IMG.naturalWidth || STAGE.clientWidth;
    V.h = IMG.naturalHeight || STAGE.clientHeight;
    IMG.style.width = V.w + "px";
    IMG.style.height = V.h + "px";
    IMG.classList.remove("wait");
    fit();
  };
  // (decode may refuse a picture that did load, as WebKit does some
  // SVGs and very large ones: then it is shown as it is)
  IMG.decode().then(loaded, () => {
    if (V.pic !== pic) {
      return;
    }
    if (IMG.complete && IMG.naturalWidth > 0) {
      loaded();
    } else {
      D.querySelector<HTMLElement>(".why")!.hidden = false;
    }
  });
}

// the chat's pictures, and where the one shown is among them (-1: not
// there, or a picture of the box's); the chat redrawn since, the same
// file nearest where it was
function place(): [Pic[], number] {
  if (V.pic === null || !V.pic.log) {
    return [[], -1];
  }
  const list = [...document.querySelectorAll<HTMLImageElement>(PICS)].map((img) => viewer_pic(img)!);
  const src = V.pic.src;
  const at = list.flatMap((p, k) => (p.src === src ? [k] : []));
  const k = at.reduce((best, k) => (best < 0 || Math.abs(k - V.n) < Math.abs(best - V.n) ? k : best), -1);
  V.n = k;
  return [list, k];
}

// the picture before (-1) or after (1) in the chat, in place of this one
// (its history entry too); false: none
function step(d: number): boolean {
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

// Zoom
// ====

// fitted: its own size at most, centered
function fit(): void {
  V.fit = fit_scale();
  V.s = V.fit;
  hold();
  draw();
}

// the scale that fits the picture in the stage, but never past its own
// size
function fit_scale(): number {
  return V.w === 0 ? 1 : Math.min(1, STAGE.clientWidth / V.w, STAGE.clientHeight / V.h);
}

// the stage resized (a phone turned, a window resized): one fitted stays
// fitted, else it keeps its scale, held in the stage
function refit(): void {
  if (V.w === 0) {
    return;
  }
  const was = fitted();
  V.fit = fit_scale();
  V.s = was ? V.fit : Math.max(V.fit, V.s);
  hold();
  draw();
}

function fitted(): boolean {
  return V.s <= V.fit * 1.001;
}

// zoomed to s (within fitted and MAX), the point (x, y) of the stage
// staying where it is
function zoom_at(x: number, y: number, s: number): void {
  const to = Math.min(Math.max(s, V.fit), Math.max(MAX, V.fit));
  V.x = x - ((x - V.x) * to) / V.s;
  V.y = y - ((y - V.y) * to) / V.s;
  V.s = to;
  hold();
  draw();
}

// a side smaller than the stage centered in it; a larger one covering it
// (no gap at an edge)
function hold(): void {
  const [w, h] = [V.w * V.s, V.h * V.s];
  const [sw, sh] = [STAGE.clientWidth, STAGE.clientHeight];
  V.x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, V.x));
  V.y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, V.y));
}

function draw(): void {
  IMG.style.transform = `translate(${V.x + V.swipe}px, ${V.y}px) scale(${V.s})`;
  D.classList.toggle("big", !fitted());
  D.querySelector(".zoom")!.textContent = V.w === 0 ? "" : Math.round(V.s * 100) + "%";
}

// fitted ↔ its own size (one fitted at its own size already: 2.5×), at
// (x, y)
function toggle(x: number, y: number): void {
  const big = V.fit < 0.999 ? 1 : V.fit * 2.5;
  ease();
  zoom_at(x, y, fitted() ? big : V.fit);
}

// the next change drawn eased (a double tap's, a key's, a swipe let go)
function ease(): void {
  D.classList.add("ease");
  setTimeout(() => D.classList.remove("ease"), 220);
}

// a point on the screen, on the stage
function at(x: number, y: number): [number, number] {
  const r = STAGE.getBoundingClientRect();
  return [x - r.left, y - r.top];
}

// Input
// =====

function down(ev: PointerEvent): void {
  if ((ev.pointerType === "mouse" && ev.button !== 0) || (ev.target as Element).closest("button") !== null) {
    return;
  }
  // (a mouse: no text selected, no image dragged)
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

// one pointer pans (fitted, with pictures beside it: swipes); two pinch,
// zooming about their midpoint as it moves
function move(ev: PointerEvent): void {
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
  zoom_at(nx, ny, span === 0 ? V.s : (V.s * Math.hypot(c.x - d.x, c.y - d.y)) / span);
}

// all pointers up: a swipe far enough goes to the picture beside, else
// slides back; a tap, unmoved: a second near the first toggles the zoom,
// a mouse's click beside the picture closes it
function up(ev: PointerEvent): void {
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

// the wheel zooms where the pointer is (a trackpad's pinch comes as the
// wheel with Ctrl, in smaller steps)
function wheel(ev: WheelEvent): void {
  ev.preventDefault();
  if (V.w === 0 || !STAGE.contains(ev.target as Node)) {
    return;
  }
  const px = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? STAGE.clientHeight : 1);
  zoom_at(...at(ev.clientX, ev.clientY), V.s * Math.exp(-px * (ev.ctrlKey ? 0.01 : 0.002)));
}

// ← → the picture beside, + − zoom at the middle, 0 fitted; nothing
// scrolls the chat under it (Escape: the dialog's own)
function key(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) {
    return;
  }
  const [x, y] = [STAGE.clientWidth / 2, STAGE.clientHeight / 2];
  const on = (ev.target as Element).closest("a, button") !== null;
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

// Names
// =====

// a url's last part (as written, if its escapes are broken)
function base(src: string): string {
  const last = src.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || "picture";
  } catch {
    return last;
  }
}

// the name it downloads as: its own, with its file's extension if it
// has none (a picture named in markdown as "chart")
function file_name(pic: Pic): string {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(base(pic.src))?.[1];
  return ext === undefined || /\.[a-z0-9]{1,10}$/i.test(pic.name) ? pic.name : pic.name + "." + ext;
}
