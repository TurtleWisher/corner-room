/*
 * Corner Room service worker (D-AUDIO-18, 2026-10-25). Deliberately small: it only makes the app
 * open without a connection. When a page can't be loaded from the network, /offline.html (the
 * offline library and player, reading songs saved in IndexedDB) is shown instead. Nothing else is
 * cached or changed: API calls, audio streams, uploads and built assets all go to the network as
 * before, so a new release is never hidden behind an old cache.
 */

const CACHE = "cr-offline-v1";
const SHELL = ["/offline.html", "/offline-player.js", "/brand/logo/corner-room-logo-ember.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The offline files themselves: network first so updates arrive, cache when offline.
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() => caches.match(url.pathname)),
    );
    return;
  }

  // Pages: always the network; only when it fails, the offline library.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  }
});
