"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ROLES, type Role } from "@/domain/enums";
import { changeUserRoleAction } from "@/server/admin/actions";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

const ROLE_LABEL_BN: Record<Role, string> = {
  VISITOR: "দর্শনার্থী",
  USER: "ব্যবহারকারী",
  OWNER: "মালিক",
  ADMIN: "অ্যাডমিন",
  SUPER_ADMIN: "সুপার অ্যাডমিন",
};

/**
 * Role picker with a confirmation step.
 *
 * Granting staff access is the single most consequential admin action, so it
 * never happens on a stray click of a dropdown.
 */
export function RoleSelect({ userId, currentRole }: { userId: string; currentRole: Role }) {
  const router = useRouter();
  const toast = useToast();
  const [nextRole, setNextRole] = React.useState<Role | null>(null);
  const [pending, startTransition] = React.useTransition();

  function confirm() {
    if (!nextRole) return;
    const formData = new FormData();
    formData.set("userId", userId);
    formData.set("role", nextRole);

    startTransition(async () => {
      const result = await changeUserRoleAction(formData);
      if (result.ok) {
        toast.show("ভূমিকা পরিবর্তন হয়েছে। ব্যবহারকারীর সেশন বাতিল করা হয়েছে।", "success");
        router.refresh();
      } else {
        toast.show(result.message, "error");
      }
      setNextRole(null);
    });
  }

  return (
    <>
      <Select
        value={currentRole}
        aria-label="ভূমিকা পরিবর্তন"
        className="h-9 w-40 text-sm"
        onChange={(event) => setNextRole(event.target.value as Role)}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABEL_BN[role]}
          </option>
        ))}
      </Select>

      <Modal
        open={nextRole !== null}
        onClose={() => setNextRole(null)}
        title="ভূমিকা পরিবর্তন করবেন?"
        footer={
          <>
            <Button variant="outline" onClick={() => setNextRole(null)}>
              বাতিল
            </Button>
            <Button loading={pending} onClick={confirm}>
              নিশ্চিত করুন
            </Button>
          </>
        }
      >
        <p className="text-ink-700">
          ভূমিকা <strong>{ROLE_LABEL_BN[currentRole]}</strong> থেকে{" "}
          <strong>{nextRole ? ROLE_LABEL_BN[nextRole] : ""}</strong> করা হবে। ব্যবহারকারীর
          সব সেশন বাতিল হবে এবং নতুন করে লগইন করতে হবে।
        </p>
      </Modal>
    </>
  );
}
