// Pay & Route offline cache. Bump VERSION when app files change.
const VERSION = 'pr-v31';
const SHELL = ['./', './index.html', './router.js', './config.js', './supabase.js', './manifest.json', './maplibre-gl.js', './maplibre-gl.css', './icon-180.png', './icon-192.png', './icon-512.png', './pdf.min.js', './pdf.worker.min.js'];
const MAP = './halton-map.txt';
const TILES = 'pr-tiles';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![VERSION, 'pr-map', TILES, 'pr-share'].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles(c) { const ks = await c.keys(); if (ks.length > 6000) for (const k of ks.slice(0, ks.length - 5000)) await c.delete(k); }
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    // Android "Share → Pay & Route": keep the shared text, PDF or screenshots, then open the app
    e.respondWith((async () => {
      const fd = await e.request.formData();
      let text = (fd.get('title') || '') + '\n' + (fd.get('text') || '');
      const files = fd.getAll('file').filter(x => x && x.size), c = await caches.open('pr-share');
      const imgs = files.filter(x => /^image\//i.test(x.type) || /\.(png|jpe?g|webp|heic)$/i.test(x.name || ''));
      const f = files.find(x => !imgs.includes(x));
      if (imgs.length) { for (let i = 0; i < imgs.length; i++) await c.put('./shared-img-' + i, new Response(imgs[i], { headers: { 'Content-Type': imgs[i].type || 'image/png' } })); await c.put('./shared-imgs', new Response(String(imgs.length))); }
      else if (f && (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name || ''))) await c.put('./shared.pdf', new Response(f, { headers: { 'Content-Type': 'application/pdf' } }));
      else { if (f && f.text) text += '\n' + await f.text(); await c.put('./shared.txt', new Response(text)); }
      return Response.redirect('./index.html#route', 303);
    })());
    return;
  }
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
  // always ask the server first (skip the browser's 10-minute cache) so uploads show up right away
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cl)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
