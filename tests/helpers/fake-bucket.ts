/**
 * An in-memory R2 bucket.
 *
 * Records what was written so tests can assert that the stored object key is
 * server-generated and that the bytes reaching storage are the ones that
 * passed validation.
 */
export class FakeBucket {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> }
  >();

  async put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) {
    this.objects.set(key, {
      bytes: new Uint8Array(value as ArrayBuffer),
      contentType: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
    });
    return { key };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async get(key: string) {
    return this.objects.has(key) ? { key } : null;
  }
}

export const asBucket = (fake: FakeBucket): R2Bucket => fake as unknown as R2Bucket;

/** Byte headers the real sniffer recognises, for building fixture uploads. */
export const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const JPEG_HEADER = [0xff, 0xd8, 0xff];

/** A minimal but genuinely well-formed PNG header, with dimensions. */
export function pngBytes(width = 728, height = 90, padTo = 64): Uint8Array {
  const bytes = new Uint8Array(Math.max(padTo, 24));
  bytes.set(PNG_HEADER, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** Bytes that are not any accepted image format. */
export function svgBytes(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
}
