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
import {
  approveCampaign,
  cancelCampaign,
  pauseCampaign,
  rejectCampaign,
  resumeCampaign,
} from "@/server/advertising/campaigns";
import { reviewCreative } from "@/server/advertising/creatives";
import {
  setZoneEnabled,
  updatePackage,
  updateZone,
} from "./advertising";
import { setAdvertiserStatus } from "@/server/advertising/advertisers";

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

/* -------------------------------------------------------------------------- */
/* Advertising                                                                 */
/*                                                                             */
/* Each action re-runs requireAdmin() and delegates to the shared lifecycle    */
/* functions rather than writing its own UPDATE. The rules about which         */
/* transitions are legal, and that a rejection must carry a reason, therefore  */
/* apply identically here and everywhere else.                                 */
/* -------------------------------------------------------------------------- */

function refreshAdvertising(): void {
  revalidatePath("/admin/advertising");
  revalidatePath("/admin/advertising/approvals");
  revalidatePath("/admin/advertising/campaigns");
}

export async function approveCampaignAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const startAt = String(formData.get("startAt") ?? "").trim();
  const result = await approveCampaign(getDb(), {
    campaignId,
    adminId: admin.id,
    startAt: startAt ? `${startAt}T00:00:00Z` : undefined,
  });
  if (!result.ok) return { ok: false, message: "ক্যাম্পেইনটি অনুমোদন করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "CAMPAIGN_APPROVED",
    entityType: "advertisement_campaign",
    entityId: campaignId,
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function rejectCampaignAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaignId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!campaignId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };
  // Enforced again in rejectCampaign and once more by a CHECK constraint.
  if (reason.length < 5) return { ok: false, message: "প্রত্যাখ্যানের কারণ লিখুন।" };

  const result = await rejectCampaign(getDb(), { campaignId, adminId: admin.id, reason });
  if (!result.ok) return { ok: false, message: "ক্যাম্পেইনটি প্রত্যাখ্যান করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "CAMPAIGN_REJECTED",
    entityType: "advertisement_campaign",
    entityId: campaignId,
    metadata: { reason },
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function pauseCampaignAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaignId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  if (!campaignId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const result = await pauseCampaign(getDb(), { campaignId, byUserId: admin.id, reason });
  if (!result.ok) return { ok: false, message: "ক্যাম্পেইনটি স্থগিত করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "CAMPAIGN_PAUSED",
    entityType: "advertisement_campaign",
    entityId: campaignId,
    metadata: reason ? { reason } : undefined,
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function resumeCampaignAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  // Resuming a campaign whose window closed expires it instead of reviving it.
  const result = await resumeCampaign(getDb(), campaignId);
  if (!result.ok) return { ok: false, message: "ক্যাম্পেইনটি আবার চালু করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "CAMPAIGN_RESUMED",
    entityType: "advertisement_campaign",
    entityId: campaignId,
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function cancelCampaignAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  const result = await cancelCampaign(getDb(), campaignId);
  if (!result.ok) return { ok: false, message: "ক্যাম্পেইনটি বাতিল করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "CAMPAIGN_CANCELLED",
    entityType: "advertisement_campaign",
    entityId: campaignId,
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function reviewCreativeAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const creativeId = String(formData.get("creativeId") ?? "");
  const approve = String(formData.get("approve") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim();

  if (!creativeId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };
  if (!approve && reason.length < 5) return { ok: false, message: "প্রত্যাখ্যানের কারণ লিখুন।" };

  const ok = await reviewCreative(getDb(), { creativeId, adminId: admin.id, approve, reason });
  if (!ok) return { ok: false, message: "ব্যানারটি হালনাগাদ করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: approve ? "CREATIVE_APPROVED" : "CREATIVE_REJECTED",
    entityType: "advertisement_creative",
    entityId: creativeId,
    metadata: approve ? undefined : { reason },
    ipHash: await adminIpHash(),
  });

  refreshAdvertising();
  return { ok: true };
}

export async function setAdvertiserStatusAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const advertiserId = String(formData.get("advertiserId") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const allowed = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const;
  if (!advertiserId || !(allowed as readonly string[]).includes(status)) {
    return { ok: false, message: "অনুরোধটি সঠিক নয়।" };
  }

  const ok = await setAdvertiserStatus(getDb(), {
    advertiserId,
    status: status as (typeof allowed)[number],
    adminId: admin.id,
    rejectionReason: reason || undefined,
  });
  if (!ok) return { ok: false, message: "বিজ্ঞাপনদাতার অবস্থা পরিবর্তন করা যায়নি।" };

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "ADVERTISER_STATUS_CHANGED",
    entityType: "advertiser",
    entityId: advertiserId,
    metadata: { status },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/advertising/advertisers");
  return { ok: true };
}

/** Zone and package configuration is a SUPER_ADMIN concern: it sets prices. */
export async function setZoneEnabledAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const zoneId = String(formData.get("zoneId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (!zoneId) return { ok: false, message: "অনুরোধটি সঠিক নয়।" };

  if (!(await setZoneEnabled(getDb(), zoneId, enabled))) {
    return { ok: false, message: "জোনটি হালনাগাদ করা যায়নি।" };
  }

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "AD_ZONE_UPDATED",
    entityType: "advertisement_zone",
    entityId: zoneId,
    metadata: { enabled },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/advertising/zones");
  return { ok: true };
}

export async function updateZoneAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const zoneId = String(formData.get("zoneId") ?? "");
  const basePriceBdt = Number.parseInt(String(formData.get("basePriceBdt") ?? ""), 10);
  const maxActiveAds = Number.parseInt(String(formData.get("maxActiveAds") ?? ""), 10);
  const priority = Number.parseInt(String(formData.get("priority") ?? "0"), 10);

  if (!zoneId || !Number.isFinite(basePriceBdt) || !Number.isFinite(maxActiveAds)) {
    return { ok: false, message: "মান সঠিক নয়।" };
  }

  if (!(await updateZone(getDb(), zoneId, { basePriceBdt, maxActiveAds, priority: priority || 0 }))) {
    return { ok: false, message: "জোনটি হালনাগাদ করা যায়নি।" };
  }

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "AD_ZONE_UPDATED",
    entityType: "advertisement_zone",
    entityId: zoneId,
    metadata: { basePriceBdt, maxActiveAds },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/advertising/zones");
  return { ok: true };
}

export async function updatePackageAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireSuperAdmin();
  const packageId = String(formData.get("packageId") ?? "");
  const priceBdt = Number.parseInt(String(formData.get("priceBdt") ?? ""), 10);
  const durationDays = Number.parseInt(String(formData.get("durationDays") ?? ""), 10);
  const isActive = String(formData.get("isActive") ?? "") === "1";

  if (!packageId || !Number.isFinite(priceBdt) || !Number.isFinite(durationDays)) {
    return { ok: false, message: "মান সঠিক নয়।" };
  }

  // Note: this changes what is on sale from now on. Campaigns already bought
  // keep the price and duration snapshotted onto their own row.
  if (!(await updatePackage(getDb(), packageId, { priceBdt, durationDays, isActive }))) {
    return { ok: false, message: "প্যাকেজটি হালনাগাদ করা যায়নি।" };
  }

  await recordAdminAction(getDb(), {
    adminId: admin.id,
    action: "AD_PACKAGE_UPDATED",
    entityType: "advertisement_package",
    entityId: packageId,
    metadata: { priceBdt, durationDays, isActive },
    ipHash: await adminIpHash(),
  });

  revalidatePath("/admin/advertising/packages");
  return { ok: true };
}
