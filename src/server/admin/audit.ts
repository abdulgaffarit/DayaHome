import type { AdminAction } from "@/domain/enums";
import { execute, queryAll } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * Append-only audit trail for sensitive staff actions.
 *
 * The application never updates or deletes rows here. `ip_hash` is a salted
 * digest, never a raw address.
 */
export async function recordAdminAction(
  db: D1Database,
  entry: {
    adminId: string;
    action: AdminAction;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ipHash?: string | null;
  },
): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO admin_logs (id, admin_id, action, entity_type, entity_id, metadata, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("log"),
        entry.adminId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata).slice(0, 4000) : null,
        entry.ipHash ?? null,
        nowIso(),
      ],
    );
  } catch (error) {
    // Losing an audit row must not silently succeed — log loudly, but do not
    // roll back the action the admin already performed.
    console.error("[audit] FAILED TO RECORD ADMIN ACTION", entry.action, error);
  }
}

export interface AdminLogRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: string | null;
  created_at: string;
  admin_name: string | null;
}

export async function listAdminLogs(
  db: D1Database,
  limit = 100,
  offset = 0,
): Promise<AdminLogRow[]> {
  return queryAll<AdminLogRow>(
    db,
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at,
            u.name AS admin_name
       FROM admin_logs l
       LEFT JOIN users u ON u.id = l.admin_id
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}
