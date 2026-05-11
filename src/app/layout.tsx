import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TIENS POS - Smart Inventory & Sales",
  description: "Advanced Point of Sale system for Tiens Uganda",
  manifest: "/manifest.json",
  themeColor: "#0f172a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TIENS POS",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
