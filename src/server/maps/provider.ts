/**
 * Map provider abstraction.
 *
 * Only the *configuration* for a map lives on the server; nothing here ever
 * receives a property's real coordinates unless the caller has already been
 * authorized. The public detail page renders an approximate area marker, and
 * the exact pin is added client-side only after the contact API returns.
 */
export type MapProviderName = "maplibre" | "google";

export interface MapConfig {
  provider: MapProviderName;
  tileUrl: string;
  attribution: string;
  /** Fallback centre: Dayarampur, Bagatipara, Natore. */
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
}

const DAYARAMPUR_CENTER = { lat: 24.2069, lng: 89.0631 };

export function getMapConfig(env: {
  MAP_PROVIDER?: string;
  NEXT_PUBLIC_MAP_TILE_URL?: string;
  NEXT_PUBLIC_MAP_ATTRIBUTION?: string;
}): MapConfig {
  const provider: MapProviderName = env.MAP_PROVIDER === "google" ? "google" : "maplibre";
  return {
    provider,
    tileUrl: env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "© OpenStreetMap contributors",
    defaultCenter: DAYARAMPUR_CENTER,
    defaultZoom: 14,
  };
}

/**
 * Rounds coordinates to roughly a 1 km grid.
 *
 * Used nowhere on public pages today — the public page shows only the area
 * name — but kept here so that if an approximate map is ever added it uses a
 * deliberately coarsened value rather than the real pin.
 */
export function coarsenCoordinates(
  lat: number,
  lng: number,
): { lat: number; lng: number } {
  const round = (v: number) => Math.round(v * 100) / 100;
  return { lat: round(lat), lng: round(lng) };
}
