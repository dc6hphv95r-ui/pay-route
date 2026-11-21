// Pay & Route offline cache. Bump VERSION when app files change.
const VERSION = 'pr-v7';
const SHELL = ['./', './index.html', './router.js', './manifest.json', './maplibre-gl.js', './maplibre-gl.css', './icon-180.png', './icon-192.png', './icon-512.png'];
const MAP = './halton-map.txt';
const TILES = 'pr-tiles';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![VERSION, 'pr-map', TILES].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles(c) { const ks = await c.keys(); if (ks.length > 6000) for (const k of ks.slice(0, ks.length - 5000)) await c.delete(k); }
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'tiles.openfreemap.org') {
    // online map: use saved copy when there is one, so areas you've viewed work without signal
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) { c.put(e.request, r.clone()); trimTiles(c); } return r; }).catch(() => null);
      return hit || net.then(r => r || new Response('', { status: 504 }));
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/halton-map.txt')) {
    e.respondWith(caches.open('pr-map').then(async c => {
      const hit = await c.match(MAP);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(MAP, r.clone()); return r; }).catch(() => null);
      return hit || net.then(r => r || new Response('', { status: 503 }));
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cl)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
