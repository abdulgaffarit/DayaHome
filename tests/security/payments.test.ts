/**
 * Payment integrity.
 *
 * Covers the specification's price-manipulation and duplicate-IPN requirements,
 * plus the rule that a payment only settles after server-to-server verification.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createPendingPayment, createProperty, createUser, grantUnlock } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import { createUnlockPayment, settlePayment } from "@/server/payments/unlock-service";
import { hasActiveUnlock } from "@/server/properties/contact";
import { queryOne } from "@/server/db/client";

const SERVER_PRICE = 50;

const URLS = {
  successUrl: "https://dayarampur.com/api/payments/sslcommerz/return?outcome=success",
  failUrl: "https://dayarampur.com/api/payments/sslcommerz/return?outcome=fail",
  cancelUrl: "https://dayarampur.com/api/payments/sslcommerz/return?outcome=cancel",
  ipnUrl: "https://dayarampur.com/api/payments/sslcommerz/ipn",
};

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

describe("payment creation", () => {
  it("CRITICAL: the charged amount comes from the server, not from the caller", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    const provider = new FakeGateway();

    // Simulates a tampered client that has tried to set its own price. The
    // service signature has no channel for it: the only price it accepts is the
    // one the route reads from configuration.
    await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: SERVER_PRICE,
      gateway: provider,
      urls: URLS,
    });

    expect(provider.created).toHaveLength(1);
    expect(provider.created[0].amount).toBe(SERVER_PRICE);
    expect(provider.created[0].currency).toBe("BDT");

    const stored = await queryOne<{ amount: number; currency: string; status: string }>(
      ctx.db,
      `SELECT amount, currency, status FROM payments WHERE user_id = ?`,
      [user.id],
    );
    expect(stored).toMatchObject({ amount: SERVER_PRICE, currency: "BDT", status: "PENDING" });
  });

  it("does not charge again for a property the user has already unlocked", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await grantUnlock(ctx.db, user.id, property.id);

    const provider = new FakeGateway();
    const result = await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: SERVER_PRICE,
      gateway: provider,
      urls: URLS,
    });

    expect(result.status).toBe("ALREADY_UNLOCKED");
    // No gateway session is created at all, so no second charge is possible.
    expect(provider.created).toHaveLength(0);
  });

  it("refuses payment for a listing that is not publicly visible", async () => {
    const user = await createUser(ctx.db);
    const hidden = await createProperty(ctx.db, { status: "PENDING" });

    const result = await createUnlockPayment(ctx.db, {
      user,
      propertyId: hidden.id,
      priceBdt: SERVER_PRICE,
      gateway: new FakeGateway(),
      urls: URLS,
    });

    expect(result.status).toBe("NOT_FOUND");
  });

  it("does not charge an owner for their own listing", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id });

    const result = await createUnlockPayment(ctx.db, {
      user: owner,
      propertyId: property.id,
      priceBdt: SERVER_PRICE,
      gateway: new FakeGateway(),
      urls: URLS,
    });

    expect(result.status).toBe("OWN_PROPERTY");
  });

  it("marks the payment FAILED when the gateway cannot create a session", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);

    const result = await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: SERVER_PRICE,
      gateway: new FakeGateway({ createOk: false }),
      urls: URLS,
    });

    expect(result.status).toBe("GATEWAY_ERROR");
    const stored = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE user_id = ?`,
      [user.id],
    );
    expect(stored?.status).toBe("FAILED");
  });
});

describe("settlement", () => {
  it("settles only after server-to-server verification succeeds", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-1");

    const provider = new FakeGateway();
    const outcome = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-1",
      validationId: "VAL-1",
    });

    expect(outcome.result).toBe("SETTLED");
    // The gateway was asked to confirm OUR amount and OUR transaction id.
    expect(provider.verifications[0]).toMatchObject({
      transactionId: "TXN-1",
      expectedAmount: 50,
      expectedCurrency: "BDT",
    });
    await expect(hasActiveUnlock(ctx.db, user.id, property.id)).resolves.toBe(true);
  });

  it("CRITICAL: a duplicate IPN does not create a second unlock", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-DUP");

    const provider = new FakeGateway();
    const first = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-DUP",
      validationId: "VAL-DUP",
    });
    const second = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-DUP",
      validationId: "VAL-DUP",
    });
    const third = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-DUP",
      validationId: "VAL-DUP",
    });

    expect(first.result).toBe("SETTLED");
    expect(second.result).toBe("ALREADY_SETTLED");
    expect(third.result).toBe("ALREADY_SETTLED");

    const unlocks = await queryOne<{ total: number }>(
      ctx.db,
      `SELECT COUNT(*) AS total FROM contact_unlocks WHERE user_id = ? AND status = 'ACTIVE'`,
      [user.id],
    );
    expect(unlocks?.total).toBe(1);

    const counter = await queryOne<{ unlocks_count: number }>(
      ctx.db,
      `SELECT unlocks_count FROM properties WHERE id = ?`,
      [property.id],
    );
    // The counter is bumped exactly once, not once per callback.
    expect(counter?.unlocks_count).toBe(1);
  });

  it("CRITICAL: a gateway response for a smaller amount does not settle the payment", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-CHEAP");

    // The gateway reports the transaction as valid but for ৳1 rather than ৳50.
    const provider = new FakeGateway({
      verify: (args) => ({
        verified: false,
        status: "VALID",
        transactionId: args.transactionId,
        amount: 1,
        currency: "BDT",
        failureReason: "amount_mismatch",
      }),
    });

    const outcome = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-CHEAP",
      validationId: "VAL-CHEAP",
    });

    expect(outcome.result).toBe("REJECTED");
    await expect(hasActiveUnlock(ctx.db, user.id, property.id)).resolves.toBe(false);
  });

  it("a success callback with no validation id is rejected", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-NOVAL");

    const outcome = await settlePayment(ctx.db, new FakeGateway(), {
      transactionId: "TXN-NOVAL",
      validationId: null,
    });

    expect(outcome).toMatchObject({ result: "REJECTED", reason: "missing_validation_id" });
    await expect(hasActiveUnlock(ctx.db, user.id, property.id)).resolves.toBe(false);
  });

  it("an unknown transaction id settles nothing", async () => {
    const outcome = await settlePayment(ctx.db, new FakeGateway(), {
      transactionId: "TXN-NEVER-EXISTED",
      validationId: "VAL-X",
    });
    expect(outcome.result).toBe("UNKNOWN_TRANSACTION");
  });

  it("a FAILED gateway status marks the payment failed and grants nothing", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-FAIL");

    const provider = new FakeGateway({
      verify: () => ({ verified: false, status: "FAILED", failureReason: "declined" }),
    });
    const outcome = await settlePayment(ctx.db, provider, {
      transactionId: "TXN-FAIL",
      validationId: "VAL-FAIL",
    });

    expect(outcome.result).toBe("REJECTED");
    const stored = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE transaction_id = ?`,
      ["TXN-FAIL"],
    );
    expect(stored?.status).toBe("FAILED");
  });

  it("a PENDING gateway status leaves the payment open for a later IPN", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await createPendingPayment(ctx.db, user.id, property.id, "TXN-SLOW");

    const pendingProvider = new FakeGateway({
      verify: () => ({ verified: false, status: "PENDING" }),
    });
    await settlePayment(ctx.db, pendingProvider, {
      transactionId: "TXN-SLOW",
      validationId: "VAL-SLOW",
    });

    const afterFirst = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE transaction_id = ?`,
      ["TXN-SLOW"],
    );
    expect(afterFirst?.status).toBe("PENDING");

    // The real IPN arrives later and settles it.
    const outcome = await settlePayment(ctx.db, new FakeGateway(), {
      transactionId: "TXN-SLOW",
      validationId: "VAL-SLOW",
    });
    expect(outcome.result).toBe("SETTLED");
    await expect(hasActiveUnlock(ctx.db, user.id, property.id)).resolves.toBe(true);
  });
});
