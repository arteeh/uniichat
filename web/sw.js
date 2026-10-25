// UniiChat's service worker
// =========================
// The app's shell (SHELL), kept as last fetched: a page opened while the
// server is down gets it, and waits there for the server (main.ts
// boot_me) instead of the browser's error page. The server's answer
// always comes first, so a deploy shows at once; nothing else (the API,
// the socket, the chat's pages and images) is ever kept or answered here.
// A push (Push.ts, Push.browsers) shows the start of a reply, unless a
// tab of the chat is in front, in place of the one before; a tap opens
// the chat.

// (named by the web app's build, which the server writes in: a new
// build's drops the old one's as it starts)
const CACHE = "unii-shell-{build}";
const SHELL = ["/", "/app.js", "/style.css", "/favicon.svg", "/mark.svg", "/manifest.webmanifest", "/icon-192.png"];
const PAGES = ["/", "/settings", "/account", "/tree"];

// Safari takes a subscription back from a site whose pushes show nothing,
// so there every push shows
const QUIET = !/AppleWebKit/.test(navigator.userAgent) || /Chrom|Android/.test(navigator.userAgent);

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

// the shell's files, and a page of the app (PAGES: all index.html, kept
// as "/")
self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  const page = req.mode === "navigate" && PAGES.includes(url.pathname);
  if (req.method !== "GET" || url.origin !== location.origin || !(page || SHELL.includes(url.pathname))) {
    return;
  }
  ev.respondWith(fresh(req, page ? "/" : url.pathname));
});

// the server's answer (never the browser's cache unchecked: a new build
// shows at once), kept; none, or the server down behind a proxy (5xx),
// the one kept
async function fresh(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" });
    if (res.ok) {
      await cache.put(key, res.clone());
    }
    return res.status < 500 ? res : (await cache.match(key)) ?? res;
  } catch (err) {
    const kept = await cache.match(key);
    if (kept === undefined) {
      throw err;
    }
    return kept;
  }
}

self.addEventListener("push", (ev) => {
  let text = "";
  try {
    text = String(ev.data?.json().text ?? "");
  } catch {}
  ev.waitUntil(notify(text));
});

async function notify(text) {
  const tabs = await self.clients.matchAll({ type: "window" });
  if (QUIET && tabs.some((tab) => tab.focused)) {
    return;
  }
  await self.registration.showNotification("UniiChat", { body: text, icon: "/icon-192.png", tag: "unii", renotify: true });
}

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(open_chat());
});

// the chat: one of its tabs, in front; else a new one
async function open_chat() {
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const tab = tabs.find((t) => new URL(t.url).origin === location.origin);
  return tab !== undefined ? tab.focus() : self.clients.openWindow("/");
}
