import type { PricePeriod } from "./enums";

/**
 * The nine launch categories. `slug` doubles as the public URL segment
 * (`/basha-vhara/`) and as the `categories.slug` column value, so the seed and
 * the router can never drift apart.
 */
export type CategorySlug =
  | "basha-vhara"
  | "basha-bikri"
  | "dokaan-vhara"
  | "office-vhara"
  | "godown-vhara"
  | "jomi-bikri"
  | "jomi-vhara"
  | "mess"
  | "sublet";

export type CategoryKind = "RENT" | "SALE";

export interface CategoryDef {
  slug: CategorySlug;
  nameBn: string;
  /** Short label used in tabs and chips where space is tight. */
  shortBn: string;
  nameEn: string;
  kind: CategoryKind;
  /** H1 for the category landing page. */
  headingBn: string;
  metaTitleBn: string;
  metaDescriptionBn: string;
  defaultPricePeriod: PricePeriod;
  /** Bedroom/bathroom filters only make sense for dwellings. */
  hasRooms: boolean;
  /** Land is measured in katha/decimal rather than square feet. */
  landAreaUnits: boolean;
  icon: "home" | "building-2" | "store" | "briefcase" | "warehouse" | "land-plot" | "users" | "door-open";
  sortOrder: number;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    slug: "basha-vhara",
    nameBn: "বাসা ভাড়া",
    shortBn: "বাসা ভাড়া",
    nameEn: "House rental",
    kind: "RENT",
    headingBn: "দয়ারামপুরে বাসা ভাড়া",
    metaTitleBn: "দয়ারামপুরে বাসা ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ভাড়ার জন্য খালি বাসা ও ফ্ল্যাটের তালিকা। এলাকা, ভাড়া ও রুম অনুযায়ী খুঁজুন, ছবি ও বিস্তারিত দেখুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: true,
    landAreaUnits: false,
    icon: "home",
    sortOrder: 1,
  },
  {
    slug: "basha-bikri",
    nameBn: "বাসা বিক্রি",
    shortBn: "বাসা বিক্রি",
    nameEn: "House sale",
    kind: "SALE",
    headingBn: "দয়ারামপুরে বাসা বিক্রি",
    metaTitleBn: "দয়ারামপুরে বাসা ও ফ্ল্যাট বিক্রি | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে বিক্রির জন্য বাসা, বাড়ি ও ফ্ল্যাটের তালিকা। দাম, আয়তন ও এলাকা অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "TOTAL",
    hasRooms: true,
    landAreaUnits: false,
    icon: "building-2",
    sortOrder: 2,
  },
  {
    slug: "dokaan-vhara",
    nameBn: "দোকান ভাড়া",
    shortBn: "দোকান",
    nameEn: "Shop rental",
    kind: "RENT",
    headingBn: "দয়ারামপুরে দোকান ভাড়া",
    metaTitleBn: "দয়ারামপুরে দোকান ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ভাড়ার জন্য দোকান ও বাণিজ্যিক স্পেসের তালিকা। বাজার, রোড ও ভাড়া অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: false,
    landAreaUnits: false,
    icon: "store",
    sortOrder: 3,
  },
  {
    slug: "office-vhara",
    nameBn: "অফিস ভাড়া",
    shortBn: "অফিস",
    nameEn: "Office rental",
    kind: "RENT",
    headingBn: "দয়ারামপুরে অফিস ভাড়া",
    metaTitleBn: "দয়ারামপুরে অফিস ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ভাড়ার জন্য অফিস স্পেসের তালিকা। আয়তন, তলা ও ভাড়া অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: false,
    landAreaUnits: false,
    icon: "briefcase",
    sortOrder: 4,
  },
  {
    slug: "godown-vhara",
    nameBn: "গুদাম ভাড়া",
    shortBn: "গুদাম",
    nameEn: "Godown rental",
    kind: "RENT",
    headingBn: "দয়ারামপুরে গুদাম ভাড়া",
    metaTitleBn: "দয়ারামপুরে গুদাম ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ভাড়ার জন্য গুদাম ও ওয়্যারহাউসের তালিকা। আয়তন ও ভাড়া অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: false,
    landAreaUnits: false,
    icon: "warehouse",
    sortOrder: 5,
  },
  {
    slug: "jomi-bikri",
    nameBn: "জমি বিক্রি",
    shortBn: "জমি বিক্রি",
    nameEn: "Land sale",
    kind: "SALE",
    headingBn: "দয়ারামপুরে জমি বিক্রি",
    metaTitleBn: "দয়ারামপুরে জমি বিক্রি | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে বিক্রির জন্য জমির তালিকা। শতক/কাঠা, দাম ও এলাকা অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "PER_DECIMAL",
    hasRooms: false,
    landAreaUnits: true,
    icon: "land-plot",
    sortOrder: 6,
  },
  {
    slug: "jomi-vhara",
    nameBn: "জমি ভাড়া",
    shortBn: "জমি ভাড়া",
    nameEn: "Land rental",
    kind: "RENT",
    headingBn: "দয়ারামপুরে জমি ভাড়া",
    metaTitleBn: "দয়ারামপুরে জমি ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ভাড়ার জন্য জমির তালিকা। শতক/কাঠা ও ভাড়া অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "YEARLY",
    hasRooms: false,
    landAreaUnits: true,
    icon: "land-plot",
    sortOrder: 7,
  },
  {
    slug: "mess",
    nameBn: "মেস",
    shortBn: "মেস",
    nameEn: "Mess",
    kind: "RENT",
    headingBn: "দয়ারামপুরে মেস",
    metaTitleBn: "দয়ারামপুর মেস — সিট ভাড়া | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে ছাত্র ও চাকরিজীবীদের জন্য মেস ও সিট ভাড়ার তালিকা। মাসিক খরচ ও সুবিধা দেখুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: true,
    landAreaUnits: false,
    icon: "users",
    sortOrder: 8,
  },
  {
    slug: "sublet",
    nameBn: "সাবলেট",
    shortBn: "সাবলেট",
    nameEn: "Sublet",
    kind: "RENT",
    headingBn: "দয়ারামপুরে সাবলেট",
    metaTitleBn: "দয়ারামপুর সাবলেট | dayarampur.com",
    metaDescriptionBn:
      "দয়ারামপুরে সাবলেট রুমের তালিকা। মাসিক ভাড়া, রুম ও সুবিধা অনুযায়ী খুঁজুন।",
    defaultPricePeriod: "MONTHLY",
    hasRooms: true,
    landAreaUnits: false,
    icon: "door-open",
    sortOrder: 9,
  },
] as const;

const BY_SLUG = new Map<string, CategoryDef>(CATEGORIES.map((c) => [c.slug, c]));

export function getCategory(slug: string): CategoryDef | undefined {
  return BY_SLUG.get(slug);
}

export function isCategorySlug(slug: string): slug is CategorySlug {
  return BY_SLUG.has(slug);
}

/** Tabs shown in the homepage search box (fewer than the full category list). */
export const HOME_SEARCH_TABS: readonly {
  label: string;
  categories: CategorySlug[];
}[] = [
  { label: "বাসা ভাড়া", categories: ["basha-vhara"] },
  { label: "বাসা বিক্রি", categories: ["basha-bikri"] },
  { label: "দোকান ভাড়া", categories: ["dokaan-vhara"] },
  { label: "অফিস ভাড়া", categories: ["office-vhara"] },
  { label: "জমি", categories: ["jomi-bikri", "jomi-vhara"] },
  { label: "মেস/সাবলেট", categories: ["mess", "sublet"] },
];
