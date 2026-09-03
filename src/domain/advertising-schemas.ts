import { z } from "zod";
import { AD_TARGET_DEVICES } from "./advertising";
import { bdPhoneSchema, emailSchema } from "./schemas";

/**
 * Validation for the advertiser-facing flow.
 *
 * Note what is absent: there is no price, duration, priority or exclusivity
 * field anywhere in these schemas. Those come from the package row on the
 * server, exactly as the unlock price does. A request cannot influence what a
 * campaign costs.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/**
 * Where a banner sends the visitor.
 *
 * This is the one advertiser-supplied value that ends up in an `href`, so it is
 * the injection surface. Only http and https are permitted — `javascript:`,
 * `data:`, `vbscript:` and `file:` are the classic ways a link becomes script
 * execution, and an allowlist is the only reliable way to exclude them.
 *
 * Embedded credentials (`https://user:pass@host`) are rejected too: they are
 * a phishing device, showing one hostname while the browser resolves another.
 */
export const destinationUrlSchema = z
  .string()
  .trim()
  .min(1, "লিংক দিন")
  .max(2000, "লিংকটি অনেক বড়")
  .superRefine((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "সম্পূর্ণ লিংক দিন (https:// দিয়ে শুরু)" });
      return;
    }

    // Allowlist, never a blocklist.
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({ code: "custom", message: "শুধু http বা https লিংক ব্যবহার করা যাবে" });
      return;
    }
    if (url.username || url.password) {
      ctx.addIssue({ code: "custom", message: "লিংকে ইউজারনেম বা পাসওয়ার্ড রাখা যাবে না" });
      return;
    }
    if (!url.hostname || !url.hostname.includes(".")) {
      ctx.addIssue({ code: "custom", message: "সঠিক ওয়েবসাইট ঠিকানা দিন" });
    }
  })
  // Re-serialised through URL, so what is stored is the parsed form rather
  // than the raw string the advertiser typed.
  .transform((value) => new URL(value).toString());

export const advertiserRegistrationSchema = z.object({
  businessName: z.string().trim().min(2, "ব্যবসার নাম দিন").max(120),
  contactPerson: z.string().trim().min(2, "যোগাযোগকারীর নাম দিন").max(120),
  businessPhone: bdPhoneSchema,
  businessEmail: emailSchema.optional().or(z.literal("").transform(() => undefined)),
  businessAddress: optionalText(300),
  websiteUrl: destinationUrlSchema.optional().or(z.literal("").transform(() => undefined)),
  tradeLicenceNo: optionalText(60),
});

export type AdvertiserRegistrationInput = z.infer<typeof advertiserRegistrationSchema>;

/** An id as it appears in a form: opaque, bounded, no separators. */
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "সঠিক আইডি দিন");

/** A date the advertiser asks the campaign to start on. */
const startDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "সঠিক তারিখ দিন")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "সঠিক তারিখ দিন")
  .transform((v) => `${v}T00:00:00Z`)
  .optional();

export const campaignDraftSchema = z.object({
  zoneId: idSchema,
  packageId: idSchema,
  title: z.string().trim().min(3, "বিজ্ঞাপনের নাম দিন").max(120),
  destinationUrl: destinationUrlSchema,
  requestedStartAt: startDateSchema,
  targetLocationId: idSchema.optional(),
  targetCategoryId: idSchema.optional(),
  targetDevice: z.enum(AD_TARGET_DEVICES).default("ALL"),
});

export type CampaignDraftInput = z.infer<typeof campaignDraftSchema>;

/** Metadata accompanying a banner upload. The bytes are checked separately. */
export const creativeUploadSchema = z.object({
  campaignId: idSchema,
  variant: z.enum(["DESKTOP", "MOBILE"]).default("DESKTOP"),
  altBn: z.string().trim().min(2, "বিজ্ঞাপনের বিকল্প টেক্সট দিন").max(200),
});

/** A staff rejection always carries a reason the advertiser will read. */
export const campaignRejectionSchema = z.object({
  campaignId: idSchema,
  reason: z.string().trim().min(5, "কারণ লিখুন").max(500),
});
