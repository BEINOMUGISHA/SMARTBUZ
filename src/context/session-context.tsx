/**
 * SMARTBUZ Session Context
 *
 * The session itself lives in an HttpOnly signed cookie issued by the
 * Next.js server (POST /api/auth). This context rehydrates it on load and
 * holds the two things the sign-in screens need: the signed-in address,
 * and the two actions that open and close a session.
 *
 * It is deliberately separate from the auth context, and deliberately free
 * of any Convex import.
 *
 * Why it matters: the sign-in route is the first thing the product does for
 * a stranger, and the performance audit found that it was downloading the
 * whole Convex client — 24 KB gzipped of it — only to let a person type
 * an email address and a password. The Convex client is needed to *read*
 * the business data behind an open session, and the sign-in screens do not
 * read any business data. So the part of the session that the sign-in
 * screens need lives here, with no Convex in it, and the part that does
 * need Convex lives in `auth-context.tsx` and is only mounted on the
 * authenticated routes.
 *
 * The sign-in action itself never needed Convex: it posts to /api/auth,
 * and the server calls the backend.
 */

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import {
  cacheSession,
  clearCachedSession,
  getSessionCacheServerSnapshot,
  getSessionCacheSnapshot,
  subscribeSessionCache,
  type CachedSession,
} from "@/lib/offline/session-cache";

export type SessionContextType = {
  /**
   * The address of the signed-in person, or null when nobody is signed in.
   *
   * It is null until the server has been asked and has answered, so "not
   * known yet" and "known to be signed out" look the same. `isRestoring`
   * tells the two apart.
   */
  email: string | null;
  /** The server has not answered yet. */
  isRestoring: boolean;
  /**
   * The last session the server confirmed, kept locally.
   *
   * A till with no network still has to come up so the cashier can sell.
   * The cache is only a fallback: it never grants anything the server
   * would not grant, it just lets the interface show the right screen
   * while the server cannot be asked.
   */
  cachedSession: CachedSession | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /**
   * Remember the session, so that a till which loses its network still
   * knows who is at it.
   *
   * Called by the auth context once the server has confirmed the session.
   */
  rememberSession: (snapshot: {
    email: string;
    user: Record<string, unknown>;
    businesses: unknown[];
    activeBusiness: unknown;
    permissions: string[];
  }) => void;
  /**
   * Forget the session.
   *
   * Called when the server has answered and says the session is no good.
   * An *unanswered* server does not sign the cashier out — that would lose
   * their queue.
   */
  clearSession: () => void;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  /**
   * The address the server confirmed, if any.
   *
   * It is null until the server has answered. The address of the cached
   * session is folded in below, so that a till which is cut off still
   * knows who is at it.
   */
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const router = useRouter();

  /**
   * The cached session, watched rather than copied.
   *
   * Reading it as an external store means the component re-renders when
   * the cache changes, without anyone having to copy it into state by
   * hand — and without the first render of the page disagreeing with the
   * server's, which is what a plain `useState(readCachedSession())` would
   * do on a page that is served from a cache.
   */
  const cachedSession = useSyncExternalStore(
    subscribeSessionCache,
    getSessionCacheSnapshot,
    getSessionCacheServerSnapshot
  );

  const email = confirmedEmail ?? cachedSession?.email ?? null;

  // Ask the server who is signed in. The cached session stands until the
  // server can be reached again.
  useEffect(() => {
    fetch("/api/auth", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data?.user?.email) {
          setConfirmedEmail(data.user.email);
        }
      })
      .catch(() => {
        // No network. The cached session stands until the server can be
        // reached again.
      })
      .finally(() => setIsRestoring(false));
  }, []);

  const clearSession = useCallback(() => {
    setConfirmedEmail(null);
    clearCachedSession();
  }, []);

  const rememberSession = useCallback(
    (snapshot: {
      email: string;
      user: Record<string, unknown>;
      businesses: unknown[];
      activeBusiness: unknown;
      permissions: string[];
    }) => {
      cacheSession(snapshot);
    },
    []
  );

  const login = useCallback(
    async (newEmail: string, password: string) => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: newEmail.trim().toLowerCase(), password }),
        });

        const data = await res.json();

        if (data.success && data.user?.email) {
          setConfirmedEmail(data.user.email);
          router.push("/");
          return { success: true };
        }
        return { success: false, error: data.error || "Authentication failed" };
      } catch {
        return { success: false, error: "Network error. Please try again." };
      }
    },
    [router]
  );

  const logout = useCallback(async () => {
    clearCachedSession();
    setConfirmedEmail(null);
    await fetch("/api/auth?action=logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    router.push("/auth/login");
  }, [router]);

  return (
    <SessionContext.Provider
      value={{
        email,
        isRestoring,
        cachedSession,
        login,
        logout,
        rememberSession,
        clearSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
};
