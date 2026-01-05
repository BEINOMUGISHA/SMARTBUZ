"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type User = {
    _id: string;
    first_name: string;
    last_name: string;
    email: string;
    roles: string[];
};

type AuthContextType = {
    user: User | null;
    isLoading: boolean;
    login: (email: string) => Promise<void>;
    logout: () => void;
    checkRole: (roles: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [email, setEmail] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
        const savedEmail = localStorage.getItem("pos_user_email");
        setEmail(savedEmail);
    }, []);

    const user = useQuery(api.users.getByEmail, email ? { email } : "skip");
    const isLoading = email !== null && user === undefined;

    useEffect(() => {
        if (!isLoading && !user && email) {
            // Handle invalid session
            localStorage.removeItem("pos_user_email");
            setEmail(null);
            router.push("/auth/login");
        }
    }, [user, isLoading, email, router]);

    const login = async (newEmail: string) => {
        localStorage.setItem("pos_user_email", newEmail);
        setEmail(newEmail);
        router.push("/");
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
