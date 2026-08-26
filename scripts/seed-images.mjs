/**
 * Generates placeholder property photos for the development seed.
 *
 * Real listing photos cannot live in the repository, so this writes a small set
 * of generated PNGs to `.seed-images/`, prints the `wrangler r2 object put`
 * commands that upload them, and emits the matching `property_images` rows.
 *
 * PNGs are built here by hand rather than with an image library: the encoder is
 * about fifty lines for a flat-colour image, which is a far better trade than
 * adding a dependency the application itself never uses.
 *
 * Usage:
 *   node scripts/seed-images.mjs > seed-images.sql   # writes SQL + PNG files
 *   sh .seed-images/upload.sh                        # uploads to R2 (local)
 */
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const WIDTH = 800;
const HEIGHT = 600;
const OUT_DIR = ".seed-images";

/* ---------------------------- PNG encoding ---------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Flat background with a lighter diagonal band, so the images aren't identical. */
function makePng(rgb, variant) {
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  let offset = 0;
  for (let y = 0; y < HEIGHT; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < WIDTH; x++) {
      const band = ((x + y * (1 + variant * 0.3)) % 220) < 110 ? 14 : 0;
      raw[offset++] = Math.min(255, rgb[0] + band);
      raw[offset++] = Math.min(255, rgb[1] + band);
      raw[offset++] = Math.min(255, rgb[2] + band);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------- Seed wiring ---------------------------- */

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz";
function id(prefix, seed) {
  const digest = createHash("sha256").update(`${prefix}:${seed}`).digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

// Muted greens and warm neutrals — recognisably placeholders, not stock photos.
const PALETTE = [
  [126, 158, 138],
  [148, 166, 141],
  [170, 160, 138],
  [136, 150, 164],
  [158, 142, 130],
];

// Matches the property keys in scripts/seed.ts.
const PROPERTY_KEYS = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
const OWNER_BY_PROPERTY = {
  p1: "owner1", p2: "owner2", p3: "owner3", p4: "owner4", p5: "owner1",
  p6: "owner5", p7: "owner2", p8: "owner3", p9: "owner4", p10: "owner5",
  p11: "owner1", p12: "owner2", p13: "owner3", p14: "owner4", p15: "owner5",
  p16: "owner1", p17: "owner2", p18: "owner3", p19: "owner4", p20: "owner5",
};

mkdirSync(OUT_DIR, { recursive: true });

const sql = [];
const uploads = [];
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

PROPERTY_KEYS.forEach((propertyKey, index) => {
  // Two photos per listing: enough to exercise the gallery and the thumbnail
  // strip without bloating the seed.
  for (let n = 0; n < 2; n++) {
    const fileName = `${propertyKey}-${n}.png`;
    const objectKey = `properties/2026/01/seed/${propertyKey}-${n}.png`;
    const png = makePng(PALETTE[(index + n) % PALETTE.length], n);
    writeFileSync(`${OUT_DIR}/${fileName}`, png);

    uploads.push(
      `wrangler r2 object put "dayarampur-property-images-dev/${objectKey}" ` +
        `--file "${OUT_DIR}/${fileName}" --content-type image/png --local`,
    );

    sql.push(
      `INSERT OR IGNORE INTO property_images (id, property_id, uploaded_by, object_key, mime_type, size_bytes, width, height, alt_bn, sort_order, is_primary, created_at) VALUES (` +
        [
          `'${id("img", `${propertyKey}-${n}`)}'`,
          `'${id("prp", propertyKey)}'`,
          `'${id("usr", OWNER_BY_PROPERTY[propertyKey])}'`,
          `'${objectKey}'`,
          `'image/png'`,
          String(png.length),
          String(WIDTH),
          String(HEIGHT),
          `'বিজ্ঞাপনের ছবি'`,
          String(n),
          n === 0 ? "1" : "0",
          `'${now}'`,
        ].join(", ") +
        ");",
    );
  }
});

writeFileSync(
  `${OUT_DIR}/upload.sh`,
  ["#!/bin/sh", "set -e", "# Uploads the generated placeholder images to local R2.", ...uploads, ""].join("\n"),
  { mode: 0o755 },
);

process.stdout.write(
  [
    "-- Placeholder property images for the development seed.",
    "-- Run `sh .seed-images/upload.sh` first so the objects exist in R2.",
    "",
    ...sql,
    "",
  ].join("\n"),
);

console.error(
  `Wrote ${PROPERTY_KEYS.length * 2} PNG files to ${OUT_DIR}/ and ${OUT_DIR}/upload.sh`,
);
