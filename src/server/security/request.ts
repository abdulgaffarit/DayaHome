import { sha256Hex } from "@/lib/ids";

/**
 * Client IP as seen by Cloudflare. `CF-Connecting-IP` is set by the edge and
 * cannot be spoofed by the client; `x-forwarded-for` is only a local-dev
 * fallback.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

/**
 * Pseudonymised IP for logs and rate-limit buckets.
 *
 * The site salt means the stored digest cannot be reversed with a rainbow table
 * of the (small) IPv4 space.
 */
export async function ipHash(request: Request, salt: string): Promise<string> {
  return sha256Hex(`${salt}|${clientIp(request)}`);
}

/**
 * Per-visitor view fingerprint: session cookie when present, otherwise a salted
 * hash of IP + user agent. Deliberately coarse — it exists to stop refresh
 * inflation, not to track people.
 */
export async function viewFingerprint(
  request: Request,
  salt: string,
  sessionId: string | null,
): Promise<string> {
  if (sessionId) return sha256Hex(`${salt}|s|${sessionId}`);
  const ua = request.headers.get("user-agent") ?? "";
  return sha256Hex(`${salt}|a|${clientIp(request)}|${ua}`);
}

/**
 * CSRF defence for state-changing requests.
 *
 * The session cookie is SameSite=Lax, which already blocks cross-site form
 * POSTs. This adds a second, independent check: the request must carry an
 * `Origin` (or `Referer`) that matches the site. Requests with neither header
 * are rejected, since every browser sends `Origin` on cross-origin and
 * same-origin POSTs alike.
 */
export function isSameOrigin(request: Request, expectedOrigin: string): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const expected = normalizeOrigin(expectedOrigin);
  const origin = request.headers.get("origin");
  if (origin) return normalizeOrigin(origin) === expected;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return normalizeOrigin(new URL(referer).origin) === expected;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.replace(/\/$/, "").toLowerCase();
  }
}
