"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { GatewayId } from "@/domain/payments";
import {
  setGatewayEnabledAction,
  setGatewayRoleAction,
  updateGatewaySettingsAction,
} from "@/server/admin/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const SETTING_LABEL_BN: Record<string, string> = {
  account_number: "যে নম্বরে টাকা পাঠাবে",
  instructions_bn: "ব্যবহারকারীকে দেখানো নির্দেশনা",
};

export function GatewayControls({
  gatewayId,
  enabled,
  configured,
  isPrimary,
  isFallback,
  settings,
  editableSettings,
}: {
  gatewayId: GatewayId;
  enabled: boolean;
  configured: boolean;
  isPrimary: boolean;
  isFallback: boolean;
  settings: Record<string, string>;
  editableSettings: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string>>(settings ?? {});

  function run(action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>, fields: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.show("সংরক্ষিত হয়েছে।", "success");
        router.refresh();
        setSettingsOpen(false);
      } else {
        toast.show(result.message ?? "পরিবর্তন করা যায়নি।", "error");
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={enabled ? "secondary" : "outline"}
        loading={pending}
        onClick={() =>
          run(setGatewayEnabledAction, { gatewayId, enabled: String(!enabled) })
        }
      >
        {enabled ? "বন্ধ করুন" : "চালু করুন"}
      </Button>

      {/* Only a usable gateway can be made primary — otherwise payments would
          route to something that cannot take money. */}
      <Button
        size="sm"
        variant="outline"
        disabled={!enabled || !configured || isPrimary}
        loading={pending}
        onClick={() => run(setGatewayRoleAction, { gatewayId, role: "primary" })}
      >
        প্রাইমারি করুন
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={!enabled || !configured || isFallback}
        loading={pending}
        onClick={() => run(setGatewayRoleAction, { gatewayId, role: "fallback" })}
      >
        ফলব্যাক করুন
      </Button>

      {editableSettings.length > 0 ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
            সেটিংস
          </Button>

          <Modal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            title="গেটওয়ে সেটিংস"
            description="শুধু সাধারণ তথ্য — কোনো গোপন কী এখানে রাখা হয় না।"
            footer={
              <>
                <Button variant="outline" onClick={() => setSettingsOpen(false)}>
                  বাতিল
                </Button>
                <Button
                  loading={pending}
                  onClick={() => run(updateGatewaySettingsAction, { gatewayId, ...draft })}
                >
                  সংরক্ষণ
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              {editableSettings.map((key) =>
                key === "instructions_bn" ? (
                  <Field key={key} label={SETTING_LABEL_BN[key] ?? key} htmlFor={`s-${key}`}>
                    <Textarea
                      id={`s-${key}`}
                      value={draft[key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </Field>
                ) : (
                  <Field key={key} label={SETTING_LABEL_BN[key] ?? key} htmlFor={`s-${key}`}>
                    <Input
                      id={`s-${key}`}
                      value={draft[key] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </Field>
                ),
              )}
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
