import type { Role, UserStatus } from "@/domain/enums";
import { newToken, sha256Hex } from "@/lib/ids";
import { DAY, isoPlus, nowIso } from "@/lib/time";
import { execute, queryOne } from "@/server/db/client";

export const SESSION_COOKIE = "dp_session";
export const SESSION_TTL_MS = 30 * DAY;
/** Refresh `last_seen_at` at most once a day to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 1 * DAY;

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  status: UserStatus;
  isVerifiedOwner: boolean;
}

export interface SessionContext {
  user: AuthUser;
  sessionId: string;
  expiresAt: string;
}

/**
 * Creates a session and returns the raw cookie token.
 *
 * Only the SHA-256 of the token is persisted, so read access to the `sessions`
 * table does not let an attacker mint a valid cookie.
 */
export async function createSession(
  db: D1Database,
  userId: string,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken(32);
  const id = await sha256Hex(token);
  const now = nowIso();
  const expiresAt = isoPlus(SESSION_TTL_MS);

  await execute(
    db,
    `INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, expiresAt, now, now, meta.ipHash ?? null, (meta.userAgent ?? "").slice(0, 300) || null],
  );

  return { token, expiresAt };
}

interface SessionRow {
  session_id: string;
  expires_at: string;
  last_seen_at: string;
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  status: UserStatus;
  is_verified_owner: number;
}

/**
 * Resolves a cookie token to a live session.
 *
 * Returns `null` for an unknown token, an expired session, or a suspended /
 * deleted account — a suspension therefore takes effect on the account's very
 * next request rather than when its cookie eventually expires.
 */
export async function resolveSession(
  db: D1Database,
  token: string | undefined | null,
): Promise<SessionContext | null> {
  if (!token) return null;
  const id = await sha256Hex(token);
  const now = nowIso();

  const row = await queryOne<SessionRow>(
    db,
    `SELECT s.id           AS session_id,
            s.expires_at   AS expires_at,
            s.last_seen_at AS last_seen_at,
            u.id, u.name, u.phone, u.email, u.role, u.status, u.is_verified_owner
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
    [id, now],
  );

  if (!row) return null;
  if (row.status !== "ACTIVE") return null;

  if (Date.parse(now) - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await execute(db, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [now, id]);
  }

  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      status: row.status,
      isVerifiedOwner: row.is_verified_owner === 1,
    },
  };
}

/** Logout. */
export async function destroySession(db: D1Database, token: string): Promise<void> {
  await execute(db, `DELETE FROM sessions WHERE id = ?`, [await sha256Hex(token)]);
}

/**
 * Invalidates every session for a user. Called on password change, on
 * suspension, and by the user from the profile page.
 */
export async function destroyAllSessions(db: D1Database, userId: string): Promise<void> {
  await execute(db, `DELETE FROM sessions WHERE user_id = ?`, [userId]);
}

export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await execute(db, `DELETE FROM sessions WHERE expires_at <= ?`, [nowIso()]);
}
