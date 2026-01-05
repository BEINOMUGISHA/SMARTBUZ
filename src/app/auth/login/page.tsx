"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { Package2 } from "lucide-react";

import Link from "next/link";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();


  // ... (other imports)

  // ...

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (!result.success) {
      toast.error(formatError(result.error || "Login failed"));
    } else {
      toast.success("Login successful");
    }
  };

  return (
    <div className="flex min-h-screen w-full lg:grid lg:grid-cols-2 bg-muted/30">
      {/* Left side: Hero Section (Desktop only) */}
      <div className="hidden bg-muted lg:block relative">
        <Image
          src="/bac.jpg"
          alt="Login Background"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-primary/30 backdrop-blur-[3px] flex flex-col items-center justify-center p-12 text-white">
          {/* <div className="mb-12">
            <Image src="/logo.ico" alt="Logo" width={240} height={80} className="object-contain brightness-0 invert" />
          </div> */}
          <h2 className="text-5xl font-extrabold mb-6 text-center leading-tight">Empowering Health, <br />Enriching Life</h2>
          <p className="text-xl text-center max-w-md opacity-90 font-medium">
            Access the Tiens Uganda POS Management System to manage your business with precision and ease.
          </p>
        </div>
        <div className="absolute bottom-8 left-0 right-0 text-center text-white/60 text-sm">
          Trusted by Tiens Distributors & Staff across Uganda
        </div>
      </div>

      {/* Right side: Login Form */}
      <div className="flex items-center justify-center py-12 px-6 sm:px-12 lg:px-8 bg-background relative overflow-hidden">
        {/* Subtle decorative elements for mobile */}
        <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-primary/5 rounded-full blur-3xl lg:hidden" />
        <div className="absolute bottom-[-10%] left-[-10%] w-64 h-64 bg-secondary/10 rounded-full blur-3xl lg:hidden" />

        <div className="w-full max-w-[420px] space-y-10 relative z-10">
          <div className="flex flex-col items-center text-center">
            <div className="space-y-3">
              <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl lg:text-5xl">Welcome Back</h1>
              <p className="text-sm sm:text-base text-muted-foreground font-medium max-w-xs mx-auto">
                Please enter your credentials to sign in
              </p>
            </div>
          </div>

          <div className="bg-card border shadow-xl rounded-2xl p-6 sm:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-5">
                <div className="space-y-2.5">
                  <Label htmlFor="email" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">Email Address</Label>
                  <div className="relative group">
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="admin@pos.com"
                      className="h-14 pl-4 pr-4 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all rounded-xl text-lg"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80">Password</Label>
                    <Link href="/auth/forgot-password" title="Forgot Password" className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative group">
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      className="h-14 pl-4 pr-4 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all rounded-xl text-lg"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-5 w-5 rounded-md border-muted-foreground/30 text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                  />
                  <Label htmlFor="remember-me" className="text-sm font-medium text-muted-foreground cursor-pointer select-none">
                    Keep me signed in
                  </Label>
                </div>
              </div>

              <Button
                disabled={loading}
                type="submit"
                className="w-full h-14 text-lg font-bold shadow-xl shadow-primary/25 hover:scale-[1.02] active:scale-[0.98] transition-all rounded-xl relative overflow-hidden group"
              >
                <span className="relative z-10">{loading ? "Authenticating..." : "Sign In"}</span>
                <div className="absolute inset-0 bg-white/10 group-hover:translate-x-full transition-transform duration-500 skew-x-12" />
              </Button>
            </form>
          </div>

          <div className="pt-4 text-center">
            <p className="text-sm font-medium text-muted-foreground/60">
              &copy; {new Date().getFullYear()} Jirah POS • Specialized for Tiens Uganda
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
