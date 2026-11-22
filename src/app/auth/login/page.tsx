"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import { Eye, EyeOff, Package2 } from "lucide-react";

import Link from "next/link";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  /**
   * Set when the account exists but its email address has not been proven.
   * The person can ask for another code from here.
   */
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const { login } = useAuth();


  // ... (other imports)

  // ...

  /**
   * Ask the server to email another verification code.
   *
   * The code never reaches the browser — it is only ever sent to the inbox.
   */
  const handleResendVerification = async () => {
    if (!email.trim()) {
      toast.error("Enter the email address you registered with.");
      return;
    }
    setResending(true);
    try {
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!response.ok) throw new Error("Could not send the verification code.");
      toast.success("If that address needs verifying, a new code is on its way.");
    } catch {
      toast.error("Could not send the verification code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (!result.success) {
      const message = result.error || "Login failed";
      toast.error(formatError(message));
      if (/verify your email/i.test(message)) {
        setNeedsVerification(true);
      }
    } else {
      toast.success("Login successful");
    }
  };

  return (
    <main className="flex min-h-screen w-full lg:grid lg:grid-cols-2 bg-muted/30">
      {/* Left side: Hero Section (Desktop only) */}
      <div className="hidden bg-muted lg:block relative overflow-hidden">
        <Image
          src="/images/cashier-retail-hero.jpg"
          alt="Retail Commerce in Uganda"
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover object-center transform scale-105 transition-transform duration-1000"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/60 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-xs font-black tracking-wider uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              SMARTBUZ Commerce
            </div>
            <div className="text-[11px] font-mono font-bold text-white/70">
              KAMPALA • EAST AFRICA
            </div>
          </div>

          <div className="space-y-4 max-w-lg">
            <h2 className="text-4xl xl:text-5xl font-black tracking-tight leading-tight text-white drop-shadow-md">
              Run Your Business <br />
              <span className="text-emerald-400">Smarter, Faster.</span>
            </h2>
            <p className="text-base text-white/90 font-medium leading-relaxed drop-shadow-sm">
              Point of sale, real-time multi-branch stock tracking, instant Mobile Money payments, and automated URA VAT tax receipts.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/15 text-xs font-bold">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-black">✓</span> MTN & Airtel MoMo
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-black">✓</span> Multi-Branch Sync
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-black">✓</span> Offline Draft Queue
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-black">✓</span> A5 & Thermal Invoicing
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/10 flex items-center justify-between text-xs text-white/70">
            <span>Official POS for Retail, Wholesale & MLM</span>
            <span className="font-semibold text-white/90">Trusted in Uganda 🇺🇬</span>
          </div>
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
                  </div>
                  <div className="relative group">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="••••••••"
                      className="h-14 pl-4 pr-12 border-muted-foreground/20 focus:border-primary focus:ring-primary/20 transition-all rounded-xl text-lg"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground h-10 w-10"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                      <span className="sr-only">
                        {showPassword ? "Hide password" : "Show password"}
                      </span>
                    </Button>
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

              {needsVerification && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    Your email address has not been verified yet.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Open the link we emailed you, or ask for a new code.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={resending}
                    onClick={handleResendVerification}
                  >
                    {resending ? "Sending..." : "Send a new code"}
                  </Button>
                </div>
              )}
            </form>

            <div className="space-y-3 pt-2 text-center">
              <Link href="/auth/register" className="inline-flex items-center justify-center text-sm font-bold text-primary hover:text-primary/80 transition-colors">
                Create a new account
              </Link>
              <div>
                <Link href="/auth/forgot-password" className="inline-flex items-center justify-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                  Forgot your password?
                </Link>
              </div>
            </div>
          </div>

          <div className="pt-4 text-center">
            <p className="text-sm font-medium text-muted-foreground/60">
              &copy; {new Date().getFullYear()} SMART_BUZ • Smart Business Operations
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
