import type {
  PaymentProvider,
  PaymentSessionRequest,
  PaymentSessionResult,
  VerificationResult,
} from "./provider";
import { md5Hex } from "./md5";
import { timingSafeEqual } from "@/lib/ids";

const SANDBOX_BASE = "https://sandbox.sslcommerz.com";
const LIVE_BASE = "https://securepay.sslcommerz.com";

const SESSION_PATH = "/gwprocess/v4/api.php";
const VALIDATION_PATH = "/validator/api/validationserverAPI.php";

export interface SslcommerzConfig {
  storeId: string;
  storePassword: string;
  isSandbox: boolean;
}

interface SessionApiResponse {
  status?: string;
  failedreason?: string;
  sessionkey?: string;
  GatewayPageURL?: string;
}

interface ValidationApiResponse {
  status?: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  store_amount?: string;
  currency?: string;
  currency_type?: string;
  currency_amount?: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  error?: string;
}

export class SslcommerzProvider implements PaymentProvider {
  readonly name = "SSLCOMMERZ";

  constructor(private readonly config: SslcommerzConfig) {}

  private get base(): string {
    return this.config.isSandbox ? SANDBOX_BASE : LIVE_BASE;
  }

  async createSession(request: PaymentSessionRequest): Promise<PaymentSessionResult> {
    const body = new URLSearchParams({
      store_id: this.config.storeId,
      store_passwd: this.config.storePassword,
      total_amount: request.amount.toFixed(2),
      currency: request.currency,
      tran_id: request.transactionId,
      success_url: request.successUrl,
      fail_url: request.failUrl,
      cancel_url: request.cancelUrl,
      ipn_url: request.ipnUrl,
      // Digital delivery — no shipping leg.
      shipping_method: "NO",
      product_name: request.productName,
      product_category: request.productCategory,
      product_profile: "non-physical-goods",
      num_of_item: "1",
      cus_name: request.customer.name,
      cus_email: request.customer.email,
      cus_phone: request.customer.phone,
      cus_add1: request.customer.address,
      cus_city: request.customer.city,
      cus_country: request.customer.country,
    });

    // value_a..value_d are echoed back in the IPN, giving a second, independent
    // way to confirm which user and property a callback belongs to.
    const metaKeys = ["value_a", "value_b", "value_c", "value_d"] as const;
    Object.values(request.metadata ?? {}).forEach((value, index) => {
      if (index < metaKeys.length) body.set(metaKeys[index], value);
    });

    try {
      const response = await fetch(`${this.base}${SESSION_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!response.ok) {
        return { ok: false, failureReason: `gateway_http_${response.status}` };
      }

      const data = (await response.json()) as SessionApiResponse;
      if (data.status === "SUCCESS" && data.GatewayPageURL) {
        return { ok: true, redirectUrl: data.GatewayPageURL, sessionKey: data.sessionkey };
      }
      return { ok: false, failureReason: data.failedreason ?? data.status ?? "session_failed" };
    } catch (error) {
      console.error("[sslcommerz] createSession failed", error);
      return { ok: false, failureReason: "gateway_unreachable" };
    }
  }

  /**
   * Verifies the IPN's `verify_sign`.
   *
   * SSLCOMMERZ specifies: take the parameter names listed in `verify_key`,
   * collect their posted values, add `store_passwd = md5(store password)`, sort
   * by key, join as `k=v&k=v`, and MD5 the result.
   */
  verifySignature(payload: Record<string, string>): boolean {
    const verifySign = payload.verify_sign;
    const verifyKey = payload.verify_key;
    if (!verifySign || !verifyKey) return false;

    const fields: Record<string, string> = {};
    for (const key of verifyKey.split(",")) {
      const name = key.trim();
      if (name && payload[name] !== undefined) fields[name] = payload[name];
    }
    fields.store_passwd = md5Hex(this.config.storePassword);

    const hashString = Object.keys(fields)
      .sort()
      .map((key) => `${key}=${fields[key]}`)
      .join("&");

    return timingSafeEqual(md5Hex(hashString), verifySign.toLowerCase());
  }

  /**
   * Authoritative check against the Order Validation API.
   *
   * Returns `verified: true` only when the gateway reports VALID/VALIDATED AND
   * the transaction id, amount and currency all match what we recorded when the
   * payment was created. A tampered success redirect cannot produce this.
   */
  async verifyTransaction(params: {
    validationId: string;
    expectedTransactionId: string;
    expectedAmount: number;
    expectedCurrency: string;
  }): Promise<VerificationResult> {
    const url = new URL(`${this.base}${VALIDATION_PATH}`);
    url.searchParams.set("val_id", params.validationId);
    url.searchParams.set("store_id", this.config.storeId);
    url.searchParams.set("store_passwd", this.config.storePassword);
    url.searchParams.set("v", "1");
    url.searchParams.set("format", "json");

    let data: ValidationApiResponse;
    try {
      const response = await fetch(url.toString(), { method: "GET" });
      if (!response.ok) {
        return { verified: false, status: "UNKNOWN", failureReason: `validator_http_${response.status}` };
      }
      data = (await response.json()) as ValidationApiResponse;
    } catch (error) {
      console.error("[sslcommerz] verifyTransaction failed", error);
      return { verified: false, status: "UNKNOWN", failureReason: "validator_unreachable" };
    }

    const status = normaliseStatus(data.status);
    const gatewayAmount = Number.parseFloat(data.currency_amount ?? data.amount ?? "NaN");
    const gatewayCurrency = (data.currency_type ?? data.currency ?? "").toUpperCase();

    const result: VerificationResult = {
      verified: false,
      status,
      transactionId: data.tran_id,
      validationId: data.val_id,
      amount: Number.isFinite(gatewayAmount) ? gatewayAmount : undefined,
      currency: gatewayCurrency || undefined,
      bankTransactionId: data.bank_tran_id,
      cardType: data.card_type,
      riskLevel: data.risk_level,
      raw: data,
    };

    if (status !== "VALID" && status !== "VALIDATED") {
      result.failureReason = data.error ?? `gateway_status_${data.status ?? "unknown"}`;
      return result;
    }
    if (data.tran_id !== params.expectedTransactionId) {
      result.failureReason = "transaction_id_mismatch";
      return result;
    }
    if (gatewayCurrency !== params.expectedCurrency.toUpperCase()) {
      result.failureReason = "currency_mismatch";
      return result;
    }
    // Tolerance of <1 unit, matching the official SDKs — the gateway can return
    // the amount with rounding applied.
    if (!Number.isFinite(gatewayAmount) || Math.abs(gatewayAmount - params.expectedAmount) >= 1) {
      result.failureReason = "amount_mismatch";
      return result;
    }

    result.verified = true;
    return result;
  }
}

function normaliseStatus(raw: string | undefined): VerificationResult["status"] {
  switch ((raw ?? "").toUpperCase()) {
    case "VALID":
      return "VALID";
    case "VALIDATED":
      return "VALIDATED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "PENDING":
    case "UNATTEMPTED":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}
