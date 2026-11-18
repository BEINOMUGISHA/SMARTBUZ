/**
 * SMARTBUZ — connectivity detection for the offline till
 *
 * `navigator.onLine` is not a reliable answer: it reports "online" whenever
 * the machine merely has a network interface up, which is exactly what
 * happens behind a captive portal or a dead uplink in a Ugandan branch
 * office. The only trustworthy signal is whether a real HTTP request
 * actually completes.
 *
 * So the heartbeat below performs a cheap request against a static asset
 * (`/manifest.json`) with `cache: "no-store"`. Only a real HTTP response
 * counts as "online"; a timeout, an abort or a network error means the till
 * is effectively offline, even if the OS says otherwise.
 */

/** A cheap, static, always-present asset used as the heartbeat target. */
const HEARTBEAT_URL = "/manifest.json";

/** How long a single heartbeat may take before it is considered failed. */
const DEFAULT_TIMEOUT_MS = 5000;

/** How often the heartbeat runs while a connectivity watcher is active. */
const HEARTBEAT_INTERVAL_MS = 20000;

/**
 * The browser's own opinion about the network.
 *
 * Cheap and instant, but treat it as a hint only — a captive portal still
 * reports `true`.
 */
export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine;
}

/**
 * The heartbeat: actually talk to the server.
 *
 * @param timeoutMs how long to wait before giving up.
 * @returns true only when an HTTP response came back.
 */
export async function checkConnectivity(
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<boolean> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return false;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Any HTTP response (even 404) proves the network path is alive.
    await window.fetch(HEARTBEAT_URL, {
      cache: "no-store",
      signal: controller.signal,
      credentials: "omit",
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Watch connectivity and report every real change.
 *
 * Combines the browser's `online`/`offline` events with a periodic
 * heartbeat, because the events alone fire far too rarely in practice (and
 * not at all when a captive portal swallows the connection). The callback is
 * invoked only when the state actually changes.
 *
 * @returns a cleanup function that removes the listeners and the timer.
 */
export function watchConnectivity(
  callback: (online: boolean) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let lastState: boolean | null = null;

  const emit = (online: boolean): void => {
    if (online === lastState) return;
    lastState = online;
    callback(online);
  };

  const handleOnline = (): void => emit(true);
  const handleOffline = (): void => emit(false);

  const probe = (): void => {
    void checkConnectivity().then(
      (online) => emit(online),
      () => emit(false)
    );
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  const timer = window.setInterval(probe, HEARTBEAT_INTERVAL_MS);

  // Report the state as it is right now, so a UI mounted while offline does
  // not have to wait for the first heartbeat.
  probe();

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.clearInterval(timer);
  };
}
