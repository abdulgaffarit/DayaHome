/**
 * Bangla number/date formatting.
 *
 * The whole UI is Bangla-first, so every numeral the user reads goes through
 * here. Values sent to the server stay in ASCII digits.
 */

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

export function fromBanglaDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Group digits the South Asian way: 12,34,567 rather than 1,234,567. */
export function groupIndian(value: number): string {
  const n = Math.trunc(Math.abs(value));
  const s = String(n);
  if (s.length <= 3) return (value < 0 ? "-" : "") + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return (value < 0 ? "-" : "") + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

/**
 * Human-friendly Bangla money: ৳১২,৫০০ / ৳১২ লাখ / ৳১.৫ কোটি.
 * Large sale prices become unreadable otherwise.
 */
export function formatTaka(value: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "৳—";
  if (opts.compact) {
    if (value >= 10_000_000) {
      const v = value / 10_000_000;
      return `৳${toBanglaDigits(trimDecimal(v))} কোটি`;
    }
    if (value >= 100_000) {
      const v = value / 100_000;
      return `৳${toBanglaDigits(trimDecimal(v))} লাখ`;
    }
    if (value >= 1_000) {
      const v = value / 1_000;
      return `৳${toBanglaDigits(trimDecimal(v))} হাজার`;
    }
  }
  return `৳${toBanglaDigits(groupIndian(value))}`;
}

function trimDecimal(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** Absolute date: "১২ মার্চ ২০২৬". */
export function formatBanglaDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${toBanglaDigits(d.getUTCDate())} ${BN_MONTHS[d.getUTCMonth()]} ${toBanglaDigits(d.getUTCFullYear())}`;
}

/** Relative date for "posted" labels: "আজ", "৩ দিন আগে". */
export function formatRelativeBanglaDate(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "আজ";
  if (days === 1) return "গতকাল";
  if (days < 30) return `${toBanglaDigits(days)} দিন আগে`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${toBanglaDigits(months)} মাস আগে`;
  return formatBanglaDate(iso);
}

/** "৳১২,০০০ / মাস" — the period suffix used on cards and the detail page. */
export const PRICE_PERIOD_LABEL_BN: Record<string, string> = {
  MONTHLY: "মাস",
  YEARLY: "বছর",
  TOTAL: "",
  PER_KATHA: "কাঠা",
  PER_DECIMAL: "শতক",
};

export function formatPrice(
  price: number,
  period: string,
  opts: { compact?: boolean } = {},
): string {
  const amount = formatTaka(price, opts);
  const suffix = PRICE_PERIOD_LABEL_BN[period] ?? "";
  return suffix ? `${amount}/${suffix}` : amount;
}
