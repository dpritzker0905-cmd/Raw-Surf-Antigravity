// Raw Surf OS Service Worker for Push Notifications and Offline Mode
// BUILD_VERSION is bumped on each deploy to auto-purge stale caches
const BUILD_VERSION = 'd50cc058';
const CACHE_NAME = `rawsurf-v3-${BUILD_VERSION}`;
const SPOT_CACHE_NAME = `rawsurf-spots-v1-${BUILD_VERSION}`;
const OFFLINE_CACHE_NAME = `rawsurf-offline-v1-${BUILD_VERSION}`;
const GALLERY_CACHE_NAME = 'rawsurf-gallery-offline-v1'; // Gallery persists across deploys
const FEED_CACHE_NAME = `rawsurf-feed-v1-${BUILD_VERSION}`;

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html'
];

// API endpoints to cache for offline mode
const OFFLINE_API_PATTERNS = [
  '/api/surf-spots',
  '/api/surf-spots/search',
  '/api/spots-in-bounds'
];

// Helper to safely call caches.open, returning null on rejection
async function safeOpenCache(name) {
  try {
    return await caches.open(name);
  } catch (err) {
    console.warn(`[ServiceWorker] CacheStorage open(${name}) failed:`, err);
    return null;
  }
}

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install - caching static assets');
  event.waitUntil(
    safeOpenCache(CACHE_NAME).then((cache) => {
      if (!cache) return;
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.log('[ServiceWorker] Static cache failed (expected in dev):', err);
      });
    }).catch(err => {
      console.warn('[ServiceWorker] Install cache flow failed:', err);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches and enable navigation preload
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    (async () => {
      // Enable navigation preload to prevent error flash during SW activation
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (e) { /* preload not supported or failed */ }
      }
      // Clean old caches
      try {
        const keyList = await caches.keys();
        await Promise.all(keyList.map((key) => {
          if (key !== CACHE_NAME && key !== SPOT_CACHE_NAME && key !== OFFLINE_CACHE_NAME && key !== GALLERY_CACHE_NAME && key !== FEED_CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', key);
            return caches.delete(key).catch(() => {});
          }
        }));
      } catch (err) {
        console.warn('[ServiceWorker] Activate cleaning caches failed:', err);
      }
    })()
  );
  self.clients.claim();
});

// Fetch event - implement offline-first strategy for spots
self.addEventListener('fetch', (event) => {
  // Guard: only intercept GET requests (POST/PUT can't be cloned safely)
  if (event.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return; // Malformed URL — let browser handle
  }
  
  // Exclude realtime weather, marine physics, and map tile APIs from SW interception
  if (
    url.hostname.includes('open-meteo.com') || 
    url.hostname.includes('rainviewer') ||
    url.hostname.includes('tiles.') ||
    url.hostname.includes('tile.') ||
    url.hostname.includes('maplibre') ||
    url.hostname.includes('.om') ||
    url.protocol.includes('om') ||
    url.pathname.includes('/marine') || 
    url.pathname.includes('/weather')
  ) {
    return; // Let the browser handle it natively without SW noise
  }

  // Check if this is an API request we want to cache for offline
  const isOfflineAPI = OFFLINE_API_PATTERNS.some(pattern => url.pathname.includes(pattern));
  
  if (isOfflineAPI) {
    // Network-first with cache fallback for spot data
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Only cache SUCCESSFUL responses — never cache a cold-start 502/4xx (it would poison the cache
          // and get served as "spots" on the next failure).
          if (response && response.ok) {
            const responseClone = response.clone();
            safeOpenCache(SPOT_CACHE_NAME).then((cache) => {
              if (!cache) return;
              try {
                cache.put(event.request, responseClone);
              } catch (e) {
                // Clone failed during SW transition — ignore
              }
            }).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          // Network failed, try cache
          console.log('[ServiceWorker] Offline - serving from cache:', url.pathname);
          try {
            const cache = await safeOpenCache(SPOT_CACHE_NAME);
            if (cache) {
              const cachedResponse = await cache.match(event.request);
              if (cachedResponse) {
                // Tag the cache-fallback so the client can tell a transient cold-start (retry → fresh global
                // spots) from genuine offline (keep stale). Without this the stale viewport cache was served
                // as if real → the app got stuck on a stale spot list (the "only Central FL spots" report).
                try {
                  const body = await cachedResponse.clone().text();
                  const headers = new Headers(cachedResponse.headers);
                  headers.set('X-SW-Cache-Fallback', '1');
                  return new Response(body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers });
                } catch (e) {
                  return cachedResponse;
                }
              }
            }
          } catch (e) {
            console.warn('[ServiceWorker] Match failed:', e);
          }
          // Return offline response for spots
          return new Response(JSON.stringify({
            offline: true,
            message: 'You are offline. Showing cached spot data.',
            data: []
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // Gallery offline cache — serve cached purchased media when offline
  // This handles Supabase storage URLs that were cached by offlineGallery.js
  const isGalleryMedia = url.hostname.includes('supabase') && url.pathname.includes('/storage/');
  if (isGalleryMedia) {
    event.respondWith(
      safeOpenCache(GALLERY_CACHE_NAME).then(async (cache) => {
        if (!cache) return fetch(event.request);
        const cached = await cache.match(event.request);
        if (cached) {
          // Cache hit — serve from cache (works offline)
          // Also try network in background to refresh
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              try { cache.put(event.request, networkResponse.clone()); } catch (e) { /* sw transition */ }
            }
          }).catch(() => { /* offline, that's fine */ });
          return cached;
        }
        // Not cached — fetch normally
        return fetch(event.request);
      }).catch(() => fetch(event.request))
    );
    return;
  }

  // For navigation requests (page loads), use preload response or fetch
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        // Try navigation preload first (prevents error flash during SW activation)
        try {
          const preloadResponse = await event.preloadResponse;
          if (preloadResponse) return preloadResponse;
        } catch (e) { /* preload not available */ }
        // Normal fetch with offline fallback
        try {
          return await fetch(event.request);
        } catch (e) {
          try {
            const cache = await safeOpenCache(CACHE_NAME);
            if (cache) {
              const cached = await cache.match('/offline.html');
              if (cached) return cached;
              const indexCached = await cache.match('/index.html');
              if (indexCached) return indexCached;
            }
          } catch (err) {}
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // For all other requests, use network-first
  // (don't cache other API calls like messages, posts, etc.)
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received:', event);
  
  let notificationData = {
    title: 'Raw Surf OS',
    body: 'You have a new notification',
    icon: '/logo.svg',
    badge: '/logo.svg',
    tag: 'rawsurf-notification',
    data: {}
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      notificationData = {
        title: payload.title || notificationData.title,
        body: payload.body || notificationData.body,
        icon: payload.icon || notificationData.icon,
        badge: payload.badge || notificationData.badge,
        tag: payload.tag || notificationData.tag,
        data: payload.data || {},
        vibrate: [200, 100, 200],
        requireInteraction: payload.requireInteraction || false
      };
    } catch (e) {
      console.error('[ServiceWorker] Error parsing push data:', e);
      notificationData.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      data: notificationData.data,
      vibrate: notificationData.vibrate,
      requireInteraction: notificationData.requireInteraction,
      actions: [
        { action: 'view', title: 'View' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    }).catch(err => {
      console.warn('[ServiceWorker] showNotification failed:', err);
    })
  );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click:', event);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  let targetUrl = '/';
  
  // Route based on notification type
  if (data.type === 'surf_alert') {
    // ⛔ THIS SENT `/map?spot=${data.spot_id}` AND NOTHING READ THAT PARAMETER. `MapPage.js` and all
    // of `components/map/` contain zero useSearchParams / location.search / URLSearchParams —
    // positive control: 19 files elsewhere in src DO use useSearchParams. So tapping the push
    // landed the user on a generic map at whatever viewport they left, while the SAME notification
    // arriving in-app went to `/alerts?alert_id=` (utils/notificationDeepLinks.js:210-214). One
    // notification, two destinations, and the push's one was inert.
    // ⇒ Aligned with the in-app rule, which IS consumed: SurfAlerts.js:90 reads
    //   `searchParams.get('alert_id')`. Same fallback, so an older payload without alert_id still
    //   lands somewhere real rather than on a dead query string.
    targetUrl = data.alert_id ? `/alerts?alert_id=${data.alert_id}` : '/alerts';
  } else if (data.type === 'new_message') {
    targetUrl = `/messages`;
  } else if (data.type === 'session_join') {
    targetUrl = `/map`;
  } else if (data.type === 'new_follower') {
    targetUrl = `/profile`;
  } else {
    targetUrl = '/notifications';
  }

  // Route action buttons
  if (event.action === 'view') {
    // Use the targetUrl determined above
  } else if (event.action === 'dismiss') {
    return; // Just close the notification
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Open a new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Push subscription change event
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[ServiceWorker] Push subscription changed');
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey
    }).then((subscription) => {
      // Re-send subscription to server
      console.log('[ServiceWorker] Re-subscribed:', subscription);
    }).catch(err => {
      console.warn('[ServiceWorker] Push subscription change re-subscribe failed:', err);
    })
  );
});

// Message handler for cache control from the app
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'CACHE_SPOTS') {
    // Manually trigger caching of spot data
    event.waitUntil(
      safeOpenCache(SPOT_CACHE_NAME).then(async (cache) => {
        if (!cache) throw new Error('CacheStorage not available');
        const spotsUrl = new URL('/api/surf-spots', self.location.origin);
        const response = await fetch(spotsUrl);
        if (response.ok) {
          await cache.put(spotsUrl, response.clone());
          // Notify client that caching is complete
          event.source.postMessage({ type: 'SPOTS_CACHED', success: true });
        }
      }).catch(err => {
        event.source.postMessage({ type: 'SPOTS_CACHED', success: false, error: err.message });
      })
    );
  }
  
  if (event.data && event.data.type === 'CLEAR_SPOT_CACHE') {
    event.waitUntil(
      caches.delete(SPOT_CACHE_NAME).then(() => {
        event.source.postMessage({ type: 'SPOT_CACHE_CLEARED', success: true });
      }).catch(err => {
        event.source.postMessage({ type: 'SPOT_CACHE_CLEARED', success: false, error: err.message });
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil(
      safeOpenCache(SPOT_CACHE_NAME).then(async (cache) => {
        if (!cache) {
          event.source.postMessage({ type: 'CACHE_STATUS', count: 0, cached: false });
          return;
        }
        const keys = await cache.keys();
        event.source.postMessage({ 
          type: 'CACHE_STATUS', 
          count: keys.length,
          cached: keys.length > 0
        });
      }).catch(err => {
        event.source.postMessage({ 
          type: 'CACHE_STATUS', 
          count: 0,
          cached: false,
          error: err.message
        });
      })
    );
  }
});

console.log('[ServiceWorker] Loaded with offline support');
