/**
 * Password reset.
 *
 * Threat model: an attacker must not be able to (a) learn whether an account
 * exists, (b) reuse a reset link, (c) use a link after it expires, or (d) keep
 * a session they stole before the reset.
 *
 * Design decisions that follow from it:
 *
 * - Only the SHA-256 of the emailed token is stored, exactly as sessions do, so
 *   read access to `verification_tokens` does not yield usable links.
 * - `requestPasswordReset` returns the same shape whether or not an account
 *   matched. The caller cannot distinguish the cases, and neither can the user.
 * - Consuming a token is a conditional UPDATE, so two clicks on the same link
 *   cannot both succeed.
 * - A completed reset destroys every session for that user.
 */
import type { EmailProvider } from "@/server/email/provider";
import { changes, execute, queryOne } from "@/server/db/client";
import { newId, newToken, sha256Hex } from "@/lib/ids";
import { HOUR, isoPlus, nowIso } from "@/lib/time";
import { hashPassword } from "./password";
import { destroyAllSessions } from "./session";

/** Deliberately short: a reset link is a bearer credential for the account. */
export const RESET_TOKEN_TTL_MS = 1 * HOUR;

/**
 * Result of requesting a reset.
 *
 * `sent` is for logging and tests only — it is never surfaced to the caller of
 * the API route, which always reports the same generic success.
 */
export interface RequestResetOutcome {
  /** True when an email was actually dispatched. */
  sent: boolean;
  /** Why nothing was sent. Server-side diagnostics only. */
  reason?: "NO_MATCHING_USER" | "NO_EMAIL_ON_FILE" | "ACCOUNT_INACTIVE" | "EMAIL_FAILED";
  /** The raw token — returned only so tests can exercise the full flow. */
  token?: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  status: string;
}

function normalizePhone(value: string): string {
  const cleaned = value.replace(/[\s-]/g, "");
  if (cleaned.startsWith("+880")) return `0${cleaned.slice(4)}`;
  if (cleaned.startsWith("880")) return `0${cleaned.slice(3)}`;
  return cleaned;
}

/**
 * Issues a reset link if — and only if — the identifier matches an active
 * account that has an email address on file.
 *
 * Phone-only accounts cannot reset this way; there is no SMS provider. The UI
 * says so as general guidance, never per-account, so this is not an oracle.
 */
export async function requestPasswordReset(
  db: D1Database,
  identifier: string,
  email: EmailProvider,
  siteUrl: string,
): Promise<RequestResetOutcome> {
  const trimmed = identifier.trim();

  const user = await queryOne<UserRow>(
    db,
    `SELECT id, name, email, status FROM users WHERE phone = ? OR email = ? LIMIT 1`,
    [normalizePhone(trimmed), trimmed.toLowerCase()],
  );

  if (!user) return { sent: false, reason: "NO_MATCHING_USER" };
  if (user.status !== "ACTIVE") return { sent: false, reason: "ACCOUNT_INACTIVE" };
  if (!user.email) return { sent: false, reason: "NO_EMAIL_ON_FILE" };

  // Any earlier unused link becomes void, so only the newest email works.
  await execute(
    db,
    `UPDATE verification_tokens SET consumed_at = ?
      WHERE user_id = ? AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
    [nowIso(), user.id],
  );

  const token = newToken(32);
  await execute(
    db,
    `INSERT INTO verification_tokens (id, user_id, purpose, expires_at, created_at)
     VALUES (?, ?, 'PASSWORD_RESET', ?, ?)`,
    [await sha256Hex(token), user.id, isoPlus(RESET_TOKEN_TTL_MS), nowIso()],
  );

  const link = `${siteUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const result = await email.send(buildResetEmail(user.name, user.email, link));

  if (!result.ok) {
    console.error("[password-reset] delivery failed", result.error);
    return { sent: false, reason: "EMAIL_FAILED", token };
  }
  return { sent: true, token };
}

export type ResetOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "INVALID_TOKEN" | "EXPIRED" | "ALREADY_USED" };

/**
 * Completes a reset.
 *
 * The token is consumed with `UPDATE ... WHERE consumed_at IS NULL`, so a
 * double submission (or a race between two tabs) can only succeed once.
 */
export async function resetPassword(
  db: D1Database,
  token: string,
  newPassword: string,
): Promise<ResetOutcome> {
  const id = await sha256Hex(token);

  const row = await queryOne<{ user_id: string; expires_at: string; consumed_at: string | null }>(
    db,
    `SELECT user_id, expires_at, consumed_at FROM verification_tokens
      WHERE id = ? AND purpose = 'PASSWORD_RESET'`,
    [id],
  );

  if (!row) return { ok: false, reason: "INVALID_TOKEN" };
  if (row.consumed_at) return { ok: false, reason: "ALREADY_USED" };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: "EXPIRED" };

  const now = nowIso();
  const consumed = await execute(
    db,
    `UPDATE verification_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
    [now, id],
  );
  // Lost the race — another request already used this token.
  if (changes(consumed) !== 1) return { ok: false, reason: "ALREADY_USED" };

  await execute(db, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
    await hashPassword(newPassword),
    now,
    row.user_id,
  ]);

  // Whoever prompted the reset may hold a stolen session; end all of them.
  await destroyAllSessions(db, row.user_id);

  return { ok: true, userId: row.user_id };
}

/** Housekeeping for expired/consumed tokens. Safe to call from a cron. */
export async function purgeExpiredResetTokens(db: D1Database): Promise<number> {
  const result = await execute(
    db,
    `DELETE FROM verification_tokens WHERE expires_at <= ? OR consumed_at IS NOT NULL`,
    [nowIso()],
  );
  return changes(result);
}

function buildResetEmail(name: string, to: string, link: string) {
  const subject = "dayarampur.com — পাসওয়ার্ড রিসেট করুন";
  const text = [
    `আসসালামু আলাইকুম ${name},`,
    "",
    "আপনার dayarampur.com অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি।",
    "নিচের লিংকে ক্লিক করে নতুন পাসওয়ার্ড দিন:",
    "",
    link,
    "",
    "লিংকটি ১ ঘণ্টা পর্যন্ত কাজ করবে এবং একবারই ব্যবহার করা যাবে।",
    "আপনি যদি এই অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন — আপনার পাসওয়ার্ড অপরিবর্তিত থাকবে।",
    "",
    "— dayarampur.com",
  ].join("\n");

  const html = `<!doctype html>
<html lang="bn"><body style="margin:0;padding:24px;background:#f2f9f4;font-family:system-ui,sans-serif;color:#232928">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e8e7;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#0b6b3a">dayarampur.com</p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b7674">দয়ারামপুরের নিজের ঠিকানা</p>
    <p style="line-height:1.8">আসসালামু আলাইকুম ${escapeHtml(name)},</p>
    <p style="line-height:1.8">আপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নিচের বোতামে ক্লিক করে নতুন পাসওয়ার্ড দিন।</p>
    <p style="margin:28px 0">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#0b6b3a;color:#fff;text-decoration:none;padding:13px 26px;border-radius:12px;font-weight:600">নতুন পাসওয়ার্ড দিন</a>
    </p>
    <p style="line-height:1.8;font-size:14px;color:#4d5755">লিংকটি <strong>১ ঘণ্টা</strong> পর্যন্ত কাজ করবে এবং একবারই ব্যবহার করা যাবে।</p>
    <p style="line-height:1.8;font-size:14px;color:#4d5755">আপনি যদি এই অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন — আপনার পাসওয়ার্ড অপরিবর্তিত থাকবে।</p>
    <p style="margin-top:24px;padding-top:16px;border-top:1px solid #e4e8e7;font-size:12px;color:#98a3a0;word-break:break-all">${escapeHtml(link)}</p>
  </div>
</body></html>`;

  return { to, subject, text, html };
}

/** The name comes from user input, so it is escaped before entering the HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
