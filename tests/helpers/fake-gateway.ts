import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentGateway,
  RefundResult,
  VerificationResult,
  WebhookEvent,
} from "@/server/payments/gateway";

/**
 * A scriptable gateway.
 *
 * Records what the service asked for, which is how the tests assert that the
 * amount sent to the gateway comes from the server and not from the request.
 */
export class FakeGateway implements PaymentGateway {
  readonly id = "SSLCOMMERZ" as const;
  readonly displayName = "Fake";
  readonly labelBn = "পরীক্ষামূলক";
  readonly capabilities = {
    hostedCheckout: true,
    webhook: true,
    refund: true,
    statusCheck: true,
    manualSettlement: false,
  };

  readonly created: CreatePaymentRequest[] = [];
  readonly verifications: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }[] = [];

  constructor(
    private readonly config: {
      configured?: boolean;
      createOk?: boolean;
      /** Manual-style gateway: returns instructions instead of a redirect. */
      instructions?: boolean;
      verify?: (args: {
        transactionId: string;
        validationId: string | null;
        expectedAmount: number;
        expectedCurrency: string;
      }) => VerificationResult;
      signatureValid?: boolean;
    } = {},
  ) {}

  isConfigured(): boolean {
    return this.config.configured ?? true;
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    this.created.push(request);
    if (this.config.createOk === false) {
      return { kind: "FAILED", reason: "session_failed" };
    }
    if (this.config.instructions) {
      return {
        kind: "INSTRUCTIONS",
        instructionsBn: "টাকা পাঠান",
        reference: request.transactionId,
        accountNumber: "01700000000",
      };
    }
    return { kind: "REDIRECT", redirectUrl: `https://gateway.test/pay/${request.transactionId}` };
  }

  async verifyPayment(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    this.verifications.push(params);
    if (this.config.verify) return this.config.verify(params);
    return {
      verified: true,
      status: "VALID",
      transactionId: params.transactionId,
      validationId: params.validationId ?? undefined,
      amount: params.expectedAmount,
      currency: params.expectedCurrency,
    };
  }

  verifyWebhookSignature(): boolean {
    return this.config.signatureValid ?? true;
  }

  parseWebhook(payload: Record<string, string>): WebhookEvent | null {
    if (!payload.tran_id) return null;
    return { transactionId: payload.tran_id, validationId: payload.val_id ?? null, payload };
  }

  async refund(): Promise<RefundResult> {
    return { ok: true, reference: "refund-ref", manual: false };
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
