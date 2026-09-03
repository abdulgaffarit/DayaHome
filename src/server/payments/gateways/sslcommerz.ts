/**
 * SSLCOMMERZ adapter.
 *
 * Wraps the existing, working SSLCOMMERZ client in the generic PaymentGateway
 * contract. The verification logic is unchanged: a payment settles only when
 * the Order Validation API confirms the transaction id, amount and currency.
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
import { SslcommerzProvider, type SslcommerzConfig } from "../sslcommerz";

export class SslcommerzGateway implements PaymentGateway {
  readonly id = "SSLCOMMERZ" as const;
  readonly displayName = "SSLCOMMERZ";
  readonly labelBn = "এসএসএলকমার্জ";
  readonly capabilities = {
    hostedCheckout: true,
    webhook: true,
    // SSLCOMMERZ refunds require a separate merchant agreement and are issued
    // from their panel, so this adapter records rather than executes them.
    refund: false,
    statusCheck: true,
    manualSettlement: false,
  };

  private readonly client: SslcommerzProvider | null;

  constructor(private readonly config: Partial<SslcommerzConfig>) {
    this.client =
      config.storeId && config.storePassword
        ? new SslcommerzProvider({
            storeId: config.storeId,
            storePassword: config.storePassword,
            isSandbox: config.isSandbox ?? true,
          })
        : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private require(): SslcommerzProvider {
    if (!this.client) {
      throw new Error(
        "SSLCOMMERZ is not configured. Set SSLCOMMERZ_STORE_ID and " +
          "SSLCOMMERZ_STORE_PASSWORD as Worker secrets.",
      );
    }
    return this.client;
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    const session = await this.require().createSession({
      transactionId: request.transactionId,
      amount: request.amount,
      currency: request.currency,
      productName: request.description.slice(0, 100),
      productCategory: request.paymentType.toLowerCase(),
      customer: request.customer,
      successUrl: request.successUrl,
      failUrl: request.failUrl,
      cancelUrl: request.cancelUrl,
      ipnUrl: request.webhookUrl,
      metadata: request.metadata,
    });

    if (!session.ok || !session.redirectUrl) {
      return { kind: "FAILED", reason: session.failureReason ?? "session_failed" };
    }
    return { kind: "REDIRECT", redirectUrl: session.redirectUrl, sessionKey: session.sessionKey };
  }

  async verifyPayment(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    if (!params.validationId) {
      return { verified: false, status: "UNKNOWN", failureReason: "missing_validation_id" };
    }
    return this.require().verifyTransaction({
      validationId: params.validationId,
      expectedTransactionId: params.transactionId,
      expectedAmount: params.expectedAmount,
      expectedCurrency: params.expectedCurrency,
    });
  }

  verifyWebhookSignature(payload: Record<string, string>): boolean {
    return this.client ? this.client.verifySignature(payload) : false;
  }

  parseWebhook(payload: Record<string, string>): WebhookEvent | null {
    const transactionId = payload.tran_id;
    if (!transactionId) return null;
    return { transactionId, validationId: payload.val_id ?? null, payload };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    // Deliberately not implemented rather than faked: SSLCOMMERZ refunds go
    // through their merchant panel. `recordRefund` in the admin service marks
    // our ledger once an operator has completed it there.
    return {
      ok: false,
      reason:
        "SSLCOMMERZ refunds are issued from the merchant panel. " +
        `Complete it there for ${request.transactionId}, then record the reference in Admin → Payments.`,
    };
  }

  async getStatus(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    return this.verifyPayment(params);
  }
}
