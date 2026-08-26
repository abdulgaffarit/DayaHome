import type { NotificationType } from "@/domain/enums";
import { batch, execute, queryAll, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

/**
 * In-app notifications.
 *
 * Delivery is intentionally fire-and-forget: a failure to record a
 * notification must never fail the business action that triggered it (a
 * settled payment stays settled even if the bell icon misses a row).
 */
export interface NotificationInput {
  userId: string;
  type: NotificationType;
  titleBn: string;
  bodyBn?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
}

export async function notify(db: D1Database, input: NotificationInput): Promise<void> {
  try {
    await execute(
      db,
      `INSERT INTO notifications (id, user_id, type, title_bn, body_bn, link, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId("ntf"),
        input.userId,
        input.type,
        input.titleBn,
        input.bodyBn ?? null,
        input.link ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
        nowIso(),
      ],
    );
  } catch (error) {
    console.error("[notify] failed to record notification", error);
  }
}

/** Fans a notification out to every admin — new pending listing, new report. */
export async function notifyAdmins(
  db: D1Database,
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  try {
    const admins = await queryAll<{ id: string }>(
      db,
      `SELECT id FROM users WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND status = 'ACTIVE'`,
    );
    if (admins.length === 0) return;
    const now = nowIso();
    await batch(
      db,
      admins.map((admin) => ({
        sql: `INSERT INTO notifications (id, user_id, type, title_bn, body_bn, link, entity_type, entity_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId("ntf"),
          admin.id,
          input.type,
          input.titleBn,
          input.bodyBn ?? null,
          input.link ?? null,
          input.entityType ?? null,
          input.entityId ?? null,
          now,
        ],
      })),
    );
  } catch (error) {
    console.error("[notify] admin fan-out failed", error);
  }
}

export interface NotificationRow {
  id: string;
  type: string;
  title_bn: string;
  body_bn: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listNotifications(
  db: D1Database,
  userId: string,
  limit = 30,
): Promise<NotificationRow[]> {
  return queryAll<NotificationRow>(
    db,
    `SELECT id, type, title_bn, body_bn, link, read_at, created_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function countUnread(db: D1Database, userId: string): Promise<number> {
  const row = await queryOne<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );
  return row?.total ?? 0;
}

export async function markAllRead(db: D1Database, userId: string): Promise<void> {
  await execute(
    db,
    `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
    [nowIso(), userId],
  );
}
