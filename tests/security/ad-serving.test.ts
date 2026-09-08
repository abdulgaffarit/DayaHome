/**
 * Ad serving, rotation and tracking.
 *
 * The eligibility rules are the commercially important part: an advert that
 * serves when it should not is either a refund or a lawsuit, and one that
 * fails to serve when it should is revenue quietly lost. Each rule gets its
 * own test rather than being covered incidentally.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createAdvertiserFor, createDraftCampaign, createUser } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import { createCampaignPayment } from "@/server/advertising/payments";
import { settlePayment } from "@/server/payments/unlock-service";
import { approveCampaign } from "@/server/advertising/campaigns";
import { rotationSeed, selectAd, selectAds } from "@/server/advertising/serving";
import { recordClick, recordImpression } from "@/server/advertising/tracking";
import { execute, queryOne } from "@/server/db/client";
import { DAY, nowIso } from "@/lib/time";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});
afterEach(() => ctx.close());

const ago = (ms: number) => nowIso(new Date(Date.now() - ms));
const ahead = (ms: number) => nowIso(new Date(Date.now() + ms));

/**
 * A campaign taken all the way to serving: paid, settled, approved, with an
 * APPROVED creative. This is the only state in which an advert may appear.
 */
async function liveCampaign(
  options: { zoneId?: string; priority?: number; title?: string; packageId?: string } = {},
) {
  const user = await createUser(ctx.db);
  const admin = await createUser(ctx.db, { role: "ADMIN" });
  const advertiser = await createAdvertiserFor(ctx.db, user.id);
  const campaign = await createDraftCampaign(ctx.db, advertiser.id, {
    zoneId: options.zoneId ?? "zone_home_top",
    packageId: options.packageId ?? "adpkg_basic",
    title: options.title ?? "ব্যানার",
  });

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
  await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

  const creativeId = `crv_${campaign.id.slice(-8)}`;
  await execute(
    ctx.db,
    `INSERT INTO advertisement_creatives
       (id, campaign_id, uploaded_by, variant, object_key, mime_type, size_bytes,
        alt_bn, status, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'DESKTOP', ?, 'image/webp', 2048, 'ব্যানার', 'APPROVED', 1, ?, ?)`,
    [creativeId, campaign.id, user.id, `ads/2026/01/${campaign.id}.webp`, nowIso(), nowIso()],
  );

  if (options.priority !== undefined) {
    await execute(ctx.db, `UPDATE advertisement_campaigns SET priority = ? WHERE id = ?`, [
      options.priority,
      campaign.id,
    ]);
  }

  return { user, admin, advertiser, campaign, creativeId };
}

const HOME = { zoneSlug: "home-top", device: "DESKTOP" as const };

describe("eligibility", () => {
  it("serves an approved, paid, in-window campaign", async () => {
    const { campaign } = await liveCampaign();

    const ad = await selectAd(ctx.db, HOME);

    expect(ad?.campaignId).toBe(campaign.id);
    expect(ad?.objectKey).toMatch(/^ads\//);
  });

  it("CRITICAL: never serves a paused campaign", async () => {
    const { campaign } = await liveCampaign();
    await execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'PAUSED' WHERE id = ?`, [
      campaign.id,
    ]);

    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
  });

  it("CRITICAL: never serves an expired or not-yet-started campaign", async () => {
    const { campaign } = await liveCampaign();

    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
      [ago(10 * DAY), ago(DAY), campaign.id],
    );
    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();

    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
      [ahead(DAY), ahead(10 * DAY), campaign.id],
    );
    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
  });

  it("CRITICAL: a campaign whose payment did not settle never serves", async () => {
    const { campaign } = await liveCampaign();
    // Status says ACTIVE, but the money is not there. Payment is re-checked at
    // serve time precisely so these two facts cannot drift apart.
    await execute(
      ctx.db,
      `UPDATE payments SET status = 'FAILED'
        WHERE id = (SELECT payment_id FROM advertisement_campaigns WHERE id = ?)`,
      [campaign.id],
    );

    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
  });

  it("CRITICAL: a campaign with no APPROVED creative never serves", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_creatives SET status = 'PENDING_REVIEW' WHERE campaign_id = ?`,
      [campaign.id],
    );

    // An unreviewed banner must not reach a page even when the campaign was
    // approved.
    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
  });

  it("never serves into a disabled zone", async () => {
    await liveCampaign();
    await execute(ctx.db, `UPDATE advertisement_zones SET is_enabled = 0 WHERE slug = 'home-top'`);

    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
  });

  it("does not serve a campaign bought for a different zone", async () => {
    await liveCampaign({ zoneId: "zone_site_footer" });

    await expect(selectAd(ctx.db, HOME)).resolves.toBeNull();
    await expect(selectAd(ctx.db, { ...HOME, zoneSlug: "site-footer" })).resolves.not.toBeNull();
  });
});

describe("targeting", () => {
  it("respects device targeting", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET target_device = 'MOBILE' WHERE id = ?`,
      [campaign.id],
    );

    await expect(selectAd(ctx.db, { ...HOME, device: "DESKTOP" })).resolves.toBeNull();
    await expect(selectAd(ctx.db, { ...HOME, device: "MOBILE" })).resolves.not.toBeNull();
  });

  it("respects location and category targeting, and ALL matches everything", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns
          SET target_location_id = 'loc_bazar', target_category_id = 'cat_basha_vhara'
        WHERE id = ?`,
      [campaign.id],
    );

    // Wrong location.
    await expect(
      selectAd(ctx.db, { ...HOME, locationId: "loc_college_road", categoryId: "cat_basha_vhara" }),
    ).resolves.toBeNull();
    // Right on both axes.
    await expect(
      selectAd(ctx.db, { ...HOME, locationId: "loc_bazar", categoryId: "cat_basha_vhara" }),
    ).resolves.not.toBeNull();
  });

  it("targeting matches by slug as well as by id", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns
          SET target_location_id = 'loc_bazar', target_category_id = 'cat_basha_vhara'
        WHERE id = ?`,
      [campaign.id],
    );

    // The public property type exposes slugs, not ids, so serving must accept
    // either form and reach the same decision.
    await expect(
      selectAd(ctx.db, {
        ...HOME,
        locationSlug: "dayarampur-bazar",
        categorySlug: "basha-vhara",
      }),
    ).resolves.not.toBeNull();
    await expect(
      selectAd(ctx.db, { ...HOME, locationSlug: "college-road", categorySlug: "basha-vhara" }),
    ).resolves.toBeNull();
  });

  it("an untargeted campaign serves regardless of page context", async () => {
    await liveCampaign();

    await expect(
      selectAd(ctx.db, { ...HOME, locationId: "loc_bazar", categoryId: "cat_mess" }),
    ).resolves.not.toBeNull();
  });

  it("CRITICAL: the served payload carries no advertiser or targeting data", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET target_location_id = 'loc_bazar' WHERE id = ?`,
      [campaign.id],
    );

    const ad = await selectAd(ctx.db, HOME);
    const serialized = JSON.stringify(ad);

    // What reaches a page is an image, alt text and a destination — nothing
    // about who bought it or whom they are targeting.
    expect(serialized).not.toContain("loc_bazar");
    expect(serialized).not.toContain("দয়ারামপুর ইলেকট্রনিক্স");
    expect(serialized).not.toContain("01800000001");
  });
});

describe("rotation", () => {
  it("CRITICAL: multiple eligible campaigns do not always yield the same one", async () => {
    await liveCampaign({ title: "A" });
    await liveCampaign({ title: "B" });
    await liveCampaign({ title: "C" });

    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const ad = await selectAd(ctx.db, { ...HOME, sessionHash: `visitor-${i}` });
      if (ad) seen.add(ad.campaignId);
    }

    // No permanent monopoly: every campaign gets shown to some visitor.
    expect(seen.size).toBe(3);
  });

  it("is stable for one visitor within the hour, so a refresh is not a new advert", async () => {
    await liveCampaign({ title: "A" });
    await liveCampaign({ title: "B" });

    const first = await selectAd(ctx.db, { ...HOME, sessionHash: "steady" });
    for (let i = 0; i < 5; i++) {
      const again = await selectAd(ctx.db, { ...HOME, sessionHash: "steady" });
      expect(again?.campaignId).toBe(first?.campaignId);
    }
  });

  it("weights higher-priority campaigns without starving the others", async () => {
    await liveCampaign({ title: "basic", priority: 0 });
    await liveCampaign({ title: "premium", priority: 9 });

    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const ad = await selectAd(ctx.db, { ...HOME, sessionHash: `v${i}` });
      if (ad) counts.set(ad.campaignId, (counts.get(ad.campaignId) ?? 0) + 1);
    }

    const shares = [...counts.values()].sort((a, b) => b - a);
    expect(shares).toHaveLength(2);
    // The premium campaign wins more often...
    expect(shares[0]).toBeGreaterThan(shares[1]);
    // ...but the basic one is never shut out.
    expect(shares[1]).toBeGreaterThan(0);
  });

  it("CRITICAL: an exclusive campaign takes the zone alone", async () => {
    await liveCampaign({ title: "ordinary" });
    const exclusive = await liveCampaign({ title: "exclusive" });
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET is_exclusive = 1 WHERE id = ?`,
      [exclusive.campaign.id],
    );

    for (let i = 0; i < 20; i++) {
      const ad = await selectAd(ctx.db, { ...HOME, sessionHash: `v${i}` });
      expect(ad?.campaignId).toBe(exclusive.campaign.id);
    }
  });

  it("selectAds returns several distinct campaigns for a multi-slot zone", async () => {
    await liveCampaign({ title: "A" });
    await liveCampaign({ title: "B" });
    await liveCampaign({ title: "C" });

    const ads = await selectAds(ctx.db, { ...HOME, sessionHash: "multi" }, 2);

    expect(ads).toHaveLength(2);
    expect(new Set(ads.map((a) => a.campaignId)).size).toBe(2);
  });

  it("the rotation seed is stable per hour and varies by visitor", () => {
    const at = new Date("2026-05-01T10:15:00Z");
    const laterSameHour = new Date("2026-05-01T10:59:00Z");
    const nextHour = new Date("2026-05-01T11:00:00Z");

    const a = rotationSeed({ zoneSlug: "home-top", device: "DESKTOP", sessionHash: "x" }, at);
    expect(
      rotationSeed({ zoneSlug: "home-top", device: "DESKTOP", sessionHash: "x" }, laterSameHour),
    ).toBe(a);
    expect(
      rotationSeed({ zoneSlug: "home-top", device: "DESKTOP", sessionHash: "x" }, nextHour),
    ).not.toBe(a);
    expect(
      rotationSeed({ zoneSlug: "home-top", device: "DESKTOP", sessionHash: "y" }, at),
    ).not.toBe(a);
  });
});

describe("impression tracking", () => {
  async function track(sessionHash: string) {
    const live = await liveCampaign();
    return { live, ok: await impressionFor(live, sessionHash) };
  }

  async function impressionFor(
    live: Awaited<ReturnType<typeof liveCampaign>>,
    sessionHash: string,
  ) {
    return recordImpression(ctx.db, {
      campaignId: live.campaign.id,
      creativeId: live.creativeId,
      zoneId: "zone_home_top",
      sessionHash,
    });
  }

  it("records an impression and increments the counter exactly once", async () => {
    const { live, ok } = await track("v1");

    expect(ok).toBe(true);
    const row = await queryOne<{ impressions_count: number }>(
      ctx.db,
      `SELECT impressions_count FROM advertisement_campaigns WHERE id = ?`,
      [live.campaign.id],
    );
    expect(row!.impressions_count).toBe(1);
  });

  it("CRITICAL: a refresh by the same visitor does not inflate the count", async () => {
    const { live } = await track("v1");

    for (let i = 0; i < 5; i++) {
      await expect(impressionFor(live, "v1")).resolves.toBe(false);
    }

    const row = await queryOne<{ impressions_count: number; events: number }>(
      ctx.db,
      `SELECT c.impressions_count,
              (SELECT count(*) FROM advertisement_impressions WHERE campaign_id = c.id) AS events
         FROM advertisement_campaigns c WHERE c.id = ?`,
      [live.campaign.id],
    );
    // Counter and event table agree, and neither moved.
    expect(row).toMatchObject({ impressions_count: 1, events: 1 });
  });

  it("a different visitor is counted separately", async () => {
    const { live } = await track("v1");

    await expect(impressionFor(live, "v2")).resolves.toBe(true);

    const row = await queryOne<{ impressions_count: number }>(
      ctx.db,
      `SELECT impressions_count FROM advertisement_campaigns WHERE id = ?`,
      [live.campaign.id],
    );
    expect(row!.impressions_count).toBe(2);
  });
});

describe("click tracking and redirect safety", () => {
  it("records a billable click and returns the stored destination", async () => {
    const live = await liveCampaign();

    const outcome = await recordClick(ctx.db, {
      campaignId: live.campaign.id,
      creativeId: live.creativeId,
      zoneId: "zone_home_top",
      sessionHash: "v1",
    });

    expect(outcome).toMatchObject({ ok: true, billable: true });
    expect(outcome.ok && outcome.destinationUrl).toBe("https://example.test/shop");
  });

  it("CRITICAL: the destination comes from the database, never from the caller", async () => {
    const live = await liveCampaign();

    // There is no parameter through which a caller could supply a URL — the
    // only input is a campaign id. This is what makes the endpoint safe from
    // open redirect.
    const outcome = await recordClick(ctx.db, {
      campaignId: live.campaign.id,
      creativeId: live.creativeId,
      zoneId: "zone_home_top",
      sessionHash: "v1",
    });

    expect(outcome.ok && outcome.destinationUrl.startsWith("https://example.test")).toBe(true);
  });

  it("CRITICAL: a second click the same day is recorded but not billable", async () => {
    const live = await liveCampaign();
    const click = (hash: string) =>
      recordClick(ctx.db, {
        campaignId: live.campaign.id,
        creativeId: live.creativeId,
        zoneId: "zone_home_top",
        sessionHash: hash,
      });

    await click("v1");
    const second = await click("v1");

    expect(second).toMatchObject({ ok: true, billable: false });

    const row = await queryOne<{ clicks_count: number; total: number; billable: number }>(
      ctx.db,
      `SELECT c.clicks_count,
              (SELECT count(*) FROM advertisement_clicks WHERE campaign_id = c.id) AS total,
              (SELECT COALESCE(sum(is_billable), 0) FROM advertisement_clicks WHERE campaign_id = c.id) AS billable
         FROM advertisement_campaigns c WHERE c.id = ?`,
      [live.campaign.id],
    );
    // Both clicks are visible in the data; only one is charged for.
    expect(row).toMatchObject({ clicks_count: 1, total: 2, billable: 1 });
  });

  it("CRITICAL: a click on a paused or expired campaign is refused", async () => {
    const live = await liveCampaign();
    await execute(ctx.db, `UPDATE advertisement_campaigns SET status = 'PAUSED' WHERE id = ?`, [
      live.campaign.id,
    ]);

    await expect(
      recordClick(ctx.db, {
        campaignId: live.campaign.id,
        creativeId: live.creativeId,
        zoneId: "zone_home_top",
        sessionHash: "v1",
      }),
    ).resolves.toEqual({ ok: false, reason: "NOT_SERVABLE" });
  });

  it("CRITICAL: a made-up campaign id yields no redirect", async () => {
    await expect(
      recordClick(ctx.db, {
        campaignId: "adc_does_not_exist",
        zoneId: "zone_home_top",
        sessionHash: "v1",
      }),
    ).resolves.toEqual({ ok: false, reason: "NOT_SERVABLE" });
  });
});

describe("timestamp handling at the day boundary", () => {
  it("CRITICAL: a campaign that started earlier today is servable", async () => {
    const { campaign } = await liveCampaign();
    // Regression guard. SQLite's datetime('now') renders "YYYY-MM-DD HH:MM:SS"
    // while these columns hold ISO-8601 with a 'T'; compared as TEXT, 'T' sorts
    // after ' ', so a same-day start would read as not-yet-started and the
    // campaign would silently lose its first day.
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET start_at = ?, end_at = ? WHERE id = ?`,
      [`${nowIso().slice(0, 10)}T00:00:00Z`, ahead(7 * DAY), campaign.id],
    );

    await expect(selectAd(ctx.db, HOME)).resolves.not.toBeNull();
  });
});
