/**
 * SMART_BUZ — service worker
 *
 * Two rules drive everything here:
 *
 *  1. Never cache or replay a redirect. A cached 30x response carries the
 *     `redirected` flag, and the browser refuses it for a navigation whose
 *     redirect mode is not "follow":
 *     "a redirected response was used for a request whose redirect mode is
 *     not follow". That is what broke the app root.
 *  2. HTML navigations are network-first. The till must always run the code
 *     that was just deployed, and an authenticated shell should never be
 *     replayed from a stale cache. Static assets stay cache-first with a
 *     background refresh.
 *  3. API responses are never cached. /api/auth answers "who am I", and a
 *     cached copy of that is session data sitting in Cache Storage where it
 *     can outlive the session it belongs to.
 */

const CACHE_VERSION = "v5";
const CACHE_NAME = `smartbuz-${CACHE_VERSION}`;

/** Only real, cacheable assets are precached. "/" is deliberately absent. */
const PRECACHE_URLS = ["/manifest.json", "/logo.ico"];

/** A response we are willing to store. */
function isCacheable(response) {
    return Boolean(
        response &&
        response.ok &&
        !response.redirected &&
        response.type !== "opaqueredirect" &&
        response.status !== 304
    );
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await Promise.allSettled(
                PRECACHE_URLS.map(async (url) => {
                    try {
                        const response = await fetch(url, { cache: "reload" });
                        if (isCacheable(response)) {
                            await cache.put(url, response);
                        }
                    } catch {
                        // A missing optional asset must not fail the install.
                    }
                })
            );
            await self.skipWaiting();
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("message", (event) => {
    if (event.data === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    // Only GET is cacheable. Everything else (Convex mutations, uploads)
    // goes straight to the network.
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Cross-origin requests (the Convex deployment, CDNs) are never served
    // from our cache.
    if (url.origin !== self.location.origin) return;

    // API responses are never cached or replayed. /api/auth answers "who am
    // I"; a cached copy of that is session data left sitting in Cache
    // Storage, and a cached report could be shown after the data changed.
    if (url.pathname.startsWith("/api/")) return;

    // The worker script itself is never cached. The spec already routes the
    // script fetch around the worker, but being explicit means a stale
    // sw.js can never be replayed to a browser and leave an old worker
    // installed forever.
    if (url.pathname === "/sw.js") return;

    // Navigations: network-first, but the browser must stay in charge of
    // redirects.
    //
    // A navigation request has redirect mode "manual", and the browser
    // refuses any response that carries the `redirected` flag:
    //   "a redirected response was used for a request whose redirect mode is
    //    not follow"
    // That happens as soon as the worker follows the redirect itself and
    // hands the result back. So when the fetch was redirected we hand the
    // redirect back to the browser instead, and the address bar still ends
    // up on the right URL.
    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(url.href, {
                        redirect: "follow",
                        credentials: "same-origin",
                        headers: request.headers,
                    });

                    if (response.redirected) {
                        const target = response.url;
                        if (target && target !== url.href) {
                            // Let the browser perform the redirect itself.
                            return Response.redirect(target, 307);
                        }
                        // Last resort: same URL, so serve the body without the
                        // `redirected` flag the browser would reject.
                        return new Response(response.body, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                        });
                    }

                    if (isCacheable(response)) {
                        const copy = response.clone();
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(request, copy);
                    }

                    return response;
                } catch {
                    // Offline: fall back to the last good shell.
                    const cached = await caches.match(request);
                    if (cached && isCacheable(cached)) return cached;
                    return new Response(
                        "<!doctype html><html><head><meta charset='utf-8'><title>Offline</title></head>" +
                            "<body style='font-family:system-ui;padding:2rem;text-align:center'>" +
                            "<h1>You are offline</h1>" +
                            "<p>Reconnect to continue selling. Sales saved offline sync automatically.</p>" +
                            "</body></html>",
                        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
                    );
                }
            })()
        );
        return;
    }

    // React Server Component payloads.
    //
    // Next.js asks for these when the router navigates, and when the page is
    // rehydrated. They are the data behind the page, so without them a till
    // that is reopened offline would come up with a shell and no content.
    //
    // Network-first, with the cache as a fallback: a freshly deployed page
    // is preferred, but a till that has already been open keeps working.
    if (request.headers.get("RSC") === "1") {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(url.href, {
                        credentials: "same-origin",
                        headers: request.headers,
                    });
                    if (isCacheable(response)) {
                        const copy = response.clone();
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(request, copy);
                    }
                    return response;
                } catch {
                    const cached = await caches.match(request);
                    if (cached) return cached;
                    return new Response("", {
                        status: 504,
                        headers: { "Content-Type": "text/plain; charset=utf-8" },
                    });
                }
            })()
        );
        return;
    }

    // Static assets: cache-first, refreshed in the background.
    event.respondWith(
        (async () => {
            const cached = await caches.match(request);

            const network = fetch(request)
                .then(async (response) => {
                    if (isCacheable(response)) {
                        const copy = response.clone();
                        const cache = await caches.open(CACHE_NAME);
                        await cache.put(request, copy);
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })()
    );
});
