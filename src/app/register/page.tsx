import type { Metadata } from "next";
import { safeNextPath } from "@/lib/next-path";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/cloudflare/env";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "রেজিস্টার",
  description: "dayarampur.com-এ নতুন অ্যাকাউন্ট তৈরি করুন।",
  robots: NOINDEX,
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Honour `next` for someone who is already signed in: arriving here with a
  // pending intent (a property waiting to be unlocked, say) and being dropped
  // on the dashboard would silently discard it.
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next));

  return (
    <AuthShell
      title="নতুন অ্যাকাউন্ট"
      description="বিজ্ঞাপন দিতে ও পছন্দের বাসা সংরক্ষণ করতে অ্যাকাউন্ট তৈরি করুন।"
    >
      <Suspense fallback={null}>
        <RegisterForm turnstileSiteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      </Suspense>
    </AuthShell>
  );
}
