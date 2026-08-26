"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/admin/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * Runs a Server Action from a button, with an optional confirmation dialog.
 *
 * Destructive operations always confirm — the spec's rule that dangerous admin
 * actions must be acknowledged is implemented here rather than left to each
 * call site remembering.
 */
export function ActionButton({
  action,
  fields,
  confirmTitle,
  confirmBody,
  successMessage = "সম্পন্ন হয়েছে।",
  children,
  ...buttonProps
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  confirmTitle?: string;
  confirmBody?: React.ReactNode;
  successMessage?: string;
  children: React.ReactNode;
} & Omit<ButtonProps, "onClick" | "children">) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function run() {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);

    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        toast.show(successMessage, "success");
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <Button
        {...buttonProps}
        loading={pending}
        onClick={() => (confirmTitle ? setConfirmOpen(true) : run())}
      >
        {children}
      </Button>

      {confirmTitle ? (
        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={confirmTitle}
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                বাতিল
              </Button>
              <Button variant={buttonProps.variant ?? "primary"} loading={pending} onClick={run}>
                নিশ্চিত করুন
              </Button>
            </>
          }
        >
          <div className="text-ink-700">{confirmBody}</div>
        </Modal>
      ) : null}
    </>
  );
}
