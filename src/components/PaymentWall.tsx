"use client";

/**
 * SMARTBUZ PaymentWall (Updated)
 *
 * FIX #3: License enforcement is now handled by Next.js middleware (middleware.ts).
 * Unlicensed users are redirected to /locked BEFORE any React code runs.
 *
 * This component is now a simple passthrough wrapper — the real security
 * is server-side. It is kept here for backwards compatibility with any
 * layouts that still render it, but it no longer renders any gate UI itself.
 */

export default function PaymentWall({
  children,
}: {
  children: React.ReactNode;
}) {
  // The middleware.ts handles all license enforcement at the server/edge level.
  // This component simply renders its children.
  return <>{children}</>;
}
