import type { Metadata } from "next";
import { safeNextPath } from "@/lib/next-path";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEnv } from "@/server/cloudflare/env";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "লগইন",
  description: "dayarampur.com অ্যাকাউন্টে লগইন করুন।",
  robots: NOINDEX,
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in — no reason to show the form again.
  // Honour `next` for someone who is already signed in: arriving here with a
  // pending intent (a property waiting to be unlocked, say) and being dropped
  // on the dashboard would silently discard it.
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next));

  return (
    <AuthShell title="লগইন করুন" description="আপনার অ্যাকাউন্টে প্রবেশ করুন।">
      <Suspense fallback={null}>
        <LoginForm turnstileSiteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      </Suspense>
    </AuthShell>
  );
}
