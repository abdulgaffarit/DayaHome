/**
 * The UddoktaPay gateway.
 *
 * The invariant under test throughout: a contact unlock becomes ACTIVE only
 * after UddoktaPay itself confirms, server-to-server, that THIS invoice was
 * COMPLETED for THIS amount against THIS transaction. Reaching a return URL,
 * receiving a webhook, or holding a genuine invoice that belongs to someone
 * else's payment must all fail to settle anything.
 *
 * `fetch` is stubbed rather than reached: these assert our handling of each
 * documented response, and no test needs (or has) a real API key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser } from "../helpers/factories";
import { UddoktaPayGateway } from "@/server/payments/gateways/uddoktapay";
import { gatewayCallbackUrls } from "@/server/payments/callback-urls";
import { buildGateway } from "@/server/payments/registry";
import { createUnlockPayment, settlePayment } from "@/server/payments/unlock-service";
import { queryOne } from "@/server/db/client";
import type { AppEnv } from "@/server/cloudflare/env";

let ctx: TestDb;
const API_KEY = "test-key-not-a-real-credential";

beforeEach(() => {
  ctx = createTestDatabase();
});
afterEach(() => {
  ctx.close();
  vi.unstubAllGlobals();
});

const URLS = {
  successUrl: "https://dayarampur.com/api/payments/return/UDDOKTAPAY?outcome=success",
  failUrl: "https://dayarampur.com/api/payments/return/UDDOKTAPAY?outcome=fail",
  cancelUrl: "https://dayarampur.com/api/payments/return/UDDOKTAPAY?outcome=cancel",
  ipnUrl: "https://dayarampur.com/api/payments/webhook/UDDOKTAPAY",
};

/** Records every request, and replies with whatever the test scripts. */
function stubFetch(reply: (url: string, body: unknown) => { status?: number; json: unknown } | Error) {
  interface Captured {
    url: string;
    body: {
      metadata?: Record<string, string>;
      [key: string]: unknown;
    };
    headers: Record<string, string>;
  }
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body, headers: init.headers as Record<string, string> });
    const result = reply(String(url), body);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return calls;
}

function gateway() {
  return new UddoktaPayGateway({ apiKey: API_KEY, baseUrl: "https://dayarampur.paymently.io/api" });
}

async function buyer() {
  const user = await createUser(ctx.db);
  const property = await createProperty(ctx.db, { status: "APPROVED" });
  return { user, property };
}

/** Starts a real ৳50 unlock through the service, returning its ids. */
async function startPayment(gw = gateway()) {
  const { user, property } = await buyer();
  const result = await createUnlockPayment(ctx.db, {
    user,
    propertyId: property.id,
    priceBdt: 50,
    gateway: gw,
    urls: URLS,
  });
  return { user, property, result };
}

const verifyBody = (over: Record<string, unknown> = {}) => ({
  status: "COMPLETED",
  amount: "50.00",
  invoice_id: "inv_abc123",
  transaction_id: "TXN-UP-1",
  payment_method: "bkash",
  metadata: { transactionId: "REPLACE", paymentId: "p", userId: "u", propertyId: "pr" },
  ...over,
});

/* -------------------------------------------------------------------------- */
/* Checkout                                                                    */
/* -------------------------------------------------------------------------- */

describe("checkout", () => {
  it("posts the documented fields to /checkout-v2 and redirects to payment_url", async () => {
    const calls = stubFetch(() => ({ json: { payment_url: "https://pay.example/inv_abc123" } }));

    const { result } = await startPayment();

    expect(result.status).toBe("REDIRECT");
    if (result.status !== "REDIRECT") throw new Error("unreachable");
    expect(result.redirectUrl).toBe("https://pay.example/inv_abc123");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://dayarampur.paymently.io/api/checkout-v2");
    expect(calls[0].headers["RT-UDDOKTAPAY-API-KEY"]).toBe(API_KEY);

    const sent = calls[0].body;
    for (const field of [
      "full_name",
      "email",
      "amount",
      "metadata",
      "redirect_url",
      "return_type",
      "cancel_url",
      "webhook_url",
    ]) {
      expect(sent, `missing ${field}`).toHaveProperty(field);
    }
    // The amount is the server's, not the client's.
    expect(sent.amount).toBe("50");
    expect(sent.return_type).toBe("GET");
    expect(sent.webhook_url).toBe(URLS.ipnUrl);
  });

  it("carries the internal payment, user and property ids in metadata", async () => {
    const calls = stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { user, property, result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    const meta = calls[0].body.metadata ?? {};
    expect(meta.paymentId).toBe(result.paymentId);
    expect(meta.userId).toBe(user.id);
    expect(meta.propertyId).toBe(property.id);
    expect(meta.transactionId).toBe(result.transactionId);

    // The return URL carries our reference so the browser leg knows what to ask about.
    expect(calls[0].body.redirect_url).toContain(`tran=${encodeURIComponent(result.transactionId)}`);
  });

  it("fails the attempt when UddoktaPay returns no payment_url", async () => {
    stubFetch(() => ({ status: 422, json: { message: "invalid amount" } }));
    const { result } = await startPayment();
    expect(result.status).toBe("GATEWAY_ERROR");
  });
});

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

describe("verification", () => {
  it("settles and activates the unlock on COMPLETED with a matching amount", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { user, property, result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    const calls = stubFetch(() => ({
      json: verifyBody({ metadata: { transactionId: result.transactionId } }),
    }));

    const outcome = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    expect(outcome.result).toBe("SETTLED");
    expect(calls[0].url).toBe("https://dayarampur.paymently.io/api/verify-payment");
    expect(calls[0].body).toEqual({ invoice_id: "inv_abc123" });

    const payment = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE id = ?`,
      [result.paymentId],
    );
    expect(payment?.status).toBe("PAID");

    const unlock = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM contact_unlocks WHERE user_id = ? AND property_id = ?`,
      [user.id, property.id],
    );
    expect(unlock?.status).toBe("ACTIVE");
  });

  it("refuses an amount mismatch and never activates the unlock", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { user, property, result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    stubFetch(() => ({
      json: verifyBody({ amount: "5.00", metadata: { transactionId: result.transactionId } }),
    }));

    const outcome = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    expect(outcome.result).toBe("REJECTED");
    if (outcome.result === "REJECTED") expect(outcome.reason).toBe("amount_mismatch");

    const unlock = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM contact_unlocks WHERE user_id = ? AND property_id = ?`,
      [user.id, property.id],
    );
    expect(unlock?.status).not.toBe("ACTIVE");
  });

  it("refuses a genuine COMPLETED invoice that names a different transaction", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    // A real, fully-paid ৳50 invoice — but for somebody else's payment.
    stubFetch(() => ({
      json: verifyBody({ metadata: { transactionId: "U999-SOMEONEELSE" } }),
    }));

    const outcome = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    expect(outcome.result).toBe("REJECTED");
    if (outcome.result === "REJECTED") expect(outcome.reason).toBe("transaction_mismatch");
  });

  it("leaves the payment PENDING while UddoktaPay reports PENDING", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    stubFetch(() => ({ json: verifyBody({ status: "PENDING" }) }));

    const outcome = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    expect(outcome.result).toBe("REJECTED");
    const payment = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE id = ?`,
      [result.paymentId],
    );
    // Still open, so a later webhook can settle it.
    expect(payment?.status).toBe("PENDING");
  });

  it("marks the payment FAILED on ERROR", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    stubFetch(() => ({ json: verifyBody({ status: "ERROR" }) }));

    await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    const payment = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE id = ?`,
      [result.paymentId],
    );
    expect(payment?.status).toBe("FAILED");
  });

  it("reports an invalid invoice id without settling", async () => {
    const gw = gateway();
    stubFetch(() => ({ status: 404, json: { message: "Invoice not found" } }));

    const verification = await gw.verifyPayment({
      transactionId: "U1-ABC",
      validationId: "inv_does_not_exist",
      expectedAmount: 50,
      expectedCurrency: "BDT",
    });

    expect(verification.verified).toBe(false);
    expect(verification.failureReason).toBe("verify_http_404");
  });

  it("reports a missing invoice id without calling the API", async () => {
    const calls = stubFetch(() => ({ json: {} }));
    const verification = await gateway().verifyPayment({
      transactionId: "U1-ABC",
      validationId: null,
      expectedAmount: 50,
      expectedCurrency: "BDT",
    });

    expect(verification.verified).toBe(false);
    expect(verification.failureReason).toBe("missing_invoice_id");
    expect(calls).toHaveLength(0);
  });

  it("treats a network failure as UNKNOWN, keeping the payment open", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    stubFetch(() => new Error("network down"));

    const verification = await gateway().verifyPayment({
      transactionId: result.transactionId,
      validationId: "inv_abc123",
      expectedAmount: 50,
      expectedCurrency: "BDT",
    });
    // UNKNOWN, not FAILED: the invoice may be paid, so nothing is written off.
    expect(verification.verified).toBe(false);
    expect(verification.status).toBe("UNKNOWN");

    await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });
    const payment = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE id = ?`,
      [result.paymentId],
    );
    expect(payment?.status).toBe("PENDING");
  });

  it("surfaces a checkout timeout as a gateway error", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    stubFetch(() => timeout);

    const created = await gateway().createPayment({
      transactionId: "U1-ABC",
      amount: 50,
      currency: "BDT",
      paymentType: "PROPERTY_CONTACT_UNLOCK",
      description: "unlock",
      customer: {
        name: "A",
        email: "a@example.com",
        phone: "01700000000",
        address: "x",
        city: "Natore",
        country: "Bangladesh",
      },
      successUrl: URLS.successUrl,
      failUrl: URLS.failUrl,
      cancelUrl: URLS.cancelUrl,
      webhookUrl: URLS.ipnUrl,
    });

    expect(created.kind).toBe("FAILED");
    if (created.kind === "FAILED") expect(created.reason).toBe("uddoktapay_timeout");
  });
});

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                 */
/* -------------------------------------------------------------------------- */

describe("duplicate callbacks", () => {
  it("settles once however many times the callback arrives", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const { user, property, result } = await startPayment();
    if (result.status !== "REDIRECT") throw new Error("expected REDIRECT");

    stubFetch(() => ({
      json: verifyBody({ metadata: { transactionId: result.transactionId } }),
    }));

    const first = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });
    const second = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });
    const third = await settlePayment(ctx.db, gateway(), {
      transactionId: result.transactionId,
      validationId: "inv_abc123",
    });

    expect(first.result).toBe("SETTLED");
    expect(second.result).toBe("ALREADY_SETTLED");
    expect(third.result).toBe("ALREADY_SETTLED");

    // Exactly one ACTIVE unlock, and it was not re-dated by the replays.
    const unlocks = await queryOne<{ n: number }>(
      ctx.db,
      `SELECT COUNT(*) AS n FROM contact_unlocks
        WHERE user_id = ? AND property_id = ? AND status = 'ACTIVE'`,
      [user.id, property.id],
    );
    expect(unlocks?.n).toBe(1);
  });

  it("keeps the single-PENDING protection: a second attempt reuses the first", async () => {
    stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db, { status: "APPROVED" });

    const first = await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: 50,
      gateway: gateway(),
      urls: URLS,
    });
    const second = await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: 50,
      gateway: gateway(),
      urls: URLS,
    });

    if (first.status !== "REDIRECT" || second.status !== "REDIRECT") {
      throw new Error("expected both attempts to redirect");
    }
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.transactionId).toBe(first.transactionId);

    const pending = await queryOne<{ n: number }>(
      ctx.db,
      `SELECT COUNT(*) AS n FROM payments
        WHERE user_id = ? AND property_id = ?
          AND status = 'PENDING' AND payment_type = 'PROPERTY_CONTACT_UNLOCK'`,
      [user.id, property.id],
    );
    expect(pending?.n).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

describe("configuration", () => {
  it("is unconfigured without the secret, and refuses to take money", async () => {
    const unset = new UddoktaPayGateway({ apiKey: undefined });
    const blank = new UddoktaPayGateway({ apiKey: "   " });

    expect(unset.isConfigured()).toBe(false);
    expect(blank.isConfigured()).toBe(false);
    expect(gateway().isConfigured()).toBe(true);

    const calls = stubFetch(() => ({ json: { payment_url: "https://pay.example/x" } }));
    const created = await unset.createPayment({
      transactionId: "U1-ABC",
      amount: 50,
      currency: "BDT",
      paymentType: "PROPERTY_CONTACT_UNLOCK",
      description: "unlock",
      customer: {
        name: "A",
        email: "a@example.com",
        phone: "01700000000",
        address: "x",
        city: "Natore",
        country: "Bangladesh",
      },
      successUrl: URLS.successUrl,
      failUrl: URLS.failUrl,
      cancelUrl: URLS.cancelUrl,
      webhookUrl: URLS.ipnUrl,
    });

    expect(created.kind).toBe("FAILED");
    if (created.kind === "FAILED") expect(created.reason).toBe("uddoktapay_not_configured");
    // The key's absence is caught before any request is attempted.
    expect(calls).toHaveLength(0);
  });

  it("is built by the registry from the Worker secret", () => {
    const built = buildGateway("UDDOKTAPAY", { UDDOKTAPAY_API_KEY: API_KEY } as unknown as AppEnv);
    expect(built.id).toBe("UDDOKTAPAY");
    expect(built.isConfigured()).toBe(true);

    const without = buildGateway("UDDOKTAPAY", {} as unknown as AppEnv);
    expect(without.isConfigured()).toBe(false);
  });

  it("parses a webhook via the echoed metadata", () => {
    const event = gateway().parseWebhook({
      invoice_id: "inv_abc123",
      status: "COMPLETED",
      metadata: JSON.stringify({ transactionId: "U1-ABC", paymentId: "pay_1" }),
    });
    expect(event).toEqual({
      transactionId: "U1-ABC",
      validationId: "inv_abc123",
      payload: expect.any(Object),
    });

    // Without metadata there is nothing to correlate, so it is ignored.
    expect(gateway().parseWebhook({ invoice_id: "inv_abc123" })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Callback URLs                                                               */
/* -------------------------------------------------------------------------- */

describe("gatewayCallbackUrls", () => {
  const base = "https://dayarampur.com";

  it("preserves the registered SSLCOMMERZ URLs exactly", () => {
    expect(gatewayCallbackUrls("SSLCOMMERZ", base)).toEqual({
      successUrl: `${base}/api/payments/sslcommerz/return?outcome=success`,
      failUrl: `${base}/api/payments/sslcommerz/return?outcome=fail`,
      cancelUrl: `${base}/api/payments/sslcommerz/return?outcome=cancel`,
      ipnUrl: `${base}/api/payments/sslcommerz/ipn`,
    });
  });

  it("routes every other gateway to its own generic endpoints", () => {
    expect(gatewayCallbackUrls("UDDOKTAPAY", base)).toEqual({
      successUrl: `${base}/api/payments/return/UDDOKTAPAY?outcome=success`,
      failUrl: `${base}/api/payments/return/UDDOKTAPAY?outcome=fail`,
      cancelUrl: `${base}/api/payments/return/UDDOKTAPAY?outcome=cancel`,
      ipnUrl: `${base}/api/payments/webhook/UDDOKTAPAY`,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Migration 0007                                                              */
/* -------------------------------------------------------------------------- */

describe("migration 0007", () => {
  it("makes UddoktaPay primary, keeps MANUAL as fallback, disables SSLCOMMERZ", async () => {
    const rows = await queryOne<{
      uddokta_enabled: number;
      uddokta_primary: number;
      manual_enabled: number;
      manual_fallback: number;
      ssl_enabled: number;
      ssl_present: number;
    }>(
      ctx.db,
      `SELECT
         (SELECT is_enabled  FROM payment_gateways WHERE id = 'UDDOKTAPAY') AS uddokta_enabled,
         (SELECT is_primary  FROM payment_gateways WHERE id = 'UDDOKTAPAY') AS uddokta_primary,
         (SELECT is_enabled  FROM payment_gateways WHERE id = 'MANUAL')     AS manual_enabled,
         (SELECT is_fallback FROM payment_gateways WHERE id = 'MANUAL')     AS manual_fallback,
         (SELECT is_enabled  FROM payment_gateways WHERE id = 'SSLCOMMERZ') AS ssl_enabled,
         (SELECT COUNT(*)    FROM payment_gateways WHERE id = 'SSLCOMMERZ') AS ssl_present`,
    );

    expect(rows?.uddokta_enabled).toBe(1);
    expect(rows?.uddokta_primary).toBe(1);
    expect(rows?.manual_enabled).toBe(1);
    expect(rows?.manual_fallback).toBe(1);
    expect(rows?.ssl_enabled).toBe(0);
    // Disabled, never deleted — existing payments must still resolve it.
    expect(rows?.ssl_present).toBe(1);
  });

  it("leaves exactly one primary and one fallback", async () => {
    const counts = await queryOne<{ primaries: number; fallbacks: number }>(
      ctx.db,
      `SELECT
         (SELECT COUNT(*) FROM payment_gateways WHERE is_primary  = 1) AS primaries,
         (SELECT COUNT(*) FROM payment_gateways WHERE is_fallback = 1) AS fallbacks`,
    );
    expect(counts?.primaries).toBe(1);
    expect(counts?.fallbacks).toBe(1);
  });
});
