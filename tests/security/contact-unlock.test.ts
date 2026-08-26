/**
 * The four critical security tests from the specification, plus the
 * authorization edge cases around them.
 *
 * These run the real queries against a real SQLite engine loaded with the real
 * migrations — including the partial unique index that enforces "one active
 * unlock per user per property".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createProperty, createUser, grantUnlock } from "../helpers/factories";
import { decideUnlock, hasActiveUnlock, resolveContact } from "@/server/properties/contact";
import { execute } from "@/server/db/client";

const PRICE = 50;
const OWNER_PHONE = "01700000123";
const EXACT_ADDRESS = "বাড়ি নং ৪২, কলেজ রোড, দয়ারামপুর";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

describe("contact unlock authorization", () => {
  it("CRITICAL: a user without a paid unlock does NOT receive the phone number", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db, {
      phone: OWNER_PHONE,
      exactAddress: EXACT_ADDRESS,
    });

    const result = await resolveContact(ctx.db, property.id, buyer, PRICE);

    expect(result.locked).toBe(true);
    // The serialised response must not contain the private values anywhere.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(OWNER_PHONE);
    expect(serialised).not.toContain(EXACT_ADDRESS);
  });

  it("CRITICAL: a paid user DOES receive the phone number", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db, {
      phone: OWNER_PHONE,
      exactAddress: EXACT_ADDRESS,
    });
    await grantUnlock(ctx.db, buyer.id, property.id);

    const result = await resolveContact(ctx.db, property.id, buyer, PRICE);

    expect(result.locked).toBe(false);
    if (result.locked === false) {
      expect(result.phone).toBe(OWNER_PHONE);
      expect(result.exactLocation).toBe(EXACT_ADDRESS);
      expect(result.latitude).toBeCloseTo(24.2069);
    }
  });

  it("CRITICAL: one user's unlock does not work for a different user", async () => {
    const payer = await createUser(ctx.db, { name: "যিনি টাকা দিয়েছেন" });
    const freeloader = await createUser(ctx.db, { name: "যিনি টাকা দেননি" });
    const property = await createProperty(ctx.db, { phone: OWNER_PHONE });

    await grantUnlock(ctx.db, payer.id, property.id);

    await expect(hasActiveUnlock(ctx.db, payer.id, property.id)).resolves.toBe(true);
    await expect(hasActiveUnlock(ctx.db, freeloader.id, property.id)).resolves.toBe(false);

    const result = await resolveContact(ctx.db, property.id, freeloader, PRICE);
    expect(result.locked).toBe(true);
    expect(JSON.stringify(result)).not.toContain(OWNER_PHONE);
  });

  it("an unlock for property A does not unlock property B", async () => {
    const buyer = await createUser(ctx.db);
    const propertyA = await createProperty(ctx.db, { phone: "01700000111" });
    const propertyB = await createProperty(ctx.db, { phone: "01700000222" });

    await grantUnlock(ctx.db, buyer.id, propertyA.id);

    expect((await resolveContact(ctx.db, propertyA.id, buyer, PRICE)).locked).toBe(false);
    expect((await resolveContact(ctx.db, propertyB.id, buyer, PRICE)).locked).toBe(true);
  });

  it("an anonymous visitor is refused before the property is even looked up", async () => {
    const property = await createProperty(ctx.db, { phone: OWNER_PHONE });

    const { decision, row } = await decideUnlock(ctx.db, property.id, null);

    expect(decision).toEqual({ allowed: false, reason: "AUTH_REQUIRED" });
    // No private row is loaded at all for an unauthenticated caller.
    expect(row).toBeNull();
  });

  it("the owner sees their own listing's details without paying", async () => {
    const owner = await createUser(ctx.db, { role: "OWNER" });
    const property = await createProperty(ctx.db, {
      ownerId: owner.id,
      phone: OWNER_PHONE,
    });

    const result = await resolveContact(ctx.db, property.id, owner, PRICE);
    expect(result.locked).toBe(false);
  });

  it("staff see the details for moderation", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const property = await createProperty(ctx.db, { phone: OWNER_PHONE, status: "PENDING" });

    const { decision } = await decideUnlock(ctx.db, property.id, admin);
    expect(decision).toEqual({ allowed: true, via: "STAFF" });
  });

  it("an ACTIVE unlock whose payment is not PAID still keeps the contact locked", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db, { phone: OWNER_PHONE });
    const { paymentId } = await grantUnlock(ctx.db, buyer.id, property.id);

    // Simulate a refund or a bad manual edit: the unlock row still says ACTIVE.
    await execute(ctx.db, `UPDATE payments SET status = 'REFUNDED' WHERE id = ?`, [paymentId]);

    await expect(hasActiveUnlock(ctx.db, buyer.id, property.id)).resolves.toBe(false);
    expect((await resolveContact(ctx.db, property.id, buyer, PRICE)).locked).toBe(true);
  });

  it("a non-public listing is not purchasable or readable by a stranger", async () => {
    const stranger = await createUser(ctx.db);
    const property = await createProperty(ctx.db, { status: "PENDING", phone: OWNER_PHONE });

    const { decision } = await decideUnlock(ctx.db, property.id, stranger);
    expect(decision).toEqual({ allowed: false, reason: "NOT_FOUND" });
  });

  it("a locked response for a missing property is indistinguishable from an unpaid one", async () => {
    const user = await createUser(ctx.db);

    const missing = await resolveContact(ctx.db, "prp_does_not_exist", user, PRICE);
    const unpaid = await resolveContact(
      ctx.db,
      (await createProperty(ctx.db)).id,
      user,
      PRICE,
    );

    // Anti-enumeration: the two responses are byte-identical.
    expect(missing).toEqual(unpaid);
  });
});

describe("duplicate unlock protection (database level)", () => {
  it("the partial unique index rejects a second ACTIVE unlock for the same pair", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    await grantUnlock(ctx.db, buyer.id, property.id);

    await expect(grantUnlock(ctx.db, buyer.id, property.id)).rejects.toThrow(/UNIQUE/i);
  });

  it("a REVOKED unlock does not block issuing a new one", async () => {
    const buyer = await createUser(ctx.db);
    const property = await createProperty(ctx.db);
    const { unlockId } = await grantUnlock(ctx.db, buyer.id, property.id);

    await execute(ctx.db, `UPDATE contact_unlocks SET status = 'REVOKED' WHERE id = ?`, [
      unlockId,
    ]);

    // The index is partial (WHERE status = 'ACTIVE'), so re-purchase is allowed.
    await expect(grantUnlock(ctx.db, buyer.id, property.id)).resolves.toBeTruthy();
  });
});
