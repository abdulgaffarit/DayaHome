import type { Metadata } from "next";
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

export default async function LoginPage() {
  // Already signed in — no reason to show the form again.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <AuthShell title="লগইন করুন" description="আপনার অ্যাকাউন্টে প্রবেশ করুন।">
      <Suspense fallback={null}>
        <LoginForm turnstileSiteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      </Suspense>
    </AuthShell>
  );
}
