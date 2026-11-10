/* TableTap service worker — offline shell + web push.
   Kept deliberately small: navigation requests fall back to the cached shell,
   static assets are stale-while-revalidate, API calls are never cached. */
const VERSION = 'tabletap-v1';
const SHELL = ['/offline.html', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API responses

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  if (/\.(png|jpg|jpeg|svg|webp|woff2|css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});

/* ---------------------------------------------------------------- push */
self.addEventListener('push', (event) => {
  let payload = { title: 'TableTap', body: 'New activity', url: '/waiter' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch (e) {
    /* plain text payload */
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag,
      renotify: true,
      requireInteraction: true,
      vibrate: [120, 60, 120],
      data: { url: payload.url, event: payload.event },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/waiter';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
