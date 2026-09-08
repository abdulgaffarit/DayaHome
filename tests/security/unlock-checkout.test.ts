/**
 * The BDT 50 contact-unlock checkout.
 *
 * Two production defects are pinned here. Every click on the pay button opened
 * a NEW payment — production held six PENDING rows for one user and one
 * property — and the client treated the manual gateway's instructions as a
 * failure, so the payer was told it had not worked and clicked again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser, grantUnlock } from "../helpers/factories";
import { FakeGateway } from "../helpers/fake-gateway";
import { createUnlockPayment, settlePayment } from "@/server/payments/unlock-service";
import { decideUnlock } from "@/server/properties/contact";
import { execute, queryOne } from "@/server/db/client";
import { safeNextPath, nextParam } from "@/lib/next-path";

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

async function buyer() {
  const user = await createUser(ctx.db);
  const property = await createProperty(ctx.db, { status: "APPROVED" });
  return { user, property };
}

const start = (
  user: Awaited<ReturnType<typeof createUser>>,
  propertyId: string,
  gateway = new FakeGateway(),
) =>
  createUnlockPayment(ctx.db, { user, propertyId, priceBdt: 50, gateway, urls: URLS });

const countPending = async (userId: string, propertyId: string) =>
  (
    await queryOne<{ n: number }>(
      ctx.db,
      `SELECT count(*) AS n FROM payments
        WHERE user_id = ? AND property_id = ?
          AND payment_type = 'PROPERTY_CONTACT_UNLOCK' AND status = 'PENDING'`,
      [userId, propertyId],
    )
  )!.n;

/* ---------------------------------------------------------------- scenarios */

describe("4 + 5. duplicate and reused checkouts", () => {
  it("CRITICAL: a double-click creates only one pending transaction", async () => {
    const { user, property } = await buyer();

    // Sequential, as a fast double-click arrives.
    await start(user, property.id);
    await start(user, property.id);
    await start(user, property.id);

    expect(await countPending(user.id, property.id)).toBe(1);
  });

  it("CRITICAL: concurrent clicks cannot both insert", async () => {
    const { user, property } = await buyer();

    // The real race: neither call has committed when the other reads.
    await Promise.all([
      start(user, property.id),
      start(user, property.id),
      start(user, property.id),
    ]);

    expect(await countPending(user.id, property.id)).toBe(1);
  });

  it("CRITICAL: an existing pending attempt is reused, same transaction id", async () => {
    const { user, property } = await buyer();

    const first = await start(user, property.id);
    const second = await start(user, property.id);

    if (first.status !== "REDIRECT" || second.status !== "REDIRECT") {
      throw new Error("expected redirects");
    }
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.paymentId).toBe(first.paymentId);
  });

  it("the database refuses a second pending row even by raw insert", async () => {
    const { user, property } = await buyer();
    await start(user, property.id);

    await expect(
      execute(
        ctx.db,
        `INSERT INTO payments
           (id, transaction_id, user_id, property_id, payment_type, amount, currency,
            gateway, status, created_at, updated_at)
         VALUES ('p_dup','T_DUP',?,?,'PROPERTY_CONTACT_UNLOCK',50,'BDT','MANUAL','PENDING',
                 '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`,
        [user.id, property.id],
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("a pending attempt for a DIFFERENT property is not reused", async () => {
    const { user, property } = await buyer();
    const other = await createProperty(ctx.db, { status: "APPROVED" });

    const a = await start(user, property.id);
    const b = await start(user, other.id);

    if (a.status !== "REDIRECT" || b.status !== "REDIRECT") throw new Error("expected redirects");
    // Payment is property-specific; one attempt must not stand in for another.
    expect(b.transactionId).not.toBe(a.transactionId);
  });
});

describe("6. already paid", () => {
  it("CRITICAL: a paid property is never charged again", async () => {
    const { user, property } = await buyer();
    await grantUnlock(ctx.db, user.id, property.id);

    await expect(start(user, property.id)).resolves.toEqual({ status: "ALREADY_UNLOCKED" });

    // And no new attempt was opened.
    expect(await countPending(user.id, property.id)).toBe(0);
  });

  it("the owner is never charged for their own listing", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, { ownerId: owner.id, status: "APPROVED" });

    await expect(start(owner, property.id)).resolves.toEqual({ status: "OWN_PROPERTY" });
  });
});

describe("7. failed gateway initialisation", () => {
  it("CRITICAL: leaves no pending payment and no orphan unlock behind", async () => {
    const { user, property } = await buyer();

    const result = await start(user, property.id, new FakeGateway({ createOk: false }));

    expect(result).toMatchObject({ status: "GATEWAY_ERROR" });
    expect(await countPending(user.id, property.id)).toBe(0);

    const orphan = await queryOne<{ n: number }>(
      ctx.db,
      `SELECT count(*) AS n FROM contact_unlocks WHERE user_id = ? AND status = 'PENDING'`,
      [user.id],
    );
    // A stranded PENDING unlock would block the reuse lookup afterwards.
    expect(orphan!.n).toBe(0);
  });

  it("a retry after a failure can still open a fresh attempt", async () => {
    const { user, property } = await buyer();
    await start(user, property.id, new FakeGateway({ createOk: false }));

    await expect(start(user, property.id)).resolves.toMatchObject({ status: "REDIRECT" });
    expect(await countPending(user.id, property.id)).toBe(1);
  });
});

describe("8. settlement unlocks exactly one property for one user", () => {
  it("CRITICAL: a verified payment unlocks only that user and that property", async () => {
    const { user, property } = await buyer();
    const other = await createProperty(ctx.db, { status: "APPROVED" });
    const stranger = await createUser(ctx.db);
    const gateway = new FakeGateway();

    const created = await start(user, property.id, gateway);
    if (created.status !== "REDIRECT") throw new Error("expected redirect");
    await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: `val-${created.transactionId}`,
    });

    // The buyer sees this property.
    const mine = await decideUnlock(ctx.db, property.id, user);
    expect(mine.decision).toEqual({ allowed: true, via: "PAID_UNLOCK" });

    // Not another property...
    const theirs = await decideUnlock(ctx.db, other.id, user);
    expect(theirs.decision).toMatchObject({ allowed: false });

    // ...and not another person.
    const notMine = await decideUnlock(ctx.db, property.id, stranger);
    expect(notMine.decision).toMatchObject({ allowed: false });
  });

  it("CRITICAL: a replayed callback is idempotent", async () => {
    const { user, property } = await buyer();
    const gateway = new FakeGateway();
    const created = await start(user, property.id, gateway);
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    const first = await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: `val-${created.transactionId}`,
    });
    const replay = await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: `val-${created.transactionId}`,
    });

    expect(first.result).toBe("SETTLED");
    expect(replay.result).toBe("ALREADY_SETTLED");

    const unlocks = await queryOne<{ n: number }>(
      ctx.db,
      `SELECT count(*) AS n FROM contact_unlocks WHERE user_id = ? AND status = 'ACTIVE'`,
      [user.id],
    );
    expect(unlocks!.n).toBe(1);
  });

  it("CRITICAL: an unverified callback unlocks nothing", async () => {
    const { user, property } = await buyer();
    const gateway = new FakeGateway({
      verify: () => ({ verified: false, status: "FAILED", failureReason: "declined" }),
    });
    const created = await start(user, property.id, gateway);
    if (created.status !== "REDIRECT") throw new Error("expected redirect");

    await settlePayment(ctx.db, gateway, {
      transactionId: created.transactionId,
      validationId: "val-x",
    });

    const decision = await decideUnlock(ctx.db, property.id, user);
    expect(decision.decision).toMatchObject({ allowed: false });
  });
});

describe("9. tampered input", () => {
  it("CRITICAL: the amount is the server's, whatever the caller wants", async () => {
    const { user, property } = await buyer();
    const gateway = new FakeGateway();

    // `createUnlockPayment` takes priceBdt from configuration; the route never
    // reads an amount from the body. Charging 1 is not expressible from a
    // request, so the gateway is always told the configured price.
    await start(user, property.id, gateway);

    expect(gateway.created[0].amount).toBe(50);
    expect(gateway.created[0].currency).toBe("BDT");

    const payment = await queryOne<{ amount: number; currency: string; payment_type: string }>(
      ctx.db,
      `SELECT amount, currency, payment_type FROM payments`,
    );
    expect(payment).toMatchObject({
      amount: 50,
      currency: "BDT",
      payment_type: "PROPERTY_CONTACT_UNLOCK",
    });
  });

  it("a property that is not publicly visible cannot be bought", async () => {
    const user = await createUser(ctx.db);
    const hidden = await createProperty(ctx.db, { status: "PENDING" });

    // Same reply as a missing listing, so ids cannot be probed.
    await expect(start(user, hidden.id)).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("a made-up property id is refused", async () => {
    const user = await createUser(ctx.db);

    await expect(start(user, "prp_does_not_exist")).resolves.toEqual({ status: "NOT_FOUND" });
  });
});

/* ------------------------------------------------------- auth continuation */

describe("1 + 2. auth continuation keeps the property and the intent", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("CRITICAL: an unauthenticated visitor is sent to register, not login", async () => {
    const source = read("src/components/property/contact-lock-card.tsx");

    // Registration is the default for a first purchase; the register page
    // carries a login link that preserves `next`.
    expect(source).toMatch(/router\.push\(`\/register\?next=/);
    expect(source).not.toMatch(/router\.push\(`\/login\?next=/);
  });

  it("CRITICAL: the return path keeps the property and the unlock intent", () => {
    const source = read("src/components/property/contact-lock-card.tsx");

    expect(source).toContain("unlock=1");
    // Built from the current path, so the property travels with it.
    expect(source).toContain("window.location.pathname");
    // And put through the shared guard before it reaches a URL.
    expect(source).toContain("safeNextPath");
  });

  it("CRITICAL: checkout resumes automatically on return", () => {
    const source = read("src/components/property/contact-lock-card.tsx");

    expect(source).toMatch(/get\("unlock"\) !== "1"/);
    expect(source).toContain("startPayment()");
    // The flag is cleared so a refresh does not re-open checkout.
    expect(source).toContain("window.history.replaceState");
  });

  it("the login and register links carry `next` between them", () => {
    const source = read("src/components/auth/auth-forms.tsx");

    expect(source).toContain('`/register${nextParam(params.get("next"))}`');
    expect(source).toContain('`/login${nextParam(params.get("next"))}`');
  });

  it("an already-signed-in visitor is sent to `next`, not the dashboard", () => {
    for (const page of ["src/app/login/page.tsx", "src/app/register/page.tsx"]) {
      expect(read(page), page).toContain("redirect(safeNextPath(next))");
    }
  });
});

describe("safe return paths", () => {
  it("CRITICAL: refuses anything that could leave this origin", () => {
    for (const attack of [
      "https://evil.test/x",
      "//evil.test/x",
      "/\\evil.test",
      "javascript:alert(1)",
      "http://evil.test",
      "evil.test",
    ]) {
      expect(safeNextPath(attack), attack).toBe("/dashboard");
    }
  });

  it("keeps a genuine internal path, query string and all", () => {
    expect(safeNextPath("/property/mess-dayarampur-1015?unlock=1")).toBe(
      "/property/mess-dayarampur-1015?unlock=1",
    );
  });

  it("falls back when there is nothing to return to", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
  });

  it("nextParam emits nothing for an unsafe or absent path", () => {
    expect(nextParam("https://evil.test")).toBe("");
    expect(nextParam(null)).toBe("");
    expect(nextParam("/property/x?unlock=1")).toBe("?next=%2Fproperty%2Fx%3Funlock%3D1");
  });
});

/* ------------------------------------------------------------- manual flow */

describe("the manual gateway is a state, not a failure", () => {
  it("CRITICAL: the client renders instructions instead of an error", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/property/contact-lock-card.tsx"),
      "utf8",
    );

    // The production bug: `manual: true` fell through to the generic error
    // while the payment row had already been created.
    expect(source).toContain("data.manual");
    expect(source).toContain("ManualInstructions");
    expect(source).toMatch(/setManual\(/);
  });

  it("a manual attempt is reused rather than duplicated", async () => {
    const { user, property } = await buyer();
    const manual = new FakeGateway({ instructions: true });

    const a = await start(user, property.id, manual);
    const b = await start(user, property.id, manual);

    if (a.status !== "INSTRUCTIONS" || b.status !== "INSTRUCTIONS") {
      throw new Error("expected instructions");
    }
    expect(b.reference).toBe(a.reference);
    expect(await countPending(user.id, property.id)).toBe(1);
  });

  it("CRITICAL: a manual attempt unlocks nothing until it settles", async () => {
    const { user, property } = await buyer();

    await start(user, property.id, new FakeGateway({ instructions: true }));

    const decision = await decideUnlock(ctx.db, property.id, user);
    expect(decision.decision).toMatchObject({ allowed: false });
  });
});
