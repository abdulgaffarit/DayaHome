import type {
  FurnishedState,
  PricePeriod,
  PropertyStatus,
  TenantType,
} from "./enums";

/**
 * The *public* shape of a property.
 *
 * By construction this type has no `phone`, `exactAddress`, `latitude` or
 * `longitude` field. Everything that reaches a React Server Component, a JSON
 * response, `generateMetadata`, or JSON-LD must be typed as `PublicProperty`,
 * which makes leaking private data a compile error rather than a code-review
 * question. The private half lives in `PrivateContact` and is only ever
 * produced by `src/server/properties/contact.ts` after an authorization check.
 */
export interface PublicProperty {
  id: string;
  /** Short human-facing identifier shown on the detail page, e.g. `DP-1042`. */
  publicId: string;
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  categoryNameBn: string;
  propertyType: string | null;
  price: number;
  pricePeriod: PricePeriod;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  floor: number | null;
  totalFloors: number | null;
  furnished: FurnishedState | null;
  tenantType: TenantType | null;
  availableFrom: string | null;
  /** Coarse neighbourhood name only — never the house number. */
  areaNameBn: string;
  areaSlug: string;
  /** e.g. "কলেজ রোডের কাছে" — deliberately imprecise. */
  generalLocation: string | null;
  landmark: string | null;
  rules: string | null;
  amenities: { slug: string; nameBn: string }[];
  images: PropertyImage[];
  status: PropertyStatus;
  isFeatured: boolean;
  isVerified: boolean;
  viewsCount: number;
  unlocksCount: number;
  ownerDisplayName: string;
  publishedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface PropertyImage {
  id: string;
  /** R2 object key. Rendered through `/api/images/[...key]`. */
  objectKey: string;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
  altBn: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** Compact projection used by cards, search results and sitemaps. */
export interface PropertyCardData {
  id: string;
  publicId: string;
  slug: string;
  title: string;
  categorySlug: string;
  price: number;
  pricePeriod: PricePeriod;
  bedrooms: number | null;
  bathrooms: number | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  areaNameBn: string;
  status: PropertyStatus;
  isFeatured: boolean;
  isVerified: boolean;
  primaryImageKey: string | null;
  publishedAt: string | null;
  createdAt: string;
}

/**
 * Private contact payload. Only ever returned by
 * `GET /api/properties/[id]/contact` after a paid, ACTIVE unlock owned by the
 * authenticated user has been verified server-side.
 */
export interface PrivateContact {
  phone: string;
  ownerName: string;
  exactLocation: string;
  latitude: number | null;
  longitude: number | null;
}

export type ContactResponse =
  | { locked: true; priceBdt: number; reason: "PAYMENT_REQUIRED" | "AUTH_REQUIRED" }
  | ({ locked: false } & PrivateContact);
