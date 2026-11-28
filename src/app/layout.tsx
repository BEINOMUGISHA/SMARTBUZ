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
import { ThemeProvider } from "@/components/theme-provider";
import { cookies } from "next/headers";
import { I18nProvider } from "@/i18n/provider";
import { DEFAULT_LOCALE, isLocaleCode, LOCALE_COOKIE } from "@/i18n/locales";

/**
 * The root layout carries the session and the language, and nothing else.
 *
 * The Convex client and the auth context used to live here, which meant the
 * sign-in route downloaded 24 KB gzipped of Convex client in order to let a
 * stranger type a password. Those two need the backend, and the sign-in
 * screens do not read any business data, so they are mounted on the
 * authenticated routes instead — see `src/app/(dashboard)/layout.tsx`.
 *
 * The session itself stays here: it is a cookie, it is needed by every
 * route, and it costs nothing.
 *
 * The language is read from a cookie for the same reason the session is:
 * the page has to be painted in the language the reader chose, and the
 * server is the only thing that knows what to paint.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const stored = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocaleCode(stored) ? stored : DEFAULT_LOCALE;

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className="font-sans antialiased"
      >
        <ThemeProvider>
          <I18nProvider locale={locale}>
            <SessionProvider>
              <ServiceWorkerRegistration />
              {children}
              <Toaster />
            </SessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
