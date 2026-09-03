/**
 * Adapters for gateways that have no integration yet: bKash, Nagad, Rocket.
 *
 * These are deliberately NOT implementations. Each Bangladeshi mobile-money
 * gateway has its own tokenised-checkout API, its own credential set and its
 * own callback contract, and none of those credentials exist for this project
 * yet. Writing speculative request/response code against an unseen API would
 * produce something that looks finished, passes review, and fails the first
 * time real money touches it.
 *
 * So each one:
 *   - reports `isConfigured() === false`, so it can never be selected;
 *   - throws `GatewayNotConfiguredError` from every operation;
 *   - documents exactly what is needed to make it real.
 *
 * When credentials arrive, replace the class with a real adapter implementing
 * the same `PaymentGateway` interface. Nothing outside this folder changes.
 */
import type { GatewayId } from "@/domain/payments";
import {
  GatewayNotConfiguredError,
  type CreatePaymentResult,
  type GatewayCapabilities,
  type PaymentGateway,
  type RefundResult,
  type VerificationResult,
  type WebhookEvent,
} from "../gateway";

/**
 * What each gateway will need before it can be implemented. Surfaced in the
 * admin UI so an operator knows precisely what to obtain.
 */
export interface PendingIntegration {
  id: GatewayId;
  displayName: string;
  labelBn: string;
  /** Worker secrets the real adapter will read. */
  requiredSecrets: string[];
  /** What the operator must obtain from the provider. */
  prerequisite: string;
  capabilities: GatewayCapabilities;
}

export const PENDING_INTEGRATIONS: readonly PendingIntegration[] = [
  {
    id: "BKASH",
    displayName: "bKash",
    labelBn: "বিকাশ",
    requiredSecrets: ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"],
    prerequisite:
      "A bKash Merchant (PGW) account with Checkout API credentials, plus the sandbox " +
      "and production base URLs from bKash.",
    capabilities: {
      hostedCheckout: true,
      webhook: true,
      refund: true,
      statusCheck: true,
      manualSettlement: false,
    },
  },
  {
    id: "NAGAD",
    displayName: "Nagad",
    labelBn: "নগদ",
    requiredSecrets: ["NAGAD_MERCHANT_ID", "NAGAD_PUBLIC_KEY", "NAGAD_PRIVATE_KEY"],
    prerequisite:
      "A Nagad merchant account and the RSA key pair Nagad issues for request signing.",
    capabilities: {
      hostedCheckout: true,
      webhook: true,
      refund: true,
      statusCheck: true,
      manualSettlement: false,
    },
  },
  {
    id: "ROCKET",
    displayName: "Rocket",
    labelBn: "রকেট",
    requiredSecrets: ["ROCKET_MERCHANT_ID", "ROCKET_API_KEY"],
    prerequisite:
      "A Dutch-Bangla Bank Rocket merchant account. Rocket is commonly reached through an " +
      "aggregator (SSLCOMMERZ already routes Rocket), so check whether a direct integration " +
      "is needed at all before building one.",
    capabilities: {
      hostedCheckout: true,
      webhook: true,
      refund: false,
      statusCheck: true,
      manualSettlement: false,
    },
  },
];

/**
 * A gateway that exists in the interface but has no integration.
 *
 * Every operation throws. Nothing here can be mistaken for a working payment
 * path, and the registry refuses to select it because `isConfigured()` is false.
 */
export class UnconfiguredGateway implements PaymentGateway {
  readonly id: GatewayId;
  readonly displayName: string;
  readonly labelBn: string;
  readonly capabilities: GatewayCapabilities;

  constructor(private readonly integration: PendingIntegration) {
    this.id = integration.id;
    this.displayName = integration.displayName;
    this.labelBn = integration.labelBn;
    // The capabilities it *will* have, so the admin UI can show what is coming.
    this.capabilities = integration.capabilities;
  }

  /** Never true: there is no adapter behind this, only an interface. */
  isConfigured(): boolean {
    return false;
  }

  get requiredSecrets(): string[] {
    return this.integration.requiredSecrets;
  }

  get prerequisite(): string {
    return this.integration.prerequisite;
  }

  async createPayment(): Promise<CreatePaymentResult> {
    throw new GatewayNotConfiguredError(this.id);
  }

  async verifyPayment(): Promise<VerificationResult> {
    throw new GatewayNotConfiguredError(this.id);
  }

  verifyWebhookSignature(): boolean {
    return false;
  }

  parseWebhook(): WebhookEvent | null {
    return null;
  }

  async refund(): Promise<RefundResult> {
    throw new GatewayNotConfiguredError(this.id);
  }

  async getStatus(): Promise<VerificationResult> {
    throw new GatewayNotConfiguredError(this.id);
  }
}
