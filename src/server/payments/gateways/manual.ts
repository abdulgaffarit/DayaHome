/**
 * Manual payment adapter.
 *
 * A real, working gateway — not a placeholder. The payer sends money out of
 * band (personal bKash/Nagad number, bank transfer, cash at the office) and
 * quotes the transaction reference; an administrator then confirms it in
 * Admin → Payments.
 *
 * Because settlement is a human decision, `verifyPayment` NEVER returns
 * `verified: true` on its own. Only the admin confirmation path may settle a
 * manual payment, and it is recorded in `admin_logs` like any other staff
 * action. That keeps the invariant intact: nothing settles without an
 * authority outside the payer's control.
 */
import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentGateway,
  RefundRequest,
  RefundResult,
  VerificationResult,
  WebhookEvent,
} from "../gateway";

export interface ManualGatewaySettings {
  /** Bangla instructions shown to the payer. */
  instructions_bn?: string;
  /** The number or account the payer sends money to. Not a secret. */
  account_number?: string;
}

export class ManualGateway implements PaymentGateway {
  readonly id = "MANUAL" as const;
  readonly displayName = "Manual payment";
  readonly labelBn = "ম্যানুয়াল পেমেন্ট";
  readonly capabilities = {
    hostedCheckout: false,
    webhook: false,
    refund: false,
    statusCheck: false,
    manualSettlement: true,
  };

  constructor(private readonly settings: ManualGatewaySettings = {}) {}

  /**
   * Configured once an account number has been set in Admin → Payment
   * Gateways. Without it the payer would be told to send money nowhere.
   */
  isConfigured(): boolean {
    return Boolean(this.settings.account_number?.trim());
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      return {
        kind: "FAILED",
        reason: "manual_gateway_missing_account_number",
      };
    }
    return {
      kind: "INSTRUCTIONS",
      instructionsBn:
        this.settings.instructions_bn?.trim() ||
        "নিচের নম্বরে টাকা পাঠিয়ে ট্রানজেকশন আইডিসহ রেফারেন্স নম্বরটি জমা দিন।",
      reference: request.transactionId,
      accountNumber: this.settings.account_number,
    };
  }

  /**
   * Always unverified.
   *
   * There is no API to ask. Returning PENDING keeps the payment open for an
   * administrator to confirm, and guarantees no automated path can settle it.
   */
  async verifyPayment(): Promise<VerificationResult> {
    return {
      verified: false,
      status: "PENDING",
      failureReason: "manual_settlement_required",
    };
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhook(): WebhookEvent | null {
    return null;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return {
      ok: false,
      reason:
        "Manual payments are refunded out of band. Send the money back, then " +
        `record the reference against ${request.transactionId} in Admin → Payments.`,
    };
  }

  async getStatus(): Promise<VerificationResult> {
    return { verified: false, status: "PENDING", failureReason: "manual_settlement_required" };
  }
}
