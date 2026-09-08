/**
 * The advertiser flow end to end, at the service layer the routes call.
 *
 * The properties that matter here are the ones a route handler could get
 * wrong: that ownership is derived from the session rather than the request,
 * that paying never publishes, and that the campaign logic is genuinely
 * gateway-neutral rather than SSLCOMMERZ with a rename.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createAdvertiserFor, createDraftCampaign, createUser } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import {
  ctr,
  getAdvertiserCampaign,
  getAdvertiserStats,
  groupCampaigns,
  listAdvertiserCampaigns,
  listAdvertiserPayments,
  listPurchasablePackages,
  listPurchasableZones,
} from "@/server/advertising/queries";
import { createCampaignPayment } from "@/server/advertising/payments";
import { settlePayment } from "@/server/payments/unlock-service";
import { approveCampaign, getCampaignById } from "@/server/advertising/campaigns";
import { execute } from "@/server/db/client";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});
afterEach(() => ctx.close());

const URLS = {
  successUrl: "https://dayarampur.com/ok",
  failUrl: "https://dayarampur.com/no",
  cancelUrl: "https://dayarampur.com/cancel",
  ipnUrl: "https://dayarampur.com/ipn",
};

async function advertiserWithCampaign() {
  const user = await createUser(ctx.db);
  const advertiser = await createAdvertiserFor(ctx.db, user.id);
  const campaign = await createDraftCampaign(ctx.db, advertiser.id);
  return { user, advertiser, campaign };
}

/** Pays through whichever gateway is handed in, then settles it. */
async function payAndSettle(
  user: Awaited<ReturnType<typeof createUser>>,
  advertiserId: string,
  campaignId: string,
  gateway = new FakeGateway(),
) {
  const created = await createCampaignPayment(ctx.db, {
    user,
    advertiserId,
    campaignId,
    gateway,
    urls: URLS,
  });
  if (created.status !== "REDIRECT") throw new Error(`unexpected ${created.status}`);
  const settled = await settlePayment(ctx.db, gateway, {
    transactionId: created.transactionId,
    validationId: `val-${created.transactionId}`,
  });
  return { created, settled };
}

describe("public catalogue", () => {
  it("offers only enabled zones and active packages", async () => {
    await execute(ctx.db, `UPDATE advertisement_zones SET is_enabled = 0 WHERE id = 'zone_home_top'`);

    const zones = await listPurchasableZones(ctx.db);
    const packages = await listPurchasablePackages(ctx.db);

    expect(zones).toHaveLength(11);
    expect(zones.map((z) => z.id)).not.toContain("zone_home_top");
    // The exclusive package ships inactive until an operator prices it.
    expect(packages.map((p) => p.id)).not.toContain("adpkg_exclusive");
  });

  it("the catalogue carries no advertiser data at all", async () => {
    await advertiserWithCampaign();

    const serialized = JSON.stringify([
      await listPurchasableZones(ctx.db),
      await listPurchasablePackages(ctx.db),
    ]);

    expect(serialized).not.toContain("দয়ারামপুর ইলেকট্রনিক্স");
    expect(serialized).not.toContain("01800000001");
  });
});

describe("owner scoping", () => {
  it("CRITICAL: a campaign is invisible to another advertiser", async () => {
    const mine = await advertiserWithCampaign();
    const theirs = await advertiserWithCampaign();

    await expect(
      getAdvertiserCampaign(ctx.db, theirs.advertiser.id, mine.campaign.id),
    ).resolves.toBeNull();
    await expect(
      getAdvertiserCampaign(ctx.db, mine.advertiser.id, mine.campaign.id),
    ).resolves.toMatchObject({ id: mine.campaign.id });
  });

  it("CRITICAL: the campaign list never leaks across advertisers", async () => {
    const mine = await advertiserWithCampaign();
    const theirs = await advertiserWithCampaign();
    await createDraftCampaign(ctx.db, theirs.advertiser.id);

    const rows = await listAdvertiserCampaigns(ctx.db, mine.advertiser.id);

    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.id === mine.campaign.id)).toBe(true);
  });

  it("CRITICAL: payments are scoped through the campaign's advertiser", async () => {
    const mine = await advertiserWithCampaign();
    const theirs = await advertiserWithCampaign();
    await payAndSettle(mine.user, mine.advertiser.id, mine.campaign.id);

    await expect(listAdvertiserPayments(ctx.db, theirs.advertiser.id)).resolves.toHaveLength(0);
    await expect(listAdvertiserPayments(ctx.db, mine.advertiser.id)).resolves.toHaveLength(1);
  });

  it("stats count only the advertiser's own campaigns", async () => {
    const mine = await advertiserWithCampaign();
    const theirs = await advertiserWithCampaign();
    await payAndSettle(theirs.user, theirs.advertiser.id, theirs.campaign.id);

    const stats = await getAdvertiserStats(ctx.db, mine.advertiser.id);

    expect(stats.campaigns).toBe(1);
    // Another advertiser's settled payment is not our spend.
    expect(stats.spentBdt).toBe(0);
  });
});

describe("payment does not publish", () => {
  it("CRITICAL: a settled payment leaves the campaign in review, with no window", async () => {
    const { user, advertiser, campaign } = await advertiserWithCampaign();

    const { settled } = await payAndSettle(user, advertiser.id, campaign.id);

    expect(settled.result).toBe("SETTLED");
    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("PENDING_REVIEW");
    expect(row!.start_at).toBeNull();
    expect(row!.end_at).toBeNull();
  });

  it("CRITICAL: only an explicit approval opens the window", async () => {
    const { user, advertiser, campaign } = await advertiserWithCampaign();
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    await payAndSettle(user, advertiser.id, campaign.id);

    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

    const row = await getCampaignById(ctx.db, campaign.id);
    expect(row!.status).toBe("ACTIVE");
    expect(row!.start_at).toBeTruthy();
  });
});

describe("gateway neutrality", () => {
  it("CRITICAL: the campaign reaches review identically through any gateway", async () => {
    // Two different adapters, same lifecycle. If SSLCOMMERZ were hard-coded
    // anywhere in the campaign path, one of these would behave differently.
    for (const gateway of [new FakeGateway(), new FakeGateway({ signatureValid: false })]) {
      const { user, advertiser, campaign } = await advertiserWithCampaign();

      await payAndSettle(user, advertiser.id, campaign.id, gateway);

      expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_REVIEW");
    }
  });

  it("a manual gateway yields instructions and publishes nothing", async () => {
    const { user, advertiser, campaign } = await advertiserWithCampaign();

    const result = await createCampaignPayment(ctx.db, {
      user,
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      gateway: new FakeGateway({ instructions: true }),
      urls: URLS,
    });

    expect(result.status).toBe("INSTRUCTIONS");
    expect((await getCampaignById(ctx.db, campaign.id))!.status).toBe("PENDING_PAYMENT");
  });
});

describe("dashboard grouping and CTR", () => {
  it("groups every lifecycle state into a visible section", async () => {
    const { advertiser } = await advertiserWithCampaign();
    const rows = await listAdvertiserCampaigns(ctx.db, advertiser.id);

    const groups = groupCampaigns(rows);

    // A DRAFT must land somewhere; a campaign that appears in no group would
    // silently vanish from the advertiser's dashboard.
    const total = Object.values(groups).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(rows.length);
  });

  it("CRITICAL: CTR handles zero impressions without dividing by zero", () => {
    expect(ctr(0, 0)).toBe(0);
    // A click with no recorded impression must not yield Infinity.
    expect(Number.isFinite(ctr(0, 5))).toBe(true);
    expect(ctr(0, 5)).toBe(0);
  });

  it("CTR is a percentage rounded to one decimal", () => {
    expect(ctr(1000, 25)).toBe(2.5);
    expect(ctr(3, 1)).toBe(33.3);
    expect(ctr(100, 100)).toBe(100);
  });
});
