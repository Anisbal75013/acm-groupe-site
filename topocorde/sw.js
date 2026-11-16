/* TopoCorde — fonctionnement hors ligne. */
const V = 'topocorde-v1.0.0';
const SHELL = ['app.html', 'core.js', 'pdf.js', 'ui.js', 'jspdf.umd.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('topocorde-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  /* Réseau d'abord (pour recevoir les mises à jour), cache si le réseau manque */
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('app.html'))));
});
