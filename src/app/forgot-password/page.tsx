import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";
import { getEnv } from "@/server/cloudflare/env";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "পাসওয়ার্ড ভুলে গেছেন",
  description: "dayarampur.com অ্যাকাউন্টের পাসওয়ার্ড রিসেট করুন।",
  robots: NOINDEX,
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="পাসওয়ার্ড ভুলে গেছেন?"
      description="অ্যাকাউন্টের মোবাইল নম্বর বা ইমেইল দিন — রিসেট লিংক পাঠানো হবে।"
    >
      <Suspense fallback={null}>
        <ForgotPasswordForm turnstileSiteKey={getEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      </Suspense>
    </AuthShell>
  );
}
