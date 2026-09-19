/* Imported by the generated Workbox service worker (vite.config.js → workbox.importScripts).
   Background Sync: the app registers the tag 'gk-capture-sync' after every machine
   photo capture (src/offline/captureQueue.js). When the browser fires the sync
   event (typically once connectivity returns, even if the tab was closed and
   reopened) we wake every open client and ask it to flush its IndexedDB queue.
   Uploads need the user's Bearer token, which lives in the page, so the page
   does the upload — the worker only nudges. */
self.addEventListener('sync', (event) => {
  if (event.tag !== 'gk-capture-sync') return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'gk-flush-captures' }));
    })
  );
});
