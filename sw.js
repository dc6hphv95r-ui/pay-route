// Pay & Route offline cache. Bump VERSION when files change.
const VERSION = 'pr-v1';
const SHELL = ['./', './index.html', './router.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
const MAP = './halton-map.txt';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'pr-map').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/halton-map.txt')) {
    // map: cache first (big); refresh in background
    e.respondWith(caches.open('pr-map').then(async c => {
      const hit = await c.match(MAP);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(MAP, r.clone()); return r; }).catch(() => null);
      return hit || net.then(r => r || new Response('', { status: 503 }));
    }));
    return;
  }
  // app shell: network first so updates arrive, fall back to cache offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cl)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
