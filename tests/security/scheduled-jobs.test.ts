/**
 * Scheduled marketplace jobs.
 *
 * A listing whose window has closed must leave the site whether or not anyone
 * is browsing, and a campaign that was paid for and approved must start on its
 * date with nobody watching. Nothing here may depend on a request arriving.
 *
 * The properties asserted below:
 *
 *   * expiry and activation are detected from the data, not from a page view;
 *   * every job is idempotent — a second run in the same minute changes
 *     nothing, which is what makes at-least-once cron delivery safe;
 *   * a job that throws does not stop the others;
 *   * and the timestamp comparison that drives all of it behaves correctly at
 *     the boundary, including the exact instant of expiry.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import {
  createAdvertiserFor,
  createDraftCampaign,
  createProperty,
  createUser,
} from "../helpers/factories";
import { runScheduledJobs } from "@/server/jobs/run";
import { SCHEDULED_JOBS, findJob } from "@/server/jobs/registry";
import { approveCampaign } from "@/server/advertising/campaigns";
import { createCampaignPayment } from "@/server/advertising/payments";
import { settlePayment } from "@/server/payments/unlock-service";
import { FakeGateway } from "../helpers/fake-gateway";
import { execute, queryAll, queryOne } from "@/server/db/client";
import { DAY, nowIso } from "@/lib/time";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

const ago = (ms: number) => nowIso(new Date(Date.now() - ms));
const ahead = (ms: number) => nowIso(new Date(Date.now() + ms));

async function statusOf(table: string, id: string): Promise<string> {
  const row = await queryOne<{ status: string }>(
    ctx.db,
    `SELECT status FROM ${table} WHERE id = ?`,
    [id],
  );
  return row!.status;
}

/** An APPROVED listing with an explicit expiry. */
async function listingExpiring(at: string) {
  const property = await createProperty(ctx.db, { status: "APPROVED" });
  await execute(ctx.db, `UPDATE properties SET expires_at = ? WHERE id = ?`, [at, property.id]);
  return property;
}

/** A campaign driven all the way to a live serving window. */
async function liveCampaign() {
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
      successUrl: "https://dayarampur.com/ok",
      failUrl: "https://dayarampur.com/no",
      cancelUrl: "https://dayarampur.com/cancel",
      ipnUrl: "https://dayarampur.com/ipn",
    },
  });
  if (created.status !== "REDIRECT") throw new Error("expected redirect");
  await settlePayment(ctx.db, gateway, {
    transactionId: created.transactionId,
    validationId: `val-${created.transactionId}`,
  });
  await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });

  return { campaign, advertiser, user, admin };
}

/** Forces a campaign's window, bypassing the service, to simulate time passing. */
async function setWindow(campaignId: string, startAt: string, endAt: string, status?: string) {
  await execute(
    ctx.db,
    `UPDATE advertisement_campaigns SET start_at = ?, end_at = ?${status ? ", status = ?" : ""}
      WHERE id = ?`,
    status ? [startAt, endAt, status, campaignId] : [startAt, endAt, campaignId],
  );
}

/* -------------------------------------------------------------------------- */

describe("expired property detection", () => {
  it("expires an APPROVED listing whose window has closed", async () => {
    const property = await listingExpiring(ago(DAY));

    const report = await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
    const job = report.results.find((r) => r.name === "expire-properties")!;
    expect(job).toMatchObject({ ok: true, changed: 1 });
  });

  it("leaves a listing whose window is still open alone", async () => {
    const property = await listingExpiring(ahead(DAY));

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("APPROVED");
  });

  it("leaves a listing with no expiry date alone", async () => {
    const property = await createProperty(ctx.db, { status: "APPROVED" });

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("APPROVED");
  });

  it("does not resurrect or re-expire a listing in another status", async () => {
    // A PAUSED or RENTED listing is out of the public index already; the sweep
    // must not reclassify it as EXPIRED and misreport why it is not showing.
    for (const status of ["PAUSED", "RENTED", "DRAFT"]) {
      const property = await createProperty(ctx.db, { status: "APPROVED" });
      await execute(ctx.db, `UPDATE properties SET expires_at = ?, status = ? WHERE id = ?`, [
        ago(DAY),
        status,
        property.id,
      ]);

      await runScheduledJobs(ctx.db);

      expect(await statusOf("properties", property.id)).toBe(status);
    }
  });

  it("expires every stale listing in one pass", async () => {
    for (let i = 0; i < 5; i++) await listingExpiring(ago(DAY));

    const report = await runScheduledJobs(ctx.db);

    expect(report.results.find((r) => r.name === "expire-properties")!.changed).toBe(5);
  });
});

describe("expired campaign detection", () => {
  it("expires a campaign whose window has closed", async () => {
    const { campaign } = await liveCampaign();
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    const report = await runScheduledJobs(ctx.db);

    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("EXPIRED");
    expect(report.results.find((r) => r.name === "advertising-schedule")!.detail).toMatchObject({
      expired: 1,
    });
  });

  it("expires a PAUSED campaign whose paid window ran out", async () => {
    const { campaign, user } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET status = 'PAUSED', paused_by = ? WHERE id = ?`,
      [user.id, campaign.id],
    );
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    await runScheduledJobs(ctx.db);

    // Pausing does not buy extra days.
    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("EXPIRED");
  });

  it("leaves a running campaign inside its window alone", async () => {
    const { campaign } = await liveCampaign();

    await runScheduledJobs(ctx.db);

    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("ACTIVE");
  });

  it("never touches a campaign that has not been approved", async () => {
    const user = await createUser(ctx.db);
    const advertiser = await createAdvertiserFor(ctx.db, user.id);
    const draft = await createDraftCampaign(ctx.db, advertiser.id);

    await runScheduledJobs(ctx.db);

    // A DRAFT has no window, so the sweep must not invent one for it.
    expect(await statusOf("advertisement_campaigns", draft.id)).toBe("DRAFT");
  });
});

describe("scheduled campaign activation", () => {
  it("starts a campaign when its window opens, with no request involved", async () => {
    const { campaign, admin } = await liveCampaign();
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });
    await setWindow(campaign.id, ahead(2 * DAY), ahead(9 * DAY), "SCHEDULED");
    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("SCHEDULED");

    // Nothing happens while the start date is still ahead.
    await runScheduledJobs(ctx.db);
    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("SCHEDULED");

    // The start date arrives.
    await setWindow(campaign.id, ago(60_000), ahead(7 * DAY), "SCHEDULED");
    const report = await runScheduledJobs(ctx.db);

    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("ACTIVE");
    expect(report.results.find((r) => r.name === "advertising-schedule")!.detail).toMatchObject({
      activated: 1,
    });
  });

  it("records when the campaign actually went live", async () => {
    const { campaign, admin } = await liveCampaign();
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });
    await setWindow(campaign.id, ago(60_000), ahead(7 * DAY), "SCHEDULED");
    await execute(ctx.db, `UPDATE advertisement_campaigns SET activated_at = NULL WHERE id = ?`, [
      campaign.id,
    ]);

    await runScheduledJobs(ctx.db);

    const row = await queryOne<{ activated_at: string | null }>(
      ctx.db,
      `SELECT activated_at FROM advertisement_campaigns WHERE id = ?`,
      [campaign.id],
    );
    expect(row!.activated_at).toBeTruthy();
  });

  it("CRITICAL: a campaign whose whole window passed between runs ends EXPIRED, not stuck", async () => {
    const { campaign, admin } = await liveCampaign();
    await approveCampaign(ctx.db, { campaignId: campaign.id, adminId: admin.id });
    // Scheduled to run last week, for one day. The cron did not fire in time.
    await setWindow(campaign.id, ago(8 * DAY), ago(7 * DAY), "SCHEDULED");

    await runScheduledJobs(ctx.db);

    // This is why activation and expiry are one job in a fixed order: a
    // separate expiry job that ran first would leave this SCHEDULED forever.
    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("EXPIRED");
  });
});

describe("repeated execution", () => {
  it("CRITICAL: running twice changes nothing the second time", async () => {
    await listingExpiring(ago(DAY));
    const { campaign } = await liveCampaign();
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    const first = await runScheduledJobs(ctx.db);
    const second = await runScheduledJobs(ctx.db);

    expect(first.totalChanged).toBeGreaterThan(0);
    // At-least-once cron delivery is only safe because of this.
    expect(second.totalChanged).toBe(0);
    expect(second.failed).toBe(0);
  });

  it("stays a no-op over many runs", async () => {
    const property = await listingExpiring(ago(DAY));

    for (let i = 0; i < 5; i++) await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
    const runs = await queryAll<{ c: number }>(
      ctx.db,
      `SELECT count(*) AS c FROM admin_logs WHERE action = 'CRON_RUN'`,
    );
    expect(runs[0].c).toBe(5);
  });

  it("CRITICAL: overlapping runs cannot both apply the same transition", async () => {
    await listingExpiring(ago(DAY));
    const { campaign } = await liveCampaign();
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    // Two invocations racing, as an overrunning cron would produce.
    const [a, b] = await Promise.all([runScheduledJobs(ctx.db), runScheduledJobs(ctx.db)]);

    // Exactly one of them did the work; the transition happened once.
    expect(a.totalChanged + b.totalChanged).toBe(2);
  });

  it("an empty marketplace is a clean no-op", async () => {
    const report = await runScheduledJobs(ctx.db);

    expect(report.totalChanged).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(SCHEDULED_JOBS.length);
  });
});

describe("already-expired records", () => {
  it("does not re-expire an already EXPIRED listing", async () => {
    const property = await createProperty(ctx.db, { status: "APPROVED" });
    await execute(ctx.db, `UPDATE properties SET expires_at = ?, status = 'EXPIRED' WHERE id = ?`, [
      ago(30 * DAY),
      property.id,
    ]);

    const report = await runScheduledJobs(ctx.db);

    expect(report.results.find((r) => r.name === "expire-properties")!.changed).toBe(0);
  });

  it("does not disturb an already EXPIRED campaign or overwrite when it ended", async () => {
    const { campaign } = await liveCampaign();
    await setWindow(campaign.id, ago(10 * DAY), ago(2 * DAY));
    await runScheduledJobs(ctx.db);

    const first = await queryOne<{ expired_at: string }>(
      ctx.db,
      `SELECT expired_at FROM advertisement_campaigns WHERE id = ?`,
      [campaign.id],
    );

    const report = await runScheduledJobs(ctx.db);

    expect(report.results.find((r) => r.name === "advertising-schedule")!.changed).toBe(0);
    const second = await queryOne<{ expired_at: string }>(
      ctx.db,
      `SELECT expired_at FROM advertisement_campaigns WHERE id = ?`,
      [campaign.id],
    );
    // The recorded end time is when it really ended, not when a later sweep ran.
    expect(second!.expired_at).toBe(first!.expired_at);
  });

  it("a CANCELLED campaign is never expired out from under its record", async () => {
    const { campaign } = await liveCampaign();
    await execute(
      ctx.db,
      `UPDATE advertisement_campaigns SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?`,
      [nowIso(), campaign.id],
    );
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    await runScheduledJobs(ctx.db);

    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("CANCELLED");
  });
});

describe("timestamp and date-boundary behaviour", () => {
  it("expires at the exact instant, not a second later", async () => {
    // The comparison is `expires_at <= now`, so the boundary itself expires.
    const property = await listingExpiring(nowIso());

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
  });

  it("one second in the future survives the sweep", async () => {
    const property = await listingExpiring(ahead(1500));

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("APPROVED");
  });

  it("everything is compared in UTC regardless of the host timezone", async () => {
    // These strings carry an explicit Z; SQLite compares them as text, so the
    // machine's local timezone can play no part. A listing expiring at 23:00
    // UTC must not survive because the server happens to sit in UTC+6.
    const property = await listingExpiring("2020-01-01T23:00:00Z");

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
    expect(nowIso()).toMatch(/Z$/);
  });

  it("survives a UTC day boundary in either direction", async () => {
    const justBefore = await listingExpiring("2026-03-01T23:59:59Z");
    const justAfter = await listingExpiring("2099-03-02T00:00:00Z");

    await runScheduledJobs(ctx.db);

    expect(await statusOf("properties", justBefore.id)).toBe("EXPIRED");
    expect(await statusOf("properties", justAfter.id)).toBe("APPROVED");
  });

  it("CRITICAL: every timestamp the app writes is second-precision UTC", async () => {
    // This is load-bearing, not cosmetic. SQLite compares these as TEXT, and
    // "…07.500Z" sorts BEFORE "…07Z" because '.' < 'Z' — so a millisecond
    // timestamp would compare as EARLIER than a second-precision one from the
    // same second, and a listing could expire up to a second early. `nowIso()`
    // strips milliseconds, which is what keeps the ordering honest.
    const wrong = await queryOne<{ c: number }>(
      ctx.db,
      `SELECT ('2026-09-03T18:52:07.500Z' <= '2026-09-03T18:52:07Z') AS c`,
    );
    expect(wrong!.c).toBe(1); // documents the hazard

    const property = await listingExpiring(ago(DAY));
    await runScheduledJobs(ctx.db);

    const row = await queryOne<{ updated_at: string }>(
      ctx.db,
      `SELECT updated_at FROM properties WHERE id = ?`,
      [property.id],
    );
    // ...and proves the convention holds where it matters.
    expect(row!.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("job isolation and reporting", () => {
  it("CRITICAL: one failing job does not stop the others", async () => {
    const property = await listingExpiring(ago(DAY));

    // Break the advertising job specifically, then confirm listings still expire.
    await execute(ctx.db, `DROP TABLE advertisement_campaigns`);

    const report = await runScheduledJobs(ctx.db);

    expect(report.failed).toBe(1);
    expect(report.results.find((r) => r.name === "advertising-schedule")!.ok).toBe(false);
    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
  });

  it("records every run in the audit trail, failures included", async () => {
    await execute(ctx.db, `DROP TABLE advertisement_campaigns`);

    await runScheduledJobs(ctx.db, { cron: "0 * * * *" });

    const row = await queryOne<{ metadata: string; entity_id: string; admin_id: string | null }>(
      ctx.db,
      `SELECT metadata, entity_id, admin_id FROM admin_logs WHERE action = 'CRON_RUN'`,
    );
    expect(row!.entity_id).toBe("0 * * * *");
    // No human performed this.
    expect(row!.admin_id).toBeNull();
    expect(JSON.parse(row!.metadata)).toMatchObject({ failed: 1 });
  });

  it("can run a single named job", async () => {
    const property = await listingExpiring(ago(DAY));
    const { campaign } = await liveCampaign();
    await setWindow(campaign.id, ago(10 * DAY), ago(DAY));

    const report = await runScheduledJobs(ctx.db, { only: ["expire-properties"] });

    expect(report.results).toHaveLength(1);
    expect(await statusOf("properties", property.id)).toBe("EXPIRED");
    // The job that was not asked for did not run.
    expect(await statusOf("advertisement_campaigns", campaign.id)).toBe("ACTIVE");
  });

  it("every registered job has a unique name and a summary", () => {
    const names = SCHEDULED_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const job of SCHEDULED_JOBS) expect(job.summary.length).toBeGreaterThan(10);
    expect(findJob("expire-properties")).toBeTruthy();
    expect(findJob("no-such-job")).toBeUndefined();
  });
});

describe("the worker is actually wired for cron", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("CRITICAL: the Worker entry exports a scheduled handler", () => {
    // Without this export Cloudflare has nothing to deliver the trigger to,
    // and the cron would silently do nothing.
    const worker = read("src/worker.ts");
    expect(worker).toMatch(/async scheduled\s*\(/);
    expect(worker).toContain("runScheduledJobs");
  });

  it("CRITICAL: wrangler.jsonc points at that entry, not at vinext's own", () => {
    const config = read("wrangler.jsonc");
    expect(config).toContain('"main": "src/worker.ts"');
    // vinext's handler exports only `fetch`; using it directly loses the cron.
    expect(config).not.toContain('"main": "vinext/server/fetch-handler"');
  });

  it("CRITICAL: every environment declares a cron trigger", () => {
    const config = read("wrangler.jsonc");
    // Top level plus staging plus production: the generated config flattens
    // only one environment, so each must carry its own.
    expect(config.match(/"crons"/g) ?? []).toHaveLength(3);
  });
});
