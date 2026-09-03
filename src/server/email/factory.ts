import "server-only";
import { getEnv } from "@/server/cloudflare/env";
import { createEmailProvider, type EmailProvider } from "./provider";

/**
 * Builds the configured email provider.
 *
 * Unset configuration falls back to the console provider rather than throwing:
 * a missing email setup should not stop someone from using the site, and the
 * log line makes the misconfiguration obvious in Workers Logs.
 */
export function getEmailProvider(): EmailProvider {
  const env = getEnv();
  return createEmailProvider({
    provider: env.EMAIL_PROVIDER,
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  });
}
