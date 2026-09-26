/**
 * UddoktaPay adapter.
 *
 * A hosted-checkout gateway: we create an invoice, redirect the payer to the
 * `payment_url` it returns, and settle only after asking UddoktaPay directly
 * what happened. Reaching our return URL proves nothing — the browser can be
 * sent there by anyone — so `verifyPayment` is the single authority, exactly as
 * it is for SSLCOMMERZ.
 *
 * THREE THINGS MUST ALL HOLD before this adapter reports `verified: true`:
 *
 *   1. UddoktaPay says `status === "COMPLETED"`;
 *   2. the invoice amount equals the amount on OUR payment row;
 *   3. the metadata UddoktaPay echoes back names OUR transaction id.
 *
 * (3) is what stops a real, fully-paid invoice for a ৳50 unlock being replayed
 * against a different payment: the invoice id arrives from the browser, so it
 * selects which row to check but can never authorise one. The metadata is read
 * from the verification RESPONSE, never from the request that triggered it.
 *
 * The API key is a Worker secret. It is sent only in the server-to-server
 * `RT-UDDOKTAPAY-API-KEY` header and never reaches the browser.
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

export interface UddoktaPayConfig {
  apiKey?: string;
  /** Defaults to the production account; overridable for a sandbox. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://dayarampur.paymently.io/api";

/**
 * Every call is bounded. A gateway that stops responding must fail the request
 * rather than hold a Worker invocation open until the platform kills it — an
 * unbounded `fetch` there would leave the payment PENDING with no reply to the
 * payer at all.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Keys UddoktaPay echoes back untouched, used to tie an invoice to our row. */
interface UddoktaPayMetadata {
  transactionId?: string;
  paymentId?: string;
  userId?: string;
  propertyId?: string;
}

interface VerifyResponse {
  status?: string;
  amount?: string | number;
  charged_amount?: string | number;
  invoice_id?: string;
  transaction_id?: string;
  payment_method?: string;
  sender_number?: string;
  metadata?: UddoktaPayMetadata | string | null;
}

/** UddoktaPay returns money as a decimal string; our rows are whole taka. */
function parseAmount(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Tolerates metadata arriving as an object or as a JSON string. */
function readMetadata(value: VerifyResponse["metadata"]): UddoktaPayMetadata {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as UddoktaPayMetadata) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

/** Adds our transaction reference to a callback URL we supplied ourselves. */
function withTransaction(url: string, transactionId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}tran=${encodeURIComponent(transactionId)}`;
}

export class UddoktaPayGateway implements PaymentGateway {
  readonly id = "UDDOKTAPAY" as const;
  readonly displayName = "UddoktaPay";
  readonly labelBn = "উদ্যোক্তাপে";
  readonly capabilities = {
    hostedCheckout: true,
    webhook: true,
    refund: true,
    statusCheck: true,
    manualSettlement: false,
  };

  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(config: UddoktaPayConfig) {
    this.apiKey = config.apiKey?.trim() ? config.apiKey.trim() : null;
    this.baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  /** False until the Worker secret exists, so the registry never selects it. */
  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new Error(
        "UddoktaPay is not configured. Set UDDOKTAPAY_API_KEY as a Worker secret " +
          "(`wrangler secret put UDDOKTAPAY_API_KEY`).",
      );
    }
    return this.apiKey;
  }

  private async post(path: string, body: unknown): Promise<{ ok: boolean; data: unknown; status: number }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "RT-UDDOKTAPAY-API-KEY": this.requireKey(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data: unknown = await response.json().catch(() => null);
    return { ok: response.ok, data, status: response.status };
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      return { kind: "FAILED", reason: "uddoktapay_not_configured" };
    }

    // Our own transaction id travels in the metadata and comes back on the
    // verification response, which is how the invoice is tied to our row.
    const metadata = {
      ...(request.metadata ?? {}),
      transactionId: request.transactionId,
    };

    let result: { ok: boolean; data: unknown; status: number };
    try {
      result = await this.post("/checkout-v2", {
        full_name: request.customer.name,
        email: request.customer.email,
        amount: String(request.amount),
        metadata,
        // Our own reference rides on the return URL so the browser's return leg
        // knows which payment to ask about. It is not evidence of anything —
        // the invoice is still verified server-side before anything settles.
        redirect_url: withTransaction(request.successUrl, request.transactionId),
        return_type: "GET",
        cancel_url: withTransaction(request.cancelUrl, request.transactionId),
        webhook_url: request.webhookUrl,
      });
    } catch (error) {
      // Timeout or network failure. No invoice exists, so the caller retires
      // the payment row rather than leaving the payer on a dead page.
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "uddoktapay_timeout"
          : "uddoktapay_unreachable";
      console.error(`[uddoktapay] checkout failed: ${reason}`);
      return { kind: "FAILED", reason };
    }

    const data = (result.data ?? {}) as { payment_url?: string; message?: string };
    if (!result.ok || !data.payment_url) {
      // `message` is the gateway's own text; log it but never surface it, since
      // it is not Bangla and may quote request detail.
      console.error(`[uddoktapay] checkout rejected (HTTP ${result.status}): ${data.message ?? "no payment_url"}`);
      return { kind: "FAILED", reason: "uddoktapay_checkout_rejected" };
    }

    return { kind: "REDIRECT", redirectUrl: data.payment_url };
  }

  /**
   * Server-to-server confirmation. `validationId` is the UddoktaPay invoice id.
   */
  async verifyPayment(params: {
    transactionId: string;
    validationId: string | null;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    if (!this.isConfigured()) {
      return { verified: false, status: "UNKNOWN", failureReason: "uddoktapay_not_configured" };
    }
    if (!params.validationId) {
      return { verified: false, status: "UNKNOWN", failureReason: "missing_invoice_id" };
    }
    // UddoktaPay settles in BDT only; anything else cannot have been paid here.
    if (params.expectedCurrency !== "BDT") {
      return { verified: false, status: "FAILED", failureReason: "currency_mismatch" };
    }

    let result: { ok: boolean; data: unknown; status: number };
    try {
      result = await this.post("/verify-payment", { invoice_id: params.validationId });
    } catch (error) {
      // Unreachable is NOT failure: the invoice may well be paid. Reporting
      // UNKNOWN leaves our payment PENDING so the webhook, or a later status
      // check, can still settle it.
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "uddoktapay_timeout"
          : "uddoktapay_unreachable";
      console.error(`[uddoktapay] verify failed: ${reason}`);
      return { verified: false, status: "UNKNOWN", failureReason: reason };
    }

    if (!result.ok || !result.data || typeof result.data !== "object") {
      return {
        verified: false,
        status: "UNKNOWN",
        failureReason: `verify_http_${result.status}`,
        raw: result.data,
      };
    }

    const body = result.data as VerifyResponse;
    const status = String(body.status ?? "").toUpperCase();
    const metadata = readMetadata(body.metadata);
    const amount = parseAmount(body.amount);

    const base: VerificationResult = {
      verified: false,
      status: "UNKNOWN",
      transactionId: metadata.transactionId,
      validationId: body.invoice_id ?? params.validationId,
      amount: amount ?? undefined,
      currency: "BDT",
      bankTransactionId: body.transaction_id ?? undefined,
      cardType: body.payment_method ?? undefined,
      raw: body,
    };

    if (status === "PENDING") {
      return { ...base, status: "PENDING", failureReason: "uddoktapay_pending" };
    }
    if (status !== "COMPLETED") {
      // ERROR, and anything unrecognised, are both "not paid".
      return {
        ...base,
        status: status === "ERROR" ? "FAILED" : "UNKNOWN",
        failureReason: status ? `uddoktapay_${status.toLowerCase()}` : "uddoktapay_no_status",
      };
    }

    // COMPLETED — now the two correlation checks, either of which is fatal.
    if (metadata.transactionId !== params.transactionId) {
      // A genuine, fully-paid invoice that belongs to a DIFFERENT payment.
      console.error(
        `[uddoktapay] invoice ${params.validationId} names a different transaction — refusing`,
      );
      return { ...base, status: "FAILED", failureReason: "transaction_mismatch" };
    }

    if (amount === null || Math.abs(amount - params.expectedAmount) >= 0.01) {
      console.error(
        `[uddoktapay] invoice ${params.validationId} amount ${amount} != expected ${params.expectedAmount}`,
      );
      return { ...base, status: "FAILED", failureReason: "amount_mismatch" };
    }

    return { ...base, verified: true, status: "VALID" };
  }

  /**
   * Always false — and deliberately so.
   *
   * UddoktaPay authenticates its webhook with the same API key in a request
   * HEADER, which this body-only hook cannot see. Rather than pretend to have
   * checked something, it declines: `settlePayment` treats the signature as a
   * hint and settles on `verifyPayment` alone, so nothing depends on this.
   */
  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhook(payload: Record<string, string>): WebhookEvent | null {
    // The generic webhook route flattens the posted JSON, so nested metadata
    // arrives as a JSON string.
    const metadata = readMetadata(payload.metadata);
    const transactionId = metadata.transactionId;
    if (!transactionId) return null;
    return { transactionId, validationId: payload.invoice_id ?? null, payload };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    if (!this.isConfigured()) {
      return { ok: false, reason: "uddoktapay_not_configured" };
    }
    if (!request.validationId) {
      return { ok: false, reason: "refund needs the UddoktaPay invoice id" };
    }

    let result: { ok: boolean; data: unknown; status: number };
    try {
      result = await this.post("/refund-payment", {
        invoice_id: request.validationId,
        amount: String(request.amount),
        reason: request.reason.slice(0, 200),
      });
    } catch {
      return { ok: false, reason: "uddoktapay_unreachable" };
    }

    const data = (result.data ?? {}) as { status?: string | boolean; message?: string };
    const ok = result.ok && (data.status === true || String(data.status).toUpperCase() === "SUCCESS");
    if (!ok) {
      return { ok: false, reason: data.message ?? `refund_http_${result.status}` };
    }
    return { ok: true, reference: request.validationId, manual: false };
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
