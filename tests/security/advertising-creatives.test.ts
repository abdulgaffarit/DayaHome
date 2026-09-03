/**
 * Banner uploads and destination URLs.
 *
 * These are the two places advertiser-controlled data reaches a page: bytes
 * that become an <img>, and a string that becomes an href. Both are treated as
 * hostile.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createAdvertiserFor, createDraftCampaign, createUser } from "../helpers/factories";
import { FakeBucket, asBucket, pngBytes, svgBytes } from "../helpers/fake-bucket";
import { addCreative, listCreatives, removeCreative, MAX_BANNER_BYTES } from "@/server/advertising/creatives";
import { destinationUrlSchema, campaignDraftSchema, advertiserRegistrationSchema } from "@/domain/advertising-schemas";
import { execute } from "@/server/db/client";

let ctx: TestDb;
let bucket: FakeBucket;

beforeEach(() => {
  ctx = createTestDatabase();
  bucket = new FakeBucket();
});

afterEach(() => ctx.close());

async function aCampaign() {
  const user = await createUser(ctx.db);
  const advertiser = await createAdvertiserFor(ctx.db, user.id);
  const campaign = await createDraftCampaign(ctx.db, advertiser.id);
  return { user, advertiser, campaign };
}

const upload = (
  args: { advertiserId: string; campaignId: string; uploadedBy: string },
  bytes = pngBytes(),
) =>
  addCreative(ctx.db, asBucket(bucket), {
    ...args,
    variant: "DESKTOP" as const,
    altBn: "দোকানের বিজ্ঞাপন",
    bytes,
  });

describe("destination URLs", () => {
  it("CRITICAL: refuses every scheme that can execute script", () => {
    const attacks = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ];

    for (const attack of attacks) {
      expect(destinationUrlSchema.safeParse(attack).success, attack).toBe(false);
    }
  });

  it("CRITICAL: refuses embedded credentials, which disguise the real host", () => {
    expect(
      destinationUrlSchema.safeParse("https://dayarampur.com@evil.test/").success,
    ).toBe(false);
  });

  it("accepts an ordinary business link and stores the parsed form", () => {
    const result = destinationUrlSchema.safeParse("https://example.test/shop?ref=দয়ারামপুর");
    expect(result.success).toBe(true);
    expect(result.data).toContain("https://example.test/shop");
  });

  it("refuses a bare word or a hostname without a dot", () => {
    for (const value of ["shop", "https://localhost", "not a url"]) {
      expect(destinationUrlSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("campaign input validation", () => {
  it("CRITICAL: carries no price, duration or priority field", () => {
    const parsed = campaignDraftSchema.parse({
      zoneId: "zone_home_top",
      packageId: "adpkg_basic",
      title: "আমার দোকান",
      destinationUrl: "https://example.test",
      // Anything an attacker adds here is dropped, not honoured.
      priceBdt: 1,
      durationDays: 3650,
      priority: 9999,
    });

    expect(parsed).not.toHaveProperty("priceBdt");
    expect(parsed).not.toHaveProperty("durationDays");
    expect(parsed).not.toHaveProperty("priority");
  });

  it("rejects an id containing path or SQL characters", () => {
    for (const bad of ["../../etc", "a'; DROP TABLE properties;--", "id with space"]) {
      const result = campaignDraftSchema.safeParse({
        zoneId: bad,
        packageId: "adpkg_basic",
        title: "নাম",
        destinationUrl: "https://example.test",
      });
      expect(result.success, bad).toBe(false);
    }
  });

  it("normalises a phone number and accepts an optional website", () => {
    const parsed = advertiserRegistrationSchema.parse({
      businessName: "দয়ারামপুর ইলেকট্রনিক্স",
      contactPerson: "মোঃ করিম",
      businessPhone: "+8801712345678",
      businessEmail: "",
      websiteUrl: "",
    });
    expect(parsed.businessPhone).toBe("01712345678");
    expect(parsed.businessEmail).toBeUndefined();
    expect(parsed.websiteUrl).toBeUndefined();
  });
});

describe("banner uploads", () => {
  it("stores a real PNG under a server-generated key", async () => {
    const { user, advertiser, campaign } = await aCampaign();

    const result = await upload({
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      uploadedBy: user.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.creative.mime_type).toBe("image/png");
    expect(result.creative.width).toBe(728);
    // Every banner starts unreviewed, whatever the campaign's own state.
    expect(result.creative.status).toBe("PENDING_REVIEW");
    expect(result.creative.object_key).toMatch(/^ads\/\d{4}\/\d{2}\//);
    expect(bucket.objects.has(result.creative.object_key)).toBe(true);
  });

  it("CRITICAL: an SVG is refused however it is labelled", async () => {
    const { user, advertiser, campaign } = await aCampaign();

    // SVG can carry script, which is why it is not in the allowlist. The
    // decision is made from the bytes; there is no filename or Content-Type
    // to lie with.
    const result = await upload(
      { advertiserId: advertiser.id, campaignId: campaign.id, uploadedBy: user.id },
      svgBytes(),
    );

    expect(result).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(bucket.objects.size).toBe(0);
  });

  it("CRITICAL: a file with a PNG extension but other bytes is refused", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    const phpPayload = new TextEncoder().encode("<?php system($_GET['c']); ?>");

    const result = await upload(
      { advertiserId: advertiser.id, campaignId: campaign.id, uploadedBy: user.id },
      phpPayload,
    );

    expect(result).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(bucket.objects.size).toBe(0);
  });

  it("refuses an oversized or empty file before touching storage", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    const args = { advertiserId: advertiser.id, campaignId: campaign.id, uploadedBy: user.id };

    const huge = new Uint8Array(MAX_BANNER_BYTES + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

    await expect(upload(args, huge)).resolves.toEqual({ ok: false, reason: "TOO_LARGE" });
    await expect(upload(args, new Uint8Array(0))).resolves.toEqual({ ok: false, reason: "EMPTY" });
    expect(bucket.objects.size).toBe(0);
  });

  it("CRITICAL: a banner cannot be attached to another advertiser's campaign", async () => {
    const mine = await aCampaign();
    const theirs = await aCampaign();

    const result = await upload({
      advertiserId: theirs.advertiser.id,
      campaignId: mine.campaign.id,
      uploadedBy: theirs.user.id,
    });

    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(bucket.objects.size).toBe(0);
  });

  it("CRITICAL: artwork cannot be swapped once the campaign is live", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns
          SET status = 'ACTIVE', start_at = '2026-01-01T00:00:00Z', end_at = '2099-01-01T00:00:00Z'
        WHERE id = ?`,
      [campaign.id],
    );

    // The banner on the page must be the one that was reviewed.
    const result = await upload({
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      uploadedBy: user.id,
    });

    expect(result).toEqual({ ok: false, reason: "NOT_EDITABLE" });
  });

  it("enforces the package's creative limit", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    const args = { advertiserId: advertiser.id, campaignId: campaign.id, uploadedBy: user.id };

    // adpkg_basic allows 2.
    await expect(upload(args)).resolves.toMatchObject({ ok: true });
    await expect(upload(args)).resolves.toMatchObject({ ok: true });
    await expect(upload(args)).resolves.toEqual({ ok: false, reason: "TOO_MANY" });

    expect(await listCreatives(ctx.db, campaign.id)).toHaveLength(2);
  });

  it("two uploads never collide, even from the same user in the same second", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    const args = { advertiserId: advertiser.id, campaignId: campaign.id, uploadedBy: user.id };

    const a = await upload(args);
    const b = await upload(args);

    expect(a.ok && b.ok).toBe(true);
    expect(bucket.objects.size).toBe(2);
  });

  it("removing a draft banner deletes the row and the stored object", async () => {
    const { user, advertiser, campaign } = await aCampaign();
    const created = await upload({
      advertiserId: advertiser.id,
      campaignId: campaign.id,
      uploadedBy: user.id,
    });
    if (!created.ok) throw new Error("upload failed");

    await expect(
      removeCreative(ctx.db, asBucket(bucket), {
        advertiserId: advertiser.id,
        creativeId: created.creative.id,
      }),
    ).resolves.toBe(true);

    expect(await listCreatives(ctx.db, campaign.id)).toHaveLength(0);
    expect(bucket.objects.size).toBe(0);
  });

  it("CRITICAL: one advertiser cannot delete another's banner", async () => {
    const mine = await aCampaign();
    const theirs = await aCampaign();
    const created = await upload({
      advertiserId: mine.advertiser.id,
      campaignId: mine.campaign.id,
      uploadedBy: mine.user.id,
    });
    if (!created.ok) throw new Error("upload failed");

    await expect(
      removeCreative(ctx.db, asBucket(bucket), {
        advertiserId: theirs.advertiser.id,
        creativeId: created.creative.id,
      }),
    ).resolves.toBe(false);
    expect(bucket.objects.size).toBe(1);
  });
});
