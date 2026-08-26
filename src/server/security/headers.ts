/**
 * Security response headers.
 *
 * The CSP allows Turnstile (challenges.cloudflare.com), Google Fonts and
 * OpenStreetMap tiles, which is everything the app actually loads from outside
 * its own origin. `unsafe-inline` is present for styles only — Next injects
 * inline <style> for critical CSS — never for scripts.
 */
export function securityHeaders(opts: { nonce?: string } = {}): Record<string, string> {
  const scriptSrc = opts.nonce
    ? `'self' 'nonce-${opts.nonce}' https://challenges.cloudflare.com`
    : `'self' 'unsafe-inline' https://challenges.cloudflare.com`;

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "form-action 'self' https://sandbox.sslcommerz.com https://securepay.sslcommerz.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  };
}

/**
 * Applied to every response carrying private data (contact details, dashboard
 * and admin JSON). Keeps it out of shared caches and browser history caches.
 */
export const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
};
