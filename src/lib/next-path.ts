/**
 * Safe internal return paths.
 *
 * A `next` parameter is attacker-controllable — it travels in a URL anyone can
 * craft and send to a victim. Anything that is not a plain, same-origin,
 * absolute path is discarded rather than sanitised, because a partial fix here
 * is an open redirect: a login page that forwards to an arbitrary URL is a
 * ready-made phishing hop borrowing this site's credibility.
 *
 * Rejected, specifically:
 *   - "https://evil.test/x" — absolute, different origin
 *   - "//evil.test/x"       — protocol-relative, resolves off-origin
 *   - "/\evil.test"         — some browsers normalise the backslash to "//"
 *   - "javascript:..."      — not a path at all
 *   - anything not starting with "/"
 */
export const DEFAULT_NEXT_PATH = "/dashboard";

/** Control characters, which can smuggle a newline or NUL past a naive check. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (!value) return fallback;

  // Must be an absolute path on this origin, and must not be able to become a
  // network-path reference.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (CONTROL_CHARS.test(value)) return fallback;

  return value;
}

/** The `?next=` query fragment for a target path, or "" when there is none. */
export function nextParam(path: string | null | undefined): string {
  const safe = path ? safeNextPath(path, "") : "";
  return safe ? `?next=${encodeURIComponent(safe)}` : "";
}
