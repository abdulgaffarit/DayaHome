/**
 * Admin advertising.
 *
 * The rule this file exists to protect: paying for a campaign buys a place in
 * the review queue and nothing else. Everything an admin can do goes through
 * the shared lifecycle functions, so the transition rules and the mandatory
 * rejection reason apply to staff exactly as they do to everyone else.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createAdvertiserFor, createDraftCampaign, createUser } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import { createCampaignPayment } from "@/server/advertising/payments";
import { settlePayment } from "@/server/payments/unlock-service";
import {
  approveCampaign,
  getCampaignById,
  rejectCampaign,
} from "@/server/advertising/campaigns";
import {
  getAdvertisingAnalytics,
  listCampaignsForAdmin,
  listPendingReview,
  listZonesForAdmin,
  setZoneEnabled,
  updatePackage,
  updateZone,
} from "@/server/admin/advertising";
import { listPurchasablePackages } from "@/server/advertising/queries";
import { createCampaign } from "@/server/advertising/campaigns";
import { execute, queryOne } from "@/server/db/client";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});
afterEach(() => ctx.close());

async function paidCampaign() {
  const user = await createUser(ctx.db);
  const admin = await createUser(ctx.db, { role: "ADMIN" });
  const advertiser = await createAdvertiserFor(ctx.db, user.id);
  const campaign = await createDraftCampaign(ctx.db, advertiser.id);

  const gateway = new FakeGateway();
  const created = await createCampaignPayment(ctx.db, {
    user,
    advertiserId: advertiser.id,
    campaignId: campaign.id,
    gateway,
    urls: {
      successUrl: "https://d.test/ok",
      failUrl: "https://d.test/no",
      cancelUrl: "https://d.test/c",
      ipnUrl: "https://d.test/ipn",
    },
  });
  if (created.status !== "REDIRECT") throw new Error("expected redirect");
  await settlePayment(ctx.db, gateway, {
    transactionId: created.transactionId,
    validationId: `val-${created.transactionId}`,
  });

  return { user, admin, advertiser, campaign };
}

describe("the approval queue", () => {
  it("CRITICAL: a paid campaign lands in the queue, not on the site", async () => {
    const { campaign } = await paidCampaign();

    const queue = await listPendingReview(ctx.db);

    expect(queue.map((row) => row.id)).toContain(campaign.id);
    expect(queue[0].payment_status).toBe("PAID");
    // Still no serving window.
    expect(queue[0].start_at).toBeNull();
  });

  it("an unpaid draft never reaches the queue", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);
    await createDraftCampaign(ctx.db, advertiser.id);

    await expect(listPendingReview(ctx.db)).resolves.toHaveLength(0);
  });

  it("approving removes it from the queue and opens the window", async () => {
    const { admin, campaign } = await paidCampaign();

    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    await expect(listPendingReview(ctx.db)).resolves.toHaveLength(0);
    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("ACTIVE");
    expect(row!.start_at).toBeTruthy();
  });

  it("CRITICAL: rejection without a reason is refused at every layer", async () => {
    const { admin, campaign } = await paidCampaign();

    await expect(
      rejectCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id, reason: "   " }),
    ).resolves.toEqual({ ok: false, reason: "REASON_REQUIRED" });

    // And the schema refuses it too, even bypassing the service.
    await expect(
      execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'REJECTED' WHERE id = ?`, [
        campaign.id,
      ]),
    ).rejects.toThrow(/CHECK constraint failed/i);

    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_REVIEW");
  });

  it("the rejection reason is recorded and visible", async () => {
    const { admin, campaign } = await paidCampaign();

    await rejectCampaign(ctx.db, {
      campaignId: campaign.id,
      adminId: admin.id,
      reason: "ব্যানারের মান যথেষ্ট নয়।",
    });

    const rows = await listCampaignsForAdmin(ctx.db, { status: "REJECTED" });
    expect(rows[0].rejection_reason).toBe("ব্যানারের মান যথেষ্ট নয়।");
  });
});

describe("admin listing", () => {
  it("shows every advertiser's campaigns, unlike the advertiser view", async () => {
    await paidCampaign();
    await paidCampaign();

    // Staff legitimately see across advertisers; the owner-scoped queries do not.
    await expect(listCampaignsForAdmin(ctx.db)).resolves.toHaveLength(2);
  });

  it("filters by status", async () => {
    const { admin, campaign } = await paidCampaign();
    await paidCampaign();
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    await expect(listCampaignsForAdmin(ctx.db, { status: "ACTIVE" })).resolves.toHaveLength(1);
    await expect(
      listCampaignsForAdmin(ctx.db, { status: "PENDING_REVIEW" }),
    ).resolves.toHaveLength(1);
  });

  it("carries the advertiser's business details for moderation", async () => {
    await paidCampaign();

    const rows = await listCampaignsForAdmin(ctx.db);

    expect(rows[0].business_name).toBe("দয়ারামপুর ইলেকট্রনিক্স");
    expect(rows[0].business_phone).toBe("01800000001");
  });
});

describe("zone and package configuration", () => {
  it("disabling a zone stops it being sold", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);

    await setZoneEnabled(ctx.db, "zone_home_top", false);

    await expect(
      createCampaign(ctx.db, {
        advertiserId: advertiser.id,
        zoneId: "zone_home_top",
        packageId: "adpkg_basic",
        title: "ব্যানার",
        destinationUrl: "https://example.test",
      }),
    ).resolves.toEqual({ ok: false, reason: "ZONE_DISABLED" });
  });

  it("zone pricing and capacity are editable and validated", async () => {
    await expect(
      updateZone(ctx.db, "zone_home_top", { basePriceBdt: 2500, maxActiveAds: 3, priority: 50 }),
    ).resolves.toBe(true);

    const zones = await listZonesForAdmin(ctx.db);
    const zone = zones.find((z) => z.id === "zone_home_top")!;
    expect(zone).toMatchObject({ base_price_bdt: 2500, max_active_ads: 3 });

    // Nonsense values are refused rather than written.
    await expect(
      updateZone(ctx.db, "zone_home_top", { basePriceBdt: -1, maxActiveAds: 1, priority: 0 }),
    ).resolves.toBe(false);
    await expect(
      updateZone(ctx.db, "zone_home_top", { basePriceBdt: 10, maxActiveAds: 0, priority: 0 }),
    ).resolves.toBe(false);
  });

  it("deactivating a package removes it from sale", async () => {
    await updatePackage(ctx.db, "adpkg_basic", {
      priceBdt: 500,
      durationDays: 7,
      isActive: false,
    });

    const offered = await listPurchasablePackages(ctx.db);
    expect(offered.map((p) => p.id)).not.toContain("adpkg_basic");
  });

  it("CRITICAL: a price change never alters a campaign already sold", async () => {
    const { campaign } = await paidCampaign();
    const before = (await getCampaignById(ctx.db, campaign.id))!.price_bdt;

    await updatePackage(ctx.db, "adpkg_basic", {
      priceBdt: 9999,
      durationDays: 30,
      isActive: true,
    });

    const after = await getCampaignById(ctx.db, campaign.id);
    expect(after!.price_bdt).toBe(before);
    expect(after!.duration_days).toBe(7);
  });
});

describe("analytics", () => {
  it("separates settled revenue from money still owed", async () => {
    // One settled, one abandoned at checkout.
    await paidCampaign();
    const pending = await paidCampaign();
    await execute(
      ctx.db,
      `UPDATE payments SET status = 'PENDING'
        WHERE id = (SELECT payment_id FROM advertisement_campaigns WHERE id = ?)`,
      [pending.campaign.id],
    );

    const data = await getAdvertisingAnalytics(ctx.db);

    // Conflating the two would overstate revenue by every abandoned checkout.
    expect(data.revenueBdt).toBe(500);
    expect(data.pendingRevenueBdt).toBe(500);
  });

  it("counts advertisers, campaigns and engagement", async () => {
    const { campaign } = await paidCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET impressions_count = 200, clicks_count = 5 WHERE id = ?`,
      [campaign.id],
    );

    const data = await getAdvertisingAnalytics(ctx.db);

    expect(data.advertisers).toBe(1);
    expect(data.campaigns).toBe(1);
    expect(data.impressions).toBe(200);
    expect(data.clicks).toBe(5);
    expect(data.topZones.length).toBeGreaterThan(0);
  });

  it("an empty marketplace reports zeroes, not NaN", async () => {
    const data = await getAdvertisingAnalytics(ctx.db);

    expect(data).toMatchObject({
      revenueBdt: 0,
      pendingRevenueBdt: 0,
      campaigns: 0,
      impressions: 0,
      clicks: 0,
    });
    expect(Number.isFinite(data.revenueBdt)).toBe(true);
  });
});

describe("audit trail", () => {
  it("the admin action vocabulary covers every advertising decision", async () => {
    const { ADMIN_ACTIONS } = await import("@/domain/enums");

    for (const action of [
      "CAMPAIGN_APPROVED",
      "CAMPAIGN_REJECTED",
      "CAMPAIGN_PAUSED",
      "CAMPAIGN_RESUMED",
      "CAMPAIGN_CANCELLED",
      "CREATIVE_APPROVED",
      "CREATIVE_REJECTED",
      "ADVERTISER_STATUS_CHANGED",
      "AD_ZONE_UPDATED",
      "AD_PACKAGE_UPDATED",
    ]) {
      expect(ADMIN_ACTIONS).toContain(action);
    }
  });

  it("admin_logs accepts an advertising entry with no admin_id constraint issue", async () => {
    const { recordAdminAction } = await import("@/server/admin/audit");
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const { campaign } = await paidCampaign();

    await recordAdminAction(ctx.db, {
      adminId: admin.id,
      action: "CAMPAIGN_APPROVED",
      entityType: "advertisement_campaign",
      entityId: campaign.id,
    });

    const row = await queryOne<{ action: string; entity_id: string }>(
      ctx.db,
      `SELECT action, entity_id FROM admin_logs WHERE entity_type = 'advertisement_campaign'`,
    );
    expect(row).toMatchObject({ action: "CAMPAIGN_APPROVED", entity_id: campaign.id });
  });
});
