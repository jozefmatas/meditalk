import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";

import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { PageTitleProvider } from "@/components/nav/page-title-context";
import { HeaderActionsProvider } from "@/components/nav/header-actions-context";
import { ImpersonationProvider } from "@/components/admin/impersonation-context";
import { AdminProvider } from "@/hooks/use-is-admin";
import { ConditionalAnalytics } from "@/components/analytics/conditional-analytics";
import { Toaster } from "@/components/shared/sonner";
import { ErudaLoader } from "@/components/debug/eruda-loader";
import { NativeLifecycle } from "@/components/native/native-lifecycle";
import "../globals.css";

const figtree = Figtree({
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "MediTalk - Medical Communication Platform",
  description:
    "Healthcare communication platform for Slovak and Czech medical professionals",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MediTalk",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#f1eee7",
  width: "device-width",
  initialScale: 1,
  // maximumScale, userScalable, and viewportFit were removed —
  // they all break background audio recording on iOS/Android.
  // See commits d8f88bf and 5015cb7 for what NOT to add back.
};

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  // Validate that the incoming locale is valid
  if (!routing.locales.includes(locale as "sk" | "cs" | "en")) {
    notFound();
  }

  // Fetch messages for the locale
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script async src="/theme.js" />
      </head>
      <body className={`${figtree.className} antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <PageTitleProvider>
            <HeaderActionsProvider>
              <ImpersonationProvider>
                <AdminProvider>
                  {children}
                  <ErudaLoader />
                </AdminProvider>
              </ImpersonationProvider>
            </HeaderActionsProvider>
          </PageTitleProvider>
          <Toaster />
        </NextIntlClientProvider>
        <ConditionalAnalytics />
        <NativeLifecycle />
      </body>
    </html>
  );
}
