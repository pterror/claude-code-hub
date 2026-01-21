const CACHE_NAME = 'hub-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', e => {
  // Network-first for API, cache-first for assets
  if (e.request.url.includes('/agents') || e.request.url.includes('/ws') || e.request.url.includes('/push')) {
    return; // Don't cache API
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return;

  const data = e.data.json();
  const options = {
    body: data.body,
    icon: '/manifest.json', // No icon for now
    badge: '/manifest.json',
    tag: data.tag || 'hub-notification',
    renotify: true,
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'claude-code-hub', options)
  );
});

// Click on notification opens the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      // Focus existing window or open new one
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
