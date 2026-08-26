/**
 * Identifier helpers. Everything here relies on WebCrypto only, so it runs
 * unchanged in Workers, in `next dev`, and in Vitest.
 */

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz"; // no l/o — avoids misreads

/** URL-safe, non-sequential id used as the primary key of every table. */
export function newId(prefix = ""): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** High-entropy opaque token (sessions, verification links, transaction ids). */
export function newToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(buf);
}

export function base64url(buf: Uint8Array): string {
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex digest. Used for session lookup keys and IP pseudonymisation. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** Constant-time string comparison — for tokens and signatures. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
