/**
 * SMARTBUZ Auth Context
 *
 * The session itself lives in an HttpOnly signed cookie issued by the
 * Next.js server (POST /api/auth). This context rehydrates it on load and
 * exposes the signed-in user, the businesses they belong to, and the
 * business they are currently working in.
 *
 * The user record is fetched from Convex with `users.me`, which derives the
 * caller from the verified access token — never from an email the browser
 * sends. (It used to be `users.getByEmail`, which meant the browser chose
 * whose record to read.)
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { can, canAll, canAny, type Permission } from "@/lib/permissions";
import {
  cacheSession,
  clearCachedSession,
  readCachedSession,
  type CachedSession,
} from "@/lib/offline/session-cache";

type User = {
  _id: Id<"users">;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  roles: string[];
  phone_number?: string;
  activeBusinessId?: Id<"businesses">;
  /** "active" | "pending_verification" | "suspended" */
  status?: string;
  emailVerified?: boolean;
};

type BusinessSummary = {
  business: {
    _id: Id<"businesses">;
    name: string;
    categoryId?: string;
    currency?: string;
    timezone?: string;
    status?: string;
  };
  role: string;
  isActive: boolean;
};

type AuthContextType = {
  user: User | null;
  /** Every business the signed-in user belongs to. */
  businesses: BusinessSummary[];
  /** The business the user is currently working in. */
  activeBusiness: BusinessSummary["business"] & { role: string } | null;
  /**
   * The permissions the user holds in the active business.
   *
   * Reported by the backend. Used to hide what the person may not do —
   * never to decide whether they may do it.
   */
  permissions: readonly string[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Does the user hold this role in the active business? */
  checkRole: (roles: string[]) => boolean;
  /** May the user perform this action in the active business? */
  can: (permission: Permission) => boolean;
  /** May the user perform at least one of these actions? */
  canAny: (permissions: readonly Permission[]) => boolean;
  /** May the user perform all of these actions? */
  canAll: (permissions: readonly Permission[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [email, setEmail] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  /**
   * The last session the server confirmed, kept locally.
   *
   * A till with no network still has to come up so the cashier can sell.
   * The cache is only a fallback: it never grants anything the server
   * would not grant, it just lets the interface show the right screen
   * while the server cannot be asked.
   */
  const [cachedSession, setCachedSession] = useState<CachedSession | null>(null);
  const router = useRouter();

  // Rehydrate session from the server-side cookie on mount, falling back
  // to the locally cached session when the server cannot be reached.
  useEffect(() => {
    const cached = readCachedSession();
    if (cached) {
      setCachedSession(cached);
      setEmail(cached.email);
    }

    fetch("/api/auth", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data?.user?.email) {
          setEmail(data.user.email);
        }
      })
      .catch(() => {
        // No network. The cached session stands until the server can be
        // reached again.
      })
      .finally(() => setIsRestoring(false));
  }, []);

  // The caller is derived from the signed access token, not from the email.
  const liveMe = useQuery(api.users.me, email ? {} : "skip");

  // Remember the session as soon as the server confirms it, so the next
  // time the network goes the till still knows who is at it.
  useEffect(() => {
    if (!liveMe?.user || !email) return;
    const snapshot = {
      email,
      user: liveMe.user as unknown as Record<string, unknown>,
      businesses: liveMe.businesses ?? [],
      activeBusiness: liveMe.activeBusiness ?? null,
      permissions: (liveMe.permissions as string[]) ?? [],
    };
    setCachedSession({ ...snapshot, cachedAt: new Date().toISOString() });
    cacheSession(snapshot);
  }, [liveMe, email]);

  // The live session when there is one; the cached one when the server
  // cannot be reached.
  const me = liveMe ?? cachedSession;

  const user = (me?.user as User | undefined) ?? null;
  const businesses: BusinessSummary[] = (me?.businesses as BusinessSummary[]) ?? [];
  const activeBusiness =
    (me?.activeBusiness as AuthContextType["activeBusiness"]) ?? null;
  const permissions: readonly string[] = (me?.permissions as string[] | undefined) ?? [];

  const isLoading = isRestoring || (email !== null && me === undefined);

  // If the server has answered and says the session is no good, the local
  // state goes too. An unanswered server (no network) does not sign the
  // cashier out — that would lose their queue.
  useEffect(() => {
    if (!isLoading && email && liveMe === null) {
      setEmail(null);
      setCachedSession(null);
      clearCachedSession();
    }
  }, [liveMe, isLoading, email]);

  const login = useCallback(async (newEmail: string, password: string) => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: newEmail.trim().toLowerCase(), password }),
      });

      const data = await res.json();

      if (data.success && data.user?.email) {
        setEmail(data.user.email);
        router.push("/");
        return { success: true };
      }
      return { success: false, error: data.error || "Authentication failed" };
    } catch {
      return { success: false, error: "Network error. Please try again." };
    }
  }, [router]);

  const logout = useCallback(async () => {
    clearCachedSession();
    setCachedSession(null);
    await fetch("/api/auth?action=logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    setEmail(null);
    router.push("/auth/login");
  }, [router]);

  /**
   * Does the user hold one of these roles in the active business?
   *
   * The role lives on the membership, not on the legacy global roles array
   * on the user record.
   */
  const checkRole = useCallback(
    (allowedRoles: string[]) => {
      const role = activeBusiness?.role;
      if (!role) return false;
      return allowedRoles.includes(role);
    },
    [activeBusiness]
  );

  const canDo = useCallback(
    (permission: Permission) => can(permissions, permission),
    [permissions]
  );

  const canDoAny = useCallback(
    (required: readonly Permission[]) => canAny(permissions, required),
    [permissions]
  );

  const canDoAll = useCallback(
    (required: readonly Permission[]) => canAll(permissions, required),
    [permissions]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        businesses,
        activeBusiness,
        permissions,
        isLoading,
        login,
        logout,
        checkRole,
        can: canDo,
        canAny: canDoAny,
        canAll: canDoAll,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
