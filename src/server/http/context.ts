import "server-only";
import { cookies } from "next/headers";
import { getDb, getEnv, siteUrl, type AppEnv } from "@/server/cloudflare/env";
import { SESSION_COOKIE, resolveSession, type AuthUser } from "@/server/auth/session";
import { ipHash } from "@/server/security/request";
import { isSameOrigin } from "@/server/security/request";
import { jsonError } from "./responses";

export interface ApiContext {
  db: D1Database;
  env: AppEnv;
  user: AuthUser | null;
  sessionId: string | null;
  /** Salted hash of the client IP — safe to store in logs and rate-limit keys. */
  ipHash: string;
  /** Rate-limit subject: the user id when signed in, otherwise the IP hash. */
  subject: string;
}

/**
 * Builds the per-request context for a route handler.
 *
 * The SESSION_SECRET doubles as the salt for IP hashing; when it is unset (local
 * development) a fixed development salt is used so the code path is identical.
 */
export async function buildContext(request: Request): Promise<ApiContext> {
  const env = getEnv();
  const db = getDb();
  const salt = env.SESSION_SECRET ?? "dev-salt";

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await resolveSession(db, token) : null;

  const hashed = await ipHash(request, salt);
  return {
    db,
    env,
    user: session?.user ?? null,
    sessionId: session?.sessionId ?? null,
    ipHash: hashed,
    subject: session?.user.id ?? hashed,
  };
}

/**
 * CSRF guard for state-changing API routes.
 *
 * Returns a 403 response when the request did not originate from this site.
 * Combined with the SameSite=Lax session cookie, this makes a cross-site
 * forged POST fail twice over.
 */
export function requireSameOrigin(request: Request): Response | null {
  return isSameOrigin(request, siteUrl()) ? null : jsonError("CSRF_FAILED");
}

/** Returns a 401 response when nobody is signed in. */
export function requireAuth(context: ApiContext): Response | null {
  return context.user ? null : jsonError("UNAUTHORIZED");
}
