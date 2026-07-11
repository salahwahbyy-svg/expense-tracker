const CACHE = "expenses-v15";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./depreciation.js", "./manifest.json", "./icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always go to the network for live data.
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    return;
  }

  // Cache-first with background refresh (stale-while-revalidate) for the app
  // shell: the app must open instantly even when the server is cold-starting,
  // so never block rendering on the network. Updated files are picked up in
  // the background and served on the next open.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const refresh = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      // Navigations to unknown paths fall back to the cached shell.
      return (
        cached ||
        refresh.then(
          (res) => res || (event.request.mode === "navigate" ? caches.match("./index.html") : res)
        )
      );
    })
  );
});
