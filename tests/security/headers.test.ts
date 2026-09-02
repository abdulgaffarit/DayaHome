/**
 * Security headers and the canonical-host redirect.
 *
 * `securityHeaders()` previously existed but was never called by anything —
 * documented as applied, in reality dead code. These tests pin the middleware
 * that now applies it, so it cannot quietly become dead again.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { securityHeaders, NO_STORE_HEADERS } from "@/server/security/headers";

const middlewareSource = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

describe("security headers are actually wired up", () => {
  it("the middleware calls securityHeaders()", () => {
    expect(middlewareSource).toContain("securityHeaders(");
  });

  it("sets the headers that matter", () => {
    const headers = securityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
  });

  it("the CSP locks down the directives an attacker would reach for", () => {
    const csp = securityHeaders()["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("the CSP allows exactly the third parties the app loads", () => {
    const csp = securityHeaders()["Content-Security-Policy"];
    // Turnstile, Google Fonts, OSM tiles, and the payment gateway's form target.
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("tile.openstreetmap.org");
    expect(csp).toContain("https://securepay.sslcommerz.com");
    // Same-origin only for XHR/fetch — the contact endpoint is same-origin.
    expect(csp).toContain("connect-src 'self'");
  });

  it("supports a nonce for script-src when one is supplied", () => {
    const csp = securityHeaders({ nonce: "abc123" })["Content-Security-Policy"];
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("private responses are never cached", () => {
    expect(NO_STORE_HEADERS["Cache-Control"]).toContain("no-store");
    expect(NO_STORE_HEADERS["Cache-Control"]).toContain("private");
  });
});

describe("canonical host", () => {
  it("the middleware redirects www to the apex with a 308", () => {
    // 308 rather than 302: it preserves the method, so a POST landing on www
    // is not silently downgraded to a GET.
    expect(middlewareSource).toMatch(/host\.startsWith\("www\."\)/);
    expect(middlewareSource).toContain("308");
  });

  it("build assets and the image route are excluded from the matcher", () => {
    expect(middlewareSource).toContain("_next/static");
    expect(middlewareSource).toContain("api/images");
  });
});
