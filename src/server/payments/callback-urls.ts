/**
 * Where a gateway sends the payer back, and where it calls us server-to-server.
 *
 * These URLs used to be written out at each payment-creation call site, and all
 * three hardcoded the SSLCOMMERZ paths. That was invisible while SSLCOMMERZ was
 * the only redirecting gateway, and wrong the moment a second one existed: a
 * UddoktaPay payer would have been returned to the SSLCOMMERZ handler, which
 * looks for `tran_id`/`val_id` fields UddoktaPay does not send.
 *
 * SSLCOMMERZ keeps its original paths deliberately. Those URLs are registered
 * in the merchant panel, so changing them here would break a live integration
 * that is configured elsewhere. Every other gateway uses the generic routes,
 * which take the gateway id as a path segment.
 */
import type { GatewayId } from "@/domain/payments";

export interface GatewayCallbackUrls {
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
}

/**
 * @param base Absolute site origin, from `siteUrl()`. No trailing slash.
 */
export function gatewayCallbackUrls(gatewayId: GatewayId, base: string): GatewayCallbackUrls {
  if (gatewayId === "SSLCOMMERZ") {
    return {
      successUrl: `${base}/api/payments/sslcommerz/return?outcome=success`,
      failUrl: `${base}/api/payments/sslcommerz/return?outcome=fail`,
      cancelUrl: `${base}/api/payments/sslcommerz/return?outcome=cancel`,
      ipnUrl: `${base}/api/payments/sslcommerz/ipn`,
    };
  }

  const returnUrl = `${base}/api/payments/return/${gatewayId}`;
  return {
    successUrl: `${returnUrl}?outcome=success`,
    failUrl: `${returnUrl}?outcome=fail`,
    cancelUrl: `${returnUrl}?outcome=cancel`,
    ipnUrl: `${base}/api/payments/webhook/${gatewayId}`,
  };
}
