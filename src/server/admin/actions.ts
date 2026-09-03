"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  approvePropertySchema,
  changeUserRoleSchema,
  rejectPropertySchema,
  setPropertyStatusSchema,
  suspendUserSchema,
  updateReportSchema,
  updateSettingSchema,
} from "@/domain/schemas";
import { getDb, getEnv } from "@/server/cloudflare/env";
import { requireAdmin, requireSuperAdmin } from "@/server/auth/current-user";
import { sha256Hex } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { execute } from "@/server/db/client";
import {
  approveProperty,
  rejectProperty,
  setFeatured,
  setPropertyStatus,
  setVerified,
} from "./moderation";
import { changeUserRole, setUserStatus } from "./users";
import { recordRefund } from "./payments";
import { setGatewayEnabled, setGatewayRole, updateGatewaySettings } from "./gateways";
import { isGatewayId } from "@/domain/payments";
import { setReportStatus } from "@/server/properties/reports";
import { recordAdminAction } from "./audit";

/**
 * Admin mutations as Server Actions.
 *
 * Next's Server Actions carry their own origin check, so no separate CSRF token
 * is needed. Every action independently re-runs `requireAdmin()` (or
 * `requireSuperAdmin()`): being able to reach the admin UI is never taken as
 * proof of authorization for the action itself.
 */

async function adminIpHash(): Promise<string> {
  const headerList = await headers();
  const ip =
    headerList.get("cf-connecting-ip") ??
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0";
  return sha256Hex(`${getEnv().SESSION_SECRET ?? "dev-salt"}|${ip}`);
}

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function approvePropertyAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = approvePropertySchema.safeParse({ propertyId: formData.get("propertyId") });
  if (!parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const result = await approveProperty(getDb(), admin.id, parsed.data.propertyId, {
    ipHash: await adminIpHash(),
  });
  if (!result.ok) return { ok: false, message: "বিজ্ঞাপনটি অনুমোদন করা যায়নি।" };

  revalidatePath("/admin/properties/pending");
  revalidatePath("/admin/properties");
  return { ok: true };
}

export async function rejectPropertyAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = rejectPropertySchema.safeParse({
    propertyId: formData.get("propertyId"),
    reason: formData.get("reason"),
  });
  // A rejection reason is mandatory — the owner has to be told what to fix.
  if (!parsed.success) {
    return { ok: false, message: "প্রত্যাখ্যানের কারণ লিখুন (কমপক্ষে ১০ অক্ষর)।" };
  }

  const result = await rejectProperty(
    getDb(),
    admin.id,
    parsed.data.propertyId,
    parsed.data.reason,
    { ipHash: await adminIpHash() },
  );
  if (!result.ok) return { ok: false, message: "বিজ্ঞাপনটি প্রত্যাখ্যান করা যায়নি।" };

  revalidatePath("/admin/properties/pending");
  revalidatePath("/admin/properties");
  return { ok: true };
}

export async function setFeaturedAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const propertyId = String(formData.get("propertyId") ?? "");
  const featured = String(formData.get("featured") ?? "") === "true";
  if (!propertyId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const ok = await setFeatured(getDb(), admin.id, propertyId, featured, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/properties");
  return ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function setVerifiedAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const propertyId = String(formData.get("propertyId") ?? "");
  const verified = String(formData.get("verified") ?? "") === "true";
  if (!propertyId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const ok = await setVerified(getDb(), admin.id, propertyId, verified, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/properties");
  return ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function setPropertyStatusAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = setPropertyStatusSchema.safeParse({
    propertyId: formData.get("propertyId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const ok = await setPropertyStatus(getDb(), admin.id, parsed.data.propertyId, parsed.data.status, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/properties");
  return ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function setUserStatusAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = suspendUserSchema.safeParse({
    userId: formData.get("userId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const suspend = String(formData.get("suspend") ?? "true") === "true";
  const result = await setUserStatus(
    getDb(),
    admin,
    parsed.data.userId,
    suspend ? "SUSPENDED" : "ACTIVE",
    parsed.data.reason,
    { ipHash: await adminIpHash() },
  );

  revalidatePath("/admin/users");
  if (result.ok) return { ok: true };
  return {
    ok: false,
    message:
      result.reason === "SELF_CHANGE"
        ? "নিজের অ্যাকাউন্টে এই পরিবর্তন করা যাবে না।"
        : "এই ব্যবহারকারীর উপর আপনার অনুমতি নেই।",
  };
}

export async function changeUserRoleAction(formData: FormData): Promise<ActionResult> {
  // Role changes are SUPER_ADMIN-only at the door, and `changeUserRole`
  // re-checks the rules (no self-change, no staff changes by an ADMIN).
  const admin = await requireSuperAdmin();
  const parsed = changeUserRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const result = await changeUserRole(getDb(), admin, parsed.data.userId, parsed.data.role, {
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/admins");
  if (result.ok) return { ok: true };
  return {
    ok: false,
    message:
      result.reason === "SELF_CHANGE"
        ? "নিজের ভূমিকা নিজে পরিবর্তন করা যাবে না।"
        : "এই পরিবর্তনের অনুমতি নেই।",
  };
}

export async function refundPaymentAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const paymentId = String(formData.get("paymentId") ?? "");
  const refundRef = String(formData.get("refundRef") ?? "").trim();
  if (!paymentId || refundRef.length < 3) {
    return { ok: false, message: "গেটওয়ের রিফান্ড রেফারেন্স দিন।" };
  }

  const result = await recordRefund(getDb(), admin.id, paymentId, refundRef, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/payments");
  return result.ok ? { ok: true } : { ok: false, message: "এই পেমেন্ট ফেরত দেওয়া যাবে না।" };
}

export async function updateReportAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const reportId = String(formData.get("reportId") ?? "");
  const parsed = updateReportSchema.safeParse({
    status: formData.get("status"),
    resolutionNote: formData.get("resolutionNote"),
  });
  if (!reportId || !parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const ok = await setReportStatus(
    getDb(),
    reportId,
    parsed.data.status,
    admin.id,
    parsed.data.resolutionNote,
  );
  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "REPORT_STATUS_CHANGED",
    entityType: "report",
    entityId: reportId,
    metadata: { status: parsed.data.status },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/reports");
  return ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function updateSettingAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const parsed = updateSettingSchema.safeParse({
    key: formData.get("key"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  await execute(
    getDb(),
    `UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?`,
    [parsed.data.value, admin.id, nowIso(), parsed.data.key],
  );
  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "SETTING_UPDATED",
    entityType: "setting",
    entityId: parsed.data.key,
    metadata: { value: parsed.data.value },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}


/* -------------------------------------------------------------------------- */
/* Payment gateways                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Gateway configuration is SUPER_ADMIN-only: switching the primary gateway
 * changes where every payment on the site is routed.
 */
export async function setGatewayEnabledAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const gatewayId = String(formData.get("gatewayId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!isGatewayId(gatewayId)) return { ok: false, message: "গেটওয়ে সঠিক নয়।" };

  const result = await setGatewayEnabled(getDb(), admin.id, gatewayId, enabled, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/payments/gateways");
  return result.ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function setGatewayRoleAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const gatewayId = String(formData.get("gatewayId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!isGatewayId(gatewayId) || (role !== "primary" && role !== "fallback")) {
    return { ok: false, message: "অনুরোধটি সঠিক নয়।" };
  }

  const result = await setGatewayRole(getDb(), admin.id, gatewayId, role, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/payments/gateways");
  return result.ok ? { ok: true } : { ok: false, message: "পরিবর্তন করা যায়নি।" };
}

export async function updateGatewaySettingsAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const gatewayId = String(formData.get("gatewayId") ?? "");
  if (!isGatewayId(gatewayId)) return { ok: false, message: "গেটওয়ে সঠিক নয়।" };

  const settings: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key !== "gatewayId" && typeof value === "string") settings[key] = value;
  }

  const result = await updateGatewaySettings(getDb(), admin.id, gatewayId, settings, {
    ipHash: await adminIpHash(),
  });
  revalidatePath("/admin/payments/gateways");
  return result.ok
    ? { ok: true }
    : { ok: false, message: "এই গেটওয়ের কোনো সম্পাদনাযোগ্য সেটিং নেই।" };
}
