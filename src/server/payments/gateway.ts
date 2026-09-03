/**
 * The payment gateway contract.
 *
 * Business logic (unlock purchase, advertising purchase, featured listings)
 * depends only on this interface — never on SSLCOMMERZ or any other provider.
 * Adding a gateway means adding an adapter, not editing the services.
 *
 * A gateway that has no real integration yet must still implement this
 * interface, report `isConfigured() === false`, and throw
 * `GatewayNotConfiguredError` from its operations. It must NEVER pretend to
 * take a payment.
 */
import type { GatewayId, PaymentType } from "@/domain/payments";

/** What a gateway can actually do. Callers check before offering an action. */
export interface GatewayCapabilities {
  /** Redirects the payer to a hosted checkout page. */
  hostedCheckout: boolean;
  /** Calls back server-to-server when a payment settles. */
  webhook: boolean;
  /** Can move money back programmatically. */
  refund: boolean;
  /** Can be asked the current state of a transaction. */
  statusCheck: boolean;
  /** Settlement needs a human to confirm — e.g. a personal bKash number. */
  manualSettlement: boolean;
}

export class GatewayNotConfiguredError extends Error {
  constructor(readonly gatewayId: GatewayId) {
    super(
      `Payment gateway ${gatewayId} is not configured. ` +
        `Add its credentials as Worker secrets and enable it in Admin → Payment Gateways.`,
    );
    this.name = "GatewayNotConfiguredError";
  }
}

export interface PaymentCustomer {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

export interface CreatePaymentRequest {
  /** Our reference, unique per attempt. */
  transactionId: string;
  /** Whole units of `currency`. Always decided server-side. */
  amount: number;
  currency: string;
  paymentType: PaymentType;
  /** Human-readable description of what is being bought. */
  description: string;
  customer: PaymentCustomer;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  /** Echoed back by gateways that support it, for cross-checking callbacks. */
  metadata?: Record<string, string>;
}

/**
 * How the payer completes the payment.
 *
 * A discriminated union rather than an optional `redirectUrl`, because a
 * manual gateway has instructions and no redirect, and the caller must handle
 * both explicitly rather than dereferencing an absent URL.
 */
export type CreatePaymentResult =
  | { kind: "REDIRECT"; redirectUrl: string; sessionKey?: string }
  | {
      kind: "INSTRUCTIONS";
      /** Bangla instructions shown to the payer. */
      instructionsBn: string;
      /** The reference the payer must quote. */
      reference: string;
      accountNumber?: string;
    }
  | { kind: "FAILED"; reason: string };

/** Normalised outcome of asking the gateway about a transaction. */
export interface VerificationResult {
  /**
   * `true` is the ONLY thing that may settle a payment. It means the gateway
   * confirmed this transaction, for this amount, in this currency.
   */
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

export interface RefundRequest {
  transactionId: string;
  /** Gateway-side id of the settled payment, where one exists. */
  validationId?: string | null;
  bankTransactionId?: string | null;
  amount: number;
  currency: string;
  reason: string;
}

export type RefundResult =
  | { ok: true; reference: string; /** True when a human completed it out of band. */ manual: boolean }
  | { ok: false; reason: string };

/** The identifying fields a webhook carries, once parsed. */
export interface WebhookEvent {
  transactionId: string;
  validationId: string | null;
  /** Everything the gateway posted, for the audit trail. */
  payload: Record<string, string>;
}

export interface PaymentGateway {
  readonly id: GatewayId;
  readonly displayName: string;
  readonly labelBn: string;
  readonly capabilities: GatewayCapabilities;

  /**
   * Whether the credentials this gateway needs are actually present.
   *
   * Resolved from Worker secrets at runtime, never read from the database, so
   * configuration can never disagree with reality.
   */
  isConfigured(): boolean;

  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  /**
   * Authoritative server-to-server confirmation.
   *
   * Must check that the gateway's transaction id, amount and currency match
   * what we recorded. A success redirect is never sufficient.
   */
  verifyPayment(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult>;

  /** Cheap first filter on a webhook. Never sufficient on its own. */
  verifyWebhookSignature(payload: Record<string, string>): boolean;

  /** Extracts the identifying fields from a webhook body. */
  parseWebhook(payload: Record<string, string>): WebhookEvent | null;

  refund(request: RefundRequest): Promise<RefundResult>;

  /** Current state of a transaction, for reconciliation. */
  getStatus(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult>;
}
