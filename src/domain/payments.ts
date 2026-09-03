/**
 * Payment domain types.
 *
 * Mirrored by the `payment_types` and `payment_gateways` tables in
 * migration 0003. Adding a value means adding a migration.
 */

export const PAYMENT_TYPES = [
  "PROPERTY_CONTACT_UNLOCK",
  "FEATURED_PROPERTY",
  "PROPERTY_BOOST",
  "ADVERTISEMENT",
  "ADVERTISEMENT_RENEWAL",
  "SUBSCRIPTION",
] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABEL_BN: Record<PaymentType, string> = {
  PROPERTY_CONTACT_UNLOCK: "যোগাযোগের তথ্য আনলক",
  FEATURED_PROPERTY: "ফিচার্ড বিজ্ঞাপন",
  PROPERTY_BOOST: "বিজ্ঞাপন বুস্ট",
  ADVERTISEMENT: "বিজ্ঞাপন ক্যাম্পেইন",
  ADVERTISEMENT_RENEWAL: "ক্যাম্পেইন নবায়ন",
  SUBSCRIPTION: "সাবস্ক্রিপশন",
};

/** What the payment is about — decides which id column is populated. */
export const PAYMENT_TYPE_SUBJECT: Record<PaymentType, "PROPERTY" | "ADVERTISEMENT" | "ACCOUNT"> = {
  PROPERTY_CONTACT_UNLOCK: "PROPERTY",
  FEATURED_PROPERTY: "PROPERTY",
  PROPERTY_BOOST: "PROPERTY",
  ADVERTISEMENT: "ADVERTISEMENT",
  ADVERTISEMENT_RENEWAL: "ADVERTISEMENT",
  SUBSCRIPTION: "ACCOUNT",
};

export const GATEWAY_IDS = ["SSLCOMMERZ", "BKASH", "NAGAD", "ROCKET", "MANUAL"] as const;
export type GatewayId = (typeof GATEWAY_IDS)[number];

export function isGatewayId(value: string): value is GatewayId {
  return (GATEWAY_IDS as readonly string[]).includes(value);
}

export function isPaymentType(value: string): value is PaymentType {
  return (PAYMENT_TYPES as readonly string[]).includes(value);
}
