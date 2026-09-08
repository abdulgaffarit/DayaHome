/**
 * Password hashing with PBKDF2-HMAC-SHA256 via WebCrypto.
 *
 * Why PBKDF2 rather than bcrypt/argon2: WebCrypto is the only cryptographic
 * primitive available natively in Workers, and pulling a WASM argon2 build into
 * the bundle would cost far more than it buys at this scale. The iteration
 * count is stored inside the hash string, so it can be raised later and old
 * hashes keep verifying (and are transparently upgraded on next login) — but
 * only up to MAX_SUPPORTED_ITERATIONS, which the Workers runtime enforces.
 */
import { timingSafeEqual } from "@/lib/ids";

const ALGO = "PBKDF2";
const HASH = "SHA-256";
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

/**
 * The hard ceiling the Workers runtime enforces on PBKDF2.
 *
 * `crypto.subtle.deriveBits` throws
 *   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 *   supported (requested 150000)
 * for anything higher. Node has no such limit, which is why this only ever
 * surfaced once the code ran on Cloudflare.
 */
export const MAX_SUPPORTED_ITERATIONS = 100_000;

/**
 * The cost every new hash is written at.
 *
 * Pinned to the platform ceiling: it is the strongest PBKDF2 cost Workers will
 * actually run, and raising it again would break hashing outright rather than
 * merely slow it down.
 */
export const DEFAULT_ITERATIONS = MAX_SUPPORTED_ITERATIONS;

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

  // A hash written before the Workers ceiling was known cannot be verified
  // here at all — deriveBits would throw rather than return a wrong answer.
  // Failing closed keeps that a clean "wrong password" instead of a 500, and
  // the account recovers through password reset, which writes a new hash at
  // the supported cost.
  if (parsed.iterations > MAX_SUPPORTED_ITERATIONS) {
    console.error(
      `[auth] stored hash uses ${parsed.iterations} PBKDF2 iterations, above the ` +
        `platform maximum of ${MAX_SUPPORTED_ITERATIONS}; this account must reset its password`,
    );
    return false;
  }

  const derived = await deriveBits(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(b64(derived), b64(parsed.hash));
}

/**
 * True when the stored hash is not at the current cost.
 *
 * Deliberately `!==` rather than `<`: a hash is due for replacement both when
 * it is weaker than we now require AND when it is stronger than the platform
 * can execute. The second case used to be impossible, which is why this was
 * once a `<` — a 150,000-iteration hash is unverifiable on Workers, so it must
 * be rewritten at the first opportunity, not treated as good enough.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return !parsed || parsed.iterations !== DEFAULT_ITERATIONS;
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
