"use client";

import { useEffect } from "react";

/**
 * Registers the SMART_BUZ service worker — production only.
 *
 * The worker is versioned by its cache name, so a new deploy is picked up on
 * the next load. `updateViaCache: "none"` stops the browser from serving a
 * stale sw.js from the HTTP cache, and SKIP_WAITING hands control to the new
 * worker immediately instead of waiting for every tab to be closed.
 *
 * Development is deliberately excluded, and this matters more than it looks.
 * The worker answers same-origin GETs cache-first. In production that is
 * safe because every `/_next/static` URL is content-hashed, so a changed
 * file means a changed URL. In development it is not: Turbopack keeps the
 * *same* chunk URL across rebuilds and pushes the new code over the HMR
 * channel instead. The worker therefore replays the bundle it cached before
 * the edit against HTML the server has just rendered from the new code, and
 * React reports a hydration mismatch — which is exactly what was happening
 * on the login hero image, whose `sizes` prop the stale bundle did not know
 * about. It also defeats hot reloading, which is the whole point of dev mode.
 *
 * Any worker left behind by an earlier session is unregistered and its
 * caches are dropped, so a stale worker cannot keep serving old bundles
 * after this change lands.
 */
export function ServiceWorkerRegistration() {
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;

        if (process.env.NODE_ENV !== "production") {
            // Heal a worker installed by an earlier session: it would
            // otherwise keep serving stale bundles for as long as it stays
            // installed.
            navigator.serviceWorker
                .getRegistrations()
                .then((registrations) =>
                    Promise.all(registrations.map((registration) => registration.unregister()))
                )
                .catch(() => {
                    // Nothing to heal.
                });

            if ("caches" in window) {
                caches
                    .keys()
                    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
                    .catch(() => {
                        // Nothing to clear.
                    });
            }

            return;
        }

        const register = () => {
            navigator.serviceWorker
                .register("/sw.js", { updateViaCache: "none" })
                .then((registration) => {
                    console.log("Service Worker registered: ", registration);

                    registration.addEventListener("updatefound", () => {
                        const installing = registration.installing;
                        if (!installing) return;
                        installing.addEventListener("statechange", () => {
                            if (installing.state === "installed" && navigator.serviceWorker.controller) {
                                // A newer worker is waiting: take over now.
                                installing.postMessage("SKIP_WAITING");
                            }
                        });
                    });
                })
                .catch((registrationError) => {
                    console.log("Service Worker registration failed: ", registrationError);
                });
        };

        if (document.readyState === "complete") {
            register();
        } else {
            window.addEventListener("load", register, { once: true });
        }
    }, []);

    return null;
}
