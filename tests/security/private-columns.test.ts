/**
 * A static guard on the privacy boundary.
 *
 * The public query module and the public components must never mention a
 * private column or a private field name. This test greps the actual source, so
 * a future change that adds `contact_phone` to a public SELECT fails CI even if
 * every behavioural test still passes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_COLUMNS } from "@/server/properties/columns";

const ROOT = process.cwd();
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");

/**
 * Strips comments before grepping.
 *
 * The modules under test document the privacy rule in prose — naming the very
 * columns they must not select — so a naive substring search would flag its own
 * warning label. Only executable code is checked.
 */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Files that render or serialise data for anonymous visitors. If one of these
 * ever needs a private value, that is a design change requiring a new,
 * explicitly authorized code path — not an edit to this list.
 */
const PUBLIC_SOURCES = [
  "src/server/properties/queries.ts",
  "src/lib/seo.ts",
  "src/components/property/property-card.tsx",
  "src/components/property/listing-page.tsx",
  "src/app/property/[slug]/page.tsx",
  "src/app/page.tsx",
  "src/app/sitemap.ts",
];

describe("privacy boundary", () => {
  it.each(PUBLIC_SOURCES)("%s does not reference a private column", (file) => {
    const source = code(file);
    for (const column of PRIVATE_COLUMNS) {
      expect(source, `${file} must not reference the private column "${column}"`).not.toContain(
        column,
      );
    }
  });

  it("the public property type has no private field", () => {
    const source = code("src/domain/property.ts");
    const publicInterface = source.slice(
      source.indexOf("export interface PublicProperty"),
      source.indexOf("export interface PropertyImage"),
    );

    for (const field of ["phone", "exactAddress", "latitude", "longitude"]) {
      expect(publicInterface, `PublicProperty must not declare "${field}"`).not.toMatch(
        new RegExp(`^\\s+${field}[?:]`, "m"),
      );
    }
  });

  it("only the authorized resolver and staff/owner views read private columns", () => {
    // Every server module that touches a private column, with the reason it is
    // allowed to. Adding a file here should be a deliberate, reviewed act.
    const ALLOWED = [
      "src/server/properties/contact.ts", // the authorization chain itself
      "src/server/properties/owner.ts", // the owner's own listing
      "src/server/properties/mutations.ts", // writing them at creation time
      "src/server/properties/columns.ts", // the list of names
    ];

    for (const file of PUBLIC_SOURCES) {
      expect(ALLOWED).not.toContain(file);
    }
  });

  it("JSON-LD output omits telephone and street address", () => {
    const source = code("src/lib/seo.ts");
    expect(source).not.toMatch(/telephone\s*:/);
    expect(source).not.toMatch(/streetAddress\s*:/);
  });
});
