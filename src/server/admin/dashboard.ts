/** Aggregates for the admin dashboard cards and charts. */
import { queryAll, queryOne } from "@/server/db/client";

export interface AdminDashboardStats {
  totalUsers: number;
  totalProperties: number;
  activeListings: number;
  pendingListings: number;
  totalPayments: number;
  totalRevenue: number;
  totalUnlocks: number;
  todayRevenue: number;
  openReports: number;
}

export async function getAdminDashboardStats(db: D1Database): Promise<AdminDashboardStats> {
  const today = new Date().toISOString().slice(0, 10);
  const row = await queryOne<AdminDashboardStats>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM users WHERE status <> 'DELETED')                     AS totalUsers,
       (SELECT COUNT(*) FROM properties)                                          AS totalProperties,
       (SELECT COUNT(*) FROM properties WHERE status = 'APPROVED')                AS activeListings,
       (SELECT COUNT(*) FROM properties WHERE status = 'PENDING')                 AS pendingListings,
       (SELECT COUNT(*) FROM payments WHERE status = 'PAID')                      AS totalPayments,
       (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'PAID')      AS totalRevenue,
       (SELECT COUNT(*) FROM contact_unlocks WHERE status = 'ACTIVE')             AS totalUnlocks,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE status = 'PAID' AND substr(paid_at, 1, 10) = ?)                    AS todayRevenue,
       (SELECT COUNT(*) FROM reports WHERE status IN ('OPEN', 'INVESTIGATING'))   AS openReports`,
    [today],
  );
  return (
    row ?? {
      totalUsers: 0,
      totalProperties: 0,
      activeListings: 0,
      pendingListings: 0,
      totalPayments: 0,
      totalRevenue: 0,
      totalUnlocks: 0,
      todayRevenue: 0,
      openReports: 0,
    }
  );
}

export interface TimeSeriesPoint {
  day: string;
  value: number;
}

/**
 * Daily counts for the last `days` days.
 *
 * Grouping on `substr(created_at, 1, 10)` works because timestamps are stored
 * as ISO-8601 UTC strings, so the first ten characters are the date.
 */
async function dailySeries(
  db: D1Database,
  table: "properties" | "users",
  days: number,
): Promise<TimeSeriesPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return queryAll<TimeSeriesPoint>(
    db,
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value
       FROM ${table}
      WHERE substr(created_at, 1, 10) >= ?
      GROUP BY day ORDER BY day ASC`,
    [since],
  );
}

export function listingsOverTime(db: D1Database, days = 30) {
  return dailySeries(db, "properties", days);
}

export function usersOverTime(db: D1Database, days = 30) {
  return dailySeries(db, "users", days);
}

export async function revenueOverTime(db: D1Database, days = 30): Promise<TimeSeriesPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return queryAll<TimeSeriesPoint>(
    db,
    `SELECT substr(paid_at, 1, 10) AS day, COALESCE(SUM(amount), 0) AS value
       FROM payments
      WHERE status = 'PAID' AND paid_at IS NOT NULL AND substr(paid_at, 1, 10) >= ?
      GROUP BY day ORDER BY day ASC`,
    [since],
  );
}

export async function unlocksOverTime(db: D1Database, days = 30): Promise<TimeSeriesPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return queryAll<TimeSeriesPoint>(
    db,
    `SELECT substr(unlocked_at, 1, 10) AS day, COUNT(*) AS value
       FROM contact_unlocks
      WHERE status = 'ACTIVE' AND unlocked_at IS NOT NULL AND substr(unlocked_at, 1, 10) >= ?
      GROUP BY day ORDER BY day ASC`,
    [since],
  );
}

export async function categoryDistribution(
  db: D1Database,
): Promise<{ label: string; value: number }[]> {
  return queryAll<{ label: string; value: number }>(
    db,
    `SELECT c.name_bn AS label, COUNT(p.id) AS value
       FROM categories c
       LEFT JOIN properties p ON p.category_id = c.id AND p.status = 'APPROVED'
      GROUP BY c.id ORDER BY value DESC`,
  );
}
