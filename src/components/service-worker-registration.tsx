"use client";

import { useEffect } from "react";

/**
 * Registers the SMART_BUZ service worker.
 *
 * The worker is versioned by its cache name, so a new deploy is picked up on
 * the next load. `updateViaCache: "none"` stops the browser from serving a
 * stale sw.js from the HTTP cache, and SKIP_WAITING hands control to the new
 * worker immediately instead of waiting for every tab to be closed — without
 * it, users stayed on the broken worker until they cleared site data.
 */
export function ServiceWorkerRegistration() {
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;

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
