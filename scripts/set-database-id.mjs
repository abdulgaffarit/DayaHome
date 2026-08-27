/**
 * Writes a real D1 `database_id` into wrangler.jsonc.
 *
 * Usage: node scripts/set-database-id.mjs <database_name> <uuid>
 *
 * wrangler.jsonc is JSON *with comments*, so it is edited as text rather than
 * parsed and re-serialised — round-tripping through JSON.parse would strip
 * every comment in the file. The edit is scoped to the `database_id` line that
 * follows the matching `database_name`, so the three environments cannot be
 * confused with one another.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [databaseName, databaseId] = process.argv.slice(2);

if (!databaseName || !databaseId) {
  console.error("usage: node scripts/set-database-id.mjs <database_name> <uuid>");
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(databaseId)) {
  console.error(`Not a database id: ${databaseId}`);
  process.exit(1);
}

const path = "wrangler.jsonc";
const source = readFileSync(path, "utf8");

const anchor = `"database_name": "${databaseName}"`;
const anchorIndex = source.indexOf(anchor);
if (anchorIndex === -1) {
  console.error(`No database_name "${databaseName}" in ${path}`);
  process.exit(1);
}

// Replace only the first database_id occurring after this database_name.
const tail = source.slice(anchorIndex);
const replacedTail = tail.replace(
  /"database_id":\s*"[^"]*"/,
  `"database_id": "${databaseId}"`,
);
if (replacedTail === tail) {
  console.error(`No database_id found after "${databaseName}"`);
  process.exit(1);
}

writeFileSync(path, source.slice(0, anchorIndex) + replacedTail);
console.log(`${databaseName} → ${databaseId}`);
