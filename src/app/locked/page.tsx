"use client";

/**
 * SMARTBUZ License Gate Page (/locked)
 *
 * FIX #3: Replaces the client-only PaymentWall with a proper locked page.
 * The middleware redirects unlicensed users here BEFORE any app code runs.
 *
 * This page has SMARTBUZ branding (not Vercel impersonation).
 */

import { useState, useEffect } from "react";
import { ShieldAlert, Key, CheckCircle2, Loader2 } from "lucide-react";

export default function LockedPage() {
  const [licenseKey, setLicenseKey] = useState("");
  const [error, setError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [success, setSuccess] = useState(false);

  // If somehow someone arrives here with a valid license cookie, redirect them
  useEffect(() => {
    fetch("/api/validate-license", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.valid) window.location.replace("/"); })
      .catch(() => {});
  }, []);

  const handleActivate = async () => {
    const key = licenseKey.trim().toUpperCase();
    if (!key) {
      setError("Please enter your license key.");
      return;
    }

    setIsValidating(true);
    setError("");

    try {
      const res = await fetch("/api/validate-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ licenseKey: key }),
      });

      const data = await res.json();

      if (data.valid) {
        setSuccess(true);
        setTimeout(() => window.location.replace("/"), 1200);
      } else {
        setError(data.message || "Invalid license key. Contact SMARTBUZ support.");
      }
    } catch {
      setError("Connection error. Please check your internet and try again.");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between h-16 px-6 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-black text-sm shadow-sm">
            S
          </div>
          <span className="font-bold text-white tracking-tight">SMARTBUZ POS</span>
        </div>
        <span className="text-xs text-white/40 font-mono hidden sm:block">
          Enterprise License Portal
        </span>
      </nav>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-8">
        {/* Status badge */}
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold text-red-400 tracking-wide">
            License Not Activated
          </span>
        </div>

        {/* Heading */}
        <div className="text-center space-y-3 max-w-md">
          <ShieldAlert className="h-12 w-12 text-white/20 mx-auto" />
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight">
            Activate Your License
          </h1>
          <p className="text-white/50 text-sm sm:text-base leading-relaxed">
            This SMARTBUZ POS instance requires a valid license key to operate.
            Enter your key below to unlock the system.
          </p>
        </div>

        {/* Activation card */}
        <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <Key className="h-4 w-4" />
            License Activation Key
          </div>

          <input
            type="text"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={licenseKey}
            onChange={(e) => {
              setLicenseKey(e.target.value.toUpperCase());
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleActivate()}
            disabled={isValidating || success}
            className="w-full px-4 py-3 bg-black border border-white/20 rounded-xl text-white font-mono text-sm tracking-widest text-center placeholder:text-white/20 outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
            autoFocus
          />

          {error && (
            <div className="px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          <button
            onClick={handleActivate}
            disabled={isValidating || success}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {success ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Activated! Redirecting...
              </>
            ) : isValidating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating...
              </>
            ) : (
              "Activate License"
            )}
          </button>
        </div>

        <p className="text-xs text-white/30 text-center max-w-xs">
          Don&apos;t have a license key? Contact{" "}
          <span className="text-emerald-500 font-semibold">SMARTBUZ Support</span> to
          purchase a subscription.
        </p>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-4 flex items-center justify-between text-xs text-white/20">
        <span>&copy; {new Date().getFullYear()} SMARTBUZ. All rights reserved.</span>
        <span className="font-mono">v1.0.0</span>
      </footer>
    </div>
  );
}
