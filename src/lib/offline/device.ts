/**
 * SMARTBUZ — till identity
 *
 * Every installation (every browser profile on every till) gets a stable
 * device id. The server uses it to allow-list tills, and it is stamped on
 * every queued transaction so a sale can always be traced back to the
 * machine that made it.
 *
 * The id is stored in the IndexedDB `meta` store, NOT in localStorage: the
 * database survives a browser restart and a crash, and it is not wiped by
 * the browser's "clear site data on low disk" heuristics.
 *
 * Ids are generated with `crypto.getRandomValues`, never `Math.random`:
 * `Math.random` is not collision-safe and a colliding transaction id would
 * silently drop a real sale.
 */

import { readMeta, writeMeta } from "./db";
import type { DeviceInfo } from "./types";

const DEVICE_ID_KEY = "deviceId";

const DEFAULT_APP_VERSION = "1.0.0";

/**
 * Cached in-flight promise so two concurrent callers can never generate two
 * different device ids.
 */
let deviceIdPromise: Promise<string> | null = null;

/** `SBZ-` + 16 hex characters (64 bits of entropy). */
function generateDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `SBZ-${hex}`.toUpperCase();
}

/**
 * The stable id of this installation.
 *
 * Reads the persisted id; if there is none, generates one, stores it and
 * returns it. Concurrent calls share a single promise and therefore return
 * the same id.
 */
export function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const existing = await readMeta<string>(DEVICE_ID_KEY);
      if (typeof existing === "string" && existing.length > 0) {
        return existing;
      }
      const fresh = generateDeviceId();
      await writeMeta(DEVICE_ID_KEY, fresh);
      return fresh;
    })().catch((error: unknown) => {
      // Do not cache a failure: the next caller must be able to retry.
      deviceIdPromise = null;
      throw error;
    });
  }
  return deviceIdPromise;
}

/**
 * Generate and persist a brand new device id.
 *
 * Used when the server rejects this installation ("device not allowed"), e.g.
 * after a till is rebuilt or re-imaged.
 */
export async function resetDeviceId(): Promise<string> {
  const fresh = generateDeviceId();
  await writeMeta(DEVICE_ID_KEY, fresh);
  deviceIdPromise = Promise.resolve(fresh);
  return fresh;
}

/** A short, human-readable label for the platform the till runs on. */
function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";

  const ua = navigator.userAgent || "";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  if (ua.length === 0) return "unknown";

  // Unknown agent: keep it short enough to be stored and displayed.
  return ua.slice(0, 64);
}

function detectAppVersion(): string {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return typeof version === "string" && version.length > 0
    ? version
    : DEFAULT_APP_VERSION;
}

/** Identity of this installation, for the sync payload and for display. */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const deviceId = await getDeviceId();
  return {
    deviceId,
    platform: detectPlatform(),
    appVersion: detectAppVersion(),
  };
}
