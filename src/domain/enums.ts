/**
 * Canonical domain enums.
 *
 * These string literals are the single source of truth: the SQL CHECK
 * constraints in `migrations/` mirror them exactly, and every Zod schema
 * derives from them. Adding a value means adding a migration.
 */

export const ROLES = ["VISITOR", "USER", "OWNER", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Ascending privilege. Used by `hasAtLeastRole`. */
export const ROLE_RANK: Record<Role, number> = {
  VISITOR: 0,
  USER: 1,
  OWNER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROPERTY_STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "RENTED",
  "SOLD",
  "EXPIRED",
  "ARCHIVED",
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

/** Statuses whose listings are visible to the public and indexable. */
export const PUBLIC_PROPERTY_STATUSES: readonly PropertyStatus[] = ["APPROVED"];

export const PRICE_PERIODS = ["MONTHLY", "YEARLY", "TOTAL", "PER_KATHA", "PER_DECIMAL"] as const;
export type PricePeriod = (typeof PRICE_PERIODS)[number];

export const TENANT_TYPES = ["ANY", "FAMILY", "BACHELOR", "OFFICE", "STUDENT"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const FURNISHED_STATES = ["UNFURNISHED", "SEMI_FURNISHED", "FURNISHED"] as const;
export type FurnishedState = (typeof FURNISHED_STATES)[number];

export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const UNLOCK_STATUSES = ["PENDING", "ACTIVE", "REVOKED"] as const;
export type UnlockStatus = (typeof UNLOCK_STATUSES)[number];

export const REPORT_REASONS = [
  "FAKE_PROPERTY",
  "WRONG_PRICE",
  "WRONG_INFORMATION",
  "WRONG_LOCATION",
  "SCAM",
  "DUPLICATE",
  "ALREADY_RENTED",
  "OTHER",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "LISTING_SUBMITTED",
  "LISTING_APPROVED",
  "LISTING_REJECTED",
  "LISTING_EXPIRING",
  "LISTING_STATUS_CHANGED",
  "PAYMENT_SUCCESSFUL",
  "PAYMENT_FAILED",
  "CONTACT_UNLOCKED",
  "ADMIN_NEW_PENDING_PROPERTY",
  "ADMIN_NEW_REPORT",
  "ADMIN_PAYMENT_ISSUE",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ADMIN_ACTIONS = [
  "PROPERTY_APPROVED",
  "PROPERTY_REJECTED",
  "PROPERTY_FEATURED",
  "PROPERTY_UNFEATURED",
  "PROPERTY_DELETED",
  "PROPERTY_STATUS_CHANGED",
  "USER_SUSPENDED",
  "USER_UNSUSPENDED",
  "ROLE_CHANGED",
  "PAYMENT_REFUNDED",
  "REPORT_STATUS_CHANGED",
  "SETTING_UPDATED",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export function hasAtLeastRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
