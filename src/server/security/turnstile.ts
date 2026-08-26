/**
 * Cloudflare Turnstile verification for abuse-sensitive forms
 * (registration, login, post-ad, report).
 *
 * When no secret is configured — local development, tests — verification is
 * skipped and that fact is returned explicitly, so a missing secret in
 * production is visible in logs rather than silently disabling the check.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  skipped: boolean;
  errorCodes?: string[];
}

export async function verifyTurnstile(
  token: string | undefined | null,
  secret: string | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!secret) return { success: true, skipped: true };
  if (!token) return { success: false, skipped: false, errorCodes: ["missing-input-response"] };

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, { method: "POST", body });
    const data = (await response.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    return {
      success: data.success === true,
      skipped: false,
      errorCodes: data["error-codes"],
    };
  } catch {
    // A Turnstile outage must not lock everybody out of the site; fail open but
    // make it loud.
    console.error("[turnstile] verification request failed — failing open");
    return { success: true, skipped: true, errorCodes: ["verification-unreachable"] };
  }
}
