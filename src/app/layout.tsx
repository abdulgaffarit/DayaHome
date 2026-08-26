import type { Metadata, Viewport } from "next";
import { Hind_Siliguri } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { MobileBottomNav } from "@/components/site/mobile-bottom-nav";
import { ToastProvider } from "@/components/ui/toast";
import { siteUrl } from "@/server/cloudflare/env";

/**
 * Hind Siliguri renders Bangla conjuncts well and has a real range of weights,
 * which most system Bangla fonts do not. `display: swap` keeps text visible
 * during the font load rather than blocking first paint.
 */
const banglaFont = Hind_Siliguri({
  variable: "--font-hind-siliguri",
  subsets: ["bengali", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export function generateMetadata(): Metadata {
  const base = siteUrl();
  return {
    metadataBase: new URL(base),
    title: {
      default: "dayarampur.com — দয়ারামপুরের নিজের ঠিকানা",
      template: "%s | dayarampur.com",
    },
    description:
      "দয়ারামপুরে বাসা ভাড়া, বাসা বিক্রি, দোকান, অফিস, গুদাম ও জমির বিজ্ঞাপন। এলাকা ও ভাড়া অনুযায়ী খুঁজুন, ছবি ও বিস্তারিত দেখুন।",
    applicationName: "dayarampur.com",
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "bn_BD",
      siteName: "dayarampur.com",
      url: base,
      title: "dayarampur.com — দয়ারামপুরের নিজের ঠিকানা",
      description:
        "দয়ারামপুরে বাসা, দোকান, অফিস ও জমির বিজ্ঞাপন এক জায়গায়। সহজে, দ্রুত ও নির্ভরযোগ্যভাবে।",
    },
    twitter: {
      card: "summary_large_image",
      title: "dayarampur.com — দয়ারামপুরের নিজের ঠিকানা",
      description: "দয়ারামপুরে বাসা, দোকান, অফিস ও জমির বিজ্ঞাপন এক জায়গায়।",
    },
    robots: { index: true, follow: true },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b6b3a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" className={`${banglaFont.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-white">
        <ToastProvider>
          <a
            href="#main"
            className="sr-only-focusable absolute left-4 top-4 z-50 rounded-[--radius-control] bg-brand-700 px-4 py-2 text-white"
          >
            মূল অংশে যান
          </a>
          <Header />
          {/* Bottom padding leaves room for the fixed mobile nav bar. */}
          <main id="main" className="flex-1 pb-20 lg:pb-0">
            {children}
          </main>
          <Footer />
          <MobileBottomNav />
        </ToastProvider>
      </body>
    </html>
  );
}
