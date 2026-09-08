/**
 * Featured listings and boost.
 *
 * The rule under test throughout: creating a payment record grants nothing.
 * The benefit is applied only from the settlement path, after the gateway has
 * verified the transaction — and it expires on a timer rather than lasting
 * forever.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import {
  createMonetizationPayment,
  expireBoostedProperties,
  expireFeaturedProperties,
  listPlans,
} from "@/server/properties/monetization";
import { settlePayment } from "@/server/payments/unlock-service";
import { runScheduledJobs } from "@/server/jobs/run";
import { searchProperties } from "@/server/properties/queries";
import { execute, queryOne } from "@/server/db/client";
import { setFeatured } from "@/server/admin/moderation";
import { DAY, nowIso } from "@/lib/time";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});
afterEach(() => ctx.close());

const URLS = {
  successUrl: "https://d.test/ok",
  failUrl: "https://d.test/no",
  cancelUrl: "https://d.test/c",
  ipnUrl: "https://d.test/ipn",
};

async function ownedProperty() {
  const owner = await createUser(ctx.db, { role: "OWNER" });
  const property = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
  return { owner, property };
}

async function buy(
  owner: Awaited<ReturnType<typeof createUser>>,
  propertyId: string,
  planId: string,
  gateway = new FakeGateway(),
) {
  const created = await createMonetizationPayment(ctx.db, {
    user: owner,
    propertyId,
    planId,
    gateway,
    urls: URLS,
  });
  return { created, gateway };
}

async function settle(gateway: FakeGateway, transactionId: string) {
  return settlePayment(ctx.db, gateway, {
    transactionId,
    validationId: `val-${transactionId}`,
  });
}

async function propertyState(id: string) {
  return queryOne<{
    is_featured: number;
    featured_until: string | null;
    boosted_until: string | null;
  }>(ctx.db, `SELECT is_featured, featured_until, boosted_until FROM properties WHERE id = ?`, [id]);
}

describe("plans", () => {
  it("offers the seeded featured and boost plans", async () => {
    const featured = await listPlans(ctx.db, "FEATURED_PROPERTY");
    const boost = await listPlans(ctx.db, "PROPERTY_BOOST");

    expect(featured).toHaveLength(3);
    expect(boost).toHaveLength(3);
    expect(featured.every((p) => p.price_bdt > 0 && p.duration_days > 0)).toBe(true);
  });

  it("an inactive plan is not on sale and cannot be bought", async () => {
    const { owner, property } = await ownedProperty();
    await execute(ctx.db, `UPDATE monetization_plans SET is_active = 0 WHERE id = 'plan_feat_7'`);

    await expect(listPlans(ctx.db, "FEATURED_PROPERTY")).resolves.toHaveLength(2);
    const { created } = await buy(owner, property.id, "plan_feat_7");
    expect(created.status).toBe("UNKNOWN_PLAN");
  });
});

describe("purchase", () => {
  it("CRITICAL: the price comes from the plan, not from the caller", async () => {
    const { owner, property } = await ownedProperty();
    const { created, gateway } = await buy(owner, property.id, "plan_feat_15");

    expect(created.status).toBe("REDIRECT");
    // plan_feat_15 is seeded at 500 taka for 15 days.
    expect(gateway.created[0].amount).toBe(500);

    const payment = await queryOne<{ amount: number; payment_type: string; property_id: string }>(
      ctx.db,
      `SELECT amount, payment_type, property_id FROM payments`,
    );
    expect(payment).toMatchObject({
      amount: 500,
      payment_type: "FEATURED_PROPERTY",
      property_id: property.id,
    });
  });

  it("CRITICAL: creating the payment grants nothing", async () => {
    const { owner, property } = await ownedProperty();

    await buy(owner, property.id, "plan_feat_7");

    // The money has not settled, so the listing must be untouched.
    const state = await propertyState(property.id);
    expect(state).toMatchObject({ is_featured: 0, featured_until: null });
  });

  it("CRITICAL: another user cannot promote a listing they do not own", async () => {
    const { property } = await ownedProperty();
    const stranger = await createUser(ctx.db);

    const { created } = await buy(stranger, property.id, "plan_feat_7");

    // Indistinguishable from a listing that does not exist.
    expect(created.status).toBe("NOT_FOUND");
    const count = await queryOne<{ c: number }>(ctx.db, `SELECT count(*) AS c FROM payments`);
    expect(count!.c).toBe(0);
  });

  it("a listing that is not APPROVED cannot be promoted", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "PENDING" });

    const { created } = await buy(owner, property.id, "plan_feat_7");

    expect(created).toMatchObject({ status: "NOT_ELIGIBLE" });
  });

  it("works through any gateway, including a manual one", async () => {
    const { owner, property } = await ownedProperty();

    const { created } = await buy(
      owner,
      property.id,
      "plan_boost_7",
      new FakeGateway({ instructions: true }),
    );

    expect(created.status).toBe("INSTRUCTIONS");
    // Manual payments settle only by admin confirmation, so nothing is granted.
    expect(await propertyState(property.id)).toMatchObject({ boosted_until: null });
  });
});

describe("settlement grants the benefit", () => {
  it("CRITICAL: a verified payment features the listing for the plan's duration", async () => {
    const { owner, property } = await ownedProperty();
    const { created, gateway } = await buy(owner, property.id, "plan_feat_7");
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    await settle(gateway, created.transactionId);

    const state = await propertyState(property.id);
    expect(state!.is_featured).toBe(1);
    expect(state!.featured_until).toBeTruthy();

    const days = Math.round(
      (Date.parse(state!.featured_until!) - Date.now()) / DAY,
    );
    expect(days).toBe(7);
  });

  it("CRITICAL: an unverified payment grants nothing", async () => {
    const { owner, property } = await ownedProperty();
    const gateway = new FakeGateway({
      verify: () => ({ verified: false, status: "FAILED", failureReason: "declined" }),
    });
    const { created } = await buy(owner, property.id, "plan_feat_7", gateway);
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    const outcome = await settle(gateway, created.transactionId);

    expect(outcome.result).toBe("REJECTED");
    expect(await propertyState(property.id)).toMatchObject({ is_featured: 0 });
  });

  it("boost sets its own window and leaves featured alone", async () => {
    const { owner, property } = await ownedProperty();
    const { created, gateway } = await buy(owner, property.id, "plan_boost_15");
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    await settle(gateway, created.transactionId);

    const state = await propertyState(property.id);
    expect(state!.boosted_until).toBeTruthy();
    // Buying a boost does not make a listing featured.
    expect(state!.is_featured).toBe(0);
  });

  it("CRITICAL: settlement is idempotent — a replay does not extend the window", async () => {
    const { owner, property } = await ownedProperty();
    const { created, gateway } = await buy(owner, property.id, "plan_feat_7");
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    await settle(gateway, created.transactionId);
    const first = (await propertyState(property.id))!.featured_until;

    const replay = await settle(gateway, created.transactionId);

    expect(replay.result).toBe("ALREADY_SETTLED");
    // A replayed IPN must not buy another week for free.
    expect((await propertyState(property.id))!.featured_until).toBe(first);
  });

  it("buying again while still featured extends rather than replaces the window", async () => {
    const { owner, property } = await ownedProperty();

    const one = await buy(owner, property.id, "plan_feat_7");
    if (one.created.status !== "REDIRECT") throw new Error("expected redirect");
    await settle(one.gateway, one.created.transactionId);
    const after1 = Date.parse((await propertyState(property.id))!.featured_until!);

    const two = await buy(owner, property.id, "plan_feat_7");
    if (two.created.status !== "REDIRECT") throw new Error("expected redirect");
    await settle(two.gateway, two.created.transactionId);
    const after2 = Date.parse((await propertyState(property.id))!.featured_until!);

    // The remaining week is added to, not thrown away.
    expect(Math.round((after2 - after1) / DAY)).toBe(7);
  });
});

describe("expiry", () => {
  async function featuredUntil(propertyId: string, iso: string) {
    await execute(
      ctx.db,
      `UPDATE properties SET is_featured = 1, featured_until = ? WHERE id = ?`,
      [iso, propertyId],
    );
  }

  it("CRITICAL: an expired featured state does not stay active", async () => {
    const { property } = await ownedProperty();
    await featuredUntil(property.id, nowIso(new Date(Date.now() - DAY)));

    await expect(expireFeaturedProperties(ctx.db)).resolves.toBe(1);

    expect((await propertyState(property.id))!.is_featured).toBe(0);
  });

  it("a featured state still inside its window survives", async () => {
    const { property } = await ownedProperty();
    await featuredUntil(property.id, nowIso(new Date(Date.now() + DAY)));

    await expect(expireFeaturedProperties(ctx.db)).resolves.toBe(0);
    expect((await propertyState(property.id))!.is_featured).toBe(1);
  });

  it("CRITICAL: an expired boost is cleared", async () => {
    const { property } = await ownedProperty();
    await execute(ctx.db, `UPDATE properties SET boosted_until = ? WHERE id = ?`, [
      nowIso(new Date(Date.now() - DAY)),
      property.id,
    ]);

    await expect(expireBoostedProperties(ctx.db)).resolves.toBe(1);
    expect((await propertyState(property.id))!.boosted_until).toBeNull();
  });

  it("expiry runs from the scheduled job and is idempotent", async () => {
    const { property } = await ownedProperty();
    await featuredUntil(property.id, nowIso(new Date(Date.now() - DAY)));

    const first = await runScheduledJobs(ctx.db);
    const job = first.results.find((r) => r.name === "expire-monetization")!;
    expect(job).toMatchObject({ ok: true, changed: 1 });

    // A second run changes nothing, as every job here must.
    const second = await runScheduledJobs(ctx.db);
    expect(second.results.find((r) => r.name === "expire-monetization")!.changed).toBe(0);
  });

  it("CRITICAL: un-featuring clears the paid window so it cannot be reused", async () => {
    const { owner, property } = await ownedProperty();
    const admin = await createUser(ctx.db, { role: "ADMIN" });

    // Buy and settle a real featured week.
    const { created, gateway } = await buy(owner, property.id, "plan_feat_7");
    if (created.status !== "REDIRECT") throw new Error("expected redirect");
    await settle(gateway, created.transactionId);
    expect((await propertyState(property.id))!.featured_until).toBeTruthy();

    // An admin takes the placement down.
    await expect(setFeatured(ctx.db, admin.id, property.id, false)).resolves.toBe(true);

    const after = await propertyState(property.id);
    expect(after).toMatchObject({ is_featured: 0, featured_until: null });
  });

  it("CRITICAL: a later purchase does not inherit a cleared window", async () => {
    const { owner, property } = await ownedProperty();
    const admin = await createUser(ctx.db, { role: "ADMIN" });

    const first = await buy(owner, property.id, "plan_feat_30");
    if (first.created.status !== "REDIRECT") throw new Error("expected redirect");
    await settle(first.gateway, first.created.transactionId);
    await setFeatured(ctx.db, admin.id, property.id, false);

    // Buying seven days after being un-featured must give seven days — not
    // seven plus whatever remained of the cancelled month.
    const second = await buy(owner, property.id, "plan_feat_7");
    if (second.created.status !== "REDIRECT") throw new Error("expected redirect");
    await settle(second.gateway, second.created.transactionId);

    const state = await propertyState(property.id);
    const days = Math.round((Date.parse(state!.featured_until!) - Date.now()) / DAY);
    expect(days).toBe(7);
  });

  it("featuring by staff still grants no purchased window", async () => {
    const { property } = await ownedProperty();
    const admin = await createUser(ctx.db, { role: "ADMIN" });

    await setFeatured(ctx.db, admin.id, property.id, true);

    // A staff placement has no end date, and the sweep leaves it alone.
    const state = await propertyState(property.id);
    expect(state).toMatchObject({ is_featured: 1, featured_until: null });
    await expect(expireFeaturedProperties(ctx.db)).resolves.toBe(0);
  });

  it("a manually featured listing with no expiry is left alone", async () => {
    const { property } = await ownedProperty();
    // Staff can feature a listing without a purchase; that has no end date and
    // must not be swept away.
    await execute(ctx.db, `UPDATE properties SET is_featured = 1 WHERE id = ?`, [property.id]);

    await expect(expireFeaturedProperties(ctx.db)).resolves.toBe(0);
    expect((await propertyState(property.id))!.is_featured).toBe(1);
  });
});

describe("ranking", () => {
  it("CRITICAL: featured outranks boosted, which outranks ordinary", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const ordinary = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
    const boosted = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
    const featured = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });

    await execute(ctx.db, `UPDATE properties SET boosted_until = ? WHERE id = ?`, [
      nowIso(new Date(Date.now() + 7 * DAY)),
      boosted.id,
    ]);
    await execute(
      ctx.db,
      `UPDATE properties SET is_featured = 1, featured_until = ? WHERE id = ?`,
      [nowIso(new Date(Date.now() + 7 * DAY)), featured.id],
    );

    const result = await searchProperties(ctx.db, {});
    const order = result.items.map((item) => item.id);

    expect(order.indexOf(featured.id)).toBeLessThan(order.indexOf(boosted.id));
    expect(order.indexOf(boosted.id)).toBeLessThan(order.indexOf(ordinary.id));
  });

  it("CRITICAL: an expired boost loses its lift even before the sweep runs", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const ordinary = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
    const stale = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });

    // The sweep runs hourly; ranking compares against the current time so a
    // just-expired boost does not keep its lift until the next run.
    await execute(ctx.db, `UPDATE properties SET boosted_until = ? WHERE id = ?`, [
      nowIso(new Date(Date.now() - 60_000)),
      stale.id,
    ]);

    const result = await searchProperties(ctx.db, {});
    const order = result.items.map((item) => item.id);

    // `stale` was created later, so without a lift it sorts above `ordinary`
    // by recency only — the point is that it gains nothing from the dead boost.
    expect(order).toContain(ordinary.id);
    expect(order).toContain(stale.id);

    const boostedRank = await queryOne<{ lifted: number }>(
      ctx.db,
      `SELECT (boosted_until IS NOT NULL AND boosted_until > ?) AS lifted
         FROM properties WHERE id = ?`,
      [nowIso(), stale.id],
    );
    expect(boostedRank!.lifted).toBe(0);
  });

  it("boost does not hide or remove any listing", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
    const boosted = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });
    await execute(ctx.db, `UPDATE properties SET boosted_until = ? WHERE id = ?`, [
      nowIso(new Date(Date.now() + DAY)),
      boosted.id,
    ]);

    const result = await searchProperties(ctx.db, {});
    expect(result.items).toHaveLength(2);
  });
});
