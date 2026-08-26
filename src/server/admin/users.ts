/**
 * Staff user management.
 *
 * Privilege rules enforced here (not in the UI):
 *   - Nobody can change their own role. Self-elevation is impossible even for a
 *     SUPER_ADMIN, which also removes the "admin accidentally demotes himself"
 *     failure mode.
 *   - Only a SUPER_ADMIN may grant or revoke ADMIN / SUPER_ADMIN.
 *   - An ADMIN may not suspend another ADMIN or a SUPER_ADMIN.
 */
import { hasAtLeastRole, type Role, type UserStatus } from "@/domain/enums";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { nowIso } from "@/lib/time";
import { destroyAllSessions } from "@/server/auth/session";
import { recordAdminAction } from "./audit";

export type RoleChangeResult =
  | { ok: true }
  | { ok: false; reason: "SELF_CHANGE" | "NOT_PERMITTED" | "NOT_FOUND" };

export async function changeUserRole(
  db: D1Database,
  actor: { id: string; role: Role },
  targetUserId: string,
  newRole: Role,
  opts: { ipHash?: string | null } = {},
): Promise<RoleChangeResult> {
  if (actor.id === targetUserId) return { ok: false, reason: "SELF_CHANGE" };

  const target = await queryOne<{ id: string; role: Role; name: string }>(
    db,
    `SELECT id, role, name FROM users WHERE id = ?`,
    [targetUserId],
  );
  if (!target) return { ok: false, reason: "NOT_FOUND" };

  // Granting or removing staff privileges is a SUPER_ADMIN-only operation, and
  // so is touching anyone who already holds them.
  const touchesStaff =
    hasAtLeastRole(newRole, "ADMIN") || hasAtLeastRole(target.role, "ADMIN");
  if (touchesStaff && actor.role !== "SUPER_ADMIN") {
    return { ok: false, reason: "NOT_PERMITTED" };
  }
  if (!hasAtLeastRole(actor.role, "ADMIN")) return { ok: false, reason: "NOT_PERMITTED" };

  const result = await execute(db, `UPDATE users SET role = ?, updated_at = ? WHERE id = ?`, [
    newRole,
    nowIso(),
    targetUserId,
  ]);
  if (changes(result) !== 1) return { ok: false, reason: "NOT_FOUND" };

  // A privilege change takes effect immediately, not when the cookie expires.
  await destroyAllSessions(db, targetUserId);

  await recordAdminAction(db, {
    adminId: actor.id,
    action: "ROLE_CHANGED",
    entityType: "user",
    entityId: targetUserId,
    metadata: { from: target.role, to: newRole, name: target.name },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}

export async function setUserStatus(
  db: D1Database,
  actor: { id: string; role: Role },
  targetUserId: string,
  status: UserStatus,
  reason: string | undefined,
  opts: { ipHash?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  if (actor.id === targetUserId) return { ok: false, reason: "SELF_CHANGE" };

  const target = await queryOne<{ role: Role; name: string }>(
    db,
    `SELECT role, name FROM users WHERE id = ?`,
    [targetUserId],
  );
  if (!target) return { ok: false, reason: "NOT_FOUND" };
  if (hasAtLeastRole(target.role, "ADMIN") && actor.role !== "SUPER_ADMIN") {
    return { ok: false, reason: "NOT_PERMITTED" };
  }

  await execute(
    db,
    `UPDATE users SET status = ?, suspension_reason = ?, updated_at = ? WHERE id = ?`,
    [status, status === "SUSPENDED" ? (reason ?? null) : null, nowIso(), targetUserId],
  );

  if (status !== "ACTIVE") await destroyAllSessions(db, targetUserId);

  await recordAdminAction(db, {
    adminId: actor.id,
    action: status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_UNSUSPENDED",
    entityType: "user",
    entityId: targetUserId,
    metadata: { name: target.name, reason },
    ipHash: opts.ipHash,
  });
  return { ok: true };
}

export interface AdminUserRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  status: UserStatus;
  created_at: string;
  last_login_at: string | null;
  property_count: number;
  unlock_count: number;
}

export async function listUsers(
  db: D1Database,
  filters: { q?: string; role?: Role; status?: UserStatus; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    const term = `%${filters.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(`(u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`);
    params.push(term, term, term);
  }
  if (filters.role) {
    clauses.push(`u.role = ?`);
    params.push(filters.role);
  }
  if (filters.status) {
    clauses.push(`u.status = ?`);
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const countRow = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM users u ${where}`,
    params,
  );

  const rows = await queryAll<AdminUserRow>(
    db,
    `SELECT u.id, u.name, u.phone, u.email, u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM properties p WHERE p.owner_id = u.id) AS property_count,
            (SELECT COUNT(*) FROM contact_unlocks cu WHERE cu.user_id = u.id AND cu.status = 'ACTIVE') AS unlock_count
       FROM users u
       ${where}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 25, filters.offset ?? 0],
  );

  return { rows, total: countRow?.total ?? 0 };
}
