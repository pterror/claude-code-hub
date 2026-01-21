const CACHE_NAME = 'hub-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  // Don't cache API calls
  if (e.request.url.includes('/agents') ||
      e.request.url.includes('/ws') ||
      e.request.url.includes('/push') ||
      e.request.url.includes('/repos') ||
      e.request.url.includes('/triggers') ||
      e.request.url.includes('/hooks')) {
    return;
  }

  // Stale-while-revalidate for assets
  // Serve from cache immediately, but fetch in background and update cache
  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(e.request);

      // Fetch fresh version in background
      const fetchPromise = fetch(e.request).then(response => {
        if (response.ok) {
          cache.put(e.request, response.clone());

          // Notify clients if index.html was updated
          if (e.request.url.endsWith('/') || e.request.url.endsWith('/index.html')) {
            self.clients.matchAll().then(clients => {
              clients.forEach(client => client.postMessage({ type: 'update-available' }));
            });
          }
        }
        return response;
      }).catch(() => cached); // Fall back to cached on network error

      // Return cached immediately or wait for network
      return cached || fetchPromise;
    })
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
