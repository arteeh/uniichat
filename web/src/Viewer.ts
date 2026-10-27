import { get } from "../../Json.ts";
import { find, must } from "./Dom.ts";

export type Pic = { src: string; name: string; log: boolean };

const MAX = 8;

const SLOP = 10;
const DOUBLE = 320;
const NEAR = 32;

const PICS = "#log .pics a > img, #log a.media > img";

let D = document.createElement("dialog");
let STAGE: HTMLElement = D;
let IMG = document.createElement("img");

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

const PTS = new Map<number, { x: number; y: number }>();
let G: { x: number; y: number; t: number; moved: boolean; many: boolean; on: boolean; mouse: boolean } | null = null;
let TAP: { x: number; y: number; t: number } | null = null;

export function viewer_new(): void {
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
  // (the browser's own drag of an image would end the gesture; Safari's
  // pinch, its own gesture events, would zoom the page)
  IMG.addEventListener("dragstart", (ev) => ev.preventDefault());
  D.addEventListener("gesturestart", (ev) => ev.preventDefault());
  new ResizeObserver(refit).observe(STAGE);
}

export function viewer_on(): boolean {
  return D.open;
}

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
    const metas = [...document.querySelectorAll<HTMLMetaElement>("meta[name=theme-color]")];
    V.theme = metas.map((m) => m.content);
    D.showModal();
    metas.forEach((m) => (m.content = getComputedStyle(D).backgroundColor));
  }
}

export function viewer_sync(): void {
  const state: unknown = history.state;
  const pic = get(state, "pic");
  const [src, name] = [get(pic, "src"), get(pic, "name")];
  if (typeof src === "string" && typeof name === "string") {
    viewer_open({ src, name, log: get(pic, "log") === true }, false);
  } else if (D.open) {
    D.close();
  }
}

function closed(): void {
  const metas = [...document.querySelectorAll<HTMLMetaElement>("meta[name=theme-color]")];
  metas.forEach((m, k) => (m.content = V.theme[k] ?? m.content));
  V.pic = null;
  PTS.clear();
  G = TAP = null;
  IMG.removeAttribute("src");
  const state: unknown = history.state;
  if (get(state, "pic") != null) {
    history.back();
  }
}

function show(pic: Pic): void {
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
  // (decode may refuse a picture that did load, as WebKit does some
  // SVGs and very large ones: then it is shown as it is)
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

function place(): [Pic[], number] {
  if (V.pic === null || !V.pic.log) {
    return [[], -1];
  }
  const list = [...document.querySelectorAll<HTMLImageElement>(PICS)].flatMap((img) => viewer_pic(img) ?? []);
  const src = V.pic.src;
  const at = list.flatMap((p, k) => (p.src === src ? [k] : []));
  const k = at.reduce((best, k) => (best < 0 || Math.abs(k - V.n) < Math.abs(best - V.n) ? k : best), -1);
  V.n = k;
  return [list, k];
}

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

function fit(): void {
  V.fit = fit_scale();
  V.s = V.fit;
  hold();
  draw();
}

function fit_scale(): number {
  return V.w === 0 ? 1 : Math.min(1, STAGE.clientWidth / V.w, STAGE.clientHeight / V.h);
}

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

function zoom_at(x: number, y: number, s: number): void {
  const to = Math.min(Math.max(s, V.fit), Math.max(MAX, V.fit));
  V.x = x - ((x - V.x) * to) / V.s;
  V.y = y - ((y - V.y) * to) / V.s;
  V.s = to;
  hold();
  draw();
}

function hold(): void {
  const [w, h] = [V.w * V.s, V.h * V.s];
  const [sw, sh] = [STAGE.clientWidth, STAGE.clientHeight];
  V.x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, V.x));
  V.y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, V.y));
}

function draw(): void {
  IMG.style.transform = `translate(${V.x + V.swipe}px, ${V.y}px) scale(${V.s})`;
  D.classList.toggle("big", !fitted());
  must(D.querySelector(".zoom"), ".zoom").textContent = V.w === 0 ? "" : Math.round(V.s * 100) + "%";
}

function toggle(x: number, y: number): void {
  const big = V.fit < 0.999 ? 1 : V.fit * 2.5;
  ease();
  zoom_at(x, y, fitted() ? big : V.fit);
}

function ease(): void {
  D.classList.add("ease");
  setTimeout(() => D.classList.remove("ease"), 220);
}

function at(x: number, y: number): [number, number] {
  const r = STAGE.getBoundingClientRect();
  return [x - r.left, y - r.top];
}

function down(ev: PointerEvent): void {
  if ((ev.pointerType === "mouse" && ev.button !== 0) || (ev.target as Element).closest("button") !== null) {
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

function base(src: string): string {
  const last = src.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || "picture";
  } catch {
    return last;
  }
}

function file_name(pic: Pic): string {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(base(pic.src))?.[1];
  return ext === undefined || /\.[a-z0-9]{1,10}$/i.test(pic.name) ? pic.name : pic.name + "." + ext;
}
