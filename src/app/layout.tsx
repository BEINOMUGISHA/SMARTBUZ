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

import { ConvexClientProvider } from "@/components/convex-client-provider";
import { AuthProvider } from "@/context/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

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
        <ConvexClientProvider>
          <AuthProvider>
            <ServiceWorkerRegistration />
            {children}
            <Toaster />
          </AuthProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
