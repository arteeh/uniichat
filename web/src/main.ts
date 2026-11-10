import { err_why } from "../../Err.ts";
import * as Import from "../../Import.ts";
import { get, text_of } from "../../Json.ts";
import type { Page, Row } from "../../Settings.ts";
import { theme_css } from "../../Theme.ts";
import * as View from "../../View.ts";
import * as Box from "./Box.ts";
import { find, must } from "./Dom.ts";
import * as Html from "./Html.ts";
import * as Tree from "./Tree.ts";
import * as Viewer from "./Viewer.ts";

type Read = { sessions: Import.Session[]; moved: number };

type Back = { at: { a: number; top: number } | null; y: number | null; away: { y: number; end: boolean } | null; caret: [number, number]; focus: boolean };

const DESK = matchMedia("(hover: hover)");

const ME_WAIT = 4000;
const TRAVEL = 1000;

const NONE   = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";

const SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;

const WIDE = matchMedia("(min-width: 900px)");

const TOUCH = matchMedia("(pointer: coarse)");

const STILL = matchMedia("(prefers-reduced-motion: reduce)");

// the screens a history.go is taking the stack back to, laid on its popstate
let LAY: string[] | null = null;
let TRIP = 0;

const UNII = "unii";

const AGENT = /^\/a\/([a-z0-9]{1,16})(\/edit)?$/;

const v = View.view_new(AGENT.exec(location.pathname)?.[1] ?? UNII);

const BOX = $(".composer .field", HTMLElement);

const UPS = new Map<HTMLElement, XMLHttpRequest>();

const BACK = $("#import [name=back]", HTMLInputElement);

const P = {
  rec   : null as MediaRecorder | null,
  shown : "",
  frame : 0,
  rows  : true,
  toast : 0,
  push  : null as { reg: ServiceWorkerRegistration; key: string } | null,
  used  : { ws: null as WebSocket | null, on: false, at: 0, agent: "" },
  after : false,
  at    : "",
};

const SCROLL = {
  end   : true,
  stick : true,
  y     : 0,
  still : false,
  away  : null as { y: number; end: boolean } | null,
  at    : null as Spot | null,
  wide  : innerWidth,
};

const RENEW = {
  build : document.documentElement.dataset.build ?? "",
  due   : false,
  going : false,
  dirty : new Set<HTMLFormElement>(),
  saving: 0,
  gave  : null as WebSocket | null,
  back  : null as { a: number; top: number } | null,
};

const IMPORT = {
  found : new Map<string, Read>(),
  done  : {} as Import.Done,
  off   : new Set<string>(),
  step  : "" as "" | "start" | "send" | "run" | "seen" | "done",
};

function $(sel: string): HTMLElement;
function $<T extends HTMLElement>(sel: string, type: { new (): T; prototype: T }): T;
function $(sel: string, type: { new (): HTMLElement; prototype: HTMLElement } = HTMLElement): HTMLElement {
  return find(document, sel, type);
}

function kept(fact: string): string {
  return "unii." + fact;
}

async function boot(): Promise<void> {
  // the app keeps every screen's scroll itself: the browser's own restore
  // on back and forward came after or before route() and fought it (#122)
  history.scrollRestoration = "manual";
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  navigator.serviceWorker?.register("/sw.js").catch(() => {});
  navigator.serviceWorker?.addEventListener("message", (ev: MessageEvent) => {
    const url: unknown = get(ev.data, "go");
    if (typeof url === "string" && url.startsWith("/")) {
      go(url);
    }
  });
  navigator.serviceWorker?.startMessages();
  notes_close();
  const tree = location.pathname === TREE ? TREE + location.search + (tree_view() ? "#view" : "") : null;
  const own = AGENT.test(location.pathname) || location.pathname === "/new" ? location.pathname : null;
  const state: unknown = history.state;
  const pic = get(state, "pic") != null;
  const path = PAGES.includes(location.pathname) ? "/settings" : tree ?? own ?? "/";
  if (pic) {
    history.back();
  } else if (String(get(state, "chain")) !== String(depth(path))) {
    lay(depth(path), 0, true);
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
  addEventListener("focus", () => {
    in_use();
    notes_close();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      v.wake();
    }
    in_use();
    notes_close();
    if (document.hidden && RENEW.due && !RENEW.going && renew_free(true)) {
      RENEW.going = true;
      void renew(true);
    }
  });
  addEventListener("pageshow", () => v.wake());
  addEventListener("online", () => v.wake());
  // a phone freezes a page in the background, its links dead: the server
  // hears it leave now, and it comes back at once (#114)
  document.addEventListener("freeze", () => v.ws?.close());
  document.addEventListener("resume", () => v.wake());
  addEventListener("blur", () => in_use(true));
  addEventListener("pagehide", () => in_use(true));
}

async function boot_me(): Promise<unknown> {
  for (let k = 0; ; k++) {
    const res = await me();
    const got: unknown = res?.status === 200 ? await res.json().catch(() => undefined) : res?.status === 401 ? null : undefined;
    if (got !== undefined) {
      if (k > 0) {
        $("#toast").hidden = true;
      }
      return got;
    }
    if (k === 0) {
      toast("Can't reach UniiChat. Reconnecting…", true);
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

const PAGES = ["/settings", "/account"];

const FORM = /^\/(new|a\/([a-z0-9]{1,16})\/edit)$/;

const TREE = "/tree";

const OLDER = "This page is older than the server: reload it.";

function tree_view(): boolean {
  return location.hash.toLowerCase() === "#view";
}

function solo(title: string, sub: string): void {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}

function chat(): void {
  const file = $("input[type=file]", HTMLInputElement);
  Box.box_new(BOX, { input: typed, files: attach });
  BOX.addEventListener("blur", () => draw(false));
  // never the Enter that ends a composition (Japanese, Chinese: Safari
  // ends it first, so only its keyCode, 229, says so)
  BOX.onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && DESK.matches) {
      ev.preventDefault();
      submit();
    }
  };
  $("form").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $(".attach").onclick = () => file.click();
  $("#pick").onkeydown = roam;
  $("#pick").addEventListener("focusout", left);
  $("header .who").onclick = () => go("/a/" + v.agent + "/edit");
  $("header .brain").onclick = () => go("/tree?a=" + v.agent);
  $("header .back").onclick = () => go(up_to());
  WIDE.onchange = () => route();
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...(file.files ?? [])]);
    file.value = "";
  };
  onpopstate = popped;
  document.addEventListener("contextmenu", (ev) => {
    if (TOUCH.matches && ev.target instanceof Element && ev.target.closest("[data-go]") !== null) {
      ev.preventDefault();
    }
  });
  Viewer.viewer_new();
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    if ((ev.dataTransfer?.files.length ?? 0) > 0) {
      attach([...(ev.dataTransfer?.files ?? [])]);
    }
  };
  document.onclick = click;
  must(visualViewport, "visualViewport").onresize = () => {
    if (Box.box_focused() && Box.box_caret()[0] === Box.box_text().length) {
      BOX.scrollTop = BOX.scrollHeight;
    }
    draw(true);
  };
  document.onscroll = () => {
    if (at_end()) {
      SCROLL.end = true;
    } else if (scrollY < SCROLL.y) {
      SCROLL.end = false;
    }
    SCROLL.y = scrollY;
    SCROLL.at = SCROLL.end || $("#log").hidden ? null : spot();
    mine_show();
  };
  $(".mine").onclick = mine;
  $(".down").onclick = down;
  const keep = new ResizeObserver(() => {
    if (SCROLL.still) {
      SCROLL.still = false;
    } else if (SCROLL.end && !$("#log").hidden && !at_end()) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  });
  keep.observe($("#log"));
  keep.observe($("footer"));
  // a tool line opened at the chat's end grows down, its line staying put
  $("#log").addEventListener("toggle", (ev) => {
    if (ev.target instanceof HTMLDetailsElement && ev.target.matches(".line")) {
      SCROLL.still = true;
    }
  }, true);
  addEventListener("resize", resized);
  draw(true);
}

function signed(): void {
  document.body.className = "";
  BOX.dataset.placeholder = View.HINT;
  Box.box_set(sessionStorage.getItem(kept("draft." + v.agent)) ?? "");
  renewed();
}

function typed(): void {
  sessionStorage.setItem(kept("draft." + v.agent), Box.box_text());
  for (const [item, xhr] of UPS) {
    if (!item.isConnected) {
      UPS.delete(item);
      xhr.abort();
    }
  }
  draw(true);
}

function submit(): void {
  if (Box.box_items().some((item) => item.dataset.state === "bad")) {
    P.after = false;
    toast(FAILED);
    return;
  }
  if (UPS.size > 0) {
    P.after = true;
    toast("Sends once uploaded.");
    return;
  }
  P.after = false;
  const text = Box.box_text().trim();
  act({ $: "Send", text });
  Box.box_set("");
}

function back(sent: View.Sent, out: View.Answer): void {
  if (out.error === undefined) {
    return;
  }
  if (Box.box_blank()) {
    Box.box_set(sent.text);
  }
  toast(out.error);
}

const FAILED = "A file in the message didn't upload: delete it (Backspace after it), then send.";

function attach(files: File[]): void {
  for (const file of files) {
    const name = file.name.replace(/[[\]\\\n]/g, "") || "file";
    const ext = View.media_ext(file.name);
    const kind = ext !== "" ? View.ext_kind(ext) ?? "file" : file.type.startsWith("image/") ? "image" : "file";
    const item = Box.item_new(name, kind === "image" || kind === "video" ? URL.createObjectURL(file) : "", "up", kind, file.size);
    Box.box_put(item);
    upload(item, file);
  }
}

function upload(item: HTMLElement, file: File): void {
  const xhr = new XMLHttpRequest();
  UPS.set(item, xhr);
  Box.item_state(item, "up", "0%");
  item.style.setProperty("--part", "0%");
  xhr.open("POST", "/api/media?name=" + encodeURIComponent(file.name));
  xhr.upload.onprogress = (ev) => {
    const part = Math.round((ev.lengthComputable ? ev.loaded / ev.total : 0) * 100) + "%";
    Box.item_state(item, "up", part);
    item.style.setProperty("--part", part);
  };
  xhr.onloadend = () => {
    const out = upload_answer(xhr);
    if (UPS.get(item) !== xhr) {
      return;
    }
    UPS.delete(item);
    if ("name" in out) {
      Box.item_state(item, "ok", "", "/media/" + out.name);
    } else {
      Box.item_state(item, "bad", "Failed");
      toast(out.error);
    }
    typed();
    if (P.after && UPS.size === 0) {
      submit();
    }
  };
  xhr.send(file);
}

function upload_answer(xhr: XMLHttpRequest): { name: string } | { error: string } {
  let out: unknown = null;
  try {
    out = JSON.parse(xhr.responseText);
  } catch {}
  if (typeof out === "object" && out !== null && "name" in out && typeof out.name === "string") {
    return { name: out.name };
  }
  const why = typeof out === "object" && out !== null && "error" in out && typeof out.error === "string" ? out.error : xhr.status === 0 ? "Can't reach UniiChat." : "HTTP " + xhr.status;
  return { error: "Could not upload: " + why };
}

function act(a: View.Act): void {
  const said = a.$ === "Send" ? a.text.trim() : "";
  SCROLL.end = SCROLL.end || a.$ === "Send";
  P.rows = true;
  for (const msg of View.view_act(v, a)) {
    View.link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw(a.$ === "Send");
}

function click(ev: MouseEvent): void {
  const target = ev.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act], [data-copy], [data-go], [data-knob], .choices > button, .imp");
  const sel = getSelection();
  const pic = Viewer.viewer_pic(target);
  if (pic !== null && !(ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) && (sel === null || sel.isCollapsed)) {
    ev.preventDefault();
    if (!DESK.matches) {
      BOX.blur();
    }
    Viewer.viewer_open(pic, true, target);
    return;
  }
  if (el === null || (sel !== null && !sel.isCollapsed && el.contains(sel.focusNode))) {
    return;
  }
  if (el.dataset.knob !== undefined) {
    place(el);
    return;
  }
  el.closest<HTMLElement>(".choices")?.hidePopover();
  const { act: a, copy: text, go: path } = el.dataset;
  if (el.classList.contains("imp")) {
    void import_open(false);
    return;
  }
  if (path !== undefined) {
    ev.preventDefault();
    go(path);
  }
  if (a !== undefined) {
    act(JSON.parse(a) as View.Act);
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}

function place(knob: HTMLElement): void {
  const menu = $("#pick-" + knob.dataset.knob);
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

function roam(ev: KeyboardEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices");
  if (menu !== null && ev.key === "Tab" && ev.shiftKey && ev.target === menu.querySelector("button")) {
    ev.preventDefault();
    menu.hidePopover();
    (menu.previousElementSibling as HTMLElement).focus();
    return;
  }
  if (menu === null || !["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
    return;
  }
  ev.preventDefault();
  const rows = [...menu.querySelectorAll<HTMLElement>("button")];
  const n = rows.length;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + n, Home: 0, End: n - 1 };
  rows[to[ev.key] % n].focus();
}

function left(ev: FocusEvent): void {
  const menu = (ev.target as HTMLElement).closest<HTMLElement>(".choices:popover-open");
  const to = ev.relatedTarget as Node | null;
  if (menu !== null && to !== null && !menu.contains(to) && to !== menu.previousElementSibling) {
    menu.hidePopover();
  }
}


const FRAMED = new WeakSet<HTMLIFrameElement>();

function frames(all = false): void {
  for (const f of document.querySelectorAll<HTMLIFrameElement>("#log iframe.page")) {
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

// where the reader is: the innermost block under the header's bottom
// edge, and how far down it that edge falls, a share of its height
type Spot = { el: Element; share: number };

function spot(): Spot | null {
  const line = $("header").getBoundingClientRect().bottom;
  const under = (el: Element): boolean => {
    const box = el.getBoundingClientRect();
    return box.height > 0 && box.bottom > line;
  };
  let el = [...$("#log").querySelectorAll(".rows > *, .tail > *")].find(under);
  if (el === undefined) {
    return null;
  }
  for (;;) {
    const kid: Element | undefined = [...el.children].find((k) => getComputedStyle(k).display !== "inline" && under(k));
    if (kid === undefined) {
      break;
    }
    el = kid;
  }
  const box = el.getBoundingClientRect();
  return { el, share: Math.max(0, line - box.top) / box.height };
}

// a narrower window wraps the text above into more lines, and the page
// keeps scrollY (html has overflow-anchor: none), so the reader's spot
// goes back under the header (#127); at the end, keep sticks to it
function resized(): void {
  frames(true);
  const at = SCROLL.at;
  const turned = innerWidth !== SCROLL.wide;
  SCROLL.wide = innerWidth;
  if (!turned || at === null || !at.el.isConnected || SCROLL.end || $("#log").hidden) {
    return;
  }
  // route() sets body.wide only on WIDE.onchange, after this; until then
  // a .wide body that isn't wide has the list in the flow above the chat
  document.body.classList.toggle("wide", WIDE.matches);
  const line = $("header").getBoundingClientRect().bottom;
  const box = at.el.getBoundingClientRect();
  scrollBy(0, box.top + at.share * box.height - line);
}

function copied(button: HTMLElement): void {
  button.innerHTML = Html.CHECK;
  setTimeout(() => (button.innerHTML = Html.SHEETS), 1200);
}

async function mic(): Promise<void> {
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
  const parts: Blob[] = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  draw(false);
  meter(stream, rec);
}

function meter(stream: MediaStream, rec: MediaRecorder): void {
  const audio = new AudioContext();
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $(".voice canvas", HTMLCanvasElement);
  const pen = must(canvas.getContext("2d"), "a 2d canvas");
  const levels: number[] = [];
  const start = performance.now();
  const frame = (now: number): void => {
    if (P.rec !== rec) {
      void audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = (canvas.width = canvas.clientWidth * dpr);
    const h = (canvas.height = canvas.clientHeight * dpr);
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0; i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function words(audio: Blob): void {
  const act: View.Client = { $: "voice", type: audio.type, body: () => audio };
  View.link_send(v, act, heard);
  draw(false);
}

function heard(out: View.Answer): void {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(Box.box_text().slice(0, Box.box_caret()[0])) ? " " : "";
  Box.box_insert(gap + text);
  Box.box_focus();
}

function connect(): void {
  View.link_open(v, {
    open : (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post : (path, body) => fetch(path, { method: "POST", body: body as BodyInit }),
    hear : hear,
    lost : lost,
  });
}

// the agent whose chat is on screen, if one is: not the list, Settings or
// a memory page
function on_screen(): string | null {
  return document.visibilityState === "visible" && !$("#log").hidden ? v.agent : null;
}

// that agent's notifications, only while its chat is still in view once
// they are found
function notes_close(): void {
  const agent = on_screen();
  if (agent !== null) {
    navigator.serviceWorker?.ready.then((reg) => reg.getNotifications({ tag: "unii-" + agent })).then((notes) => notes.forEach((n) => on_screen() === agent && n.close())).catch(() => {});
  }
}

// the server counts a chat read, and pushes none for it, while it's on
// screen in a focused window
function in_use(off = false): void {
  const on = !off && on_screen() !== null && document.hasFocus();
  const ws = v.ws;
  if (ws === null || !v.up || ws.readyState !== WebSocket.OPEN || (ws === P.used.ws && on === P.used.on && v.agent === P.used.agent && (!on || Date.now() - P.used.at < View.USE_PING))) {
    return;
  }
  ws.send(on ? View.ACTIVE : View.IDLE);
  P.used = { ws, on, at: Date.now(), agent: v.agent };
}

// after a sleep a request can hang on a dead connection: one that takes
// longer counts as unanswered
function me(): Promise<Response | null> {
  return fetch("/api/me", { signal: AbortSignal.timeout(ME_WAIT) }).catch(() => null);
}

async function lost(up: boolean): Promise<boolean> {
  draw(true);
  setTimeout(() => draw(false), View.GRACE + 100);
  const res = up ? null : await me();
  if (res !== null && res.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}

function hear(msg: View.Server): void {
  if (msg.$ === "error" && v.refused !== null) {
    const old = v.refused.old;
    if (old && msg.build !== undefined) {
      unsent_back();
      v.build = msg.build;
      renew_due(msg.build);
    }
    if (!RENEW.due || !renew_free()) {
      toast(old ? OLDER : msg.text, true, old);
    }
    draw(false);
    return;
  }
  if (msg.$ === "view" && v.refused !== null) {
    $("#toast").hidden = true;
  }
  if (v.ws !== P.used.ws) {
    in_use();
  }
  const was = View.view_pick(v);
  const sent = JSON.stringify(v.sent);
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  if (msg.$ === "team") {
    Html.team_set(v.team);
    if (location.pathname === "/settings") {
      archived_draw();
    }
  }
  if (AGENT.test(location.pathname) && !FORM.test(location.pathname) && AGENT.exec(location.pathname)?.[1] !== v.agent) {
    history.replaceState({ chain: depth("/a/" + v.agent) }, "", "/a/" + v.agent);
  }
  const now = View.view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? JSON.stringify(v.sent) !== sent : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    renew_due(msg.build);
  }
  void import_welcome();
  draw(true);
}

// the link is shut for good: messages it holds go back to the box, before
// what was typed since, for the user to send again after the reload
function unsent_back(): void {
  const says = UPS.size === 0 ? v.out.filter((p) => p.msg.$ === "say") : [];
  v.out = v.out.filter((p) => p.msg.$ === "voice" || p.msg.$ === "import" || (p.msg.$ === "say" && !says.includes(p)));
  if (says.length > 0) {
    Box.box_set([...says.map((p) => p.said), Box.box_text()].filter((t) => t.trim() !== "").join("\n\n"));
  }
}

function importer(): void {
  const form = $("#import form", HTMLFormElement);
  const dir  = $("#import [name=dir]", HTMLInputElement);
  const zip  = $("#import [name=zip]", HTMLInputElement);
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    const pick = find(src, ".pickzip", HTMLButtonElement);
    pick.onclick = () => zip.click();
    pick.title = "From the website: " + Import.EXPORTS[src.dataset.app ?? ""] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    IMPORT.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => (ev.target as HTMLElement).closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = Import.MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if (ev.newState === "closed") {
      IMPORT.step = IMPORT.step === "start" || IMPORT.step === "done" ? "" : IMPORT.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target as HTMLInputElement;
    if (box.name === "session") {
      box.checked ? IMPORT.off.delete(box.value) : IMPORT.off.add(box.value);
    }
    import_draw("");
  };
  dir.onchange = async () => {
    const all = [...(dir.files ?? [])];
    const files = all.filter((f) => Import.import_file(f.webkitRelativePath));
    const found: Import.Session[] = [];
    let moved = 0;
    const reading = (k: number) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => Import.import_session(b, "log"), () => undefined);
      moved += s === undefined ? 1 : 0;
      found.push(...(s ? [s] : []));
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await Import.import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + (e as Error).message);
      }
    }
    zip.value = "";
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    import_send();
  };
}

function import_flow(): void {
  View.link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error && toast(out.error));
}

async function import_open(first: boolean): Promise<void> {
  IMPORT.done = (await fetch("/api/imported").then((res) => res.json()).catch(() => ({}))) as Import.Done;
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  IMPORT.step = first ? "start" : IMPORT.step === "done" ? "" : IMPORT.step;
  import_draw("");
  $("#import").showPopover();
}

function import_took(name: string, read: Read, status: string): void {
  IMPORT.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}

async function import_welcome(): Promise<void> {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === View.OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    void import_open(true);
  }
}

function import_send(): void {
  const picked = import_plan().picked;
  IMPORT.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(Import.import_body(picked), (part) => new Blob([part])));
  View.link_send(v, { $: "import", body }, import_sent);
}

function import_sent(out: View.Answer): void {
  IMPORT.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    IMPORT.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}

function import_plan(): Import.Plan {
  const form = new FormData($("#import form", HTMLFormElement));
  const want = { off: [...IMPORT.off], since: import_since(), tools: form.has("tools") };
  const found = [...IMPORT.found.values()].flatMap((read) => read.sessions);
  return Import.import_plan(found, want, IMPORT.done);
}

function import_since(): string {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 864e5).toISOString().slice(0, 10) : "";
}

function import_bar(): boolean {
  const run = v.importing;
  IMPORT.step = run !== null ? "seen" : IMPORT.step === "seen" ? "done" : IMPORT.step;
  const done  = IMPORT.step === "done";
  const going = ["send", "run", "seen", "done"].includes(IMPORT.step);
  const part  = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why   = Boolean(run?.why);
  const said  = run !== null ? View.progress_show(run) : done ? Import.DONE : IMPORT.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = IMPORT.step !== "start";
  $("#import form").hidden = going || IMPORT.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $("#import progress", HTMLProgressElement).value = part;
  $(".imping progress", HTMLProgressElement).value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = why ? "Import paused" : "Building memory";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = why ? "Resume" : "Pause";
  $("#import .flow", HTMLButtonElement).hidden = run === null;
  return going;
}

function import_draw(status: string): void {
  if (import_bar()) {
    return;
  }
  const reads    = [...IMPORT.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan     = import_plan();
  const msgs     = plan.msgs;
  const left     = reads.reduce((n, read) => n + read.moved, 0);
  const moved    = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const found    = sessions.length === 0 ? "" : plan.first === "" ? Import.OLD : Import.import_count(msgs, "new ");
  const day = (at: string | number) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 864e5));
  BACK.max = String(Math.floor(Date.now() / 864e5));
  $("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", (100 * (BACK.valueAsNumber - Number(BACK.min))) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $("#import .want").hidden = plan.first === "";
  $("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list  = must(src.querySelector(".sessions"), "#import .sessions");
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${Html.esc(s.where + ", " + Import.import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${Html.esc(Import.import_id(s))}">${Import.import_cells(s).map((c) => `<span>${Html.esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => (box.checked = !IMPORT.off.has(box.value)));
    const on = shown.filter((s) => !IMPORT.off.has(Import.import_id(s))).length;
    find(src, ".pick", HTMLElement).hidden = shown.length === 0;
    must(src.querySelector(".pick summary"), "#import .pick summary").textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  const [go, dir] = [$("#import .go", HTMLButtonElement), $(".pickdir", HTMLButtonElement)];
  go.hidden = msgs === 0;
  go.disabled = status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => (find(src, ".pickzip", HTMLButtonElement).disabled = dir.disabled));
}

function import_srcs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#import .src")];
}

async function import_copy(file: File): Promise<Blob> {
  const reader = file.stream().getReader();
  const parts: Blob[] = [];
  for (let got = await reader.read(); !got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}

const MARKUP = new WeakMap<Element, string>();

function markup(el: Element, htmls: string[]): void {
  const had = new Map<string | undefined, Element[]>();
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

function html_parse(html: string): Element {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = must(made.content.firstElementChild, "an element in " + html.slice(0, 40));
  MARKUP.set(child, html);
  return child;
}

function draw(stick: boolean): void {
  SCROLL.stick = SCROLL.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(() => {
      paint();
      mine_show();
    });
  }
}

function paint(): void {
  if ($("#log").hidden) {
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
    markup($("#log .rows"), View.view_body(v).map(Html.row_html));
    Box.box_sizes($("#log .rows"));
    P.rows = false;
  }
  markup($("#log .tail"), View.view_tail(v).map(Html.row_html));
  Box.box_sizes($("#log .tail"));
  frames();
  const back = RENEW.back === null ? null : document.querySelector<HTMLElement>(`#log [data-a="${RENEW.back.a}"]`);
  if (back !== null && RENEW.back !== null) {
    P.shown = shown;
    scrollBy(0, back.getBoundingClientRect().top - RENEW.back.top);
    RENEW.back = null;
    SCROLL.end = at_end();
    return;
  }
  if (shown !== P.shown) {
    P.shown = shown;
    SCROLL.end = true;
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll<HTMLElement>("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    SCROLL.end = at_end();
  }
}

function shown_key(): string {
  return v.agent;
}

function at_end(): boolean {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

function bars(): void {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  if (RENEW.due && !RENEW.going && renew_free()) {
    RENEW.going = true;
    setTimeout(() => void renew());
  }
  const mate = v.team.find((m) => m.id === v.agent);
  BOX.dataset.placeholder = "Message " + (mate?.name ?? "");
  markup($("#list .rows"), Html.list_html(v.team, WIDE.matches || location.pathname !== "/" ? v.agent : null));
  $("header .who .name").textContent = mate?.name ?? "";
  markup($("header .who .face"), [Html.face_html(mate?.picture ?? "")]);
  const stop = View.view_stoppable(v) && Box.box_blank();
  const send = $(".send", HTMLButtonElement);
  $(".net").hidden = !View.view_offline(v);
  $(".timers").hidden = v.timers.length === 0;
  $(".timers span").textContent = String(v.timers.length);
  markup($("#timers ul"), Html.timers_html(v.timers));
  if (v.timers.length === 0 && $("#timers").matches(":popover-open")) {
    $("#timers").hidePopover();
  }
  send.classList.toggle("stop", stop);
  $(".mic", HTMLButtonElement).disabled = v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("rec", P.rec !== null);
  const knob = (document.activeElement as HTMLElement | null)?.dataset?.knob;
  markup($("#pick"), Html.pick_html(View.view_pick(v), v.talk));
  if (knob !== undefined) {
    $("#pick [data-knob=" + knob + "]").focus();
  }
  mcp_draw();
  import_bar();
}

function anchor(): { a: number; top: number } | null {
  for (const r of document.querySelectorAll<HTMLElement>("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}

function mine(): void {
  const rows = [...document.querySelectorAll<HTMLElement>("#log .msg.user")];
  const el = rows.findLast(mine_above);
  if (el !== undefined) {
    SCROLL.end = false;
    el.scrollIntoView();
  }
  mine_show();
}

function mine_show(): void {
  const first = document.querySelector<HTMLElement>("#log .msg.user");
  $(".mine").hidden = first === null || !mine_above(first);
  $(".down").hidden = SCROLL.end || innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

function down(): void {
  scrollTo(0, document.documentElement.scrollHeight);
  SCROLL.end = true;
  mine_show();
}

function mine_above(el: HTMLElement): boolean {
  return el.getBoundingClientRect().top < $("header").getBoundingClientRect().bottom;
}

// the history holds the screens above this one, the list first, so the
// phone's back and the header's < both go up a level (up_to): to a
// screen, the history goes back to where the two part (popped), then
// pushes the rest, which drops the screens forward of there; the history
// changes at once, only the drawing waits for the slide
function go(path: string): void {
  const want = depth(path);
  if (LAY !== null) {
    LAY = want;
    return;
  }
  const now = stack();
  const k = shared(now, want);
  if (now.length > k) {
    LAY = want;
    travel(k - now.length);
  } else if (k < want.length) {
    lay(want, k, false);
    moved(want.length - now.length, route);
  } else {
    route();
  }
}

// back n entries, on to LAY (popped); a history shorter than its chain
// says (one from before this version) never answers: then LAY is laid
// over this entry
function travel(n: number): void {
  const trip = ++TRIP;
  history.go(n);
  setTimeout(() => {
    const want = LAY;
    if (want !== null && trip === TRIP) {
      LAY = null;
      lay(want, 0, true);
      route();
    }
  }, TRAVEL);
}

// how many screens two chains start with alike
function shared(a: string[], b: string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) {
    k++;
  }
  return k;
}

// want's screens from k on, after the entries before: the first in this
// entry (over) or pushed after it
function lay(want: string[], k: number, over: boolean): void {
  for (let j = k; j < want.length; j++) {
    const state = { chain: want.slice(0, j + 1) };
    if (j === k && over) {
      history.replaceState(state, "", want[j]);
    } else {
      history.pushState(state, "", want[j]);
    }
  }
}

// the history the app laid, the list first: this entry's chain
function stack(): string[] {
  const chain = get(history.state, "chain");
  const here = location.pathname + location.search + location.hash;
  return Array.isArray(chain) && chain.at(-1) === here ? chain.map(String) : depth(here);
}

// a screen and the ones above it, the list first
function depth(path: string): string[] {
  const up = up_from(path);
  return up === null ? [path] : [...depth(up), path];
}

// the header's <: the screen before this one in the history, as the
// phone's back
function up_to(): string {
  return stack().at(-2) ?? "/";
}

// the screen above: from the memory or an agent's settings to its chat,
// from a chat, Settings or a new agent to the list
function up_from(path: string): string | null {
  const url = new URL(path, location.origin);
  const edit = FORM.exec(url.pathname)?.[2];
  return url.pathname === TREE ? "/a/" + (url.searchParams.get("a") ?? UNII) : edit !== undefined ? "/a/" + edit : url.pathname === "/" ? null : "/";
}

// a change of screen, in a short slide on a phone (in going down a level,
// out going up) or a fade when wide, where the browser has view
// transitions and motion isn't reduced
function moved(levels: number, change: () => void): void {
  if (document.startViewTransition === undefined || STILL.matches) {
    change();
    return;
  }
  document.documentElement.dataset.move = WIDE.matches || levels === 0 ? "fade" : levels > 0 ? "in" : "out";
  const move = document.startViewTransition(change);
  // a transition another one skips rejects these
  move.ready.catch(() => {});
  move.finished.catch(() => {});
}

// to another agent's chat: the server sends it, the box holds its draft
function chat_to(agent: string): void {
  if (agent === v.agent) {
    return;
  }
  sessionStorage.setItem(kept("draft." + v.agent), Box.box_text());
  for (const msg of View.view_switch(v, agent)) {
    View.link_send(v, msg);
  }
  Box.box_set(sessionStorage.getItem(kept("draft." + agent)) ?? "");
  SCROLL.end = true;
  P.rows = true;
}

function route(): void {
  const p = location.pathname;
  const form = FORM.test(p);
  const page = PAGES.includes(p) || form;
  const tree = p === TREE;
  const list = p === "/" && !WIDE.matches;
  const chat = !page && !tree && !list;
  chat_to(AGENT.exec(p)?.[1] ?? (tree ? new URLSearchParams(location.search).get("a") ?? UNII : p === "/" ? UNII : v.agent));
  document.body.classList.toggle("wide", WIDE.matches);
  document.body.classList.toggle("list", list);
  document.querySelectorAll<HTMLAnchorElement>("#tree .tab").forEach((a) => {
    const to = TREE + "?a=" + v.agent + (a.dataset.tab === "VIEW" ? "#view" : "");
    a.dataset.go = to;
    a.href = to;
  });
  if (!chat && !$("#log").hidden && SCROLL.away === null) {
    SCROLL.away = { y: scrollY, end: SCROLL.end };
  }
  $("#log").hidden = !chat;
  document.body.classList.toggle("account", page);
  document.body.classList.toggle("tree", tree);
  $("#account").hidden = !page;
  $("#tree").hidden = !tree;
  const at = location.pathname + location.search + location.hash;
  if (!chat && at !== P.at) {
    scrollTo(0, 0);
  }
  P.at = at;
  // a chat already in view stays where it is: crossing the 900px line
  // (WIDE.onchange) routes again and used to jump it to the end (#127)
  if (!chat) {
    P.shown = location.pathname;
  } else if (SCROLL.away !== null) {
    P.shown = shown_key();
  }
  if (chat && SCROLL.away !== null) {
    SCROLL.end = SCROLL.away.end;
    P.rows = true;
    paint();
    scrollTo(0, SCROLL.end ? document.documentElement.scrollHeight : SCROLL.away.y);
    SCROLL.y = scrollY;
    SCROLL.away = null;
  }
  const edit = FORM.exec(p)?.[2];
  $("header .title").textContent = !page ? "" : !form ? "Settings" : edit === undefined ? "New agent" : v.team.find((m) => m.id === edit)?.name ?? "";
  if (page && form) {
    void agent_page(edit ?? null);
  } else if (page) {
    void account();
  }
  if (tree) {
    Tree.tree_show(tree_view() ? "VIEW" : "TREE", v.agent);
  } else {
    Tree.tree_hide();
  }
  in_use();
  notes_close();
  draw(chat && SCROLL.end);
}

function popped(ev: PopStateEvent): void {
  const want = LAY;
  const now = stack();
  const k = want === null ? 0 : shared(now, want);
  if (want !== null && now.length > k) {
    travel(k - now.length);
    return;
  }
  LAY = null;
  if (want !== null) {
    lay(want, k, false);
    moved(want.length - depth(P.at).length, route);
  } else if (location.pathname + location.search + location.hash !== P.at) {
    const levels = stack().length - depth(P.at).length;
    if (get(ev, "hasUAVisualTransition") === true) {
      route();
    } else {
      moved(levels, route);
    }
  }
  Viewer.viewer_sync();
  draw(true);
}

// the agents, and a new one's default prompt
async function agents(): Promise<{ agents: Html.Agent[]; template: string } | null> {
  const res = await fetch("/api/agents").catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as { agents: Html.Agent[]; template: string } | null) : null;
}

// new agent (id null) or an agent's settings
async function agent_page(id: string | null): Promise<void> {
  const el = $("#account");
  const all = await agents();
  const a = id === null ? null : all?.agents.find((x) => x.id === id) ?? null;
  if (all === null || (id !== null && a === null)) {
    $("header .title").textContent = "";
    el.innerHTML = `<p class="sub">${all === null ? "Could not read the agents. Try again in a moment." : "No such agent."}</p>`;
    if (all !== null && LAY === null && FORM.exec(location.pathname)?.[2] === id && stack().includes("/a/" + id)) {
      // no chat above: the list is, for < and the phone's back alike
      LAY = ["/", location.pathname];
      travel(1 - stack().length);
    }
    return;
  }
  $("header .title").textContent = a?.name ?? "New agent";
  el.innerHTML = Html.agent_html(a, id === UNII);
  const form = find(el, "form", HTMLFormElement);
  const [name, prompt] = [find(form, "[name=name]", HTMLInputElement), find(form, "[name=prompt]", HTMLTextAreaElement)];
  const was = { prompt: a?.own === true ? null : a?.template ?? all.template };
  const follow = () => {
    if (was.prompt !== null) {
      prompt.value = was.prompt.replaceAll("{Name}", name.value.trim() || a?.name || "");
    }
  };
  if (a === null) {
    form.querySelectorAll<HTMLInputElement>("[name=picture]")[Math.floor(Math.random() * 24)].checked = true;
    follow();
  }
  RENEW.dirty.clear();
  form.oninput = (ev) => {
    RENEW.dirty.add(form);
    const t = ev.target as HTMLElement;
    if (t === prompt) {
      was.prompt = null;
    } else if (t === name) {
      follow();
    }
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    void agent_save(form, a, ev.target as Element);
  };
  // an agent's settings save as they change; a new one waits for Create
  if (a !== null) {
    form.onchange = (ev) => void agent_save(form, a, ev.target as Element);
  }
  const file = find(form, ".upfile", HTMLInputElement);
  find(form, ".upload", HTMLButtonElement).onclick = () => file.click();
  file.onchange = () => {
    const got = file.files?.[0];
    file.value = "";
    if (got !== undefined) {
      void picture_up(form, got);
    }
  };
  el.querySelector<HTMLButtonElement>(".archive")?.addEventListener("click", () => {
    if (a !== null && confirm("Archive " + a.name + "? It leaves the chat list and the team. A running turn and its jobs finish; its timers pause. You can restore it in Settings.")) {
      void View.post("/api/agents/" + a.id + "/archive", {}).then((out) => (out.error === undefined ? go("/") : toast(text_of(out.error))));
    }
  });
}

// an upload, cropped square to 256 px, into the media store, picked
async function picture_up(form: HTMLFormElement, file: File): Promise<void> {
  const why = must(form.querySelector(".up .why"), "the upload's why");
  why.textContent = "Uploading…";
  try {
    const img = await createImageBitmap(file);
    const side = Math.min(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(256, side);
    must(canvas.getContext("2d"), "a 2d canvas").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    const res = await fetch("/api/media?name=picture.png", { method: "POST", body: blob });
    const out = (await res.json()) as { name?: string; error?: string };
    if (out.name === undefined) {
      throw new Error(out.error ?? "HTTP " + res.status);
    }
    const faces = must(form.querySelector(".faces"), "the faces");
    faces.querySelector(`[value^="/media/"]`)?.closest("label")?.remove();
    faces.insertAdjacentHTML("afterbegin", Html.face_pick_html("/media/" + out.name, true));
    RENEW.dirty.add(form);
    why.textContent = "";
    form.dispatchEvent(new Event("change"));
  } catch (err) {
    why.textContent = "Could not upload it: " + err_why(err);
  }
}

// one save at a time, each of the whole form as it is then; an error
// shows under the field that was changed, the form left as typed
let AGENT_SAVES = Promise.resolve();

function agent_save(form: HTMLFormElement, a: Html.Agent | null, at: Element): Promise<void> {
  AGENT_SAVES = AGENT_SAVES.then(() => agent_save_now(form, a, at));
  return AGENT_SAVES;
}

async function agent_save_now(form: HTMLFormElement, a: Html.Agent | null, at: Element): Promise<void> {
  if (!form.isConnected) {
    return;
  }
  const data = new FormData(form);
  const body = Object.fromEntries(["name", "about", "picture", "prompt"].map((k) => [k, text_of(data.get(k))]));
  const why = at.closest(".set")?.querySelector(".err") ?? form.querySelector(".save .why") ?? form.querySelector(".up .why");
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  RENEW.saving++;
  const out = await View.post("/api/agents" + (a === null ? "" : "/" + a.id), body);
  RENEW.saving--;
  if (out.error !== undefined) {
    if (why === null) {
      toast(text_of(out.error));
    } else {
      why.textContent = text_of(out.error);
    }
    return;
  }
  RENEW.dirty.delete(form);
  if (a === null) {
    go("/a/" + text_of(get(out.agent, "id")));
    return;
  }
  $("header .title").textContent = body.name;
}

function archived_draw(): void {
  const box = document.querySelector<HTMLElement>("#account .archived");
  if (box === null) {
    return;
  }
  box.innerHTML = Html.archived_html(v.team);
  box.onclick = async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
    const id = b?.closest<HTMLElement>("[data-id]")?.dataset.id;
    const m = v.team.find((x) => x.id === id);
    if (b === null || m === undefined) {
      return;
    }
    if (b.classList.contains("restore")) {
      const out = await View.post("/api/agents/" + m.id + "/restore", {});
      toast(out.error === undefined ? m.name + " is back in the chat list." : text_of(out.error));
      return;
    }
    const left = (await fetch("/api/agents/" + m.id + "/left").then((r) => r.json()).catch(() => ({ left: [] }))) as { left: string[] };
    const folders = left.left.length === 0 ? "" : "\n\nThese scratch folders stay, on devices not open now: " + left.left.join(", ") + ".";
    if (!confirm("Delete " + m.name + " for good? Its memory is deleted and can't be brought back, and so are its scratch folders on the open devices." + folders)) {
      return;
    }
    const res = await fetch("/api/agents/" + m.id, { method: "DELETE" }).catch(() => null);
    const out = ((await res?.json().catch(() => null)) ?? { error: "Can't reach UniiChat." }) as { error?: string };
    toast(out.error ?? m.name + " is deleted.");
  };
}

async function account(): Promise<void> {
  const el = $("#account");
  const set = await fetch("/api/settings").catch(() => null);
  const push = await notify_state().catch(() => null);
  el.innerHTML = Html.account_html(push);
  archived_draw();
  RENEW.dirty.clear();
  el.oninput = (ev) => {
    const form = (ev.target as Element).closest("form");
    if (form !== null) {
      RENEW.dirty.add(form);
    }
  };
  mcp_draw();
  el.querySelectorAll<HTMLButtonElement>(".retry").forEach((retry) => (retry.onclick = () => void account()));
  $("#account .out").onclick = () => void signout();
  const bell = document.querySelector<HTMLButtonElement>("#account .notify");
  bell?.addEventListener("click", () => {
    bell.disabled = true;
    void notify(push !== "on");
  });
  const page = set?.ok ? ((await set.json().catch(() => null)) as Page | null) : null;
  if (page === null) {
    $("#account .owned").innerHTML = `<p class="sub">Could not read the server's settings. Try again in a moment.</p>`;
    return;
  }
  settings_draw(page);
}

function mcp_draw(): void {
  const box = document.querySelector("#account .mcp");
  if (box === null || v.pick === null) {
    return;
  }
  const active = document.activeElement;
  const on = active !== null && box.contains(active) ? active.getAttribute("aria-label") : null;
  markup(box, Html.mcp_html(v.mcp));
  [...box.querySelectorAll<HTMLElement>("[role=switch]")].find((b) => b.getAttribute("aria-label") === on)?.focus();
}

async function signout(): Promise<void> {
  await notify_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
  await View.post("/api/logout", {});
  location.href = "/";
}

async function notify_state(): Promise<Html.Notify | null> {
  P.push = null;
  if (navigator.serviceWorker === undefined || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) ? "home" : null;
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  const wait = new Promise<undefined>((ok) => setTimeout(ok, 3000, undefined));
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await Promise.race([navigator.serviceWorker.ready, wait]));
  const sub = await notify_sub();
  const query = sub === null ? "" : "?endpoint=" + encodeURIComponent(sub.endpoint);
  const res = await fetch("/api/webpush" + query).catch(() => null);
  const out = res?.ok ? ((await res.json()) as { key: string | null; on: boolean }) : null;
  if (reg === undefined || out === null || out.key === null) {
    return null;
  }
  P.push = { reg, key: out.key };
  return out.on && notify_keyed(sub, out.key) ? "on" : "off";
}

// whether a subscription was made for the server's key (one made for a
// key it had before gets no push)
function notify_keyed(sub: PushSubscription | null, key: string): boolean {
  const had = sub?.options.applicationServerKey;
  return had != null && notify_bytes(key).join() === new Uint8Array(had).join();
}

function notify_bytes(key: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

async function notify_sub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function notify(on: boolean): Promise<void> {
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
  void account();
}

async function notify_on(reg: ServiceWorkerRegistration, key: string): Promise<Record<string, unknown>> {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err: unknown) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || get(err, "name") !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return View.post("/api/webpush", sub.toJSON());
}

async function notify_off(reg: ServiceWorkerRegistration): Promise<Record<string, unknown>> {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}

// the settings save as they're changed, one save at a time, each from
// the form as it is then (#125)
const SET = { page: null as Page | null, queued: 0, chain: Promise.resolve(), run: null as (() => Promise<void>) | null };

function settings_soon(): void {
  SET.queued++;
  SET.chain = SET.chain.then(async () => {
    SET.queued--;
    await SET.run?.();
  });
}

// drawn again after a save, the field being typed in kept as it is
function settings_redraw(page: Page): void {
  const a = document.activeElement;
  const field = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement ? a : null;
  const sel = field === null || !$("#account").contains(field) ? null : field.name !== "" ? `[name="${CSS.escape(field.name)}"]` + (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type) ? `[value="${CSS.escape(field.value)}"]` : "") : field.dataset.i !== undefined ? `.${field.classList[0]}[data-i="${field.dataset.i}"]` : null;
  const was = field === null ? null : { value: field.value, at: field instanceof HTMLSelectElement ? null : [field.selectionStart, field.selectionEnd] };
  settings_draw(page);
  const now = sel === null ? null : document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("#account form.settings " + sel);
  if (now === null || was === null) {
    return;
  }
  if (!(now instanceof HTMLInputElement && ["checkbox", "radio", "password"].includes(now.type)) && now.value !== was.value) {
    now.value = was.value;
    now.dispatchEvent(new Event("input", { bubbles: true }));
  }
  now.focus({ preventScroll: true });
  if (was.at !== null && !(now instanceof HTMLSelectElement)) {
    try {
      now.setSelectionRange(was.at[0], was.at[1]);
    } catch {
      // a number field has no selection
    }
  }
}

function settings_draw(page: Page): void {
  SET.page = page;
  $("#account .owned").innerHTML = Html.settings_html(page);
  const form = $("#account form.settings", HTMLFormElement);
  const rows = new Map<string, Row>(page.settings.map((r) => [r.key, r]));
  const unset = new Set<string>();
  const profs = Object.entries(page.profiles ?? {}).map(([name, list]): [string, string[]] => [name, [...list]]);
  const box = form.querySelector<HTMLElement>(".profiles .field");
  const names = () => profs.map(([name]) => name.trim()).filter((name) => name !== "");
  const listed = (key: string) => {
    const boxes = [...form.querySelectorAll<HTMLInputElement>(`input[name="${key}"]`)];
    return boxes.length === 0 ? Html.list(rows.get(key)?.value ?? "") : boxes.filter((b) => b.checked).map((b) => b.value);
  };
  const picks = () => {
    const vendors = listed("vendors");
    form.querySelectorAll<HTMLElement>(".opt[data-vendor]").forEach((o) => o.classList.toggle("off", !(o.dataset.vendor ?? "").split(" ").some((v) => vendors.includes(v))));
    for (const key of Html.PICKS) {
      const value = form.querySelector<HTMLInputElement>(`input[name="${key}"]`);
      const four = value?.parentElement?.querySelector<HTMLElement>(".four");
      if (value && four) {
        const focus = (document.activeElement as HTMLSelectElement | null)?.name;
        four.innerHTML = Html.picks_html(key, vendors, listed("models"), value.value, null, names());
        four.querySelector<HTMLSelectElement>(`select[name="${focus}"]`)?.focus();
      }
    }
    const keyless = vendors.filter((v) => {
      const name = Html.VENDOR_KEY[v];
      const key = page.keys.find((k) => k.name === name);
      const typed = form.querySelector<HTMLInputElement>(`[name="key.${name}"]`)?.value.trim() ?? "";
      return key !== undefined && (key.from === "default" || unset.has("key." + name)) && typed === "";
    });
    const warn = form.querySelector(".warn");
    if (warn !== null) {
      warn.textContent = keyless.length === 0 ? "" : keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is.";
    }
  };
  form.oninput = (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".set");
    if (el === null) {
      return;
    }
    RENEW.dirty.add(form);
    const keys = (el.dataset.key ?? "").split(" ");
    keys.forEach((k) => unset.delete(k));
    must(el.querySelector(".err"), "the setting's err").textContent = "";
    const value = el.querySelector<HTMLInputElement>("input[type=hidden]");
    if (value !== null) {
      value.value = Html.pick_mend([...el.querySelectorAll("select")].map((s) => s.value), listed("models"), names());
    }
    picks();
    if (keys.includes("vendors") || keys.includes("models")) {
      profs_draw();
    }
  };
  form.onchange = () => settings_soon();
  form.onclick = (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".reset");
    if (btn === null) {
      return;
    }
    const el = must(btn.closest<HTMLElement>(".set"), "the reset's setting");
    for (const key of (el.dataset.key ?? "").split(" ")) {
      const def = rows.get(key)?.def ?? "";
      el.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${key}"]`).forEach((b) => (b.checked = Html.list(def).includes(b.value)));
      el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`:is(input:not([type=checkbox]), textarea)[name="${key}"]`).forEach((i) => (i.value = def));
      unset.add(key);
    }
    picks();
    btn.hidden = true;
    settings_soon();
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    settings_soon();
  };
  SET.run = () => settings_save(form, unset, listed, profs);
  const profs_draw = (focus?: string) => {
    if (box !== null) {
      box.innerHTML = Html.profiles_html(profs, Html.offered(listed("vendors"), listed("models")));
      (focus === undefined ? null : box.querySelector<HTMLElement>(focus) ?? box.querySelector<HTMLElement>(".pnew"))?.focus();
    }
  };
  const profs_changed = (focus: string) => {
    profs_draw(focus);
    must(box?.closest(".set")?.querySelector(".err"), "the profiles' err").textContent = "";
    picks();
    RENEW.dirty.add(form);
    settings_soon();
  };
  const renamed = (was: string, now: string) => {
    for (const key of Html.PICKS) {
      const value = form.querySelector<HTMLInputElement>(`input[name="${key}"]`);
      if (value !== null && was.trim() !== "" && now !== "" && value.value === was.trim()) {
        value.value = now;
      }
    }
  };
  box?.addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button");
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
    const add = (ev.target as HTMLElement).closest<HTMLSelectElement>("select.add");
    if (add !== null && add.value !== "") {
      const i = Number(add.dataset.i);
      profs[i][1].push(add.value);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("input", (ev) => {
    const name = (ev.target as HTMLElement).closest<HTMLInputElement>("input.pname");
    if (name !== null) {
      const i = Number(name.dataset.i);
      renamed(profs[i][0], name.value.trim());
      profs[i][0] = name.value;
    }
  });
  box?.addEventListener("keydown", (ev) => {
    const grip = (ev.target as HTMLElement).closest<HTMLButtonElement>(".grip");
    if (grip === null || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) {
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
    const grip = (ev.target as HTMLElement).closest<HTMLButtonElement>(".grip");
    if (grip === null || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const li = must(grip.closest("li"), "the grip's row");
    const ol = must(li.parentElement, "the grip's list");
    const [i, from] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    li.classList.add("drag");
    const move = (e: PointerEvent) => {
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

async function settings_save(form: HTMLFormElement, unset: Set<string>, listed: (key: string) => string[], profs: Array<[string, string[]]>): Promise<void> {
  const page = SET.page;
  if (page === null || !form.isConnected) {
    return;
  }
  const set: Record<string, string | null> = {};
  const keys: Record<string, string | null> = {};
  for (const r of page.settings) {
    if (form.querySelector(`[name="${r.key}"]`) === null) {
      continue;
    }
    const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`:is(input, textarea)[name="${r.key}"]`);
    const flag = field instanceof HTMLInputElement && field.type === "checkbox" ? (field.checked ? "on" : "off") : null;
    const now = r.key === "vendors" || r.key === "models" ? Html.list_changed(Html.list(r.value), listed(r.key))?.join(",") ?? r.value : flag ?? field?.value.trim() ?? r.value;
    if (unset.has(r.key)) {
      set[r.key] = null;
    } else if (now !== r.value) {
      set[r.key] = now;
    }
  }
  for (const k of page.keys) {
    const typed = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="key.${k.name}"]`)?.value.trim() ?? "";
    if (unset.has("key." + k.name)) {
      keys[k.name] = null;
    } else if (typed !== "") {
      keys[k.name] = typed;
    }
  }
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  // a profile still being made (no name or no model yet) waits
  let profiles: Record<string, string[]> | undefined;
  if (page.profiles != null) {
    const now = profs.map(([name, list]): [string, string[]] => [name.trim(), list]);
    const all = now.map(([name]) => name);
    const making = all.includes("") || now.some(([, list]) => list.length === 0);
    const twice = all.some((name, k) => name !== "" && all.indexOf(name) !== k);
    if (twice) {
      must(find(form, ".profiles", HTMLElement).querySelector(".err"), "the profiles' err").textContent = "Two profiles have the same name.";
    }
    const was = JSON.stringify(page.profiles);
    profiles = making || twice || JSON.stringify(Object.fromEntries(now)) === was ? undefined : Object.fromEntries(now);
  }
  if (Object.keys(set).length === 0 && Object.keys(keys).length === 0 && profiles === undefined) {
    return;
  }
  RENEW.saving++;
  const out = await View.post("/api/settings", { version: page.version, set, keys, ...(profiles === undefined ? {} : { profiles }) });
  RENEW.saving--;
  if (!out.ok) {
    const key = out.key === undefined ? null : text_of(out.key, "null");
    const at = key === null ? null : form.querySelector<HTMLElement>(`.set[data-key~="${key}"]`);
    if (at === null) {
      toast(text_of(out.error, "Could not save."));
      return;
    }
    must(at.querySelector(".err"), "the setting's err").textContent = text_of(out.error, "Could not save.");
    return;
  }
  const done = out as Page & { saved: string[] };
  const later = done.saved.filter((key) => page.settings.find((r) => r.key === key)?.apply === "restart");
  SET.page = done;
  unset.clear();
  if (SET.queued === 0) {
    RENEW.dirty.delete(form);
    settings_redraw(done);
  }
  draw(false);
  if (later.length > 0) {
    toast(later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
  }
}

function renew_due(build: string | undefined): void {
  if (build === undefined || build_same(build)) {
    RENEW.build ||= build ?? "";
    RENEW.due = false;
    return;
  }
  if (reloads_spent_on(build)) {
    RENEW.gave = v.ws;
    return;
  }
  RENEW.due = true;
  draw(false);
}

function build_same(build: string): boolean {
  return RENEW.build === "" || build === RENEW.build;
}

function reloads_spent_on(build: string): boolean {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  return was === build && Number(n) >= 2 && (RENEW.gave === null || RENEW.gave === v.ws);
}

function renew_free(hidden = false): boolean {
  const page = location.pathname !== "/" && location.pathname !== TREE;
  const quiet = P.rec === null && UPS.size === 0 && v.out.length === 0 && !$("#import").matches(":popover-open") && !Viewer.viewer_on();
  const typing = !DESK.matches && Box.box_focused() && !hidden;
  const editing = page && document.activeElement !== null && $("#account").contains(document.activeElement) && document.activeElement.matches("input, textarea, select");
  return quiet && !typing && (!page || (!editing && RENEW.dirty.size === 0 && RENEW.saving === 0));
}

async function renew(hidden = false): Promise<void> {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  const tries = was === v.build ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = (await store?.keys().catch(() => [])) ?? [];
  await Promise.all(store === null ? [] : keys.filter((k) => k.startsWith("unii-shell")).map((k) => store.delete(k)));
  if (tries > 0) {
    await Promise.all(["/", "/app.js", "/style.css", "/sw.js"].map((path) => fetch(path, { cache: "reload" }).catch(() => null)));
  }
  if (!RENEW.due || !renew_free(hidden)) {
    RENEW.going = false;
    return;
  }
  const chat = !$("#log").hidden;
  const back: Back = { at: chat && !SCROLL.end ? anchor() : null, y: chat ? null : scrollY, away: SCROLL.away, caret: Box.box_caret(), focus: Box.box_focused() };
  sessionStorage.setItem(kept("back"), JSON.stringify(back));
  sessionStorage.setItem(kept("build"), (v.build ?? "") + " " + (tries + 1));
  location.reload();
}

function renewed(): void {
  const text = sessionStorage.getItem(kept("back"));
  sessionStorage.removeItem(kept("back"));
  const back = text === null ? null : (JSON.parse(text) as Back | null);
  if (back === null) {
    return;
  }
  if (back.focus && DESK.matches) {
    Box.box_focus();
  }
  Box.box_place(back.caret[0], back.caret[1]);
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

function toast(text: string, stay = false, reload = false): void {
  const el = $("#toast");
  el.textContent = text;
  if (reload) {
    const again = document.createElement("button");
    again.textContent = "Reload";
    again.onclick = () => {
      unsent_back();
      location.reload();
    };
    el.append(again);
  }
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = stay ? 0 : (setTimeout(() => (el.hidden = true), 7000) as unknown as number);
}

function intro_play(): Promise<void> {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end(): void {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK.matches) {
        BOX.focus();
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

const INTRO = intro_play();
void boot();
