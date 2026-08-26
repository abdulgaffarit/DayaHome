import type {
  PaymentProvider,
  PaymentSessionRequest,
  PaymentSessionResult,
  VerificationResult,
} from "@/server/payments/provider";

/**
 * A scriptable payment provider.
 *
 * Records what the service asked the gateway for — which is how the tests
 * assert that the amount sent to the gateway comes from the server and not
 * from the request body.
 */
export class FakeProvider implements PaymentProvider {
  readonly name = "SSLCOMMERZ";
  readonly sessions: PaymentSessionRequest[] = [];
  readonly verifications: {
    validationId: string;
    expectedTransactionId: string;
    expectedAmount: number;
    expectedCurrency: string;
  }[] = [];

  constructor(
    private readonly config: {
      sessionOk?: boolean;
      /** Decides the outcome of each verifyTransaction call. */
      verify?: (args: {
        validationId: string;
        expectedTransactionId: string;
        expectedAmount: number;
        expectedCurrency: string;
      }) => VerificationResult;
      signatureValid?: boolean;
    } = {},
  ) {}

  async createSession(request: PaymentSessionRequest): Promise<PaymentSessionResult> {
    this.sessions.push(request);
    if (this.config.sessionOk === false) {
      return { ok: false, failureReason: "session_failed" };
    }
    return { ok: true, redirectUrl: `https://gateway.test/pay/${request.transactionId}` };
  }

  verifySignature(): boolean {
    return this.config.signatureValid ?? true;
  }

  async verifyTransaction(args: {
    validationId: string;
    expectedTransactionId: string;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    this.verifications.push(args);
    if (this.config.verify) return this.config.verify(args);
    return {
      verified: true,
      status: "VALID",
      transactionId: args.expectedTransactionId,
      validationId: args.validationId,
      amount: args.expectedAmount,
      currency: args.expectedCurrency,
    };
  }
}
