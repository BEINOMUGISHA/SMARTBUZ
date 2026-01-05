"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

import { Id } from "../../convex/_generated/dataModel";

type User = {
    _id: Id<"users">;
    first_name: string;
    last_name: string;
    email: string;
    roles: string[];
    phone_number?: string;
};

type AuthContextType = {
    user: User | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    checkRole: (roles: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [email, setEmail] = useState<string | null>(null);
    const [isRestoring, setIsRestoring] = useState(true);
    const router = useRouter();
    const loginMutation = useMutation(api.users.login);

    useEffect(() => {
        const savedEmail = localStorage.getItem("pos_user_email");
        console.log("AuthContext: Initial load. localStorage email:", savedEmail);
        if (savedEmail) {
            setEmail(savedEmail);
        }
        setIsRestoring(false);
    }, []);

    const user = useQuery(api.users.getByEmail, email ? { email } : "skip");

    // Loading if:
    // 1. We haven't checked localStorage yet (isRestoring)
    // 2. We have an email but Convex hasn't returned the user data yet
    const isLoading = isRestoring || (email !== null && user === undefined);

    useEffect(() => {
        if (!isLoading) {
            console.log("AuthContext: State check", { email, foundUser: !!user, isLoading });
            // Only auto-logout if we aren't loading, we have an email (attempted login), but no user found
            if (email && !user) {
                console.warn("AuthContext: Logout triggered. User not found for email:", email);
                localStorage.removeItem("pos_user_email");
                setEmail(null);
                // We don't force push here, let the UI decide or user action
                // But for security, if the token/email is invalid, we should probably redirect
                // However, doing it here might conflict with other logic. 
                // Let's keep it safe: if we had an email but query returned null, we are invalid.
            }
        }
    }, [user, isLoading, email]);

    const login = async (newEmail: string, password: string) => {
        try {
            const authenticatedUser = await loginMutation({ email: newEmail, password });
            if (authenticatedUser) {
                localStorage.setItem("pos_user_email", newEmail);
                setEmail(newEmail);
                router.push("/");
                return { success: true };
            }
            return { success: false, error: "Authentication failed" };
        } catch (error: any) {
            return { success: false, error: error.message || "An error occurred" };
        }
    };

    const logout = () => {
        localStorage.removeItem("pos_user_email");
        setEmail(null);
        router.push("/auth/login");
    };

    const checkRole = (allowedRoles: string[]) => {
        if (!user) return false;
        return user.roles.some((role: string) => allowedRoles.includes(role));
    };

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
