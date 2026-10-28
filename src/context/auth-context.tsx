/**
 * SMARTBUZ Updated Auth Context
 *
 * FIX #1: Auth no longer stores a plain email in localStorage.
 * Session is now managed via a server-issued HttpOnly signed cookie
 * (set by POST /api/auth).
 *
 * The client context calls /api/auth to login/logout, and fetches
 * /api/auth?action=me to rehydrate the session on page load.
 * Convex queries still use the email from the validated session payload.
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

type User = {
  _id: Id<"users">;
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  roles: string[];
  phone_number?: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkRole: (roles: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // email is sourced from the verified server session, not from raw localStorage
  const [email, setEmail] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const router = useRouter();

  // Rehydrate session from the server-side cookie on mount
  useEffect(() => {
    fetch("/api/auth", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data) => {
        if (data?.user?.email) {
          setEmail(data.user.email);
        }
      })
      .catch(() => {})
      .finally(() => setIsRestoring(false));
  }, []);

  // Fetch full user object from Convex using the session-verified email
  const user = useQuery(api.users.getByEmail, email ? { email } : "skip");

  const isLoading = isRestoring || (email !== null && user === undefined);

  // If the email no longer resolves to a valid user, clear the local state
  useEffect(() => {
    if (!isLoading && email && !user) {
      setEmail(null);
    }
  }, [user, isLoading, email]);

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
    await fetch("/api/auth?action=logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    setEmail(null);
    router.push("/auth/login");
  }, [router]);

  const checkRole = useCallback(
    (allowedRoles: string[]) => {
      if (!user) return false;
      return (user as User).roles.some((role: string) => allowedRoles.includes(role));
    },
    [user]
  );

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, login, logout, checkRole }}>
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
