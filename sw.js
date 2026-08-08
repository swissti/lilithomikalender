// Service Worker für Lili & Thomi Kalender
// Notwendig, damit Chrome/Android die App als echte PWA installiert
// (sonst nur "Verknüpfung" mit Chrome-Badge)

const CACHE_NAME = 'lili-thomi-kalender-v1';
const URLS_TO_CACHE = [
  './'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Network-first, damit Aktualisierungen sofort ankommen; Cache nur als Fallback (offline)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ============ Push-Benachrichtigungen ============
// Zeigt eine Systembenachrichtigung, wenn der andere Elternteil einen
// Kalender-Eintrag geändert hat (ausgelöst vom Apps-Script-Backend über
// die Netlify-Function send-push).
self.addEventListener('push', (event) => {
  let data = { title: 'Lili & Thomi Kalender', body: 'Es gibt eine Änderung im Kalender.', url: './' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch (e) { /* Fallback auf Standardtext */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-badge.png',
      data: { url: data.url || './' }
    })
  );
});

// Klick auf die Benachrichtigung: vorhandenes App-Fenster fokussieren,
// sonst neu öffnen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
