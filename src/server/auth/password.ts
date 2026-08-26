/**
 * Password hashing with PBKDF2-HMAC-SHA256 via WebCrypto.
 *
 * Why PBKDF2 rather than bcrypt/argon2: WebCrypto is the only cryptographic
 * primitive available natively in Workers, and pulling a WASM argon2 build into
 * the bundle would cost far more than it buys at this scale. The iteration
 * count is stored inside the hash string, so it can be raised later and old
 * hashes keep verifying (and are transparently upgraded on next login).
 */
import { timingSafeEqual } from "@/lib/ids";

const ALGO = "PBKDF2";
const HASH = "SHA-256";
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

/**
 * Tuned for the Workers CPU budget: ~150k iterations keeps a login well inside
 * the request limit while staying far above a trivially brute-forceable cost.
 */
export const DEFAULT_ITERATIONS = 150_000;

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(password, salt, iterations);
  return `pbkdf2$${HASH.toLowerCase()}$${iterations}$${b64(salt)}$${b64(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await deriveBits(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(b64(derived), b64(parsed.hash));
}

/** True when the stored hash uses a weaker cost than we now require. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return !parsed || parsed.iterations < DEFAULT_ITERATIONS;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    ALGO,
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: ALGO, hash: HASH, salt: salt as BufferSource, iterations },
    key,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(bits);
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 5) return null;
  const [scheme, hashName, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== "pbkdf2" || hashName !== HASH.toLowerCase()) return null;
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return null;
  try {
    return { iterations, salt: unb64(saltRaw), hash: unb64(hashRaw) };
  } catch {
    return null;
  }
}

function b64(buf: Uint8Array): string {
  let bin = "";
  for (const byte of buf) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function unb64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
