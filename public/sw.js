// Self-destructing migration worker. Older Pawlytics builds registered a
// cache-first worker that could keep serving broken auth/upload bundles after a
// deployment. Existing installations update to this worker, clear those
// caches, and unregister; current builds do not register a worker at all.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
      self.registration.unregister(),
      self.clients.claim(),
    ]),
  );
});
