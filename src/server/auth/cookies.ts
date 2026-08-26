import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "@/server/cloudflare/env";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./session";

/**
 * Session cookie policy.
 *
 * - HttpOnly: the token is never readable from JavaScript.
 * - SameSite=Lax: blocks cross-site POSTs (the CSRF baseline) while still
 *   letting normal navigations — including the SSLCOMMERZ success redirect —
 *   arrive authenticated.
 * - Secure in production only, so local http://localhost development works.
 */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 0,
  });
}
