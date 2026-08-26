/**
 * Authentication, sessions and role permissions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createUser } from "../helpers/factories";
import { hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";
import { loginUser, registerUser } from "@/server/auth/service";
import { createSession, destroyAllSessions, resolveSession } from "@/server/auth/session";
import { changeUserRole, setUserStatus } from "@/server/admin/users";
import { hasAtLeastRole } from "@/domain/enums";
import { execute, queryOne } from "@/server/db/client";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { isSameOrigin } from "@/server/security/request";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

describe("password hashing", () => {
  it("never stores the plaintext and verifies correctly", async () => {
    const hash = await hashPassword("সঠিক-password123", 1000);
    expect(hash).not.toContain("password123");
    expect(hash.startsWith("pbkdf2$sha-256$1000$")).toBe(true);
    await expect(verifyPassword("সঠিক-password123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-password1", 1000);
    const b = await hashPassword("same-password1", 1000);
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password1", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password1", b)).resolves.toBe(true);
  });

  it("rejects a malformed or truncated stored hash instead of throwing", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2$md5$1000$aaa$bbb")).resolves.toBe(false);
  });

  it("flags a low-cost hash for upgrade", async () => {
    expect(needsRehash(await hashPassword("password123", 1000))).toBe(true);
  });
});

describe("registration and login", () => {
  it("registers a user and issues a working session", async () => {
    const result = await registerUser(ctx.db, {
      name: "নতুন ব্যবহারকারী",
      phone: "01712345678",
      email: undefined,
      password: "password123",
      confirmPassword: "password123",
      acceptTerms: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = await resolveSession(ctx.db, result.token);
    expect(session?.user.phone).toBe("01712345678");
    expect(session?.user.role).toBe("USER");
  });

  it("refuses a duplicate phone number without confirming the account exists", async () => {
    await createUser(ctx.db, { phone: "01712345678" });

    const result = await registerUser(ctx.db, {
      name: "আরেকজন",
      phone: "01712345678",
      email: undefined,
      password: "password123",
      confirmPassword: "password123",
      acceptTerms: true,
    });

    expect(result).toEqual({ ok: false, reason: "DUPLICATE_PHONE" });
  });

  it("logs in with either the phone or the email", async () => {
    await registerUser(ctx.db, {
      name: "পরীক্ষা",
      phone: "01712345679",
      email: "test@dayarampur.test",
      password: "password123",
      confirmPassword: "password123",
      acceptTerms: true,
    });

    await expect(
      loginUser(ctx.db, { identifier: "01712345679", password: "password123" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      loginUser(ctx.db, { identifier: "test@dayarampur.test", password: "password123" }),
    ).resolves.toMatchObject({ ok: true });
    // +880 and 880 prefixes normalise to the same account.
    await expect(
      loginUser(ctx.db, { identifier: "+8801712345679", password: "password123" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("gives the same answer for a wrong password and a missing account", async () => {
    await createUser(ctx.db, { phone: "01712345670", password: "password123" });

    const wrongPassword = await loginUser(ctx.db, {
      identifier: "01712345670",
      password: "not-the-password",
    });
    const noSuchUser = await loginUser(ctx.db, {
      identifier: "01799999999",
      password: "anything123",
    });

    expect(wrongPassword).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(noSuchUser).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("refuses a suspended account", async () => {
    const user = await createUser(ctx.db, { phone: "01712345671", password: "password123" });
    await execute(ctx.db, `UPDATE users SET status = 'SUSPENDED' WHERE id = ?`, [user.id]);

    await expect(
      loginUser(ctx.db, { identifier: "01712345671", password: "password123" }),
    ).resolves.toEqual({ ok: false, reason: "SUSPENDED" });
  });
});

describe("sessions", () => {
  it("stores only a hash of the token", async () => {
    const user = await createUser(ctx.db);
    const { token } = await createSession(ctx.db, user.id);

    const row = await queryOne<{ id: string }>(ctx.db, `SELECT id FROM sessions LIMIT 1`);
    expect(row?.id).not.toBe(token);
    expect(row?.id).toHaveLength(64); // SHA-256 hex
  });

  it("rejects an expired session", async () => {
    const user = await createUser(ctx.db);
    const { token } = await createSession(ctx.db, user.id);
    await execute(ctx.db, `UPDATE sessions SET expires_at = '2020-01-01T00:00:00Z'`);

    await expect(resolveSession(ctx.db, token)).resolves.toBeNull();
  });

  it("stops resolving as soon as the account is suspended", async () => {
    const user = await createUser(ctx.db);
    const { token } = await createSession(ctx.db, user.id);
    await expect(resolveSession(ctx.db, token)).resolves.not.toBeNull();

    await execute(ctx.db, `UPDATE users SET status = 'SUSPENDED' WHERE id = ?`, [user.id]);
    await expect(resolveSession(ctx.db, token)).resolves.toBeNull();
  });

  it("invalidates every session on demand", async () => {
    const user = await createUser(ctx.db);
    const a = await createSession(ctx.db, user.id);
    const b = await createSession(ctx.db, user.id);

    await destroyAllSessions(ctx.db, user.id);

    await expect(resolveSession(ctx.db, a.token)).resolves.toBeNull();
    await expect(resolveSession(ctx.db, b.token)).resolves.toBeNull();
  });

  it("rejects an unknown or empty token", async () => {
    await expect(resolveSession(ctx.db, "made-up-token")).resolves.toBeNull();
    await expect(resolveSession(ctx.db, undefined)).resolves.toBeNull();
  });
});

describe("role permissions", () => {
  it("orders roles by privilege", () => {
    expect(hasAtLeastRole("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(hasAtLeastRole("ADMIN", "ADMIN")).toBe(true);
    expect(hasAtLeastRole("OWNER", "ADMIN")).toBe(false);
    expect(hasAtLeastRole("USER", "OWNER")).toBe(false);
  });

  it("CRITICAL: nobody can change their own role", async () => {
    const superAdmin = await createUser(ctx.db, { role: "SUPER_ADMIN" });

    const result = await changeUserRole(ctx.db, superAdmin, superAdmin.id, "USER");
    expect(result).toEqual({ ok: false, reason: "SELF_CHANGE" });
  });

  it("an ADMIN cannot promote anyone to ADMIN", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const target = await createUser(ctx.db, { role: "USER" });

    const result = await changeUserRole(ctx.db, admin, target.id, "ADMIN");
    expect(result).toEqual({ ok: false, reason: "NOT_PERMITTED" });

    const stored = await queryOne<{ role: string }>(
      ctx.db,
      `SELECT role FROM users WHERE id = ?`,
      [target.id],
    );
    expect(stored?.role).toBe("USER");
  });

  it("an ADMIN cannot suspend another ADMIN", async () => {
    const admin = await createUser(ctx.db, { role: "ADMIN" });
    const otherAdmin = await createUser(ctx.db, { role: "ADMIN" });

    const result = await setUserStatus(ctx.db, admin, otherAdmin.id, "SUSPENDED", undefined);
    expect(result).toMatchObject({ ok: false, reason: "NOT_PERMITTED" });
  });

  it("a SUPER_ADMIN can promote a user, and the change ends their sessions", async () => {
    const superAdmin = await createUser(ctx.db, { role: "SUPER_ADMIN" });
    const target = await createUser(ctx.db, { role: "USER" });
    const { token } = await createSession(ctx.db, target.id);

    const result = await changeUserRole(ctx.db, superAdmin, target.id, "ADMIN");
    expect(result).toEqual({ ok: true });

    // The old session must not keep the old privileges alive.
    await expect(resolveSession(ctx.db, token)).resolves.toBeNull();
  });

  it("records every role change in the audit log", async () => {
    const superAdmin = await createUser(ctx.db, { role: "SUPER_ADMIN" });
    const target = await createUser(ctx.db, { role: "USER" });

    await changeUserRole(ctx.db, superAdmin, target.id, "ADMIN");

    const log = await queryOne<{ action: string; entity_id: string }>(
      ctx.db,
      `SELECT action, entity_id FROM admin_logs ORDER BY created_at DESC LIMIT 1`,
    );
    expect(log).toMatchObject({ action: "ROLE_CHANGED", entity_id: target.id });
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and then blocks", async () => {
    const rule = { action: "test", limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await consumeRateLimit(ctx.db, rule, "subject-a"));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
  });

  it("keeps separate subjects independent", async () => {
    const rule = { action: "test", limit: 1, windowMs: 60_000 };
    await consumeRateLimit(ctx.db, rule, "subject-a");

    await expect(consumeRateLimit(ctx.db, rule, "subject-a")).resolves.toMatchObject({
      allowed: false,
    });
    await expect(consumeRateLimit(ctx.db, rule, "subject-b")).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("resets in the next window", async () => {
    const rule = { action: "test", limit: 1, windowMs: 60_000 };
    const now = 1_000_000_000_000;

    await consumeRateLimit(ctx.db, rule, "subject", now);
    await expect(consumeRateLimit(ctx.db, rule, "subject", now)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      consumeRateLimit(ctx.db, rule, "subject", now + 61_000),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("never leaks the raw subject into the bucket key", async () => {
    await consumeRateLimit(ctx.db, RATE_LIMITS.login, "01712345678");
    const row = await queryOne<{ bucket_key: string }>(
      ctx.db,
      `SELECT bucket_key FROM rate_limits LIMIT 1`,
    );
    expect(row?.bucket_key).not.toContain("01712345678");
  });
});

describe("CSRF origin check", () => {
  const SITE = "https://dayarampur.com";

  it("allows a same-origin state change", () => {
    const request = new Request(`${SITE}/api/favorites`, {
      method: "POST",
      headers: { origin: SITE },
    });
    expect(isSameOrigin(request, SITE)).toBe(true);
  });

  it("blocks a cross-origin state change", () => {
    const request = new Request(`${SITE}/api/favorites`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOrigin(request, SITE)).toBe(false);
  });

  it("blocks a state change with no Origin or Referer at all", () => {
    const request = new Request(`${SITE}/api/favorites`, { method: "POST" });
    expect(isSameOrigin(request, SITE)).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    const request = new Request(`${SITE}/api/favorites`, {
      method: "POST",
      headers: { referer: `${SITE}/property/some-listing` },
    });
    expect(isSameOrigin(request, SITE)).toBe(true);
  });

  it("does not gate safe methods", () => {
    const request = new Request(`${SITE}/api/properties`, { method: "GET" });
    expect(isSameOrigin(request, SITE)).toBe(true);
  });
});
