import { batch, changes, execute } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso, todayIsoDate } from "@/lib/time";

/**
 * View tracking.
 *
 * A refresh loop must not inflate the numbers an owner sees, so a unique index
 * on (property_id, session_hash, view_date) makes at most one *unique* view per
 * visitor per property per UTC day. Total views still count every visit.
 */
export async function recordPropertyView(
  db: D1Database,
  args: {
    propertyId: string;
    userId: string | null;
    /** Salted fingerprint from `viewFingerprint()` — never a raw IP. */
    sessionHash: string;
  },
): Promise<{ counted: boolean }> {
  const now = nowIso();
  const day = todayIsoDate();

  // INSERT OR IGNORE turns the duplicate into a no-op instead of an error, so
  // the "already seen today" case costs one statement.
  const inserted = await execute(
    db,
    `INSERT OR IGNORE INTO property_views (id, property_id, user_id, session_hash, view_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId("vw"), args.propertyId, args.userId, args.sessionHash, day, now],
  );

  const isUnique = changes(inserted) === 1;

  await batch(db, [
    {
      sql: `UPDATE properties SET views_count = views_count + 1 WHERE id = ?`,
      params: [args.propertyId],
    },
    ...(isUnique
      ? [
          {
            sql: `UPDATE properties SET unique_views_count = unique_views_count + 1 WHERE id = ?`,
            params: [args.propertyId],
          },
        ]
      : []),
  ]);

  return { counted: isUnique };
}
