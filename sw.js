// Service worker: tiene l'app disponibile anche senza connessione.
// Cambia il numero di versione ogni volta che aggiorni i file, così il telefono scarica quelli nuovi.
const VERSIONE = 'v3';
const FILE = ['./', 'index.html', 'app.js', 'engine.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSIONE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Google passa dalla rete
  // prima la rete (così gli aggiornamenti arrivano subito), se manca internet la copia salvata
  e.respondWith(fetch(req).then(r => {
    const copia = r.clone();
    caches.open(VERSIONE).then(c => c.put(req, copia));
    return r;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
