"use client";
/**
 * SMARTBUZ Auth Context
 *
 * The signed-in person, the businesses they belong to, the business they
 * are currently working in, and the permissions they hold there.
 *
 * The user record is fetched from Convex with `users.me`, which derives the
 * caller from the verified access token — never from an email the browser
 * sends. (It used to be `users.getByEmail`, which meant the browser chose
 * whose record to read.)
 *
 * This context needs the Convex client, so it is mounted only on the
 * authenticated routes. The session itself — the cookie, the address, the
 * sign-in and sign-out actions — lives in `session-context.tsx`, which has
 * no Convex in it and is mounted everywhere. The split exists so that the
 * sign-in route does not have to download the Convex client in order to let
 * somebody type a password.
 */


import React, {
    createContext,
    useContext,
    useEffect,
    useCallback,
    useMemo,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { can, canAll, canAny, type Permission } from "@/lib/permissions";
import { useSession } from "@/context/session-context";

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
    currencySymbol?: string;
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
  const { email, isRestoring, cachedSession, login, logout, rememberSession, clearSession } =
    useSession();

  // The caller is derived from the signed access token, not from the email.
  const liveMe = useQuery(api.users.me, email ? {} : "skip");

  // Remember the session as soon as the server confirms it, so the next
  // time the network goes the till still knows who is at it.
  //
  // The dependency is the *content* of the session, not the identity of the
  // object it arrives in. Convex hands back a fresh object on every update,
  // so an identity-based dependency re-wrote the cache on every render —
  // which woke every subscriber of the cache, which re-read the session,
  // which came back as a fresh object again.
  const sessionContent = useMemo(() => {
    if (!liveMe?.user || !email) return null;
    return JSON.stringify({
      email,
      user: liveMe.user,
      businesses: liveMe.businesses ?? [],
      activeBusiness: liveMe.activeBusiness ?? null,
      permissions: liveMe.permissions ?? [],
    });
  }, [liveMe, email]);

  useEffect(() => {
    if (!sessionContent) return;
    rememberSession(JSON.parse(sessionContent));
  }, [sessionContent, rememberSession]);

  // The live session when there is one; the cached one when the server
  // cannot be reached.
  //
  // `me` is `null` rather than `undefined` while the query is in flight and
  // nothing has been cached yet, so it must not be used to decide whether the
  // session is still being confirmed. See `isLoading` below.
  const me = liveMe ?? cachedSession;

  const user = (me?.user as User | undefined) ?? null;
  const businesses: BusinessSummary[] = (me?.businesses as BusinessSummary[]) ?? [];
  const activeBusiness =
    (me?.activeBusiness as AuthContextType["activeBusiness"]) ?? null;
  const permissions: readonly string[] = (me?.permissions as string[] | undefined) ?? [];

  /**
   * Is the session still being confirmed?
   *
   * `liveMe` is `undefined` while the query is in flight and `null` once the
   * server has answered that there is no session. Those are different
   * answers, and the difference matters: a cold load — a new tab, a hard
   * refresh, a new device — has no cached session, so `me` is `null` the
   * whole time the query is running.
   *
   * Testing `me === undefined` here meant the loading state ended before the
   * session had been confirmed, `user` was `null`, and the dashboard layout
   * signed the person out and sent them to the sign-in screen. It only
   * worked on a warm load, where a cached session happened to be present.
   *
   * So the question is asked of the query, which is the thing that is
   * actually pending.
   */
  const isLoading = isRestoring || (email !== null && liveMe === undefined);

  // If the server has answered and says the session is no good, the local
  // state goes too. An unanswered server (no network) does not sign the
  // cashier out — that would lose their queue.
  useEffect(() => {
    if (!isLoading && email && liveMe === null) {
      clearSession();
    }
  }, [liveMe, isLoading, email, clearSession]);

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
