/* Beta Lagos / International Life service worker: keeps the game files on the device.
   - /assets/*  (hashed build files): cache first. They are saved by src/cache/AppCache.ts (real download progress) and never change under the same name.
   - everything else on this site (index.html, launch page, icons): network first, falling back to the saved copy when offline. */
const STATIC = 'bl-static-v1';
const PAGES = 'bl-pages-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bl-') && k !== STATIC && k !== PAGES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(url.pathname.includes('/assets/') ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, { cacheName: STATIC });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) (await caches.open(STATIC)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) (await caches.open(PAGES)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await caches.match(req, { cacheName: PAGES, ignoreSearch: true })) || (await caches.match(req, { cacheName: STATIC }));
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const index = await caches.match(new URL('./', self.location.href).href, { cacheName: PAGES, ignoreSearch: true });
      if (index) return index;
    }
    throw err;
  }
}
