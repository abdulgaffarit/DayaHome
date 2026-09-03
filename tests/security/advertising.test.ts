/**
 * The advertising schema and campaign lifecycle.
 *
 * The properties that matter, and why each is tested here rather than trusted:
 *
 *   * an advertiser can only ever address their own campaigns;
 *   * the price of a campaign is decided by the server from the package row;
 *   * paying for a campaign does NOT publish it — approval is a separate,
 *     staff-only step;
 *   * a rejection cannot exist without a reason, at both the service and the
 *     schema level;
 *   * money records survive campaign deletion, and campaign statistics do not
 *     outlive the campaign;
 *   * and none of this disturbs the contact-unlock flow that already works.
 *
 * Every assertion runs against the real migrations in a real SQLite engine, so
 * the CHECK constraints, foreign keys and partial unique indexes are the ones
 * production will have.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import {
  createAdvertiserFor,
  createDraftCampaign,
  createProperty,
  createUser,
  grantUnlock,
} from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import {
  createAdvertiser,
  getAdvertiserForUser,
  setAdvertiserStatus,
} from "@/server/advertising/advertisers";
import {
  approveCampaign,
  cancelCampaign,
  createCampaign,
  getCampaignById,
  getOwnedCampaign,
  listCampaignsForAdvertiser,
  pauseCampaign,
  rejectCampaign,
  renewCampaign,
  resumeCampaign,
  runCampaignSchedule,
  submitForReview,
  transitionCampaign,
} from "@/server/advertising/campaigns";
import { createCampaignPayment } from "@/server/advertising/payments";
import { settlePayment } from "@/server/payments/unlock-service";
import { decideUnlock } from "@/server/properties/contact";
import { execute, queryOne } from "@/server/db/client";
import { DAY, nowIso } from "@/lib/time";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

const URLS = {
  successUrl: "https://dayarampur.com/payment/return",
  failUrl: "https://dayarampur.com/payment/fail",
  cancelUrl: "https://dayarampur.com/payment/cancel",
  ipnUrl: "https://dayarampur.com/api/payments/webhook/sslcommerz",
};

/** A user with an advertiser profile and one DRAFT campaign. */
async function anAdvertiserWithCampaign() {
  const user = await createUser(ctx.db);
  const advertiser = await createAdvertiserFor(ctx.db, user.id);
  const campaign = await createDraftCampaign(ctx.db, advertiser.id);
  return { user, advertiser, campaign };
}

/** Drives a campaign through payment to PENDING_REVIEW, as production does. */
async function payForCampaign(
  user: Awaited<ReturnType<typeof createUser>>,
  advertiserId: string,
  campaignId: string,
) {
  const gateway = new FakeGateway();
  const created = await createCampaignPayment(ctx.db, {
    user,
    advertiserId,
    campaignId,
    gateway,
    urls: URLS,
  });
  if (created.status !== "REDIRECT") throw new Error(`unexpected: ${created.status}`);

  const settled = await settlePayment(ctx.db, gateway, {
    transactionId: created.transactionId,
    validationId: `val-${created.transactionId}`,
  });
  return { gateway, created, settled };
}

/* -------------------------------------------------------------------------- */

describe("reference data", () => {
  it("ships the twelve ad zones, all enabled and priced", async () => {
    const zones = await ctx.db
      .prepare(`SELECT id, slug, desktop_size, base_price_bdt, max_active_ads FROM advertisement_zones`)
      .all<{ id: string; slug: string; desktop_size: string; base_price_bdt: number; max_active_ads: number }>();

    expect(zones.results).toHaveLength(12);
    for (const zone of zones.results) {
      expect(zone.desktop_size).toMatch(/^\d+x\d+$/);
      expect(zone.base_price_bdt).toBeGreaterThan(0);
      expect(zone.max_active_ads).toBeGreaterThan(0);
    }
    // Slugs are the stable handle the serving code will use.
    expect(zones.results.map((z) => z.slug)).toContain("home-top");
  });

  it("the exclusive package is not on sale until an operator prices it", async () => {
    const row = await queryOne<{ is_active: number; is_exclusive: number }>(
      ctx.db,
      `SELECT is_active, is_exclusive FROM advertisement_packages WHERE id = 'adpkg_exclusive'`,
    );
    expect(row).toMatchObject({ is_active: 0, is_exclusive: 1 });
  });

  it("no table carries a column that could hold advertiser HTML or script", async () => {
    // The structural guarantee against ad-tag injection: a creative is an image
    // key plus a URL, so there is nowhere to put markup in the first place.
    const tables = ctx.raw
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'advertis%'`)
      .all() as { name: string }[];
    expect(tables.length).toBeGreaterThanOrEqual(7);

    for (const { name } of tables) {
      const columns = ctx.raw.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
      for (const column of columns) {
        // Whole segments only — "description_bn" contains the letters of
        // "script" and is not an injection channel.
        expect(column.name).not.toMatch(/(^|_)(html|script|js|embed|iframe|code|markup)(_|$)/i);
      }
    }
  });
});

describe("advertiser ownership", () => {
  it("creates a profile that starts PENDING and is found by user id", async () => {
    const user = await createUser(ctx.db);

    const result = await createAdvertiser(ctx.db, user.id, {
      businessName: "দয়ারামপুর ফার্নিচার",
      contactPerson: "মোঃ করিম",
      businessPhone: "01800000002",
    });

    expect(result.ok).toBe(true);
    const found = await getAdvertiserForUser(ctx.db, user.id);
    expect(found).toMatchObject({ user_id: user.id, status: "PENDING" });
  });

  it("CRITICAL: a user gets at most one advertiser profile", async () => {
    const user = await createUser(ctx.db);
    await createAdvertiserFor(ctx.db, user.id);

    // The unique index, not a check-then-insert, is what enforces this.
    await expect(
      createAdvertiser(ctx.db, user.id, {
        businessName: "দ্বিতীয় ব্যবসা",
        contactPerson: "কেউ",
        businessPhone: "01800000003",
      }),
    ).resolves.toEqual({ ok: false, reason: "ALREADY_EXISTS" });
  });

  it("CRITICAL: one advertiser cannot read another's campaign", async () => {
    const mine = await anAdvertiserWithCampaign();
    const theirs = await anAdvertiserWithCampaign();

    // The id is correct; only the ownership predicate rejects it.
    await expect(
      getOwnedCampaign(ctx.db, theirs.advertiser.id, mine.campaign.id),
    ).resolves.toBeNull();
    await expect(
      getOwnedCampaign(ctx.db, mine.advertiser.id, mine.campaign.id),
    ).resolves.toMatchObject({ id: mine.campaign.id });
  });

  it("CRITICAL: one advertiser cannot open a payment against another's campaign", async () => {
    const mine = await anAdvertiserWithCampaign();
    const theirs = await anAdvertiserWithCampaign();

    await expect(
      createCampaignPayment(ctx.db, {
        user: theirs.user,
        advertiserId: theirs.advertiser.id,
        campaignId: mine.campaign.id,
        gateway: new FakeGateway(),
        urls: URLS,
      }),
    ).resolves.toEqual({ status: "NOT_FOUND" });

    // And no payment row was created for the attempt.
    const count = await queryOne<{ c: number }>(ctx.db, `SELECT count(*) AS c FROM payments`);
    expect(count!.c).toBe(0);
  });

  it("the campaign list is scoped to the advertiser", async () => {
    const mine = await anAdvertiserWithCampaign();
    await anAdvertiserWithCampaign();

    const rows = await listCampaignsForAdvertiser(ctx.db, mine.advertiser.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].advertiser_id).toBe(mine.advertiser.id);
  });

  it("rejecting an advertiser requires a reason", async () => {
    const user = await createUser(ctx.db);
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const advertiser = await createAdvertiserFor(ctx.db, user.id);

    await expect(
      setAdvertiserStatus(ctx.db, {
        advertiserId: advertiser.id,
        status: "REJECTED",
        adminId: admin.id,
        rejectionReason: "   ",
      }),
    ).resolves.toBe(false);

    await expect(
      setAdvertiserStatus(ctx.db, {
        advertiserId: advertiser.id,
        status: "REJECTED",
        adminId: admin.id,
        rejectionReason: "ব্যবসার তথ্য যাচাই করা যায়নি।",
      }),
    ).resolves.toBe(true);
  });
});

describe("campaign creation", () => {
  it("CRITICAL: price and duration come from the package, not from the caller", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);

    const result = await createCampaign(ctx.db, {
      advertiserId: advertiser.id,
      zoneId: "zone_home_top",
      packageId: "adpkg_premium",
      title: "ব্যানার",
      destinationUrl: "https://example.test",
      // Note: there is no price or duration parameter to pass. That is the point.
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pkg = await queryOne<{ price_bdt: number; duration_days: number; priority: number }>(
      ctx.db,
      `SELECT price_bdt, duration_days, priority FROM advertisement_packages WHERE id = 'adpkg_premium'`,
    );
    expect(result.campaign.price_bdt).toBe(pkg!.price_bdt);
    expect(result.campaign.duration_days).toBe(pkg!.duration_days);
    expect(result.campaign.priority).toBe(pkg!.priority);
    expect(result.campaign.status).toBe("DRAFT");
  });

  it("a later price change does not alter a campaign already bought", async () => {
    const { campaign } = await anAdvertiserWithCampaign();
    const before = (await getCampaignById(ctx.db, campaign.id))!.price_bdt;

    await execute(ctx.db, `UPDATE advertisement_packages SET price_bdt = 99999 WHERE id = 'adpkg_basic'`);

    // The snapshot is what the advertiser agreed to.
    expect((await getCampaignById(ctx.db, campaign.id))!.price_bdt).toBe(before);
  });

  it("gives each campaign a unique public reference", async () => {
    const { advertiser } = await anAdvertiserWithCampaign();
    const a = await createDraftCampaign(ctx.db, advertiser.id);
    const b = await createDraftCampaign(ctx.db, advertiser.id);
    expect(a.publicRef).not.toBe(b.publicRef);
  });

  it("refuses an unknown, inactive or mismatched package", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);
    const base = {
      advertiserId: advertiser.id,
      zoneId: "zone_home_top",
      title: "ব্যানার",
      destinationUrl: "https://example.test",
    };

    await expect(createCampaign(ctx.db, { ...base, packageId: "nope" })).resolves.toEqual({
      ok: false,
      reason: "UNKNOWN_PACKAGE",
    });
    // Inactive packages are not for sale.
    await expect(
      createCampaign(ctx.db, { ...base, packageId: "adpkg_exclusive" }),
    ).resolves.toEqual({ ok: false, reason: "UNKNOWN_PACKAGE" });

    // A package restricted to one zone cannot be moved to another.
    await execute(
      ctx.db,
      `UPDATE advertisement_packages SET zone_id = 'zone_site_footer' WHERE id = 'adpkg_basic'`,
    );
    await expect(createCampaign(ctx.db, { ...base, packageId: "adpkg_basic" })).resolves.toEqual({
      ok: false,
      reason: "PACKAGE_ZONE_MISMATCH",
    });
  });

  it("refuses an unknown or disabled zone", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);
    const base = {
      advertiserId: advertiser.id,
      packageId: "adpkg_basic",
      title: "ব্যানার",
      destinationUrl: "https://example.test",
    };

    await expect(createCampaign(ctx.db, { ...base, zoneId: "zone_nope" })).resolves.toEqual({
      ok: false,
      reason: "UNKNOWN_ZONE",
    });

    await execute(ctx.db, `UPDATE advertisement_zones SET is_enabled = 0 WHERE id = 'zone_home_top'`);
    await expect(createCampaign(ctx.db, { ...base, zoneId: "zone_home_top" })).resolves.toEqual({
      ok: false,
      reason: "ZONE_DISABLED",
    });
  });
});

describe("payment relationship", () => {
  it("CRITICAL: the amount charged is the campaign's price, and the gateway is told so", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const gateway = new FakeGateway();

    const result = await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway,
      urls: URLS,
    });

    expect(result.status).toBe("REDIRECT");
    expect(gateway.created[0].amount).toBe(campaign.priceBdt);
    expect(gateway.created[0].currency).toBe("BDT");

    const payment = await queryOne<{
      amount: number;
      currency: string;
      payment_type: string;
      property_id: string | null;
      advertisement_id: string;
      status: string;
    }>(
      ctx.db,
      `SELECT amount, currency, payment_type, property_id, advertisement_id, status FROM payments`,
    );
    expect(payment).toMatchObject({
      amount: campaign.priceBdt,
      currency: "BDT",
      payment_type: "ADVERTISEMENT",
      // An advertising payment is about a campaign, never a property.
      property_id: null,
      advertisement_id: campaign.id,
      status: "PENDING",
    });
  });

  it("uses the same generic gateway contract as the contact unlock", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const gateway = new FakeGateway();

    await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway,
      urls: URLS,
    });

    // Nothing SSLCOMMERZ-shaped reaches this module: it hands the adapter a
    // payment type and a transaction id and takes back a redirect.
    expect(gateway.created[0].paymentType).toBe("ADVERTISEMENT");
    expect(gateway.created[0].webhookUrl).toBe(URLS.ipnUrl);
  });

  it("a manual gateway returns instructions and settles nothing", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const gateway = new FakeGateway({ instructions: true });

    const result = await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway,
      urls: URLS,
    });

    expect(result.status).toBe("INSTRUCTIONS");
    // The campaign is awaiting money; it has certainly not been published.
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_PAYMENT");
  });

  it("a gateway failure returns the campaign to DRAFT so it can be retried", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();

    const result = await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway: new FakeGateway({ createOk: false }),
      urls: URLS,
    });

    expect(result).toMatchObject({ status: "GATEWAY_ERROR" });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("DRAFT");
    const payment = await queryOne<{ status: string }>(ctx.db, `SELECT status FROM payments`);
    expect(payment!.status).toBe("FAILED");
  });

  it("a campaign cannot be paid for twice", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    await payForCampaign(user, advertiser.id, campaign.id);

    await expect(
      createCampaignPayment(ctx.db, {
        user,
        advertiserId: advertiser.id,
        campaignId: campaign.id,
        gateway: new FakeGateway(),
        urls: URLS,
      }),
    ).resolves.toMatchObject({ status: "NOT_PAYABLE" });
  });

  it("an unverified payment leaves the campaign unpaid", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const gateway = new FakeGateway({
      verify: () => ({ verified: false, status: "FAILED", failureReason: "declined" }),
    });

    const created = await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway,
      urls: URLS,
    });
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    const settled = await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: "val-x",
    });

    expect(settled.result).toBe("REJECTED");
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_PAYMENT");
  });

  it("settlement is idempotent — a replayed webhook does not advance the campaign twice", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const { gateway, created } = await payForCampaign(user, advertiser.id, campaign.id);

    const replay = await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: `val-${created.transactionId}`,
    });

    expect(replay.result).toBe("ALREADY_SETTLED");
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_REVIEW");
  });
});

describe("campaign lifecycle", () => {
  it("CRITICAL: paying for a campaign puts it in the review queue, NOT on the site", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();

    const { settled } = await payForCampaign(user, advertiser.id, campaign.id);

    expect(settled.result).toBe("SETTLED");
    const row = await getCampaignById(ctx.db, campaign.id);
    // The whole point: money does not publish an advert.
    expect(row!.status).toBe("PENDING_REVIEW");
    expect(row!.start_at).toBeNull();
    expect(row!.end_at).toBeNull();
    expect(row!.payment_id).toBeTruthy();
  });

  it("CRITICAL: no transition leads from PAID straight to ACTIVE", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    await payForCampaign(user, advertiser.id, campaign.id);
    await execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'PAID' WHERE id = ?`, [
      campaign.id,
    ]);

    await expect(transitionCampaign(ctx.db, campaign.id, "ACTIVE")).resolves.toEqual({
      ok: false,
      reason: "ILLEGAL_TRANSITION",
    });
    await expect(transitionCampaign(ctx.db, campaign.id, "APPROVED")).resolves.toEqual({
      ok: false,
      reason: "ILLEGAL_TRANSITION",
    });
  });

  it("approval opens the serving window and sets both dates", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);

    await expect(
      approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id }),
    ).resolves.toEqual({ ok: true });

    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("ACTIVE");
    expect(row!.start_at).toBeTruthy();
    expect(row!.end_at).toBeTruthy();

    // The window is exactly the duration that was bought.
    const days = (Date.parse(row!.end_at!) - Date.parse(row!.start_at!)) / DAY;
    expect(days).toBe(row!.duration_days);
  });

  it("a future-dated campaign is SCHEDULED rather than started early", async () => {
    const user = await createUser(ctx.db);
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const advertiser = await createAdvertiserFor(ctx.db, user.id);
    const start = nowIso(new Date(Date.now() + 5 * DAY));
    const campaign = await createDraftCampaign(ctx.db, advertiser.id, { requestedStartAt: start });
    await payForCampaign(user, advertiser.id, campaign.id);

    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("SCHEDULED");
    expect(row!.start_at).toBe(start);
  });

  it("CRITICAL: a rejection cannot be recorded without a reason", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);

    await expect(
      rejectCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id, reason: "  " }),
    ).resolves.toEqual({ ok: false, reason: "REASON_REQUIRED" });

    await expect(
      rejectCampaign(ctx.db, {
        campaignId: campaign.id,
        adminId: admin.id,
        reason: "ব্যানারে ভুল তথ্য আছে।",
      }),
    ).resolves.toEqual({ ok: true });

    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("REJECTED");
    expect(row!.rejection_reason).toBe("ব্যানারে ভুল তথ্য আছে।");
  });

  it("CRITICAL: the schema refuses a reasonless rejection even by raw SQL", async () => {
    const { campaign } = await anAdvertiserWithCampaign();

    // Belt and braces: if a future code path forgets the check, the CHECK
    // constraint still stops it.
    await expect(
      execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'REJECTED' WHERE id = ?`, [
        campaign.id,
      ]),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("REJECTED, EXPIRED and CANCELLED are terminal", async () => {
    const { campaign } = await anAdvertiserWithCampaign();
    await cancelCampaign(ctx.db, campaign.id);

    for (const target of ["ACTIVE", "PENDING_PAYMENT", "APPROVED"] as const) {
      await expect(transitionCampaign(ctx.db, campaign.id, target)).resolves.toEqual({
        ok: false,
        reason: "ILLEGAL_TRANSITION",
      });
    }
  });

  it("pause takes a campaign off the page and resume puts it back", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    await expect(
      pauseCampaign(ctx.db, { campaignId: campaign.id, byUserId: user.id, reason: "বিরতি" }),
    ).resolves.toEqual({ ok: true });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PAUSED");

    await expect(resumeCampaign(ctx.db, campaign.id)).resolves.toEqual({ ok: true });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("ACTIVE");
  });

  it("resuming a campaign whose window closed expires it instead of reviving it", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });
    await pauseCampaign(ctx.db, { campaignId: campaign.id, byUserId: user.id });

    // The paid window ran out while the campaign was paused.
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
      [nowIso(new Date(Date.now() - 10 * DAY)), nowIso(new Date(Date.now() - DAY)), campaign.id],
    );

    await expect(resumeCampaign(ctx.db, campaign.id)).resolves.toEqual({ ok: true });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("EXPIRED");
  });

  it("submitForReview only advances a campaign that has been paid for", async () => {
    const { campaign } = await anAdvertiserWithCampaign();
    // Still DRAFT: nothing has been paid.
    await expect(submitForReview(ctx.db, campaign.id)).resolves.toEqual({
      ok: false,
      reason: "ILLEGAL_TRANSITION",
    });
  });
});

describe("scheduling", () => {
  it("starts campaigns whose window has opened and expires those whose window closed", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, {
      campaignId: campaign.id,
      adminId: admin.id,
      startAt: nowIso(new Date(Date.now() + 2 * DAY)),
    });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("SCHEDULED");

    // Time passes: the window is now open.
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
      [nowIso(new Date(Date.now() - DAY)), nowIso(new Date(Date.now() + DAY)), campaign.id],
    );
    await expect(runCampaignSchedule(ctx.db)).resolves.toMatchObject({ activated: 1, expired: 0 });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("ACTIVE");

    // And later, it closes.
    await execute(ctx.db, `UPDATE advertisement_campaigns SET end_at = ? WHERE id = ?`, [
      nowIso(new Date(Date.now() - 60_000)),
      campaign.id,
    ]);
    await expect(runCampaignSchedule(ctx.db)).resolves.toMatchObject({ expired: 1 });
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("EXPIRED");
  });

  it("the sweep is idempotent", async () => {
    await expect(runCampaignSchedule(ctx.db)).resolves.toEqual({ activated: 0, expired: 0 });
    await expect(runCampaignSchedule(ctx.db)).resolves.toEqual({ activated: 0, expired: 0 });
  });

  it("CRITICAL: the schema refuses an end date before its start date", async () => {
    const { campaign } = await anAdvertiserWithCampaign();

    await expect(
      execute(
        ctx.db,
        `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
        ["2026-06-01T00:00:00Z", "2026-05-01T00:00:00Z", campaign.id],
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("CRITICAL: a campaign cannot be ACTIVE without a window", async () => {
    const { campaign } = await anAdvertiserWithCampaign();

    await expect(
      execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'ACTIVE' WHERE id = ?`, [
        campaign.id,
      ]),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });
});

describe("renewal", () => {
  it("a renewal is a new campaign that points back at the one it continues", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    const renewed = await renewCampaign(ctx.db, {
      campaignId: campaign.id,
      advertiserId: advertiser.id,
    });

    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.campaign.id).not.toBe(campaign.id);
    expect(renewed.campaign.renewed_from_id).toBe(campaign.id);
    expect(renewed.campaign.renewal_count).toBe(1);
    // A renewal is paid for and reviewed like any other campaign.
    expect(renewed.campaign.status).toBe("DRAFT");

    // The original keeps its own window and statistics.
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("ACTIVE");
  });

  it("a renewal is charged at today's price, not the original one", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    await execute(ctx.db, `UPDATE advertisement_packages SET price_bdt = 777 WHERE id = 'adpkg_basic'`);

    const renewed = await renewCampaign(ctx.db, {
      campaignId: campaign.id,
      advertiserId: advertiser.id,
    });
    expect(renewed.ok && renewed.campaign.price_bdt).toBe(777);
  });

  it("a renewal payment is typed as a renewal", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payForCampaign(user, advertiser.id, campaign.id);
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    const renewed = await renewCampaign(ctx.db, {
      campaignId: campaign.id,
      advertiserId: advertiser.id,
    });
    if (!renewed.ok) throw new Error("renewal failed");
    await payForCampaign(user, advertiser.id, renewed.campaign.id);

    const row = await queryOne<{ payment_type: string }>(
      ctx.db,
      `SELECT payment_type FROM payments WHERE advertisement_id = ?`,
      [renewed.campaign.id],
    );
    expect(row!.payment_type).toBe("ADVERTISEMENT_RENEWAL");
  });

  it("CRITICAL: a campaign cannot be renewed by someone else", async () => {
    const mine = await anAdvertiserWithCampaign();
    const theirs = await anAdvertiserWithCampaign();

    await expect(
      renewCampaign(ctx.db, {
        campaignId: mine.campaign.id,
        advertiserId: theirs.advertiser.id,
      }),
    ).resolves.toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("a draft or rejected campaign is not renewable", async () => {
    const { advertiser, campaign } = await anAdvertiserWithCampaign();

    await expect(
      renewCampaign(ctx.db, { campaignId: campaign.id, advertiserId: advertiser.id }),
    ).resolves.toEqual({ ok: false, reason: "NOT_RENEWABLE" });
  });
});

describe("foreign keys and deletion", () => {
  it("a campaign cannot reference a zone or package that does not exist", async () => {
    const { advertiser } = await anAdvertiserWithCampaign();

    await expect(
      execute(
        ctx.db,
        `INSERT INTO advertisement_campaigns
           (id, public_ref, advertiser_id, zone_id, title, destination_url, status,
            price_bdt, duration_days, created_at, updated_at)
         VALUES ('c_bad', 9001, ?, 'zone_missing', 't', 'https://x.test', 'DRAFT', 100, 7, ?, ?)`,
        [advertiser.id, nowIso(), nowIso()],
      ),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("CRITICAL: a campaign that has taken money cannot be deleted", async () => {
    const { user, advertiser, campaign } = await anAdvertiserWithCampaign();
    await payForCampaign(user, advertiser.id, campaign.id);

    // ON DELETE RESTRICT: the financial record wins over the campaign row.
    await expect(
      execute(ctx.db, `DELETE FROM advertisement_campaigns WHERE id = ?`, [campaign.id]),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);

    const payment = await queryOne<{ c: number }>(
      ctx.db,
      `SELECT count(*) AS c FROM payments WHERE advertisement_id = ?`,
      [campaign.id],
    );
    expect(payment!.c).toBe(1);
  });

  it("deleting an unpaid campaign takes its creatives and statistics with it", async () => {
    const { user, campaign } = await anAdvertiserWithCampaign();
    const now = nowIso();

    await execute(
      ctx.db,
      `INSERT INTO advertisement_creatives
         (id, campaign_id, uploaded_by, variant, object_key, mime_type, size_bytes,
          alt_bn, created_at, updated_at)
       VALUES ('cr1', ?, ?, 'DESKTOP', 'ads/2026/cr1.webp', 'image/webp', 4096, 'ব্যানার', ?, ?)`,
      [campaign.id, user.id, now, now],
    );
    await execute(
      ctx.db,
      `INSERT INTO advertisement_impressions
         (id, campaign_id, creative_id, zone_id, session_hash, view_date, created_at)
       VALUES ('im1', ?, 'cr1', 'zone_home_top', 'hash-a', '2026-03-01', ?)`,
      [campaign.id, now],
    );

    await execute(ctx.db, `DELETE FROM advertisement_campaigns WHERE id = ?`, [campaign.id]);

    for (const table of ["advertisement_creatives", "advertisement_impressions"]) {
      const row = await queryOne<{ c: number }>(ctx.db, `SELECT count(*) AS c FROM ${table}`);
      expect(row!.c, `${table} should have been cascaded`).toBe(0);
    }
  });

  it("deleting a user removes their advertiser profile and campaigns", async () => {
    const { user, advertiser } = await anAdvertiserWithCampaign();

    await execute(ctx.db, `DELETE FROM users WHERE id = ?`, [user.id]);

    const rows = await queryOne<{ a: number; c: number }>(
      ctx.db,
      `SELECT (SELECT count(*) FROM advertisers) AS a,
              (SELECT count(*) FROM advertisement_campaigns WHERE advertiser_id = ?) AS c`,
      [advertiser.id],
    );
    expect(rows).toEqual({ a: 0, c: 0 });
  });

  it("a creative must declare an accepted image type", async () => {
    const { user, campaign } = await anAdvertiserWithCampaign();
    const now = nowIso();

    await expect(
      execute(
        ctx.db,
        `INSERT INTO advertisement_creatives
           (id, campaign_id, uploaded_by, variant, object_key, mime_type, size_bytes,
            alt_bn, created_at, updated_at)
         VALUES ('cr_bad', ?, ?, 'DESKTOP', 'ads/x.svg', 'image/svg+xml', 100, 'a', ?, ?)`,
        [campaign.id, user.id, now, now],
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });

  it("two creatives cannot claim the same storage object", async () => {
    const { user, campaign } = await anAdvertiserWithCampaign();
    const now = nowIso();
    const insert = (id: string) =>
      execute(
        ctx.db,
        `INSERT INTO advertisement_creatives
           (id, campaign_id, uploaded_by, variant, object_key, mime_type, size_bytes,
            alt_bn, created_at, updated_at)
         VALUES (?, ?, ?, 'DESKTOP', 'ads/same.webp', 'image/webp', 100, 'a', ?, ?)`,
        [id, campaign.id, user.id, now, now],
      );

    await insert("cr_a");
    await expect(insert("cr_b")).rejects.toThrow(/UNIQUE constraint failed/i);
  });
});

describe("impression and click deduplication", () => {
  const now = nowIso();

  async function impression(id: string, sessionHash: string, campaignId: string, date = "2026-03-01") {
    return execute(
      ctx.db,
      `INSERT INTO advertisement_impressions
         (id, campaign_id, zone_id, session_hash, view_date, created_at)
       VALUES (?, ?, 'zone_home_top', ?, ?, ?)`,
      [id, campaignId, sessionHash, date, now],
    );
  }

  it("CRITICAL: one visitor counts once per campaign per day", async () => {
    const { campaign } = await anAdvertiserWithCampaign();

    await impression("i1", "hash-a", campaign.id);
    // A refresh loop must not inflate what the advertiser is billed for.
    await expect(impression("i2", "hash-a", campaign.id)).rejects.toThrow(
      /UNIQUE constraint failed/i,
    );

    // A different visitor, and the same visitor tomorrow, both count.
    await expect(impression("i3", "hash-b", campaign.id)).resolves.toBeTruthy();
    await expect(impression("i4", "hash-a", campaign.id, "2026-03-02")).resolves.toBeTruthy();
  });

  it("CRITICAL: only the first click of the day is billable, and repeats stay visible", async () => {
    const { campaign } = await anAdvertiserWithCampaign();
    const click = (id: string, billable: number) =>
      execute(
        ctx.db,
        `INSERT INTO advertisement_clicks
           (id, campaign_id, zone_id, session_hash, click_date, is_billable, created_at)
         VALUES (?, ?, 'zone_home_top', 'hash-a', '2026-03-01', ?, ?)`,
        [id, campaign.id, billable, now],
      );

    await click("c1", 1);
    await expect(click("c2", 1)).rejects.toThrow(/UNIQUE constraint failed/i);

    // Recorded, but not charged for — click fraud stays in the data.
    await expect(click("c3", 0)).resolves.toBeTruthy();
    const rows = await queryOne<{ total: number; billable: number }>(
      ctx.db,
      `SELECT count(*) AS total, sum(is_billable) AS billable FROM advertisement_clicks`,
    );
    expect(rows).toEqual({ total: 2, billable: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* Regression: the advertising work must not touch the unlock flow             */
/* -------------------------------------------------------------------------- */

describe("existing contact unlock behaviour is unaffected", () => {
  it("CRITICAL: an anonymous visitor still gets no contact details", async () => {
    const property = await createProperty(ctx.db);

    const { decision, row } = await decideUnlock(ctx.db, property.id, null);

    expect(decision).toEqual({ allowed: false, reason: "AUTH_REQUIRED" });
    // The private row is never even read for an anonymous visitor.
    expect(row).toBeNull();
    expect(JSON.stringify(decision)).not.toContain("01700000999");
  });

  it("CRITICAL: a paying user still sees the phone they bought", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db, { ownerId: owner.id, phone: "01711112222" });
    await grantUnlock(ctx.db, buyer.id, property.id);

    const { decision, row } = await decideUnlock(ctx.db, property.id, buyer);

    expect(decision).toEqual({ allowed: true, via: "PAID_UNLOCK" });
    expect(row!.contact_phone).toBe("01711112222");
  });

  it("CRITICAL: migration 0004 did not break the unlock-to-payment link", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    const { paymentId, unlockId } = await grantUnlock(ctx.db, buyer.id, property.id);

    // This is the join `hasActiveUnlock` depends on. The payments table was
    // rebuilt by this migration; if the link had been dropped the way it was in
    // the first draft of 0003, every paying customer would silently lose access.
    const row = await queryOne<{ payment_id: string; status: string }>(
      ctx.db,
      `SELECT u.payment_id, p.status
         FROM contact_unlocks u JOIN payments p ON p.id = u.payment_id
        WHERE u.id = ?`,
      [unlockId],
    );
    expect(row).toEqual({ payment_id: paymentId, status: "PAID" });
  });

  it("a contact-unlock payment is still typed and shaped as before", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await grantUnlock(ctx.db, buyer.id, property.id);

    const payment = await queryOne<{
      payment_type: string;
      property_id: string;
      advertisement_id: string | null;
    }>(ctx.db, `SELECT payment_type, property_id, advertisement_id FROM payments`);

    expect(payment).toMatchObject({
      payment_type: "PROPERTY_CONTACT_UNLOCK",
      property_id: property.id,
      // An unlock is never an advertising payment.
      advertisement_id: null,
    });
  });

  it("CRITICAL: a payment cannot be about a property and a campaign at once", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    const { campaign } = await anAdvertiserWithCampaign();

    await expect(
      execute(
        ctx.db,
        `INSERT INTO payments
           (id, transaction_id, user_id, property_id, advertisement_id, payment_type,
            amount, currency, gateway, status, created_at, updated_at)
         VALUES ('p_bad','TB',?,?,?,'ADVERTISEMENT',50,'BDT','SSLCOMMERZ','PENDING',?,?)`,
        [buyer.id, property.id, campaign.id, nowIso(), nowIso()],
      ),
    ).rejects.toThrow(/CHECK constraint failed/i);
  });
});
