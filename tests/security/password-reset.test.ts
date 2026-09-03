/**
 * Password reset.
 *
 * The properties that matter: a reset link must be single-use, time-limited,
 * unguessable from the database, must not reveal whether an account exists, and
 * must end every existing session for the account.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../helpers/d1";
import { createUser } from "../helpers/factories";
import {
  purgeExpiredResetTokens,
  requestPasswordReset,
  resetPassword,
} from "@/server/auth/password-reset";
import type { EmailMessage, EmailProvider } from "@/server/email/provider";
import { loginUser } from "@/server/auth/service";
import { createSession, resolveSession } from "@/server/auth/session";
import { execute, queryOne } from "@/server/db/client";
import { sha256Hex } from "@/lib/ids";

/** Captures what would have been sent. */
class CapturingEmailProvider implements EmailProvider {
  readonly name = "capture";
  readonly sent: EmailMessage[] = [];
  constructor(private readonly ok = true) {}
  async send(message: EmailMessage) {
    this.sent.push(message);
    return this.ok ? { ok: true } : { ok: false, error: "boom" };
  }
}

const SITE = "https://dayarampur.com";

let ctx: TestDb;

beforeEach(() => {
  ctx = createTestDatabase();
});

afterEach(() => {
  ctx.close();
});

async function userWithEmail(email = "owner@dayarampur.test", phone = "01712345678") {
  return createUser(ctx.db, { email, phone, password: "oldpassword123" });
}

describe("requesting a reset", () => {
  it("emails a link to an account found by email", async () => {
    const user = await userWithEmail();
    const mail = new CapturingEmailProvider();

    const outcome = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);

    expect(outcome.sent).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("owner@dayarampur.test");
    expect(mail.sent[0].text).toContain(`${SITE}/reset-password?token=`);

    const row = await queryOne<{ user_id: string; purpose: string }>(
      ctx.db,
      `SELECT user_id, purpose FROM verification_tokens`,
    );
    expect(row).toMatchObject({ user_id: user.id, purpose: "PASSWORD_RESET" });
  });

  it("finds the account by phone too, including +880 form", async () => {
    await userWithEmail("a@b.test", "01712345678");
    const mail = new CapturingEmailProvider();

    await expect(
      requestPasswordReset(ctx.db, "+8801712345678", mail, SITE),
    ).resolves.toMatchObject({ sent: true });
  });

  it("CRITICAL: stores only the hash of the token, never the token itself", async () => {
    await userWithEmail();
    const mail = new CapturingEmailProvider();
    const outcome = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);

    const row = await queryOne<{ id: string }>(ctx.db, `SELECT id FROM verification_tokens`);
    expect(row!.id).not.toBe(outcome.token);
    expect(row!.id).toBe(await sha256Hex(outcome.token!));
    // A database dump must not yield a working link.
    expect(JSON.stringify(row)).not.toContain(outcome.token!);
  });

  it("CRITICAL: sends nothing for an unknown identifier, and says why only server-side", async () => {
    const mail = new CapturingEmailProvider();

    const outcome = await requestPasswordReset(ctx.db, "01799999999", mail, SITE);

    expect(outcome).toMatchObject({ sent: false, reason: "NO_MATCHING_USER" });
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for a phone-only account with no email on file", async () => {
    await createUser(ctx.db, { phone: "01711111111", email: undefined });
    const mail = new CapturingEmailProvider();

    await expect(
      requestPasswordReset(ctx.db, "01711111111", mail, SITE),
    ).resolves.toMatchObject({ sent: false, reason: "NO_EMAIL_ON_FILE" });
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for a suspended account", async () => {
    const user = await userWithEmail();
    await execute(ctx.db, `UPDATE users SET status = 'SUSPENDED' WHERE id = ?`, [user.id]);
    const mail = new CapturingEmailProvider();

    await expect(
      requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE),
    ).resolves.toMatchObject({ sent: false, reason: "ACCOUNT_INACTIVE" });
  });

  it("invalidates an earlier unused link when a new one is requested", async () => {
    await userWithEmail();
    const mail = new CapturingEmailProvider();

    const first = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);
    const second = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);

    // Only the newest link works.
    await expect(resetPassword(ctx.db, first.token!, "newpassword123")).resolves.toEqual({
      ok: false,
      reason: "ALREADY_USED",
    });
    await expect(resetPassword(ctx.db, second.token!, "newpassword123")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("escapes the user's name in the HTML email", async () => {
    await createUser(ctx.db, {
      name: '<script>alert("x")</script>',
      email: "xss@dayarampur.test",
      phone: "01722222222",
    });
    const mail = new CapturingEmailProvider();

    await requestPasswordReset(ctx.db, "xss@dayarampur.test", mail, SITE);

    expect(mail.sent[0].html).not.toContain("<script>");
    expect(mail.sent[0].html).toContain("&lt;script&gt;");
  });
});

describe("completing a reset", () => {
  async function issueToken() {
    const user = await userWithEmail();
    const mail = new CapturingEmailProvider();
    const outcome = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);
    return { user, token: outcome.token! };
  }

  it("changes the password so the new one works and the old one does not", async () => {
    const { token } = await issueToken();

    await expect(resetPassword(ctx.db, token, "brandnew123")).resolves.toMatchObject({ ok: true });

    await expect(
      loginUser(ctx.db, { identifier: "01712345678", password: "brandnew123" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      loginUser(ctx.db, { identifier: "01712345678", password: "oldpassword123" }),
    ).resolves.toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("CRITICAL: a token cannot be used twice", async () => {
    const { token } = await issueToken();

    await expect(resetPassword(ctx.db, token, "firstchange123")).resolves.toMatchObject({
      ok: true,
    });
    await expect(resetPassword(ctx.db, token, "secondchange123")).resolves.toEqual({
      ok: false,
      reason: "ALREADY_USED",
    });

    // The second attempt must not have taken effect.
    await expect(
      loginUser(ctx.db, { identifier: "01712345678", password: "secondchange123" }),
    ).resolves.toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
  });

  it("CRITICAL: an expired token is refused", async () => {
    const { token } = await issueToken();
    await execute(ctx.db, `UPDATE verification_tokens SET expires_at = '2020-01-01T00:00:00Z'`);

    await expect(resetPassword(ctx.db, token, "brandnew123")).resolves.toEqual({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("CRITICAL: a made-up token is refused", async () => {
    await issueToken();

    await expect(resetPassword(ctx.db, "not-a-real-token", "brandnew123")).resolves.toEqual({
      ok: false,
      reason: "INVALID_TOKEN",
    });
  });

  it("CRITICAL: completing a reset ends every existing session", async () => {
    const { user, token } = await issueToken();
    const a = await createSession(ctx.db, user.id);
    const b = await createSession(ctx.db, user.id);
    await expect(resolveSession(ctx.db, a.token)).resolves.not.toBeNull();

    await resetPassword(ctx.db, token, "brandnew123");

    // A stolen session must not survive the reset that was meant to stop it.
    await expect(resolveSession(ctx.db, a.token)).resolves.toBeNull();
    await expect(resolveSession(ctx.db, b.token)).resolves.toBeNull();
  });

  it("a reset for one user cannot touch another user's password", async () => {
    const { token } = await issueToken();
    const other = await createUser(ctx.db, {
      phone: "01733333333",
      password: "otherpassword123",
    });

    await resetPassword(ctx.db, token, "brandnew123");

    const row = await queryOne<{ password_hash: string }>(
      ctx.db,
      `SELECT password_hash FROM users WHERE id = ?`,
      [other.id],
    );
    await expect(
      loginUser(ctx.db, { identifier: "01733333333", password: "otherpassword123" }),
    ).resolves.toMatchObject({ ok: true });
    expect(row).toBeTruthy();
  });
});

describe("housekeeping", () => {
  it("purges expired and consumed tokens", async () => {
    const user = await userWithEmail();
    const mail = new CapturingEmailProvider();
    const live = await requestPasswordReset(ctx.db, "owner@dayarampur.test", mail, SITE);

    // A second, expired token for the same user.
    await execute(
      ctx.db,
      `INSERT INTO verification_tokens (id, user_id, purpose, expires_at, created_at)
       VALUES ('expired', ?, 'PASSWORD_RESET', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`,
      [user.id],
    );

    const removed = await purgeExpiredResetTokens(ctx.db);
    expect(removed).toBeGreaterThanOrEqual(1);

    // The live token survives.
    await expect(resetPassword(ctx.db, live.token!, "brandnew123")).resolves.toMatchObject({
      ok: true,
    });
  });
});
