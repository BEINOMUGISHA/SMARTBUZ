import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMART_BUZ - Smart Inventory & Sales",
  description: "Advanced Point of Sale system for modern retail businesses",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SMART_BUZ",
  },
};

// `themeColor` and `viewport` belong to the viewport export in Next.js 14+.
// Keeping them in `metadata` logs a warning on every page load.
export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

import { SessionProvider } from "@/context/session-context";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

/**
 * The root layout carries the session and nothing else.
 *
 * The Convex client and the auth context used to live here, which meant the
 * sign-in route downloaded 24 KB gzipped of Convex client in order to let a
 * stranger type a password. Those two need the backend, and the sign-in
 * screens do not read any business data, so they are mounted on the
 * authenticated routes instead — see `src/app/(dashboard)/layout.tsx`.
 *
 * The session itself stays here: it is a cookie, it is needed by every
 * route, and it costs nothing.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="font-sans antialiased"
      >
        <SessionProvider>
          <ServiceWorkerRegistration />
          {children}
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
