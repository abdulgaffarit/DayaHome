import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "নতুন পাসওয়ার্ড",
  robots: NOINDEX,
};

export default function ResetPasswordPage() {
  return (
    <AuthShell title="নতুন পাসওয়ার্ড দিন" description="নতুন একটি পাসওয়ার্ড ঠিক করুন।">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
