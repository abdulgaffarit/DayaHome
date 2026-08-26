"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function ProfileForm({
  defaultName,
  defaultEmail,
  phone,
}: {
  defaultName: string;
  defaultEmail: string;
  phone: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/dashboard/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      const body = (await response.json()) as {
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!response.ok) {
        setErrors(body.error?.fields ?? {});
        toast.show(body.error?.message ?? "সংরক্ষণ করা যায়নি।", "error");
        return;
      }
      toast.show("প্রোফাইল হালনাগাদ হয়েছে।", "success");
      router.refresh();
    } catch {
      toast.show("সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।", "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-4">
      <Field label="নাম" htmlFor="p-name" required error={errors.name}>
        <Input id="p-name" name="name" defaultValue={defaultName} required />
      </Field>

      <Field
        label="মোবাইল নম্বর"
        htmlFor="p-phone"
        hint="নম্বর পরিবর্তন করতে সহায়তায় যোগাযোগ করুন।"
      >
        {/* Read-only: the phone is the login identifier, so changing it is an
            account-recovery operation rather than a profile edit. */}
        <Input id="p-phone" value={phone} readOnly disabled />
      </Field>

      <Field label="ইমেইল" htmlFor="p-email" error={errors.email}>
        <Input id="p-email" name="email" type="email" defaultValue={defaultEmail} />
      </Field>

      <fieldset className="space-y-4 rounded-[--radius-card] border border-ink-100 p-4">
        <legend className="px-2 text-sm font-medium text-ink-700">পাসওয়ার্ড পরিবর্তন</legend>
        <Field label="বর্তমান পাসওয়ার্ড" htmlFor="p-current" error={errors.currentPassword}>
          <Input
            id="p-current"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
          />
        </Field>
        <Field
          label="নতুন পাসওয়ার্ড"
          htmlFor="p-new"
          error={errors.newPassword}
          hint="খালি রাখলে পাসওয়ার্ড অপরিবর্তিত থাকবে।"
        >
          <Input id="p-new" name="newPassword" type="password" autoComplete="new-password" />
        </Field>
      </fieldset>

      <Button type="submit" loading={pending}>
        সংরক্ষণ করুন
      </Button>
    </form>
  );
}
