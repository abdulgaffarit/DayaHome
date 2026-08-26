/**
 * Slugs are the public URL of a listing and must be stable, readable and
 * unique. Bangla titles are transliterated so the URL stays ASCII, which keeps
 * it copy-pasteable and avoids percent-encoded links in shares and sitemaps.
 */

const BN_TRANSLITERATION: Record<string, string> = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "ঋ": "ri", "এ": "e", "ঐ": "oi",
  "ও": "o", "ঔ": "ou",
  "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
  "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "n",
  "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
  "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
  "প": "p", "ফ": "ph", "ব": "b", "ভ": "bh", "ম": "m",
  "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh", "স": "s", "হ": "h",
  "ড়": "r", "ঢ়": "rh", "য়": "y", "ৎ": "t", "ং": "ng", "ঃ": "h", "ঁ": "n",
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
  "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou", "্": "",
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/**
 * Built from the map's keys, longest first, so multi-code-point graphemes such
 * as ড় (ড + nukta) win over their base consonant.
 */
const BN_PATTERN = new RegExp(
  Object.keys(BN_TRANSLITERATION)
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);

export function transliterateBangla(input: string): string {
  return input.normalize("NFC").replace(BN_PATTERN, (m) => BN_TRANSLITERATION[m] ?? m);
}

export function slugify(input: string): string {
  return transliterateBangla(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * Listing slug: `<title-slug>-<publicId>`. The numeric suffix guarantees
 * uniqueness without a retry loop and gives users a shareable id in the URL.
 */
export function buildPropertySlug(title: string, publicId: string | number): string {
  const base = slugify(title) || "property";
  return `${base}-${String(publicId).toLowerCase()}`;
}

/** Recovers the trailing public id from a slug, for lookups. */
export function publicIdFromSlug(slug: string): string | null {
  const m = /-([a-z0-9]+)$/.exec(slug);
  return m ? m[1] : null;
}
