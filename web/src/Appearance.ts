import * as Theme from "../../Appearance.ts";

const KEY = "unii.appearance";
const SCHEME = matchMedia("(prefers-color-scheme: dark)");
let selected = read();

function read(): Theme.Preference {
  try {
    return Theme.preference(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...Theme.DEFAULT };
  }
}

function apply(): void {
  const p = Theme.resolve(selected, SCHEME.matches);
  const roles = {
    ink: p.fg, mid: p.muted, soft: p.soft, hair: p.border, paper: p.bg,
    lift: p.input, block: p.surface, hover: p.hover, frame: p.border, edge: p.muted,
    add: p.success, del: p.error, red: p.error, warm: p.warm, accent: p.accent,
    alien: p.accent, glow: `color-mix(in srgb, ${p.accent} 16%, transparent)`,
    veil: p.mode === "dark" ? "rgb(0 0 0 / .5)" : "rgb(0 0 0 / .2)",
    shadow: p.mode === "dark" ? "0 1px 2px rgb(0 0 0 / .4), 0 8px 28px rgb(0 0 0 / .45)" : "0 1px 2px rgb(0 0 0 / .08), 0 8px 28px rgb(0 0 0 / .12)",
  };
  const root = document.documentElement;
  for (const [name, value] of Object.entries(roles)) {
    root.style.setProperty("--" + name, value);
  }
  root.style.colorScheme = p.mode;
  root.dataset.theme = p.id;
  root.dataset.colorMode = p.mode;
  document.querySelectorAll<HTMLMetaElement>("meta[name=theme-color]").forEach((m) => {
    m.removeAttribute("media");
    m.content = p.bg;
  });
  document.querySelectorAll<HTMLIFrameElement>("iframe.page").forEach(frame);
  const status = document.querySelector("#appearance-status");
  if (status !== null) {
    status.textContent = `${p.name} · ${selected.mode === "auto" ? "Automatic: this device’s color preference" : "Fixed " + p.mode + " mode"}`;
  }
}

function frame(el: HTMLIFrameElement): void {
  try {
    const doc = el.contentDocument;
    if (doc !== null) {
      const p = Theme.resolve(selected, SCHEME.matches);
      doc.documentElement.style.colorScheme = p.mode;
      doc.documentElement.style.setProperty("--unii-page-ink", p.fg);
      doc.documentElement.style.setProperty("--unii-page-paper", p.bg);
    }
  } catch {
  }
}

export function start(): void {
  apply();
  SCHEME.addEventListener("change", apply);
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY || ev.key === null) {
      selected = read();
      apply();
      controls();
    }
  });
  document.addEventListener("load", (ev) => {
    if (ev.target instanceof HTMLIFrameElement && ev.target.matches("iframe.page")) {
      frame(ev.target);
    }
  }, true);
}

function controls(): void {
  document.querySelectorAll<HTMLSelectElement>("#s-appearance select").forEach((el) => {
    el.value = selected[el.name as keyof Theme.Preference];
  });
}

export function settings(): void {
  const box = document.querySelector("#s-appearance");
  if (box === null) {
    return;
  }
  const options = (mode: "light" | "dark") => Theme.PALETTES.filter((p) => p.mode === mode).map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  box.innerHTML = `<h2>Appearance</h2><p class="sub">One palette across chat, Settings and memory. Saved on this browser, independently of server and account settings.</p>
    <div class="appearance-fields">
    <label>Color mode<select name="mode" aria-label="Color mode"><option value="auto">Automatic · device preference</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <label>Light theme<select name="light" aria-label="Light theme">${options("light")}</select></label>
    <label>Dark theme<select name="dark" aria-label="Dark theme">${options("dark")}</select></label></div>
    <p id="appearance-status" class="sub" role="status"></p><p class="sub">Automatic follows this device, including desktop day/night switching when the browser receives it. Everforest Light Med and Dark Hard are also available as a pair. Explicit Light or Dark ignores automatic changes.</p>`;
  controls();
  box.querySelectorAll<HTMLSelectElement>("select").forEach((el) => el.addEventListener("change", () => {
    selected = Theme.preference({ ...selected, [el.name]: el.value });
    try {
      localStorage.setItem(KEY, JSON.stringify(selected));
    } catch {
      const status = box.querySelector("[role=status]");
      apply();
      if (status !== null) {
        status.textContent += " · Not saved: browser storage is unavailable.";
      }
      return;
    }
    apply();
  }));
  apply();
}
