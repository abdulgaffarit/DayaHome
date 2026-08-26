/**
 * Input validation.
 *
 * The most important assertion here is negative: the payment schema has no
 * amount field, so a client cannot supply one.
 */
import { describe, expect, it } from "vitest";
import {
  bdPhoneSchema,
  createPaymentSchema,
  createPropertySchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  searchQuerySchema,
} from "@/domain/schemas";

describe("phone numbers", () => {
  it("accepts and normalises Bangladeshi mobile formats", () => {
    expect(bdPhoneSchema.parse("01712345678")).toBe("01712345678");
    expect(bdPhoneSchema.parse("+8801712345678")).toBe("01712345678");
    expect(bdPhoneSchema.parse("8801712345678")).toBe("01712345678");
    expect(bdPhoneSchema.parse("017-1234 5678")).toBe("01712345678");
  });

  it("rejects malformed numbers", () => {
    for (const bad of ["0171234567", "017123456789", "02123456789", "abcdefghijk", ""]) {
      expect(bdPhoneSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("passwords", () => {
  it("requires length plus a letter and a digit", () => {
    expect(passwordSchema.safeParse("password123").success).toBe(true);
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("alllettersonly").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });
});

describe("registration", () => {
  const VALID = {
    name: "পরীক্ষা ব্যবহারকারী",
    phone: "01712345678",
    password: "password123",
    confirmPassword: "password123",
    acceptTerms: true,
  };

  it("accepts a well-formed submission", () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires matching passwords and accepted terms", () => {
    expect(
      registerSchema.safeParse({ ...VALID, confirmPassword: "different123" }).success,
    ).toBe(false);
    expect(registerSchema.safeParse({ ...VALID, acceptTerms: false }).success).toBe(false);
  });

  it("ignores any role a client tries to smuggle in", () => {
    const parsed = registerSchema.parse({ ...VALID, role: "SUPER_ADMIN" });
    expect(parsed).not.toHaveProperty("role");
  });
});

describe("login", () => {
  it("accepts either identifier form", () => {
    expect(
      loginSchema.safeParse({ identifier: "01712345678", password: "x" }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ identifier: "a@b.com", password: "x" }).success,
    ).toBe(true);
  });
});

describe("payment input", () => {
  it("CRITICAL: has no amount field, so a client cannot set the price", () => {
    const parsed = createPaymentSchema.parse({
      propertyId: "prp_123",
      amount: 1,
      price: 1,
      total_amount: 1,
      currency: "USD",
    });

    expect(parsed).toEqual({ propertyId: "prp_123" });
    expect(parsed).not.toHaveProperty("amount");
    expect(parsed).not.toHaveProperty("price");
    expect(parsed).not.toHaveProperty("currency");
  });

  it("requires a property id", () => {
    expect(createPaymentSchema.safeParse({}).success).toBe(false);
  });
});

describe("property creation input", () => {
  const VALID = {
    categorySlug: "basha-vhara",
    title: "কলেজ রোডে ৩ রুমের বাসা ভাড়া",
    areaSlug: "college-road",
    exactAddress: "বাড়ি নং ৪২, কলেজ রোড",
    price: 9500,
    pricePeriod: "MONTHLY",
    imageIds: ["img_1"],
    description: "এটি একটি যথেষ্ট লম্বা বিবরণ যা ত্রিশ অক্ষরের বেশি।",
    ownerName: "করিম",
    phone: "01712345678",
  };

  it("accepts a complete submission", () => {
    expect(createPropertySchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects an unknown category", () => {
    expect(
      createPropertySchema.safeParse({ ...VALID, categorySlug: "hacked" }).success,
    ).toBe(false);
  });

  it("requires at least one image and caps the count", () => {
    expect(createPropertySchema.safeParse({ ...VALID, imageIds: [] }).success).toBe(false);
    expect(
      createPropertySchema.safeParse({
        ...VALID,
        imageIds: Array.from({ length: 20 }, (_, i) => `img_${i}`),
      }).success,
    ).toBe(false);
  });

  it("ignores a status supplied by the client", () => {
    const parsed = createPropertySchema.parse({ ...VALID, status: "APPROVED" });
    expect(parsed).not.toHaveProperty("status");
  });

  it("treats the string 'false' as false rather than truthy", () => {
    expect(createPropertySchema.parse({ ...VALID, submit: "false" }).submit).toBe(false);
    expect(createPropertySchema.parse({ ...VALID, submit: "true" }).submit).toBe(true);
    expect(createPropertySchema.parse(VALID).submit).toBe(true);
  });
});

describe("search query", () => {
  it("applies safe defaults", () => {
    const parsed = searchQuerySchema.parse({});
    expect(parsed).toMatchObject({ sort: "newest", page: 1, view: "grid" });
  });

  it("falls back rather than throwing on hostile values", () => {
    const parsed = searchQuerySchema.parse({
      sort: "'; DROP TABLE properties; --",
      page: "-99",
      view: "svg",
      category: "not-a-category",
    });

    expect(parsed.sort).toBe("newest");
    expect(parsed.page).toBe(1);
    expect(parsed.view).toBe("grid");
    expect(parsed.category).toBeUndefined();
  });

  it("clamps the page number to a sane range", () => {
    expect(searchQuerySchema.parse({ page: "99999" }).page).toBe(1);
  });
});
