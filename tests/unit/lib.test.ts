/**
 * Pure helpers: Bangla formatting, slugs, image sniffing, MD5.
 */
import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatRelativeBanglaDate,
  formatTaka,
  fromBanglaDigits,
  groupIndian,
  toBanglaDigits,
} from "@/lib/bangla";
import { buildPropertySlug, slugify, transliterateBangla } from "@/lib/slug";
import { md5Hex } from "@/server/payments/md5";
import { readDimensions, sniffImageType, buildObjectKey } from "@/server/storage/images";
import { maskOwnerName, formatPublicId } from "@/server/properties/columns";
import { timingSafeEqual } from "@/lib/ids";

describe("Bangla numerals", () => {
  it("converts both ways", () => {
    expect(toBanglaDigits(12345)).toBe("১২৩৪৫");
    expect(fromBanglaDigits("১২৩৪৫")).toBe("12345");
    expect(fromBanglaDigits(toBanglaDigits("2026-08-26"))).toBe("2026-08-26");
  });

  it("groups digits the South Asian way", () => {
    expect(groupIndian(1000)).toBe("1,000");
    expect(groupIndian(100000)).toBe("1,00,000");
    expect(groupIndian(12345678)).toBe("1,23,45,678");
    expect(groupIndian(999)).toBe("999");
  });

  it("formats money compactly for large amounts", () => {
    expect(formatTaka(9500)).toBe("৳৯,৫০০");
    expect(formatTaka(6500000, { compact: true })).toBe("৳৬৫ লাখ");
    expect(formatTaka(65000000, { compact: true })).toBe("৳৬.৫ কোটি");
    expect(formatTaka(450000, { compact: true })).toBe("৳৪.৫ লাখ");
  });

  it("appends the price period", () => {
    expect(formatPrice(9500, "MONTHLY")).toBe("৳৯,৫০০/মাস");
    // A sale price has no period suffix.
    expect(formatPrice(6500000, "TOTAL", { compact: true })).toBe("৳৬৫ লাখ");
  });

  it("formats relative dates", () => {
    const now = new Date("2026-08-26T12:00:00Z");
    expect(formatRelativeBanglaDate("2026-08-26T08:00:00Z", now)).toBe("আজ");
    expect(formatRelativeBanglaDate("2026-08-25T08:00:00Z", now)).toBe("গতকাল");
    expect(formatRelativeBanglaDate("2026-08-21T08:00:00Z", now)).toBe("৫ দিন আগে");
    expect(formatRelativeBanglaDate(null, now)).toBe("");
  });
});

describe("slugs", () => {
  it("transliterates Bangla to ASCII", () => {
    expect(transliterateBangla("বাসা")).toMatch(/^[a-z]+$/);
    // ড় is a single grapheme built from two code points; it must not be split.
    expect(transliterateBangla("বাড়ি")).not.toContain("়");
  });

  it("produces URL-safe slugs", () => {
    const slug = slugify("কলেজ রোডে ৩ রুমের ফ্যামিলি বাসা ভাড়া");
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toMatch(/^-|-$/);
  });

  it("appends the public reference for uniqueness", () => {
    expect(buildPropertySlug("বাসা ভাড়া", 1042)).toMatch(/-1042$/);
    // An untranslatable title still produces something usable.
    expect(buildPropertySlug("!!!", 7)).toBe("property-7");
  });
});

describe("image validation", () => {
  it("identifies JPEG, PNG and WebP from their magic bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      ok: true,
      mime: "image/jpeg",
    });
    expect(
      sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toMatchObject({ ok: true, mime: "image/png" });

    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    expect(sniffImageType(webp)).toMatchObject({ ok: true, mime: "image/webp" });
  });

  it("CRITICAL: rejects a file whose bytes are not an image, whatever it claims to be", () => {
    // An SVG (which can carry script) and a PHP payload renamed to .jpg.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const php = new TextEncoder().encode('<?php system($_GET["c"]); ?>');
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

    expect(sniffImageType(svg)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(sniffImageType(php)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(sniffImageType(html)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
    expect(sniffImageType(new Uint8Array(0))).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });

  it("reads PNG dimensions from the header", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(16, 800);
    new DataView(png.buffer).setUint32(20, 600);
    expect(readDimensions(png, "image/png")).toEqual({ width: 800, height: 600 });
  });

  it("CRITICAL: the object key is server-generated and cannot be escaped", () => {
    const key = buildObjectKey("../../etc/passwd", "jpg");
    expect(key.startsWith("properties/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key).toMatch(/^properties\/\d{4}\/\d{2}\/[A-Za-z0-9_-]+\/[a-z0-9]+\.jpg$/);
  });

  it("generates a different key every time", () => {
    expect(buildObjectKey("user1", "jpg")).not.toBe(buildObjectKey("user1", "jpg"));
  });
});

describe("MD5 (SSLCOMMERZ signature scheme)", () => {
  it("matches the published test vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(
      md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

describe("misc helpers", () => {
  it("masks the owner name for public display", () => {
    expect(maskOwnerName("মোঃ রফিকুল ইসলাম")).toBe("মোঃ রফিকুল ই.");
    expect(maskOwnerName("করিম")).toBe("করিম");
    expect(maskOwnerName("   ")).toBe("মালিক");
  });

  it("formats the public listing reference", () => {
    expect(formatPublicId(1042)).toBe("DP-1042");
  });

  it("compares strings without an early exit", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
