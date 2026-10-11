// SommerHaus Service Worker: App-Dateien zwischenspeichern, damit die App auch ohne Netz startet.
// Strategie wie bei Doku-Fix: erst Netz (neue Version kommt an), ohne Netz die gespeicherte Datei.
// Die Daten selbst puffert Firebase im Browser, sie laufen nicht über diesen Cache.
const CACHE = 'sommerhaus-v1';
const DATEIEN = ['./', './index.html', './sh-firebase.js', './firebase-config.js', './manifest.webmanifest',
  './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './favicon-32.png'];
const FREMD = ['https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const herkunft = new URL(r.url).origin;
  if (herkunft !== location.origin && !FREMD.includes(herkunft)) return;
  e.respondWith(
    fetch(r).then(antwort => {
      if (antwort.ok || antwort.type === 'opaque') { const kopie = antwort.clone(); caches.open(CACHE).then(c => c.put(r, kopie)); }
      return antwort;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(g => g || (r.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
