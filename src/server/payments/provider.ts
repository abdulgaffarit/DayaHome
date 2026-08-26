/**
 * Payment provider abstraction.
 *
 * SSLCOMMERZ is the only implementation today, but the unlock service talks to
 * this interface so a second gateway (bKash, Nagad) can be added without
 * touching the unlock logic.
 */

export interface PaymentSessionRequest {
  transactionId: string;
  amount: number;
  currency: string;
  productName: string;
  productCategory: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  };
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  /** Opaque values echoed back by the gateway; used to cross-check the IPN. */
  metadata?: Record<string, string>;
}

export interface PaymentSessionResult {
  ok: boolean;
  redirectUrl?: string;
  sessionKey?: string;
  failureReason?: string;
}

/**
 * Result of authoritative server-to-server verification.
 *
 * `verified: true` is the ONLY thing that may cause an unlock to become ACTIVE.
 */
export interface VerificationResult {
  verified: boolean;
  status: "VALID" | "VALIDATED" | "FAILED" | "CANCELLED" | "PENDING" | "UNKNOWN";
  transactionId?: string;
  validationId?: string;
  amount?: number;
  currency?: string;
  bankTransactionId?: string;
  cardType?: string;
  riskLevel?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  createSession(request: PaymentSessionRequest): Promise<PaymentSessionResult>;
  /**
   * Verifies an IPN payload's signature. A cheap first filter only — a `true`
   * here is never sufficient to settle a payment.
   */
  verifySignature(payload: Record<string, string>): boolean;
  /**
   * Server-to-server confirmation against the gateway, checking that the
   * transaction id, amount and currency are exactly what we expect.
   */
  verifyTransaction(params: {
    validationId: string;
    expectedTransactionId: string;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult>;
}
