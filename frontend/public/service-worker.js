// Raw Surf OS Service Worker for Push Notifications and Offline Mode
const CACHE_NAME = 'rawsurf-v2';
const SPOT_CACHE_NAME = 'rawsurf-spots-v1';
const OFFLINE_CACHE_NAME = 'rawsurf-offline-v1';
const GALLERY_CACHE_NAME = 'rawsurf-gallery-offline-v1';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// API endpoints to cache for offline mode
const OFFLINE_API_PATTERNS = [
  '/api/surf-spots',
  '/api/surf-spots/search',
  '/api/spots-in-bounds'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install - caching static assets');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.log('[ServiceWorker] Static cache failed (expected in dev):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME && key !== SPOT_CACHE_NAME && key !== OFFLINE_CACHE_NAME && key !== GALLERY_CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch event - implement offline-first strategy for spots
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Check if this is an API request we want to cache for offline
  const isOfflineAPI = OFFLINE_API_PATTERNS.some(pattern => url.pathname.includes(pattern));
  
  if (isOfflineAPI) {
    // Network-first with cache fallback for spot data
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone the response for caching
          const responseClone = response.clone();
          caches.open(SPOT_CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
            console.log('[ServiceWorker] Cached spot data:', url.pathname);
          });
          return response;
        })
        .catch(async () => {
          // Network failed, try cache
          console.log('[ServiceWorker] Offline - serving from cache:', url.pathname);
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
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
      caches.open(GALLERY_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Cache hit — serve from cache (works offline)
          // Also try network in background to refresh
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
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

  // For all other requests, use network-first
  // (don't cache other API calls like messages, posts, etc.)
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received:', event);
  
  let notificationData = {
    title: 'Raw Surf OS',
    body: 'You have a new notification',
    icon: 'https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png',
    badge: 'https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png',
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
    targetUrl = `/map?spot=${data.spot_id}`;
  } else if (data.type === 'new_message') {
    targetUrl = `/messages`;
  } else if (data.type === 'session_join') {
    targetUrl = `/map`;
  } else if (data.type === 'new_follower') {
    targetUrl = `/profile`;
  } else {
    targetUrl = '/notifications';
  }

  // Handle action buttons
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
    })
  );
});

// Message handler for cache control from the app
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'CACHE_SPOTS') {
    // Manually trigger caching of spot data
    event.waitUntil(
      caches.open(SPOT_CACHE_NAME).then(async (cache) => {
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
      })
    );
  }
  
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    event.waitUntil(
      caches.open(SPOT_CACHE_NAME).then(async (cache) => {
        const keys = await cache.keys();
        event.source.postMessage({ 
          type: 'CACHE_STATUS', 
          count: keys.length,
          cached: keys.length > 0
        });
      })
    );
  }
});

console.log('[ServiceWorker] Loaded with offline support');
