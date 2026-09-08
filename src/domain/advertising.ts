/**
 * Advertising domain enums.
 *
 * These literals are mirrored by SQL CHECK constraints in migration 0004.
 * Adding a value means adding a migration.
 */

export const ADVERTISER_STATUSES = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const;
export type AdvertiserStatus = (typeof ADVERTISER_STATUSES)[number];

/**
 * The campaign lifecycle.
 *
 * Money comes first and publication comes last: a paid campaign lands in
 * PENDING_REVIEW, never on the page. Only staff approval moves it forward.
 */
export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "PENDING_PAYMENT",
  "PAID",
  "PENDING_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABEL_BN: Record<CampaignStatus, string> = {
  DRAFT: "খসড়া",
  PENDING_PAYMENT: "পেমেন্টের অপেক্ষায়",
  PAID: "পেমেন্ট সম্পন্ন",
  PENDING_REVIEW: "পর্যালোচনার অপেক্ষায়",
  APPROVED: "অনুমোদিত",
  SCHEDULED: "সময়সূচিতে",
  ACTIVE: "চলমান",
  PAUSED: "স্থগিত",
  REJECTED: "প্রত্যাখ্যাত",
  EXPIRED: "মেয়াদ শেষ",
  CANCELLED: "বাতিল",
};

/**
 * The only transitions the service layer will perform.
 *
 * Written as data rather than as scattered `if` statements so that both the
 * code and the tests read the same table. A status with an empty list is
 * terminal.
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ["PENDING_PAYMENT", "CANCELLED"],
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  // Payment alone never publishes: PAID can only go to review.
  PAID: ["PENDING_REVIEW", "CANCELLED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "ACTIVE", "REJECTED", "CANCELLED"],
  SCHEDULED: ["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"],
  ACTIVE: ["PAUSED", "EXPIRED", "CANCELLED"],
  PAUSED: ["ACTIVE", "SCHEDULED", "EXPIRED", "CANCELLED"],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Statuses whose banners may be served, given a valid window. */
export const SERVABLE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ["ACTIVE"];

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export const CREATIVE_STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED"] as const;
export type CreativeStatus = (typeof CREATIVE_STATUSES)[number];

export const CREATIVE_VARIANTS = ["DESKTOP", "MOBILE"] as const;
export type CreativeVariant = (typeof CREATIVE_VARIANTS)[number];

export const AD_DEVICES = ["DESKTOP", "MOBILE", "UNKNOWN"] as const;
export type AdDevice = (typeof AD_DEVICES)[number];

export const AD_TARGET_DEVICES = ["ALL", "DESKTOP", "MOBILE"] as const;
export type AdTargetDevice = (typeof AD_TARGET_DEVICES)[number];

export const AD_PRICING_MODELS = ["FLAT", "CPM", "CPC"] as const;
export type AdPricingModel = (typeof AD_PRICING_MODELS)[number];

/**
 * Image formats accepted for a banner.
 *
 * Mirrored by the CHECK on `advertisement_creatives.mime_type`. The upload
 * path additionally verifies magic bytes — a declared MIME type is
 * attacker-controlled and proves nothing.
 */
export const CREATIVE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type CreativeMimeType = (typeof CREATIVE_MIME_TYPES)[number];

export function isCampaignStatus(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/**
 * The zone slugs the frontend actually renders.
 *
 * `advertisement_zones` defines what a placement IS and what it costs; this
 * list records which of those the application currently has a slot for. They
 * are different facts, and only one of them can live in code.
 *
 * It exists because the two drifted: every zone in the table was purchasable
 * while only four had a slot, so an advertiser could pay for a placement that
 * would never appear on any page. Selling is now gated on this list, so a zone
 * without a renderer cannot be bought no matter what the database says.
 *
 * To add a zone here, first render an <AdSlot zoneSlug="..."> for it.
 */
export const RENDERED_AD_ZONE_SLUGS = [
  "home-top",
  "home-hero-under",
  "home-mid",
  "home-bottom",
  "category-top",
  "category-inline",
  "category-sidebar",
  "search-inline",
  "property-top",
  "property-sidebar",
  "site-footer",
] as const;

export type RenderedAdZoneSlug = (typeof RENDERED_AD_ZONE_SLUGS)[number];

/**
 * Whether a slot exists for this zone.
 *
 * `home-sidebar` is deliberately absent: the homepage has no sidebar column,
 * and inventing one would be a redesign rather than a fix. It stays defined in
 * the database — its pricing and description are intact — but it cannot be
 * sold until something renders it.
 */
export function isRenderedAdZone(slug: string): boolean {
  return (RENDERED_AD_ZONE_SLUGS as readonly string[]).includes(slug);
}
