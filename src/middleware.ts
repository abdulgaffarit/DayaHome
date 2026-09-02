import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@/server/security/headers";

/**
 * Runs on every page and API request.
 *
 * Two jobs:
 *
 * 1. **Canonical host.** dayarampur.com and www.dayarampur.com are both
 *    attached to this Worker as custom domains, so without this the site would
 *    serve identical content on two hostnames. A 308 to the apex keeps one
 *    canonical URL for search engines and for the payment callbacks.
 *
 * 2. **Security headers.** CSP, HSTS, nosniff, frame-ancestors and friends,
 *    applied in one place so no route can forget them.
 */
export function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;

  // ---- 1. www → apex -------------------------------------------------------
  if (host.startsWith("www.")) {
    const target = new URL(url);
    target.host = host.slice(4);
    target.protocol = "https:";
    target.port = "";
    // 308 preserves the method and body, so a POST that lands on www is not
    // silently downgraded to a GET.
    return NextResponse.redirect(target, 308);
  }

  // ---- 2. Security headers -------------------------------------------------
  const response = NextResponse.next();

  // The dev server uses inline eval and a websocket for HMR, which a strict CSP
  // blocks. Everything else applies in every environment.
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  for (const [name, value] of Object.entries(securityHeaders())) {
    if (isLocal && (name === "Content-Security-Policy" || name === "Strict-Transport-Security")) {
      continue;
    }
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  /**
   * Skips build assets and the image route: they are immutable, served
   * straight from R2 or the asset store, and gain nothing from a CSP that
   * applies to documents.
   */
  matcher: ["/((?!_next/static|_next/image|api/images|favicon.ico).*)"],
};
