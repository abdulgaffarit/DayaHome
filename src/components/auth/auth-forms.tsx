"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { LoginInput, RegisterInput } from "@/domain/schemas";
import { loginSchema, registerSchema } from "@/domain/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Turnstile } from "@/components/ui/turnstile";
import { useToast } from "@/components/ui/toast";

interface ApiError {
  error?: { message?: string; fields?: Record<string, string> };
}

/** Safe internal redirect target. An absolute or protocol-relative `next`
 *  parameter is discarded so the login page cannot be used as an open redirect. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export function LoginForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [token, setToken] = React.useState<string>();

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, turnstileToken: token }),
    });
    const body = (await response.json()) as ApiError;

    if (!response.ok) {
      for (const [field, message] of Object.entries(body.error?.fields ?? {})) {
        form.setError(field as keyof LoginInput, { message });
      }
      toast.show(body.error?.message ?? "লগইন করা যায়নি।", "error");
      return;
    }

    toast.show("সফলভাবে লগইন হয়েছে।", "success");
    router.push(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field
        label="মোবাইল নম্বর বা ইমেইল"
        htmlFor="identifier"
        required
        error={form.formState.errors.identifier?.message}
      >
        <Input
          id="identifier"
          autoComplete="username"
          inputMode="text"
          placeholder="০১৭xxxxxxxx"
          invalid={Boolean(form.formState.errors.identifier)}
          {...form.register("identifier")}
        />
      </Field>

      <Field
        label="পাসওয়ার্ড"
        htmlFor="password"
        required
        error={form.formState.errors.password?.message}
      >
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
      </Field>

      <Turnstile siteKey={turnstileSiteKey} onToken={setToken} />

      <Button type="submit" full size="lg" loading={form.formState.isSubmitting}>
        লগইন করুন
      </Button>

      <p className="text-center text-sm text-ink-600">
        অ্যাকাউন্ট নেই?{" "}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          রেজিস্টার করুন
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [token, setToken] = React.useState<string>();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: undefined,
      password: "",
      confirmPassword: "",
      acceptTerms: false as unknown as true,
    },
  });

  async function onSubmit(values: RegisterInput) {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, turnstileToken: token }),
    });
    const body = (await response.json()) as ApiError;

    if (!response.ok) {
      for (const [field, message] of Object.entries(body.error?.fields ?? {})) {
        form.setError(field as keyof RegisterInput, { message });
      }
      toast.show(body.error?.message ?? "রেজিস্ট্রেশন সম্পন্ন হয়নি।", "error");
      return;
    }

    toast.show("স্বাগতম! আপনার অ্যাকাউন্ট তৈরি হয়েছে।", "success");
    router.push(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="আপনার নাম" htmlFor="name" required error={form.formState.errors.name?.message}>
        <Input
          id="name"
          autoComplete="name"
          invalid={Boolean(form.formState.errors.name)}
          {...form.register("name")}
        />
      </Field>

      <Field
        label="মোবাইল নম্বর"
        htmlFor="phone"
        required
        error={form.formState.errors.phone?.message}
        hint="এই নম্বর দিয়েই আপনি লগইন করবেন।"
      >
        <Input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="০১৭xxxxxxxx"
          invalid={Boolean(form.formState.errors.phone)}
          {...form.register("phone")}
        />
      </Field>

      <Field
        label="ইমেইল"
        htmlFor="email"
        error={form.formState.errors.email?.message}
        hint="ঐচ্ছিক — পাসওয়ার্ড ভুলে গেলে কাজে লাগবে।"
      >
        <Input
          id="email"
          type="email"
          autoComplete="email"
          invalid={Boolean(form.formState.errors.email)}
          {...form.register("email")}
        />
      </Field>

      <Field
        label="পাসওয়ার্ড"
        htmlFor="new-password"
        required
        error={form.formState.errors.password?.message}
        hint="কমপক্ষে ৮ অক্ষর, একটি সংখ্যা রাখুন।"
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.password)}
          {...form.register("password")}
        />
      </Field>

      <Field
        label="পাসওয়ার্ড আবার লিখুন"
        htmlFor="confirm-password"
        required
        error={form.formState.errors.confirmPassword?.message}
      >
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(form.formState.errors.confirmPassword)}
          {...form.register("confirmPassword")}
        />
      </Field>

      <div>
        <Checkbox
          id="accept-terms"
          label={
            <>
              আমি{" "}
              <Link href="/terms" className="text-brand-700 underline">
                শর্তাবলী
              </Link>{" "}
              ও{" "}
              <Link href="/privacy" className="text-brand-700 underline">
                গোপনীয়তা নীতি
              </Link>{" "}
              মেনে নিচ্ছি।
            </>
          }
          {...form.register("acceptTerms")}
        />
        {form.formState.errors.acceptTerms ? (
          <p role="alert" className="mt-1.5 text-sm text-danger-700">
            {form.formState.errors.acceptTerms.message}
          </p>
        ) : null}
      </div>

      <Turnstile siteKey={turnstileSiteKey} onToken={setToken} />

      <Button type="submit" full size="lg" loading={form.formState.isSubmitting}>
        রেজিস্টার করুন
      </Button>

      <p className="text-center text-sm text-ink-600">
        ইতিমধ্যে অ্যাকাউন্ট আছে?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          লগইন করুন
        </Link>
      </p>
    </form>
  );
}
