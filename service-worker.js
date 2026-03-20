const CACHE_NAME = 'spendly-v1';
// Derive base URL from the service worker's own location
const BASE = self.location.pathname.replace(/\/service-worker\.js$/, '/');

const STATIC_ASSETS = [
    BASE,
    BASE + 'index.html',
    BASE + 'manifest.json',
    BASE + 'css/main.css',
    BASE + 'css/components.css',
    BASE + 'css/responsive.css',
    BASE + 'js/app.js',
    BASE + 'js/db.js',
    BASE + 'js/voice.js',
    BASE + 'js/ocr.js',
    BASE + 'js/charts.js',
    BASE + 'js/sms-parser.js',
    BASE + 'js/export.js',
    BASE + 'pages/dashboard.html',
    BASE + 'pages/add-expense.html',
    BASE + 'pages/history.html',
    BASE + 'pages/analytics.html',
    BASE + 'pages/settings.html',
    BASE + 'icons/icon-192.png',
    BASE + 'icons/icon-512.png'
];

const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/idb@7/build/umd.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Cache static assets (ignore individual failures)
            await cache.addAll(STATIC_ASSETS).catch(() => { });
            // Cache CDN assets individually so one failure doesn't break install
            for (const url of CDN_ASSETS) {
                await cache.add(url).catch(() => { });
            }
        })
    );
    self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ── Fetch — Cache-first ───────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    // Skip non-GET and chrome-extension requests
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;

            return fetch(event.request).then(response => {
                // Cache valid responses
                if (response && response.status === 200 && response.type !== 'opaque') {
                    const cloned = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
                }
                return response;
            }).catch(() => {
                // Offline fallback for navigation requests
                if (event.request.mode === 'navigate') {
                    return caches.match('/spendly/index.html');
                }
            });
        })
    );
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'sync-expenses') {
        event.waitUntil(syncPendingExpenses());
    }
});

async function syncPendingExpenses() {
    // In a full implementation, this would POST pending offline expenses to a server.
    // For this local-first PWA we simply notify the client that sync is available.
    const clients = await self.clients.matchAll();
    clients.forEach(client => client.postMessage({ type: 'SYNC_COMPLETE' }));
}

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : { title: 'Spendly', body: 'Budget alert!' };
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/spendly/icons/icon-192.png',
            badge: '/spendly/icons/icon-192.png',
            tag: 'spendly-alert',
            renotify: true
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            if (clients.length > 0) {
                clients[0].focus();
            } else {
                self.clients.openWindow('/spendly/');
            }
        })
    );
});
