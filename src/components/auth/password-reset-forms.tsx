"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, MailCheck } from "lucide-react";
import { requestPasswordResetSchema, resetPasswordSchema } from "@/domain/schemas";
import type { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Turnstile } from "@/components/ui/turnstile";
import { useToast } from "@/components/ui/toast";

type RequestInput = z.infer<typeof requestPasswordResetSchema>;
type ResetInput = z.infer<typeof resetPasswordSchema>;

interface ApiError {
  error?: { message?: string; fields?: Record<string, string> };
}

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const toast = useToast();
  const [token, setToken] = React.useState<string>();
  const [submitted, setSubmitted] = React.useState(false);

  const form = useForm<RequestInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { identifier: "" },
  });

  async function onSubmit(values: RequestInput) {
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, turnstileToken: token }),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiError;
        toast.show(body.error?.message ?? "অনুরোধ পাঠানো যায়নি।", "error");
        return;
      }
      // The server answers identically whether or not an account matched, so
      // the UI must not imply that one was found.
      setSubmitted(true);
    } catch {
      toast.show("অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।", "error");
    }
  }

  if (submitted) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-surface-mint text-brand-700">
          <MailCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-ink-900">ইমেইল দেখুন</h2>
        <p className="mt-3 leading-relaxed text-ink-600">
          এই তথ্যের সাথে মিলে যাওয়া কোনো অ্যাকাউন্টে ইমেইল থাকলে, পাসওয়ার্ড
          রিসেট করার একটি লিংক পাঠানো হয়েছে। লিংকটি ১ ঘণ্টা পর্যন্ত কাজ করবে।
        </p>
        <p className="mt-4 rounded-[--radius-control] bg-ink-50 p-3 text-sm leading-relaxed text-ink-600">
          ইমেইল না পেলে স্প্যাম ফোল্ডার দেখুন। অ্যাকাউন্টে ইমেইল যুক্ত করা না
          থাকলে এই পদ্ধতিতে রিসেট করা যাবে না — সহায়তার জন্য{" "}
          <a href="mailto:support@dayarampur.com" className="text-brand-700 underline">
            support@dayarampur.com
          </a>{" "}
          এ যোগাযোগ করুন।
        </p>
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "mt-6" })}>
          লগইন পাতায় ফিরে যান
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field
        label="মোবাইল নম্বর বা ইমেইল"
        htmlFor="reset-identifier"
        required
        error={form.formState.errors.identifier?.message}
        hint="অ্যাকাউন্টে যুক্ত করা ইমেইলে রিসেট লিংক পাঠানো হবে।"
      >
        <Input
          id="reset-identifier"
          autoComplete="username"
          placeholder="০১৭xxxxxxxx"
          invalid={Boolean(form.formState.errors.identifier)}
          {...form.register("identifier")}
        />
      </Field>

      <Turnstile siteKey={turnstileSiteKey} onToken={setToken} />

      <Button type="submit" full size="lg" loading={form.formState.isSubmitting}>
        রিসেট লিংক পাঠান
      </Button>

      <p className="text-center text-sm text-ink-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          লগইন পাতায় ফিরে যান
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [done, setDone] = React.useState(false);
  const urlToken = params.get("token") ?? "";

  const form = useForm<ResetInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: urlToken, password: "", confirmPassword: "" },
  });

  // The token arrives in the query string; keep the form in step with it.
  React.useEffect(() => {
    form.setValue("token", urlToken);
  }, [urlToken, form]);

  async function onSubmit(values: ResetInput) {
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json()) as ApiError;
      if (!response.ok) {
        for (const [field, message] of Object.entries(body.error?.fields ?? {})) {
          form.setError(field as keyof ResetInput, { message });
        }
        toast.show(body.error?.message ?? "পাসওয়ার্ড পরিবর্তন করা যায়নি।", "error");
        return;
      }
      setDone(true);
    } catch {
      toast.show("পাসওয়ার্ড পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।", "error");
    }
  }

  if (!urlToken) {
    return (
      <div className="text-center">
        <p className="leading-relaxed text-ink-600">
          লিংকটি সম্পূর্ণ নয়। ইমেইলে পাওয়া লিংকটি আবার ব্যবহার করুন, অথবা নতুন
          করে অনুরোধ করুন।
        </p>
        <Link href="/forgot-password" className={buttonVariants({ className: "mt-6" })}>
          নতুন লিংক চান
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-surface-mint text-brand-700">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-ink-900">পাসওয়ার্ড পরিবর্তন হয়েছে</h2>
        <p className="mt-3 leading-relaxed text-ink-600">
          নিরাপত্তার জন্য সব ডিভাইস থেকে লগআউট করা হয়েছে। নতুন পাসওয়ার্ড দিয়ে
          লগইন করুন।
        </p>
        <Button full size="lg" className="mt-6" onClick={() => router.push("/login")}>
          লগইন করুন
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <input type="hidden" {...form.register("token")} />

      <Field
        label="নতুন পাসওয়ার্ড"
        htmlFor="reset-password"
        required
        error={form.formState.errors.password?.message}
        hint="কমপক্ষে ৮ অক্ষর, একটি সংখ্যা রাখুন।"
      >
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
      </Field>

      <Field
        label="পাসওয়ার্ড আবার লিখুন"
        htmlFor="reset-confirm"
        required
        error={form.formState.errors.confirmPassword?.message}
      >
        <Input
          id="reset-confirm"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.confirmPassword)}
          {...form.register("confirmPassword")}
        />
      </Field>

      <Button type="submit" full size="lg" loading={form.formState.isSubmitting}>
        পাসওয়ার্ড পরিবর্তন করুন
      </Button>
    </form>
  );
}
