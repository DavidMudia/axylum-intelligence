const STATIC_CACHE = "axylum-static-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("axylum-") && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/icons/")) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (!response.ok) return response;
          return cache.put(request, response.clone()).then(() => response);
        }),
      ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    const text = event.data.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") payload = parsed;
    } catch {
      payload = { body: text };
    }
  }

  const title = typeof payload.title === "string" ? payload.title : "Axylum alert";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "You have a new Axylum update.",
    icon: "/icons/axylum-192.png",
    badge: "/icons/axylum-192.png",
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data && event.notification.data.url;
  let target = new URL("/", self.location.origin);
  if (typeof requestedUrl === "string") {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.navigate(target.href).then(() => existing.focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
