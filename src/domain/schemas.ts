import { z } from "zod";
import {
  FURNISHED_STATES,
  PRICE_PERIODS,
  PROPERTY_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  ROLES,
  TENANT_TYPES,
} from "./enums";
import { CATEGORIES } from "./categories";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Bangladeshi mobile number in local form: 01[3-9] followed by 8 digits.
 * Stored normalised as `01XXXXXXXXX`.
 */
export const bdPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .transform((v) => (v.startsWith("+880") ? `0${v.slice(4)}` : v.startsWith("880") ? `0${v.slice(3)}` : v))
  .pipe(
    z
      .string()
      .regex(/^01[3-9]\d{8}$/, "সঠিক মোবাইল নম্বর দিন (যেমন ০১৭xxxxxxxx)"),
  );

export const emailSchema = z
  .email("সঠিক ইমেইল ঠিকানা দিন")
  .trim()
  .toLowerCase()
  .max(200);

export const passwordSchema = z
  .string()
  .min(8, "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে")
  .max(200, "পাসওয়ার্ড অনেক বড় হয়ে গেছে")
  .refine((v) => /[a-zA-Zঀ-৿]/.test(v) && /\d/.test(v), {
    message: "পাসওয়ার্ডে অন্তত একটি অক্ষর ও একটি সংখ্যা রাখুন",
  });

const categorySlugSchema = z.enum(
  CATEGORIES.map((c) => c.slug) as [string, ...string[]],
);

/** Accepts "" from an unfilled HTML input and turns it into `undefined`. */
const optionalString = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/**
 * Checkbox/flag coercion. `z.coerce.boolean()` is deliberately avoided: it maps
 * the string "false" to `true`, which is exactly wrong for form payloads.
 */
const flag = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return defaultValue;
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      return ["true", "1", "on", "yes"].includes(v.toLowerCase());
    });

const optionalInt = (min: number, max: number) =>
  z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .optional()
    .catch(undefined);

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "নাম লিখুন").max(80),
    email: emailSchema.optional().or(z.literal("").transform(() => undefined)),
    phone: bdPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, { error: "শর্তাবলীতে সম্মতি দিন" }),
    turnstileToken: z.string().optional(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "পাসওয়ার্ড দুটি মিলছে না",
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  /** Either the phone number or the email address. */
  identifier: z.string().trim().min(3, "মোবাইল নম্বর বা ইমেইল দিন").max(200),
  password: z.string().min(1, "পাসওয়ার্ড দিন").max(200),
  turnstileToken: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  turnstileToken: z.string().optional(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10).max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "পাসওয়ার্ড দুটি মিলছে না",
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema.optional().or(z.literal("").transform(() => undefined)),
});

/* -------------------------------------------------------------------------- */
/* Property creation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One schema per wizard step so each step can validate in isolation, plus a
 * composed schema the server re-validates on submit. The server NEVER trusts a
 * client-side "this step passed" flag.
 */
export const propertyStep1Schema = z.object({
  categorySlug: categorySlugSchema,
});

export const propertyStep2Schema = z.object({
  title: z
    .string()
    .trim()
    .min(10, "শিরোনাম কমপক্ষে ১০ অক্ষরের হতে হবে")
    .max(120, "শিরোনাম সর্বোচ্চ ১২০ অক্ষর"),
  propertyType: optionalString(60),
});

export const propertyStep3Schema = z.object({
  areaSlug: z.string().trim().min(1, "এলাকা নির্বাচন করুন").max(80),
  landmark: optionalString(120),
  generalLocation: optionalString(160),
  /** Private — never rendered publicly. */
  exactAddress: z.string().trim().min(5, "সঠিক ঠিকানা লিখুন").max(300),
  latitude: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  longitude: z.coerce.number().min(-180).max(180).optional().catch(undefined),
});

export const propertyStep4Schema = z.object({
  price: z.coerce
    .number()
    .int("দাম পূর্ণসংখ্যায় লিখুন")
    .min(1, "দাম লিখুন")
    .max(1_000_000_000, "দাম অনেক বেশি"),
  pricePeriod: z.enum(PRICE_PERIODS),
  isNegotiable: flag(false),
});

export const propertyStep5Schema = z.object({
  bedrooms: optionalInt(0, 30),
  bathrooms: optionalInt(0, 30),
  sizeValue: z.coerce.number().min(0).max(10_000_000).optional().catch(undefined),
  sizeUnit: optionalString(20),
  floor: optionalInt(-2, 100),
  totalFloors: optionalInt(0, 100),
  furnished: z.enum(FURNISHED_STATES).optional(),
  tenantType: z.enum(TENANT_TYPES).optional(),
  availableFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "তারিখ সঠিক নয়")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  amenitySlugs: z.array(z.string().max(60)).max(40).optional().default([]),
});

export const propertyStep6Schema = z.object({
  /** Image *ids* previously returned by the upload endpoint — not raw files. */
  imageIds: z
    .array(z.string().min(1).max(64))
    .min(1, "কমপক্ষে ১টি ছবি যুক্ত করুন")
    .max(15, "সর্বোচ্চ ১৫টি ছবি দেওয়া যাবে"),
});

export const propertyStep7Schema = z.object({
  description: z
    .string()
    .trim()
    .min(30, "বিবরণ কমপক্ষে ৩০ অক্ষরের হতে হবে")
    .max(5000, "বিবরণ সর্বোচ্চ ৫০০০ অক্ষর"),
  rules: optionalString(2000),
});

export const propertyStep8Schema = z.object({
  ownerName: z.string().trim().min(2, "নাম লিখুন").max(80),
  /** Private — unlocked only after a verified BDT 50 payment. */
  phone: bdPhoneSchema,
});

export const createPropertySchema = propertyStep1Schema
  .extend(propertyStep2Schema.shape)
  .extend(propertyStep3Schema.shape)
  .extend(propertyStep4Schema.shape)
  .extend(propertyStep5Schema.shape)
  .extend(propertyStep6Schema.shape)
  .extend(propertyStep7Schema.shape)
  .extend(propertyStep8Schema.shape)
  .extend({
    turnstileToken: z.string().optional(),
    /** DRAFT keeps it private; anything else is coerced to PENDING server-side. */
    submit: flag(true),
  });
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema.partial().extend({
  id: z.string().min(1),
});

/* -------------------------------------------------------------------------- */
/* Search / filters                                                            */
/* -------------------------------------------------------------------------- */

export const SORT_OPTIONS = [
  "newest",
  "price_asc",
  "price_desc",
  "popular",
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const searchQuerySchema = z.object({
  q: optionalString(120),
  category: categorySlugSchema.optional().catch(undefined),
  area: optionalString(80),
  propertyType: optionalString(60),
  minPrice: z.coerce.number().min(0).max(1_000_000_000).optional().catch(undefined),
  maxPrice: z.coerce.number().min(0).max(1_000_000_000).optional().catch(undefined),
  bedrooms: optionalInt(0, 30),
  bathrooms: optionalInt(0, 30),
  minSize: z.coerce.number().min(0).optional().catch(undefined),
  maxSize: z.coerce.number().min(0).optional().catch(undefined),
  floor: optionalInt(-2, 100),
  furnished: z.enum(FURNISHED_STATES).optional().catch(undefined),
  tenantType: z.enum(TENANT_TYPES).optional().catch(undefined),
  availableFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  sort: z.enum(SORT_OPTIONS).default("newest").catch("newest"),
  page: z.coerce.number().int().min(1).max(500).default(1).catch(1),
  view: z.enum(["grid", "list"]).default("grid").catch("grid"),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Favorites, reports, payments                                                */
/* -------------------------------------------------------------------------- */

export const favoriteSchema = z.object({ propertyId: z.string().min(1).max(64) });

export const createReportSchema = z.object({
  propertyId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: optionalString(1000),
});

export const updateReportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  resolutionNote: optionalString(1000),
});

/**
 * Payment creation input.
 *
 * Deliberately contains ONLY the property id. There is no `amount` field: the
 * server reads the unlock price from configuration. A client that posts an
 * amount is simply ignored.
 */
export const createPaymentSchema = z.object({
  propertyId: z.string().min(1).max(64),
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                       */
/* -------------------------------------------------------------------------- */

export const approvePropertySchema = z.object({ propertyId: z.string().min(1).max(64) });

export const rejectPropertySchema = z.object({
  propertyId: z.string().min(1).max(64),
  reason: z
    .string()
    .trim()
    .min(10, "প্রত্যাখ্যানের কারণ লিখুন (কমপক্ষে ১০ অক্ষর)")
    .max(1000),
});

export const setPropertyStatusSchema = z.object({
  propertyId: z.string().min(1).max(64),
  status: z.enum(PROPERTY_STATUSES),
});

export const changeUserRoleSchema = z.object({
  userId: z.string().min(1).max(64),
  role: z.enum(ROLES),
});

export const suspendUserSchema = z.object({
  userId: z.string().min(1).max(64),
  reason: optionalString(500),
});

export const updateSettingSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().max(5000),
});
