import * as Import from "../../Import.ts";
import { theme_css } from "../../Theme.ts";
import * as View from "../../View.ts";
import * as Box from "./Box.ts";
import * as Html from "./Html.ts";
import * as Tree from "./Tree.ts";
import * as Viewer from "./Viewer.ts";

type Read = { sessions: Import.Session[]; moved: number };

const APP = (window as any).webkit?.messageHandlers?.unii ?? null;

const DESK = matchMedia("(hover: hover)");

const NONE   = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";

const SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;

const v = View.view_new();

const BOX = $<HTMLElement>(".composer .field");

const UPS = new Map<HTMLElement, XMLHttpRequest>();

const BACK = $<HTMLInputElement>("#import [name=back]");

const P = {
  rec   : null as MediaRecorder | null,
  shown : "",
  end   : true,
  stick : true,
  y     : 0,
  frame : 0,
  rows  : true,
  toast : 0,
  found : new Map<string, Read>(),
  done  : {} as Import.Done,
  off   : new Set<string>(),
  step  : "" as "" | "start" | "send" | "run" | "seen" | "done",
  push  : null as { reg: ServiceWorkerRegistration; key: string } | null,
  away  : null as { y: number; end: boolean } | null,
  used  : { ws: null as WebSocket | null, on: false, at: 0 },
  open  : new Set<string>(),
  build : document.documentElement.dataset.build ?? "",
  still : false,
  due   : false,
  going : false,
  since : false,
  dirty : new Set<HTMLFormElement>(),
  saving: 0,
  gave  : null as WebSocket | null,
  back  : null as { a: number; top: number } | null,
  after : false,
  at    : "",
};

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

function kept(fact: string): string {
  return "unii." + fact;
}

async function boot(): Promise<void> {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  if (APP === null) {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
  }
  const tree = location.pathname === TREE ? TREE + (tree_view() ? "#view" : "") : null;
  const pic = history.state?.pic != null;
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
    if (document.hidden && P.due && !P.going && renew_free(true)) {
      P.going = true;
      renew(true);
    }
  });
  addEventListener("blur", () => in_use(true));
  addEventListener("pagehide", () => in_use(true));
}

async function boot_me(): Promise<any> {
  for (let k = 0; ; k++) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      if (k > 0) {
        $("#toast").hidden = true;
      }
      return res.ok ? res.json() : null;
    }
    if (k === 0) {
      toast("Can't reach UniiChat. Reconnecting…", true);
    }
    await new Promise((ok) => setTimeout(ok, View.RETRY));
  }
}

const PAGES = ["/settings", "/account"];

const TREE = "/tree";

function tree_view(): boolean {
  return location.hash.toLowerCase() === "#view";
}

function solo(title: string, sub: string): void {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}

function chat(): void {
  const file = $<HTMLInputElement>("input[type=file]");
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
  $("#menu .out").onclick = signout;
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...(file.files ?? [])]);
    file.value = "";
  };
  onpopstate = popped;
  Viewer.viewer_new();
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    if (View.view_typing(v) && (ev.dataTransfer?.files.length ?? 0) > 0) {
      attach([...(ev.dataTransfer?.files ?? [])]);
    }
  };
  document.onclick = click;
  visualViewport!.onresize = () => {
    if (Box.box_focused() && Box.box_caret()[0] === Box.box_text().length) {
      BOX.scrollTop = BOX.scrollHeight;
    }
    draw(true);
  };
  document.onscroll = () => {
    if (at_end()) {
      P.end = true;
    } else if (scrollY < P.y) {
      P.end = false;
    }
    P.y = scrollY;
    mine_show();
  };
  $(".mine").onclick = mine;
  $(".down").onclick = down;
  const keep = new ResizeObserver(() => {
    if (P.still) {
      P.still = false;
    } else if (P.end && !$("#log").hidden && !at_end()) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  });
  keep.observe($("#log"));
  keep.observe($("footer"));
  let width = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth !== width) {
      width = innerWidth;
      measured = new WeakSet();
      folds();
    }
    frames(true);
  });
  draw(true);
}

function signed(): void {
  document.body.className = "";
  BOX.dataset.placeholder = View.HINT;
  Box.box_set(sessionStorage.getItem(kept("draft")) ?? "");
  renewed();
}

function typed(): void {
  sessionStorage.setItem(kept("draft"), Box.box_text());
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
  P.end = P.end || a.$ === "Send";
  P.rows = true;
  for (const msg of View.view_act(v, a)) {
    View.link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw(a.$ === "Send");
}

function click(ev: MouseEvent): void {
  const target = ev.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act], [data-copy], [data-go], [data-knob], .choices > button");
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
  const cut = target.closest(".unfold") ?? (el === null && target.closest("a") === null ? target.closest(".msg.long:not(.shown) > .cut") : null);
  if (cut !== null && (sel === null || sel.isCollapsed)) {
    unfold(cut.parentElement!);
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
  const menu = el.closest("#menu") !== null;
  if (menu) {
    $("#menu").hidePopover();
  }
  if (path !== undefined || (a !== undefined && menu)) {
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

const FOLD = 10;

let measured = new WeakSet<Element>();

function folds(): void {
  for (const cut of document.querySelectorAll<HTMLElement>("#log .msg > .cut")) {
    const msg = cut.parentElement!;
    if (!measured.has(msg)) {
      measured.add(msg);
      msg.classList.toggle("long", cut.scrollHeight > FOLD * parseFloat(getComputedStyle(cut).lineHeight));
    }
    fold_show(msg, P.open.has(msg.dataset.a ?? ""));
  }
}

function fold_show(msg: HTMLElement, open: boolean): void {
  msg.classList.toggle("shown", open);
  const button = msg.querySelector(":scope > .unfold")!;
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "Show less" : "Show all";
}

function unfold(msg: HTMLElement): void {
  const open = !msg.classList.contains("shown");
  const id = msg.dataset.a ?? "";
  open ? P.open.add(id) : P.open.delete(id);
  const [top, follow] = [msg.getBoundingClientRect().top, P.end];
  P.end = false;
  fold_show(msg, open);
  scrollBy(0, msg.getBoundingClientRect().top - top);
  P.end = follow || at_end();
  P.still = follow;
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
  const canvas = $<HTMLCanvasElement>(".voice canvas");
  const pen = canvas.getContext("2d")!;
  const levels: number[] = [];
  const start = performance.now();
  const frame = (now: number): void => {
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
    post : (path, body) => fetch(path, { method: "POST", body }),
    hear : hear,
    lost : lost,
  });
}

function in_use(off = false): void {
  const on = !off && document.visibilityState === "visible" && document.hasFocus();
  const ws = v.ws;
  if (ws === null || !v.up || ws.readyState !== WebSocket.OPEN || (ws === P.used.ws && on === P.used.on && (!on || Date.now() - P.used.at < View.USE_PING))) {
    return;
  }
  ws.send(on ? View.ACTIVE : View.IDLE);
  P.used = { ws, on, at: Date.now() };
}

async function lost(up: boolean): Promise<boolean> {
  draw(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}

function hear(msg: View.Server): void {
  if (v.ws !== P.used.ws) {
    in_use();
  }
  const was = View.view_pick(v);
  const agents = v.agents.join();
  for (const out of View.view_hear(v, msg)) {
    View.link_send(v, out);
  }
  const now = View.view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() !== agents : msg.$ !== "delta" && msg.$ !== "live";
  if (msg.$ === "state") {
    renew_due(msg.build);
  }
  import_welcome();
  draw(true);
}

function importer(): void {
  const form = $<HTMLFormElement>("#import form");
  const dir  = $<HTMLInputElement>("#import [name=dir]");
  $(".imp").onclick = () => import_open(false);
  const zip  = $<HTMLInputElement>("#import [name=zip]");
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    src.querySelector<HTMLButtonElement>(".pickzip")!.onclick = () => zip.click();
    src.querySelector<HTMLButtonElement>(".pickzip")!.title = "From the website: " + Import.EXPORTS[src.dataset.app!] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    P.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => (ev.target as HTMLElement).closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = Import.MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if ((ev as ToggleEvent).newState === "closed") {
      P.step = P.step === "start" || P.step === "done" ? "" : P.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target as HTMLInputElement;
    if (box.name === "session") {
      box.checked ? P.off.delete(box.value) : P.off.add(box.value);
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
  $("#menu").hidePopover();
  P.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  P.step = first ? "start" : P.step === "done" ? "" : P.step;
  import_draw("");
  $("#import").showPopover();
}

function import_took(name: string, read: Read, status: string): void {
  P.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}

async function import_welcome(): Promise<void> {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === View.OPENING && v.importing === null && DESK.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}

function import_send(): void {
  const picked = import_plan().picked;
  P.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(Import.import_body(picked), (part) => new Blob([part])));
  View.link_send(v, { $: "import", body }, import_sent);
}

function import_sent(out: View.Answer): void {
  P.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    P.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}

function import_plan(): Import.Plan {
  const form = new FormData($<HTMLFormElement>("#import form"));
  const want = { off: [...P.off], since: import_since(), tools: form.has("tools") };
  const found = [...P.found.values()].flatMap((read) => read.sessions);
  return Import.import_plan(found, want, P.done);
}

function import_since(): string {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 864e5).toISOString().slice(0, 10) : "";
}

function import_bar(): boolean {
  const run = v.importing;
  P.step = run !== null ? "seen" : P.step === "seen" ? "done" : P.step;
  const done  = P.step === "done";
  const going = ["send", "run", "seen", "done"].includes(P.step);
  const part  = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why   = Boolean(run?.why);
  const said  = run !== null ? View.progress_show(run) : done ? Import.DONE : P.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = P.step !== "start";
  $("#import form").hidden = going || P.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $<HTMLProgressElement>("#import progress").value = part;
  $<HTMLProgressElement>(".imping progress").value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = why ? "Import paused" : "Building memory";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = why ? "Resume" : "Pause";
  $<HTMLButtonElement>("#import .flow").hidden = run === null;
  return going;
}

function import_draw(status: string): void {
  if (import_bar()) {
    return;
  }
  const reads    = [...P.found.values()];
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
    const list  = src.querySelector(".sessions")!;
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${Html.esc(s.where + ", " + Import.import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${Html.esc(Import.import_id(s))}">${Import.import_cells(s).map((c) => `<span>${Html.esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => (box.checked = !P.off.has(box.value)));
    const on = shown.filter((s) => !P.off.has(Import.import_id(s))).length;
    src.querySelector<HTMLElement>(".pick")!.hidden = shown.length === 0;
    src.querySelector(".pick summary")!.textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  const [go, dir] = [$<HTMLButtonElement>("#import .go"), $<HTMLButtonElement>(".pickdir")];
  go.hidden = msgs === 0;
  go.disabled = status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => (src.querySelector<HTMLButtonElement>(".pickzip")!.disabled = dir.disabled));
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
  const had = new Map<string, Element[]>();
  for (const child of el.children) {
    const html = MARKUP.get(child)!;
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
  const child = made.content.firstElementChild!;
  MARKUP.set(child, html);
  return child;
}

function draw(stick: boolean): void {
  P.stick = P.stick && stick;
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
    P.stick = true;
    bars();
    return;
  }
  const doc = document.documentElement;
  const follow = P.stick && P.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = shown_key();
  P.frame = 0;
  P.stick = true;
  bars();
  if (P.rows) {
    markup($("#log .rows"), View.view_body(v).map(Html.row_html));
    Box.box_sizes($("#log .rows"));
    P.rows = false;
  }
  markup($("#log .tail"), View.view_tail(v).map(Html.row_html));
  Box.box_sizes($("#log .tail"));
  folds();
  frames();
  const back = P.back === null ? null : document.querySelector<HTMLElement>(`#log [data-a="${P.back.a}"]`);
  if (back !== null && P.back !== null) {
    P.shown = shown;
    scrollBy(0, back.getBoundingClientRect().top - P.back.top);
    P.back = null;
    P.end = at_end();
    return;
  }
  if (shown !== P.shown) {
    P.shown = shown;
    P.end = v.fold === null;
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
  const rows = [...document.querySelectorAll<HTMLElement>("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    P.end = at_end();
  }
}

function shown_key(): string {
  return (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
}

function at_end(): boolean {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

function bars(): void {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  if (P.due && !P.going && renew_free()) {
    P.going = true;
    setTimeout(renew);
  }
  const on = View.view_typing(v);
  const stop = on && v.busy && Box.box_blank();
  const tabs = View.view_tabs(v);
  const send = $<HTMLButtonElement>(".send");
  $(".net").hidden = v.up;
  $(".timers").hidden = v.timers.length === 0;
  $(".timers span").textContent = String(v.timers.length);
  markup($("#timers ul"), Html.timers_html(v.timers));
  if (v.timers.length === 0 && $("#timers").matches(":popover-open")) {
    $("#timers").hidePopover();
  }
  send.classList.toggle("stop", stop);
  $(".composer").hidden = !on;
  $<HTMLButtonElement>(".mic").disabled = v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("rec", P.rec !== null);
  const knob = (document.activeElement as HTMLElement | null)?.dataset?.knob;
  markup($("#pick"), Html.pick_html(View.view_fold(v), v.fold === null, View.view_shown(v), v.page === null ? v.talk : undefined));
  if (knob !== undefined) {
    $("#pick [data-knob=" + knob + "]").focus();
  }
  mcp_draw();
  $("#tabs").hidden = tabs.length < 2;
  markup($("#tabs"), Html.tabs_html(tabs));
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
    P.end = false;
    el.scrollIntoView();
  }
  mine_show();
}

function mine_show(): void {
  const first = document.querySelector<HTMLElement>("#log .msg.user");
  $(".mine").hidden = first === null || !mine_above(first);
  $(".down").hidden = P.end || innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}

function down(): void {
  scrollTo(0, document.documentElement.scrollHeight);
  P.end = true;
  mine_show();
}

function mine_above(el: HTMLElement): boolean {
  return el.getBoundingClientRect().top < $("header").getBoundingClientRect().bottom;
}

function go(path: string): void {
  if (location.pathname + location.hash !== path) {
    history.pushState(null, "", path);
  }
  route();
}

function route(): void {
  const page = PAGES.includes(location.pathname);
  const tree = location.pathname === TREE;
  const chat = !page && !tree;
  if (!chat && !$("#log").hidden && P.away === null) {
    P.away = { y: scrollY, end: P.end };
  }
  $("#log").hidden = !chat;
  document.body.classList.toggle("account", page);
  document.body.classList.toggle("tree", tree);
  $("#account").hidden = !page;
  $("#tree").hidden = !tree;
  P.at = location.pathname + location.hash;
  P.shown = chat && P.away !== null ? shown_key() : location.pathname;
  if (chat && P.away !== null) {
    P.end = P.away.end;
    P.rows = true;
    paint();
    scrollTo(0, P.end ? document.documentElement.scrollHeight : P.away.y);
    P.y = scrollY;
    P.away = null;
  }
  if (page) {
    account();
  }
  if (tree) {
    Tree.tree_show(tree_view() ? "VIEW" : "TREE");
  } else {
    Tree.tree_hide();
  }
  draw(chat && P.end);
}

function popped(): void {
  if (location.pathname + location.hash !== P.at) {
    route();
  }
  Viewer.viewer_sync();
  draw(true);
}

async function account(): Promise<void> {
  const el = $("#account");
  const [got, set] = await Promise.all([fetch("/api/prompts").catch(() => null), fetch("/api/settings").catch(() => null)]);
  const prompts: View.Prompts | null = got !== null && got.ok ? await got.json().catch(() => null) : null;
  const push = await notify_state().catch(() => null);
  el.innerHTML = Html.account_html(prompts, push);
  P.dirty.clear();
  el.oninput = (ev) => {
    const form = (ev.target as Element).closest("form");
    if (form !== null) {
      P.dirty.add(form);
    }
  };
  el.querySelectorAll<HTMLFormElement>("form.prompt").forEach((form) => (form.onsubmit = (ev) => {
    ev.preventDefault();
    account_prompt(form);
  }));
  mcp_draw();
  el.querySelectorAll<HTMLButtonElement>(".retry").forEach((retry) => (retry.onclick = () => account()));
  $("#account .out").onclick = signout;
  const bell = document.querySelector<HTMLButtonElement>("#account .notify");
  bell?.addEventListener("click", () => {
    bell.disabled = true;
    notify(push !== "on");
  });
  const page = set?.ok ? await set.json().catch(() => null) : null;
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
  const on = box.contains(document.activeElement) ? document.activeElement!.getAttribute("aria-label") : null;
  markup(box, Html.mcp_html(v.mcp));
  [...box.querySelectorAll<HTMLElement>("[role=switch]")].find((b) => b.getAttribute("aria-label") === on)?.focus();
}

async function signout(): Promise<void> {
  await notify_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
  await View.post("/api/logout", {});
  location.href = "/";
}

async function account_prompt(form: HTMLFormElement): Promise<void> {
  const area = form.querySelector("textarea")!;
  const why  = form.querySelector(".why")!;
  const save = form.querySelector("button")!;
  const sent = area.value;
  save.disabled = true;
  P.saving++;
  const out = await View.post("/api/prompts", { [area.name]: sent });
  P.saving--;
  save.disabled = false;
  if (out.error === undefined && area.value === sent) {
    area.value = out[area.name]?.text ?? sent;
  }
  why.textContent = out.error ?? (area.value === out[area.name]?.text ? "Saved." : "Not saved yet: Save again.");
  form.classList.toggle("bad", out.error !== undefined);
  if (out.error === undefined && area.value === sent) {
    P.dirty.delete(form);
    P.since = true;
  }
  draw(false);
}

async function notify_state(): Promise<Html.Notify | null> {
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
  const wait = new Promise<undefined>((ok) => setTimeout(ok, 3000, undefined));
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await Promise.race([navigator.serviceWorker.ready, wait]));
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
    toast(out.error ?? "Notifications are " + what + ".");
  } catch (err: any) {
    const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
    toast(denied ? "Notifications are blocked in this browser's settings." : "Could not turn notifications " + what + ": " + (err?.message ?? err));
  }
  account();
}

async function notify_on(reg: ServiceWorkerRegistration, key: string): Promise<any> {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || err?.name !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return View.post("/api/webpush", sub.toJSON());
}

async function notify_off(reg: ServiceWorkerRegistration): Promise<any> {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}

function settings_draw(page: any): void {
  $("#account .owned").innerHTML = Html.settings_html(page);
  const form = $<HTMLFormElement>("#account form.settings");
  const rows = new Map<string, any>(page.settings.map((r: any) => [r.key, r]));
  const unset = new Set<string>();
  const profs: Array<[string, string[]]> = Object.entries(page.profiles ?? {});
  const box = form.querySelector<HTMLElement>(".profiles .field");
  const names = () => profs.map(([name]) => name.trim()).filter((name) => name !== "");
  const listed = (key: string) => {
    const boxes = [...form.querySelectorAll<HTMLInputElement>(`input[name="${key}"]`)];
    return boxes.length === 0 ? Html.list(rows.get(key).value) : boxes.filter((b) => b.checked).map((b) => b.value);
  };
  const picks = () => {
    const vendors = listed("vendors");
    form.querySelectorAll<HTMLElement>(".opt[data-vendor]:not([data-vendor=''])").forEach((o) => (o.hidden = !o.dataset.vendor!.split(" ").some((v) => vendors.includes(v))));
    for (const key of Html.PICKS) {
      const value = form.querySelector<HTMLInputElement>(`input[name="${key}"]`);
      const four = value?.parentElement!.querySelector<HTMLElement>(".four");
      if (value && four) {
        const focus = (document.activeElement as HTMLSelectElement | null)?.name;
        four.innerHTML = Html.picks_html(key, vendors, listed("models"), value.value, key === "agents" ? "The chat's pick" : null, names());
        four.querySelector<HTMLSelectElement>(`select[name="${focus}"]`)?.focus();
      }
    }
    const keyless = vendors.filter((v) => {
      const name = Html.VENDOR_KEY[v];
      const key = page.keys.find((k: any) => k.name === name);
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
    unset.delete(el.dataset.key!);
    el.classList.remove("unset");
    el.querySelector(".err")!.textContent = "";
    const value = el.querySelector<HTMLInputElement>("input[type=hidden]");
    if (value !== null) {
      value.value = Html.pick_mend([...el.querySelectorAll("select")].map((s) => s.value), listed("models"), names());
    }
    picks();
    if (el.dataset.key === "vendors" || el.dataset.key === "models") {
      profs_draw();
    }
  };
  form.onclick = (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".reset");
    if (btn === null) {
      return;
    }
    const el = btn.closest<HTMLElement>(".set")!;
    const key = el.dataset.key!;
    const r = rows.get(key);
    el.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((b) => (b.checked = Html.list(r.def).includes(b.value)));
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]), textarea").forEach((i) => (i.value = r?.def ?? ""));
    picks();
    unset.add(key);
    el.classList.add("unset");
    btn.hidden = true;
    el.querySelector(".from")!.insertAdjacentText("beforeend", key.startsWith("key.") ? " · removed once saved" : " · the default once saved");
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    settings_save(form, page, unset, listed, profs);
  };
  const profs_draw = (focus?: string) => {
    if (box !== null) {
      box.innerHTML = Html.profiles_html(profs, Html.offered(listed("vendors"), listed("models")));
      (focus === undefined ? null : box.querySelector<HTMLElement>(focus) ?? box.querySelector<HTMLElement>(".pnew"))?.focus();
    }
  };
  const profs_changed = (focus: string) => {
    profs_draw(focus);
    box!.closest(".set")!.querySelector(".err")!.textContent = "";
    picks();
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
    const li = grip.closest("li")!;
    const ol = li.parentElement!;
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

async function settings_save(form: HTMLFormElement, page: any, unset: Set<string>, listed: (key: string) => string[], profs: Array<[string, string[]]>): Promise<void> {
  const set: Record<string, string | null> = {};
  const keys: Record<string, string | null> = {};
  for (const r of page.settings) {
    if (form.querySelector(`.set[data-key="${r.key}"]`) === null) {
      continue;
    }
    const field = form.querySelector<HTMLInputElement>(`input[name="${r.key}"]`);
    const now = r.key === "vendors" || r.key === "models" ? Html.list_changed(Html.list(r.value), listed(r.key))?.join(",") ?? r.value : field?.value.trim() ?? r.value;
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
  const why = form.querySelector(".save .why")!;
  form.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  let profiles: Record<string, string[]> | undefined;
  if (page.profiles != null) {
    const now = profs.map(([name, list]): [string, string[]] => [name.trim(), list]);
    const all = now.map(([name]) => name);
    const bad = all.includes("") ? "Name each profile." : all.some((name, k) => all.indexOf(name) !== k) ? "Two profiles have the same name." : now.some(([, list]) => list.length === 0) ? "Add a model to each profile." : null;
    if (bad !== null) {
      const at = form.querySelector<HTMLElement>(".profiles")!;
      at.querySelector(".err")!.textContent = bad;
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
  const go = form.querySelector<HTMLButtonElement>(".go")!;
  go.disabled = true;
  why.textContent = "";
  P.saving++;
  const out = await View.post("/api/settings", { version: page.version, set, keys, ...(profiles === undefined ? {} : { profiles }) });
  P.saving--;
  go.disabled = false;
  if (!out.ok) {
    const at = out.key === undefined ? null : form.querySelector<HTMLElement>(`.set[data-key="${out.key}"]`);
    (at?.querySelector(".err") ?? why).textContent = out.error ?? "Could not save.";
    (at ?? why).scrollIntoView({ block: "center" });
    return;
  }
  const later = (out.saved as string[]).filter((key) => page.settings.find((r: any) => r.key === key)?.apply === "restart");
  settings_draw(out);
  P.dirty.delete(form);
  P.since = true;
  draw(false);
  toast(later.length === 0 ? "Saved." : "Saved. " + later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
}

function renew_due(build: string | undefined): void {
  if (build === undefined || P.build === "" || build === P.build) {
    P.build ||= build ?? "";
    P.due = false;
    return;
  }
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  if (was === build && Number(n) >= 2 && (P.gave === null || P.gave === v.ws)) {
    P.gave = v.ws;
    return;
  }
  P.since = P.due && P.since;
  P.due = true;
  draw(false);
}

function renew_free(hidden = false): boolean {
  const page = location.pathname !== "/" && location.pathname !== TREE;
  const quiet = P.rec === null && UPS.size === 0 && v.out.length === 0 && !$("#import").matches(":popover-open") && !Viewer.viewer_on();
  const typing = !DESK.matches && Box.box_focused() && !hidden;
  return quiet && !typing && (!page || (P.since && P.dirty.size === 0 && P.saving === 0));
}

async function renew(hidden = false): Promise<void> {
  const [was, n] = (sessionStorage.getItem(kept("build")) ?? "").split(" ");
  const tries = was === v.build ? Number(n) : 0;
  const store = isSecureContext && "caches" in window ? window.caches : null;
  const keys = (await store?.keys().catch(() => [])) ?? [];
  await Promise.all(keys.filter((k) => k.startsWith("unii-shell")).map((k) => store?.delete(k)));
  if (tries > 0) {
    await Promise.all(["/", "/app.js", "/style.css", "/sw.js"].map((path) => fetch(path, { cache: "reload" }).catch(() => null)));
  }
  if (!P.due || !renew_free(hidden)) {
    P.going = false;
    return;
  }
  const chat = !$("#log").hidden;
  const back = { at: chat && !P.end ? anchor() : null, y: chat ? null : scrollY, away: P.away, caret: Box.box_caret(), focus: Box.box_focused(), open: [...P.open] };
  sessionStorage.setItem(kept("back"), JSON.stringify(back));
  sessionStorage.setItem(kept("build"), (v.build ?? "") + " " + (tries + 1));
  location.reload();
}

function renewed(): void {
  const text = sessionStorage.getItem(kept("back"));
  sessionStorage.removeItem(kept("back"));
  const back = text === null ? null : JSON.parse(text);
  if (back === null) {
    return;
  }
  if (back.focus && DESK.matches) {
    Box.box_focus();
  }
  Box.box_place(back.caret[0], back.caret[1]);
  back.open.forEach((id: string) => P.open.add(id));
  P.back = back.at;
  P.away = back.away;
  const end = Date.now() + 3000;
  const y = () => back.y !== null && (document.documentElement.scrollHeight >= back.y + innerHeight || Date.now() > end ? scrollTo(0, back.y) : setTimeout(y, 100));
  y();
}

function toast(text: string, stay = false): void {
  const el = $("#toast");
  el.textContent = text;
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
boot();
