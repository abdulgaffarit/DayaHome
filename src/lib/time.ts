/** ISO-8601 UTC timestamp with second precision — the format stored in D1. */
export function nowIso(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoPlus(ms: number, from: Date = new Date()): string {
  return nowIso(new Date(from.getTime() + ms));
}

export function todayIsoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
