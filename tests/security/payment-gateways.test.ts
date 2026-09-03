/**
 * Gateway abstraction and registry.
 *
 * The invariants that matter:
 *   - a gateway is usable only when the operator enabled it AND its credentials
 *     actually exist, so neither half alone can start routing money;
 *   - gateways with no integration (bKash, Nagad, Rocket) can never be
 *     selected and never pretend to take a payment;
 *   - a callback is verified by the gateway that created the payment, not by
 *     whichever is primary now;
 *   - manual payments cannot settle themselves.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import {
  buildGateway,
  gatewayForPayment,
  listGatewayStatuses,
  listPayableGateways,
  resolveGateway,
} from "@/server/payments/registry";
import { GatewayNotConfiguredError } from "@/server/payments/gateway";
import { createUnlockPayment, settlePayment } from "@/server/payments/unlock-service";
import { execute, queryOne } from "@/server/db/client";
import type { AppEnv } from "@/server/cloudflare/env";

/** Only the fields the registry reads. */
const withSslcommerz = {
  SSLCOMMERZ_STORE_ID: "store",
  SSLCOMMERZ_STORE_PASSWORD: "secret",
  SSLCOMMERZ_IS_SANDBOX: "true",
} as unknown as AppEnv;

const withoutSecrets = {} as unknown as AppEnv;

const URLS = {
  successUrl: "https://dayarampur.com/ok",
  failUrl: "https://dayarampur.com/fail",
  cancelUrl: "https://dayarampur.com/cancel",
  ipnUrl: "https://dayarampur.com/api/payments/sslcommerz/ipn",
};

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

describe("gateways with no integration", () => {
  it.each(["BKASH", "NAGAD", "ROCKET"] as const)(
    "%s reports itself unconfigured no matter what secrets exist",
    (id) => {
      // Even with a fully-populated env, there is no adapter behind these.
      const gateway = buildGateway(id, withSslcommerz);
      expect(gateway.isConfigured()).toBe(false);
    },
  );

  it.each(["BKASH", "NAGAD", "ROCKET"] as const)(
    "%s throws rather than pretending to take a payment",
    async (id) => {
      const gateway = buildGateway(id, withSslcommerz);
      await expect(
        gateway.createPayment({
          transactionId: "T1",
          amount: 50,
          currency: "BDT",
          paymentType: "PROPERTY_CONTACT_UNLOCK",
          description: "test",
          customer: {
            name: "x",
            email: "x@y.z",
            phone: "01700000000",
            address: "a",
            city: "b",
            country: "BD",
          },
          successUrl: "",
          failUrl: "",
          cancelUrl: "",
          webhookUrl: "",
        }),
      ).rejects.toBeInstanceOf(GatewayNotConfiguredError);
    },
  );

  it("never verifies a payment", async () => {
    const gateway = buildGateway("BKASH", withSslcommerz);
    await expect(
      gateway.verifyPayment({
        transactionId: "T1",
        validationId: "V1",
        expectedAmount: 50,
        expectedCurrency: "BDT",
      }),
    ).rejects.toBeInstanceOf(GatewayNotConfiguredError);
  });

  it("rejects every webhook signature", () => {
    expect(buildGateway("NAGAD", withSslcommerz).verifyWebhookSignature({})).toBe(false);
  });

  it("is never offered to a payer, even if an admin enables it", async () => {
    await execute(ctx.db, `UPDATE payment_gateways SET is_enabled = 1 WHERE id = 'BKASH'`);

    const payable = await listPayableGateways(ctx.db, withSslcommerz);
    expect(payable.map((g) => g.id)).not.toContain("BKASH");
  });
});

describe("SSLCOMMERZ adapter", () => {
  it("is configured only when both store credentials are present", () => {
    expect(buildGateway("SSLCOMMERZ", withSslcommerz).isConfigured()).toBe(true);
    expect(buildGateway("SSLCOMMERZ", withoutSecrets).isConfigured()).toBe(false);
    expect(
      buildGateway("SSLCOMMERZ", { SSLCOMMERZ_STORE_ID: "store" } as unknown as AppEnv).isConfigured(),
    ).toBe(false);
  });

  it("does not claim a refund capability it does not have", async () => {
    const gateway = buildGateway("SSLCOMMERZ", withSslcommerz);
    expect(gateway.capabilities.refund).toBe(false);

    // It reports how to do it rather than silently succeeding.
    const result = await gateway.refund({
      transactionId: "T1",
      amount: 50,
      currency: "BDT",
      reason: "test",
    });
    expect(result.ok).toBe(false);
  });
});

describe("manual gateway", () => {
  it("is unconfigured until an account number is set", () => {
    expect(buildGateway("MANUAL", withoutSecrets, {}).isConfigured()).toBe(false);
    expect(
      buildGateway("MANUAL", withoutSecrets, { account_number: "01700000000" }).isConfigured(),
    ).toBe(true);
  });

  it("returns instructions rather than a redirect", async () => {
    const gateway = buildGateway("MANUAL", withoutSecrets, {
      account_number: "01700000000",
      instructions_bn: "টাকা পাঠান",
    });
    const result = await gateway.createPayment({
      transactionId: "T-123",
      amount: 50,
      currency: "BDT",
      paymentType: "PROPERTY_CONTACT_UNLOCK",
      description: "unlock",
      customer: {
        name: "x",
        email: "x@y.z",
        phone: "01700000000",
        address: "a",
        city: "b",
        country: "BD",
      },
      successUrl: "",
      failUrl: "",
      cancelUrl: "",
      webhookUrl: "",
    });

    expect(result).toMatchObject({
      kind: "INSTRUCTIONS",
      reference: "T-123",
      accountNumber: "01700000000",
    });
  });

  it("CRITICAL: can never settle itself — verification is always pending", async () => {
    const gateway = buildGateway("MANUAL", withoutSecrets, { account_number: "01700000000" });

    const verification = await gateway.verifyPayment({
      transactionId: "T-123",
      validationId: "anything",
      expectedAmount: 50,
      expectedCurrency: "BDT",
    });

    expect(verification.verified).toBe(false);
    expect(verification.status).toBe("PENDING");
  });

  it("CRITICAL: a manual payment does not settle through the normal path", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await execute(
      ctx.db,
      `INSERT INTO payments (id, transaction_id, user_id, property_id, payment_type, amount,
                             currency, gateway, status, created_at, updated_at)
       VALUES ('p1', 'T-MAN', ?, ?, 'PROPERTY_CONTACT_UNLOCK', 50, 'BDT', 'MANUAL', 'PENDING', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [user.id, property.id],
    );

    const gateway = buildGateway("MANUAL", withoutSecrets, { account_number: "01700000000" });
    const outcome = await settlePayment(ctx.db, gateway, {
      transactionId: "T-MAN",
      validationId: "forged",
    });

    expect(outcome.result).toBe("REJECTED");
    const row = await queryOne<{ status: string }>(
      ctx.db,
      `SELECT status FROM payments WHERE transaction_id = 'T-MAN'`,
    );
    // Still pending: only an administrator may confirm it.
    expect(row?.status).toBe("PENDING");
  });
});

describe("selecting a gateway", () => {
  it("uses the primary when it is enabled and configured", async () => {
    const resolution = await resolveGateway(ctx.db, withSslcommerz);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.gateway.id).toBe("SSLCOMMERZ");
      expect(resolution.usedFallback).toBe(false);
    }
  });

  it("CRITICAL: refuses when the primary is enabled but has no credentials", async () => {
    // Enabled in the database, secrets absent from the environment.
    const resolution = await resolveGateway(ctx.db, withoutSecrets);
    expect(resolution).toEqual({ ok: false, reason: "NO_USABLE_GATEWAY" });
  });

  it("falls through to the fallback when the primary is unusable", async () => {
    await execute(
      ctx.db,
      `UPDATE payment_gateways
          SET is_enabled = 1, is_fallback = 1,
              settings_json = '{"account_number":"01700000000"}'
        WHERE id = 'MANUAL'`,
    );
    // No SSLCOMMERZ secrets, so the primary is enabled but not configured.
    const resolution = await resolveGateway(ctx.db, withoutSecrets);

    expect(resolution.ok).toBe(true);
    if (resolution.ok) {
      expect(resolution.gateway.id).toBe("MANUAL");
      expect(resolution.usedFallback).toBe(true);
    }
  });

  it("honours a payer's choice, but only among usable gateways", async () => {
    await execute(
      ctx.db,
      `UPDATE payment_gateways SET is_enabled = 1,
              settings_json = '{"account_number":"01700000000"}' WHERE id = 'MANUAL'`,
    );

    const chosen = await resolveGateway(ctx.db, withSslcommerz, "MANUAL");
    expect(chosen.ok && chosen.gateway.id).toBe("MANUAL");

    // An unusable choice is ignored in favour of the primary.
    const ignored = await resolveGateway(ctx.db, withSslcommerz, "BKASH");
    expect(ignored.ok && ignored.gateway.id).toBe("SSLCOMMERZ");
  });

  it("skips a disabled gateway even when its credentials exist", async () => {
    await execute(ctx.db, `UPDATE payment_gateways SET is_enabled = 0 WHERE id = 'SSLCOMMERZ'`);

    const resolution = await resolveGateway(ctx.db, withSslcommerz);
    expect(resolution).toEqual({ ok: false, reason: "NO_USABLE_GATEWAY" });
  });
});

describe("gateway status for the admin screen", () => {
  it("reports enabled, configured and usable separately", async () => {
    const statuses = await listGatewayStatuses(ctx.db, withoutSecrets);
    const sslcommerz = statuses.find((s) => s.id === "SSLCOMMERZ")!;

    // Enabled by the operator, but the secrets are missing.
    expect(sslcommerz.enabled).toBe(true);
    expect(sslcommerz.configured).toBe(false);
    expect(sslcommerz.usable).toBe(false);
  });

  it("tells the operator which secrets a pending integration needs", async () => {
    const statuses = await listGatewayStatuses(ctx.db, withSslcommerz);
    const bkash = statuses.find((s) => s.id === "BKASH")!;

    expect(bkash.configured).toBe(false);
    expect(bkash.requiredSecrets).toContain("BKASH_APP_KEY");
    expect(bkash.prerequisite).toMatch(/Merchant/i);
  });

  it("CRITICAL: never exposes a secret in the settings it returns", async () => {
    const statuses = await listGatewayStatuses(ctx.db, withSslcommerz);

    const serialised = JSON.stringify(statuses);
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain("store");
    for (const status of statuses) {
      expect(Object.keys(status.settings)).not.toContain("store_password");
    }
  });
});

describe("verifying a callback", () => {
  it("CRITICAL: uses the gateway that created the payment, not the current primary", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await execute(
      ctx.db,
      `INSERT INTO payments (id, transaction_id, user_id, property_id, payment_type, amount,
                             currency, gateway, status, created_at, updated_at)
       VALUES ('p2', 'T-OLD', ?, ?, 'PROPERTY_CONTACT_UNLOCK', 50, 'BDT', 'MANUAL', 'PENDING', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [user.id, property.id],
    );

    // SSLCOMMERZ is primary, but this payment was taken by MANUAL.
    const gateway = await gatewayForPayment(ctx.db, withSslcommerz, "MANUAL");
    expect(gateway?.id).toBe("MANUAL");
  });

  it("returns null for an unknown gateway id", async () => {
    await expect(gatewayForPayment(ctx.db, withSslcommerz, "PAYPAL")).resolves.toBeNull();
  });
});

describe("payment records carry their type", () => {
  it("records payment_type and a description for a contact unlock", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);

    await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: 50,
      gateway: new FakeGateway(),
      urls: URLS,
    });

    const row = await queryOne<{ payment_type: string; description: string; gateway: string }>(
      ctx.db,
      `SELECT payment_type, description, gateway FROM payments WHERE user_id = ?`,
      [user.id],
    );
    expect(row?.payment_type).toBe("PROPERTY_CONTACT_UNLOCK");
    expect(row?.description).toContain("যোগাযোগের তথ্য");
    expect(row?.gateway).toBe("SSLCOMMERZ");
  });

  it("supports a manual gateway returning instructions instead of a redirect", async () => {
    const user = await createUser(ctx.db);
    const property = await createProperty(ctx.db);

    const result = await createUnlockPayment(ctx.db, {
      user,
      propertyId: property.id,
      priceBdt: 50,
      gateway: new FakeGateway({ instructions: true }),
      urls: URLS,
    });

    expect(result.status).toBe("INSTRUCTIONS");
    if (result.status === "INSTRUCTIONS") {
      expect(result.reference).toBe(result.transactionId);
    }
  });
});
