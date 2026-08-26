"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { updateSettingAction } from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function SettingsForm({
  settingKey,
  value,
  description,
}: {
  settingKey: string;
  value: string;
  description: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = React.useState(value);
  const [pending, startTransition] = React.useTransition();
  const dirty = current !== value;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("key", settingKey);
    formData.set("value", current);

    startTransition(async () => {
      const result = await updateSettingAction(formData);
      if (result.ok) {
        toast.show("সেটিং সংরক্ষিত হয়েছে।", "success");
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field
        label={description ?? settingKey}
        htmlFor={`setting-${settingKey}`}
        hint={<span className="font-mono text-xs">{settingKey}</span>}
        className="min-w-0 flex-1"
      >
        <Input
          id={`setting-${settingKey}`}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>
      <Button type="submit" loading={pending} disabled={!dirty}>
        সংরক্ষণ
      </Button>
    </form>
  );
}
