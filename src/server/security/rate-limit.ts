import { sha256Hex } from "@/lib/ids";
import { execute, queryOne } from "@/server/db/client";

/**
 * Fixed-window rate limiting backed by D1.
 *
 * A window is identified by `<action>:<subjectHash>:<windowStart>`. Because the
 * key embeds the window start, an expired window simply never matches again and
 * old rows are swept opportunistically rather than on a schedule.
 */
export interface RateLimitRule {
  /** Stable name of the protected action, e.g. `login`. */
  action: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  login: { action: "login", limit: 8, windowMs: 15 * 60_000 },
  register: { action: "register", limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { action: "password_reset", limit: 5, windowMs: 60 * 60_000 },
  createProperty: { action: "create_property", limit: 10, windowMs: 60 * 60_000 },
  createPayment: { action: "create_payment", limit: 20, windowMs: 60 * 60_000 },
  report: { action: "report", limit: 10, windowMs: 60 * 60_000 },
  upload: { action: "upload", limit: 60, windowMs: 60 * 60_000 },
  contact: { action: "contact_lookup", limit: 120, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms at which the current window ends. */
  resetAt: number;
}

/**
 * Consumes one unit from the bucket for `subject` (an IP, a user id, or both).
 *
 * `subject` is hashed before storage so the table never holds raw IP addresses.
 */
export async function consumeRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const resetAt = windowStart + rule.windowMs;
  const key = `${rule.action}:${await sha256Hex(subject)}:${windowStart}`;

  // INSERT .. ON CONFLICT DO UPDATE is a single atomic statement in SQLite, so
  // concurrent requests cannot both read the same count and overwrite it.
  await execute(
    db,
    `INSERT INTO rate_limits (bucket_key, count, window_start, expires_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`,
    [key, windowStart, resetAt],
  );

  const row = await queryOne<{ count: number }>(
    db,
    `SELECT count FROM rate_limits WHERE bucket_key = ?`,
    [key],
  );
  const count = row?.count ?? 1;

  // Cheap opportunistic sweep — roughly one request in fifty pays for cleanup.
  if (Math.random() < 0.02) {
    await execute(db, `DELETE FROM rate_limits WHERE expires_at < ?`, [now]).catch(() => {});
  }

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
  };
}

/** Resets a bucket — used after a successful login so a user is not punished. */
export async function clearRateLimit(
  db: D1Database,
  rule: RateLimitRule,
  subject: string,
  now: number = Date.now(),
): Promise<void> {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const key = `${rule.action}:${await sha256Hex(subject)}:${windowStart}`;
  await execute(db, `DELETE FROM rate_limits WHERE bucket_key = ?`, [key]);
}
