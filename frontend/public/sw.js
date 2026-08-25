// ═══════════════════════════════════════════════════════════════════
// RHoSAM PWA Service Worker v2
// Features: Versioned caching, asset precaching, offline fallback,
//           background sync, periodic sync, stale-while-revalidate
// ═══════════════════════════════════════════════════════════════════

const CACHE_VERSION = "v2";
const STATIC_CACHE = `rhosam-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `rhosam-dynamic-${CACHE_VERSION}`;
const OFFLINE_CACHE = `rhosam-offline-${CACHE_VERSION}`;
const API_CACHE = `rhosam-api-${CACHE_VERSION}`;

// Max items in dynamic/API caches
const MAX_DYNAMIC_ITEMS = 100;
const MAX_API_ITEMS = 50;

// Assets to pre-cache on install (critical app shell)
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/offline.html",
  "/favicon.svg",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// ═══════════════════════════════════════════════════════════════════
// INSTALL — Pre-cache critical assets
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] Pre-caching app shell");
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// ═══════════════════════════════════════════════════════════════════
// ACTIVATE — Clean old caches
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        const validCaches = [STATIC_CACHE, DYNAMIC_CACHE, OFFLINE_CACHE, API_CACHE];
        return Promise.all(
          cacheNames
            .filter((name) => !validCaches.includes(name))
            .map((name) => {
              console.log("[SW] Deleting old cache:", name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Claim all clients immediately
        return self.clients.claim();
      })
  );
});

// ═══════════════════════════════════════════════════════════════════
// FETCH — Smart caching strategies per request type
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome-extension URLs
  if (request.method !== "GET" || url.protocol === "chrome-extension:") {
    return;
  }

  // Skip API calls (except cached GET requests for offline)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Navigation requests — network first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Static assets (JS, CSS, fonts, images) — stale-while-revalidate
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Other requests — network first, cache fallback
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// ═══════════════════════════════════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════════════════════════════════

// Navigation: Network first, cache fallback, offline page
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback
    return caches.match("/offline.html") || new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// API: Network first, cache for offline reads (GET only)
async function handleApiRequest(request) {
  try {
    const response = await fetch(request);
    // Cache successful GET responses for offline
    if (response.ok && request.method === "GET") {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
      await trimCache(API_CACHE, MAX_API_ITEMS);
    }
    return response;
  } catch {
    // Return cached version for offline
    const cached = await caches.match(request);
    if (cached) {
      // Add offline indicator header
      const offlineResponse = new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: {
          ...Object.fromEntries(cached.headers.entries()),
          "X-From-Cache": "true",
          "X-Offline": "true",
        },
      });
      return offlineResponse;
    }
    // No cache, return offline error
    return new Response(
      JSON.stringify({ message: "Offline — data may be stale", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Stale-while-revalidate: Return cache immediately, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// Network first with cache fallback
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      await trimCache(cacheName, MAX_DYNAMIC_ITEMS);
    }
    return response;
  } catch {
    return caches.match(request);
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function isStaticAsset(pathname) {
  return (
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2") ||
    pathname.endsWith(".ttf") ||
    pathname.endsWith(".ico") ||
    pathname.includes("/assets/")
  );
}

// Trim cache to max items (FIFO eviction)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// BACKGROUND SYNC — Queue failed requests for retry
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-sales") {
    event.waitUntil(syncQueuedSales());
  }
});

async function syncQueuedSales() {
  try {
    const cache = await caches.open("rhosam-sync-queue");
    const requests = await cache.keys();
    for (const request of requests) {
      const body = await (await cache.match(request)).json();
      await fetch(request, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await cache.delete(request);
    }
    // Notify clients that sync completed
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: "SYNC_COMPLETE" });
    });
  } catch (e) {
    console.error("[SW] Sync failed:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "RHoSAM", body: event.data.text() };
  }

  const options = {
    body: data.body || "You have a new notification",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-72x72.png",
    vibrate: [100, 50, 100],
    data: { url: data.url || "/" },
    actions: data.actions || [],
    tag: data.tag || "rhosam-notification",
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "RHoSAM POS", options)
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICKED", url });
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});

// ═══════════════════════════════════════════════════════════════════
// MESSAGE HANDLER — Communication with main app
// ═══════════════════════════════════════════════════════════════════
self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_VERSION":
      event.ports[0]?.postMessage({ version: CACHE_VERSION });
      break;

    case "CLEAR_CACHES":
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      ).then(() => {
        event.ports[0]?.postMessage({ cleared: true });
      });
      break;

    case "CACHE_URLS":
      if (Array.isArray(payload)) {
        caches.open(DYNAMIC_CACHE).then((cache) =>
          cache.addAll(payload)
        );
      }
      break;

    default:
      break;
  }
});
