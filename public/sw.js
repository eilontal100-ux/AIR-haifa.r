// Service worker: shows Pilot Swap push notifications and opens the app when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Pilot Swap', {
    body: data.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: data.tag, data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(c => c.url.startsWith(self.location.origin));
    if (!open) return self.clients.openWindow(url);
    await open.focus();
    try { await open.navigate(url); } catch { /* not controlled yet: focusing is enough */ }
  })());
});
