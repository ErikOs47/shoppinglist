// Service Worker: hält die App-Hülle offline verfügbar.
// Daten (Produkte, Zettel) liegen nicht hier, sondern im localStorage der App;
// Anfragen an Supabase (andere Domain) werden nie zwischengespeichert.

const CACHE = 'einkauf-v2';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Gebaute Assets (Dateinamen mit Hash) aus index.html herauslesen und
      // gleich mit ablegen, damit der erste Offline-Start funktioniert.
      const html = await (await cache.match('./', { ignoreVary: true })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Seitenaufruf: erst Netz (neueste Version), bei Fehler die gespeicherte Hülle.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./', res.clone());
          return res;
        } catch {
          return (await caches.match('./', { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  // Gehashte Assets ändern sich nie: zuerst Cache.
  // Übriges (Icons, Manifest): Cache sofort, im Hintergrund auffrischen.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: Server senden oft „Vary: Origin“; Modul-Skripte werden mit
      // Origin-Header angefragt, der Cache-Eintrag aus install() ohne. Ohne
      // ignoreVary findet der Abgleich offline nichts.
      const cached = await cache.match(req, { ignoreVary: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached && url.pathname.includes('/assets/')) return cached;
      return cached || network;
    })(),
  );
});
