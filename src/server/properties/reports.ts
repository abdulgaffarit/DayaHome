import type { ReportReason, ReportStatus } from "@/domain/enums";
import { changes, execute, queryAll, queryOne } from "@/server/db/client";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { notifyAdmins } from "@/server/notifications/notify";

export async function createReport(
  db: D1Database,
  args: {
    propertyId: string;
    reporterId: string;
    reason: ReportReason;
    details?: string;
  },
): Promise<{ ok: boolean; reason?: "NOT_FOUND" | "DUPLICATE" }> {
  const property = await queryOne<{ id: string; title: string }>(
    db,
    `SELECT id, title FROM properties WHERE id = ? AND status = 'APPROVED'`,
    [args.propertyId],
  );
  if (!property) return { ok: false, reason: "NOT_FOUND" };

  // One open report per person per listing keeps the moderation queue readable.
  const existing = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM reports
      WHERE property_id = ? AND reporter_id = ? AND status IN ('OPEN', 'INVESTIGATING')`,
    [args.propertyId, args.reporterId],
  );
  if (existing) return { ok: false, reason: "DUPLICATE" };

  const now = nowIso();
  await execute(
    db,
    `INSERT INTO reports (id, property_id, reporter_id, reason, details, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
    [newId("rep"), args.propertyId, args.reporterId, args.reason, args.details ?? null, now, now],
  );

  await notifyAdmins(db, {
    type: "ADMIN_NEW_REPORT",
    titleBn: "নতুন রিপোর্ট জমা হয়েছে",
    bodyBn: property.title,
    link: "/admin/reports",
    entityType: "property",
    entityId: args.propertyId,
  });

  return { ok: true };
}

export interface ReportRow {
  id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  property_id: string;
  property_title: string;
  property_slug: string;
  reporter_name: string | null;
}

export async function listReports(
  db: D1Database,
  status?: ReportStatus,
  limit = 50,
  offset = 0,
): Promise<ReportRow[]> {
  const params: (string | number)[] = [];
  let where = "";
  if (status) {
    where = `WHERE r.status = ?`;
    params.push(status);
  }
  params.push(limit, offset);

  return queryAll<ReportRow>(
    db,
    `SELECT r.id, r.reason, r.details, r.status, r.created_at,
            p.id AS property_id, p.title AS property_title, p.slug AS property_slug,
            u.name AS reporter_name
       FROM reports r
       JOIN properties p ON p.id = r.property_id
       LEFT JOIN users u ON u.id = r.reporter_id
       ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?`,
    params,
  );
}

export async function setReportStatus(
  db: D1Database,
  reportId: string,
  status: ReportStatus,
  adminId: string,
  note?: string,
): Promise<boolean> {
  const now = nowIso();
  const resolved = status === "RESOLVED" || status === "DISMISSED";
  const result = await execute(
    db,
    `UPDATE reports
        SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?`,
    [status, note ?? null, resolved ? adminId : null, resolved ? now : null, now, reportId],
  );
  return changes(result) === 1;
}
