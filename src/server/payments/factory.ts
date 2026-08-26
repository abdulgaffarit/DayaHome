import "server-only";
import { getEnv } from "@/server/cloudflare/env";
import type { PaymentProvider } from "./provider";
import { SslcommerzProvider } from "./sslcommerz";

/**
 * Builds the configured payment provider.
 *
 * Credentials are read from Worker secrets at call time and never leave the
 * server. Throwing on a missing secret is deliberate: a misconfigured store
 * should fail loudly at the moment of payment rather than quietly produce a
 * broken gateway session.
 */
export function getPaymentProvider(): PaymentProvider {
  const env = getEnv();
  const storeId = env.SSLCOMMERZ_STORE_ID;
  const storePassword = env.SSLCOMMERZ_STORE_PASSWORD;

  if (!storeId || !storePassword) {
    throw new Error(
      "SSLCOMMERZ is not configured. Set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD " +
        "with `wrangler secret put` (or in .dev.vars for local development).",
    );
  }

  return new SslcommerzProvider({
    storeId,
    storePassword,
    // Anything other than an explicit "false" keeps us in the sandbox — the
    // safe default if the variable is missing or malformed.
    isSandbox: String(env.SSLCOMMERZ_IS_SANDBOX ?? "true") !== "false",
  });
}
