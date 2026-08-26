/**
 * Property image storage on Cloudflare R2.
 *
 * D1 holds only object keys and metadata; the bytes live in R2. Uploads are
 * validated by sniffing the file's magic bytes rather than by trusting the
 * client-supplied filename, extension, or Content-Type — any of which an
 * attacker controls completely.
 */
import { newId } from "@/lib/ids";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGES_PER_PROPERTY = 15;

/** The only formats we accept, keyed by their magic-byte signature. */
const ALLOWED_TYPES = {
  "image/jpeg": { ext: "jpg" },
  "image/png": { ext: "png" },
  "image/webp": { ext: "webp" },
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

export type SniffResult =
  | { ok: true; mime: AllowedMime; ext: string }
  | { ok: false; reason: "UNSUPPORTED_TYPE" };

/**
 * Determines the real content type from the leading bytes.
 *
 * JPEG  FF D8 FF
 * PNG   89 50 4E 47 0D 0A 1A 0A
 * WebP  "RIFF" .... "WEBP"
 */
export function sniffImageType(bytes: Uint8Array): SniffResult {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { ok: true, mime: "image/png", ext: "png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ok: true, mime: "image/webp", ext: "webp" };
  }
  return { ok: false, reason: "UNSUPPORTED_TYPE" };
}

/**
 * Generates the R2 object key.
 *
 * The key is entirely server-generated: a date prefix for lifecycle rules, the
 * uploading user's id for traceability, and a random component. No part of the
 * user's filename survives, which removes path traversal and key-collision
 * concerns outright.
 */
export function buildObjectKey(userId: string, ext: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `properties/${yyyy}/${mm}/${sanitizeSegment(userId)}/${newId()}.${ext}`;
}

/** Belt-and-braces: strip anything that could escape the key namespace. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "unknown";
}

export interface StoredImage {
  objectKey: string;
  mime: AllowedMime;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export type StoreImageResult =
  | { ok: true; image: StoredImage }
  | { ok: false; reason: "TOO_LARGE" | "UNSUPPORTED_TYPE" | "EMPTY" };

export async function storeImage(
  bucket: R2Bucket,
  userId: string,
  file: { bytes: Uint8Array },
): Promise<StoreImageResult> {
  const { bytes } = file;
  if (bytes.length === 0) return { ok: false, reason: "EMPTY" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "TOO_LARGE" };

  const sniffed = sniffImageType(bytes);
  if (!sniffed.ok) return { ok: false, reason: "UNSUPPORTED_TYPE" };

  const objectKey = buildObjectKey(userId, sniffed.ext);
  const dimensions = readDimensions(bytes, sniffed.mime);

  await bucket.put(objectKey, bytes as unknown as ArrayBuffer, {
    httpMetadata: {
      contentType: sniffed.mime,
      // Object keys are random and immutable, so a long cache is safe.
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: { uploadedBy: userId },
  });

  return {
    ok: true,
    image: {
      objectKey,
      mime: sniffed.mime,
      sizeBytes: bytes.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    },
  };
}

export async function deleteImage(bucket: R2Bucket, objectKey: string): Promise<void> {
  await bucket.delete(objectKey);
}

/**
 * Reads intrinsic dimensions from the header so `<img width height>` can be
 * emitted and layout shift avoided. Decoding the whole image would be far too
 * expensive inside a Worker.
 */
export function readDimensions(
  bytes: Uint8Array,
  mime: AllowedMime,
): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === "image/jpeg") return readJpegDimensions(bytes);
    if (mime === "image/webp") return readWebpDimensions(bytes);
  } catch {
    return null;
  }
  return null;
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2; // skip SOI
  while (offset + 9 < bytes.length) {
    if (view.getUint8(offset) !== 0xff) {
      offset++;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (format === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (format === "VP8 " && bytes.length >= 30) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (format === "VP8L" && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

/**
 * Public URL for an object key.
 *
 * Defaults to the app's own `/api/images/...` route, which streams from R2. In
 * production point `NEXT_PUBLIC_IMAGE_BASE_URL` at a custom domain in front of
 * the bucket so images are served straight from the edge.
 */
export function imageUrl(objectKey: string | null, baseUrl?: string): string | null {
  if (!objectKey) return null;
  const base = (baseUrl ?? "/api/images").replace(/\/$/, "");
  return `${base}/${objectKey}`;
}
