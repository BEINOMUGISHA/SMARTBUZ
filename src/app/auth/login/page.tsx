"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { Package2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email);
  };

  return (
    <div className="flex min-h-screen w-full lg:grid lg:grid-cols-2">
      <div className="hidden bg-muted lg:block relative">
        <Image
          src="/bac.jpg"
          alt="Login Background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-primary/20 backdrop-blur-[2px] flex flex-col items-center justify-center p-12 text-white">
          
          <h2 className="text-4xl font-bold mb-4 text-center">Empowering Health, Enriching Life</h2>
          <p className="text-xl text-center max-w-md opacity-90">
            Welcome back to the Tiens Uganda POS Management System.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center lg:items-start">
            <div className="lg:hidden mb-8">
              <Image src="/logo.ico" alt="Logo" width={180} height={60} className="object-contain" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Login</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Please enter your details to sign in to your account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="space-y-4 rounded-md shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="admin@pos.com"
                  className="h-12 border-muted-foreground/20 focus:border-primary"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <a href="#" className="text-sm font-medium text-primary hover:underline">
                    Forgot password?
                  </a>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="h-12 border-muted-foreground/20 focus:border-primary"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm text-muted-foreground">
                Remember me
              </label>
            </div>

            <Button type="submit" className="w-full h-12 text-lg font-semibold shadow-lg shadow-primary/20 hover:scale-[1.01] transition-transform">
              Sign In
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Jirah POS. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
