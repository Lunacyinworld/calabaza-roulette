// Service worker mínimo: permite instalar la app. El juego necesita internet (WebSocket).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
