const CACHE = "ki-shell-{build}";
const SHELL = ["/", "/app.js", "/style.css", "/favicon.svg", "/mark.svg", "/manifest.webmanifest", "/icon-192.png"];
const PAGES = ["/", "/settings", "/account", "/tree", "/new"];
const PAGE_WAIT = 3000;

// Safari takes a subscription back from a site whose pushes show nothing,
// so there every push shows
const QUIET = !/AppleWebKit/.test(navigator.userAgent) || /Chrom|Android/.test(navigator.userAgent);

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  const page = req.mode === "navigate" && (PAGES.includes(url.pathname) || /^\/a\/[a-z0-9]+(\/edit|\/s\/[A-Za-z]+)?$/.test(url.pathname));
  if (req.method !== "GET" || url.origin !== location.origin || !(page || SHELL.includes(url.pathname))) {
    return;
  }
  ev.respondWith(fresh(ev, req, page ? "/" : url.pathname));
});

// a page or shell file whose network hangs (a phone's, just woken) comes
// from the cache after PAGE_WAIT, and the cache is refreshed after (#159)
async function fresh(ev, req, key) {
  const cache = await caches.open(CACHE);
  const net = fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" }).then(async (res) => {
    if (res.ok) {
      await cache.put(key, res.clone());
    }
    return res;
  });
  ev.waitUntil(net.catch(() => {}));
  try {
    const late = new Promise((ok) => setTimeout(ok, PAGE_WAIT, null));
    const res = (await Promise.race([net, late])) ?? (await cache.match(key)) ?? (await net);
    return res.status < 500 ? res : (await cache.match(key)) ?? res;
  } catch (err) {
    const kept = await cache.match(key);
    if (kept === undefined) {
      throw err;
    }
    return kept;
  }
}

// a reply of an agent: its name and chat; no picture, which Android would
// show on the right, not where a messaging app has it (#152)
self.addEventListener("push", (ev) => {
  let msg = {};
  try {
    msg = ev.data?.json() ?? {};
  } catch {}
  ev.waitUntil(notify(msg));
});

// none while a focused window shows that agent's chat
async function notify(msg) {
  const tabs = await self.clients.matchAll({ type: "window" });
  const url = typeof msg.url === "string" ? msg.url : "/";
  if (QUIET && tabs.some((tab) => tab.focused && new URL(tab.url).pathname === url)) {
    return;
  }
  await self.registration.showNotification(String(msg.title ?? "Ki"), { body: String(msg.text ?? ""), tag: String(msg.tag ?? "ki"), renotify: true, data: { url } });
}

// the push service renewed the subscription: the server gets the new one
// (#152)
self.addEventListener("pushsubscriptionchange", (ev) => {
  ev.waitUntil((async () => {
    const options = ev.oldSubscription?.options;
    const sub = ev.newSubscription ?? (options === undefined ? null : await self.registration.pushManager.subscribe(options));
    if (sub !== null) {
      await fetch("/api/webpush", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    }
  })());
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(open_chat(ev.notification.data?.url ?? "/"));
});

async function open_chat(url) {
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const tab = tabs.find((t) => new URL(t.url).origin === location.origin);
  if (tab === undefined) {
    return self.clients.openWindow(url);
  }
  await tab.focus();
  // an open app goes there itself, so its history stays one stack
  if ((await self.clients.matchAll({ type: "window" })).some((t) => t.id === tab.id)) {
    return tab.postMessage({ go: url });
  }
  return tab.navigate(url).catch(() => null);
}
