/**
 * Registration and login.
 *
 * Both flows are written to give away as little as possible: a failed login
 * cannot distinguish "no such account" from "wrong password", and registration
 * with an existing phone number returns the same generic field error rather
 * than confirming that the number is registered.
 */
import type { LoginInput, RegisterInput } from "@/domain/schemas";
import { execute, isUniqueViolation, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { createSession } from "./session";
import type { AuthUser } from "./session";
import type { Role, UserStatus } from "@/domain/enums";

export type RegisterResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; reason: "DUPLICATE_PHONE" | "DUPLICATE_EMAIL" };

export async function registerUser(
  db: D1Database,
  input: RegisterInput,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
): Promise<RegisterResult> {
  const id = newId("usr");
  const now = nowIso();
  const passwordHash = await hashPassword(input.password);

  try {
    await execute(
      db,
      `INSERT INTO users (id, name, phone, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'USER', 'ACTIVE', ?, ?)`,
      [id, input.name, input.phone, input.email ?? null, passwordHash, now, now],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Which column collided is not disclosed to the caller beyond the field
      // the user actually typed.
      const existingPhone = await queryOne<{ id: string }>(
        db,
        `SELECT id FROM users WHERE phone = ?`,
        [input.phone],
      );
      return { ok: false, reason: existingPhone ? "DUPLICATE_PHONE" : "DUPLICATE_EMAIL" };
    }
    throw error;
  }

  const { token } = await createSession(db, id, meta);
  return {
    ok: true,
    token,
    user: {
      id,
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      role: "USER",
      status: "ACTIVE",
      isVerifiedOwner: false,
    },
  };
}

export type LoginResult =
  | { ok: true; user: AuthUser; token: string }
  | { ok: false; reason: "INVALID_CREDENTIALS" | "SUSPENDED" };

interface LoginRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  password_hash: string;
  role: Role;
  status: UserStatus;
  is_verified_owner: number;
}

/**
 * A dummy hash with the current cost, verified against when no user matches.
 *
 * Without this, a missing account would return noticeably faster than a wrong
 * password and the response time alone would enumerate registered numbers.
 */
const DUMMY_HASH =
  "pbkdf2$sha-256$150000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function loginUser(
  db: D1Database,
  input: LoginInput,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
): Promise<LoginResult> {
  const identifier = input.identifier.trim();
  // The identifier is matched against both columns; normalising the phone here
  // means "+8801..." and "01..." reach the same account.
  const phone = normalizePhone(identifier);

  const row = await queryOne<LoginRow>(
    db,
    `SELECT id, name, phone, email, password_hash, role, status, is_verified_owner
       FROM users
      WHERE phone = ? OR email = ?
      LIMIT 1`,
    [phone, identifier.toLowerCase()],
  );

  if (!row) {
    await verifyPassword(input.password, DUMMY_HASH);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const valid = await verifyPassword(input.password, row.password_hash);
  if (!valid) return { ok: false, reason: "INVALID_CREDENTIALS" };

  if (row.status !== "ACTIVE") return { ok: false, reason: "SUSPENDED" };

  const now = nowIso();
  // Transparent cost upgrade: if the stored hash predates a raised iteration
  // count, rewrite it now that we hold the plaintext.
  if (needsRehash(row.password_hash)) {
    const upgraded = await hashPassword(input.password);
    await execute(db, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
      upgraded,
      now,
      row.id,
    ]);
  }
  await execute(db, `UPDATE users SET last_login_at = ? WHERE id = ?`, [now, row.id]);

  const { token } = await createSession(db, row.id, meta);
  return {
    ok: true,
    token,
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

function normalizePhone(value: string): string {
  const cleaned = value.replace(/[\s-]/g, "");
  if (cleaned.startsWith("+880")) return `0${cleaned.slice(4)}`;
  if (cleaned.startsWith("880")) return `0${cleaned.slice(3)}`;
  return cleaned;
}

/** Password change from the profile page. Invalidates other sessions. */
export async function changePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; reason?: "WRONG_PASSWORD" }> {
  const row = await queryOne<{ password_hash: string }>(
    db,
    `SELECT password_hash FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) return { ok: false, reason: "WRONG_PASSWORD" };
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return { ok: false, reason: "WRONG_PASSWORD" };
  }
  await execute(db, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
    await hashPassword(newPassword),
    nowIso(),
    userId,
  ]);
  return { ok: true };
}
