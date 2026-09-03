/**
 * Resolves a deployable Wrangler configuration for one environment.
 *
 * WHY THIS EXISTS
 * ---------------
 * `vinext build` writes `dist/server/wrangler.json` plus a Wrangler
 * "redirected configuration" pointer at `.wrangler/deploy/config.json`. When
 * that pointer exists, Wrangler ignores `wrangler.jsonc` entirely and uses the
 * generated file — and vinext flattens the top-level (development) environment
 * into it, dropping the `env` block completely.
 *
 * The consequence is silent and dangerous: `wrangler deploy --env production`
 * finds no environments in the config it is actually using, so `--env` matches
 * nothing and it falls back to the development bindings — the dev D1 database,
 * the dev R2 bucket, APP_ENV=development and NEXT_PUBLIC_SITE_URL=localhost.
 * The deploy succeeds and looks fine.
 *
 * So we stop passing `--env` at deploy time. Instead this script merges the
 * chosen environment from `wrangler.jsonc` (the source of truth) into the
 * generated config, and then refuses to continue unless the result really is
 * that environment. Deployment then targets a config that can only be the
 * intended environment, because there is nothing left for `--env` to select.
 *
 * Usage:
 *   node scripts/prepare-deploy-config.mjs <staging|production>
 *   node scripts/prepare-deploy-config.mjs <staging|production> --verify
 *
 * `--verify` re-checks an already-prepared config without rewriting it, so the
 * same assertions can run as a final gate immediately before deploying.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SOURCE_CONFIG = "wrangler.jsonc";
const GENERATED_CONFIG = "dist/server/wrangler.json";
const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

/** Keys that define "which environment is this" and must come from the env block. */
const ENVIRONMENT_KEYS = [
  "name",
  "vars",
  "d1_databases",
  "r2_buckets",
  "kv_namespaces",
  "queues",
  "routes",
  "route",
  "workers_dev",
  "preview_urls",
];

/* -------------------------------------------------------------------------- */
/* JSONC                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Strips comments from JSONC.
 *
 * String-aware, so a `//` inside a value such as "https://dayarampur.com" is
 * left alone — a naive regex would corrupt every URL in the file.
 */
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += char;
  }

  // Trailing commas are legal in JSONC but not in JSON.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function readJsonc(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const problems = [];
const fail = (message) => problems.push(message);

/**
 * Asserts the resolved config really is `environment`.
 *
 * Expectations are derived from `wrangler.jsonc` rather than hardcoded, so this
 * keeps working when a name changes — while the development comparison below
 * is what actually catches the silent-fallback bug.
 */
function validate(resolved, source, environment) {
  const expected = source.env?.[environment];
  if (!expected) {
    fail(`wrangler.jsonc has no env.${environment} block`);
    return;
  }

  // ---- 1. It must not be the development environment ----------------------
  // This is the specific failure mode that prompted this script.
  const devDb = source.d1_databases?.[0]?.database_name;
  const devBucket = source.r2_buckets?.[0]?.bucket_name;
  const resolvedDb = resolved.d1_databases?.[0]?.database_name;
  const resolvedBucket = resolved.r2_buckets?.[0]?.bucket_name;

  if (resolvedDb === devDb) {
    fail(`D1 binding is the DEVELOPMENT database "${devDb}" — expected the ${environment} one`);
  }
  if (resolvedBucket === devBucket) {
    fail(`R2 binding is the DEVELOPMENT bucket "${devBucket}" — expected the ${environment} one`);
  }
  if (resolved.vars?.APP_ENV === "development") {
    fail(`APP_ENV is "development" — expected "${environment}"`);
  }

  // ---- 2. It must match what wrangler.jsonc declares for this environment --
  if (resolved.name !== expected.name) {
    fail(`Worker name is "${resolved.name}" — expected "${expected.name}"`);
  }
  if (resolvedDb !== expected.d1_databases?.[0]?.database_name) {
    fail(
      `D1 database is "${resolvedDb}" — expected "${expected.d1_databases?.[0]?.database_name}"`,
    );
  }
  if (resolvedBucket !== expected.r2_buckets?.[0]?.bucket_name) {
    fail(`R2 bucket is "${resolvedBucket}" — expected "${expected.r2_buckets?.[0]?.bucket_name}"`);
  }
  if (resolved.vars?.APP_ENV !== environment) {
    fail(`APP_ENV is "${resolved.vars?.APP_ENV}" — expected "${environment}"`);
  }

  // ---- 3. Bindings the application cannot start without -------------------
  const dbBinding = resolved.d1_databases?.find((d) => d.binding === "DB");
  if (!dbBinding) fail("Missing D1 binding `DB` — every page read needs it");
  if (!resolved.r2_buckets?.some((b) => b.binding === "PROPERTY_IMAGES")) {
    fail("Missing R2 binding `PROPERTY_IMAGES` — image upload and serving need it");
  }
  if (!resolved.assets?.binding) fail("Missing `assets` binding — static files would 404");

  // A placeholder id deploys a Worker bound to a database that does not exist.
  if (dbBinding && (!dbBinding.database_id || dbBinding.database_id === PLACEHOLDER_DATABASE_ID)) {
    fail(
      `D1 database_id for "${dbBinding.database_name}" is still the placeholder. ` +
        `Create the database and record its id:\n` +
        `      npx wrangler d1 create ${dbBinding.database_name}\n` +
        `      node scripts/set-database-id.mjs ${dbBinding.database_name} <uuid>`,
    );
  }

  // ---- 4. Values that would silently break the live site -------------------
  const siteUrl = resolved.vars?.NEXT_PUBLIC_SITE_URL ?? "";
  if (!siteUrl.startsWith("https://")) {
    fail(
      `NEXT_PUBLIC_SITE_URL is "${siteUrl}" — it must be the real https origin. ` +
        `It drives canonical URLs, the sitemap, robots.txt and the payment callback URLs.`,
    );
  }
  if (!resolved.vars?.CONTACT_UNLOCK_PRICE_BDT) {
    fail("CONTACT_UNLOCK_PRICE_BDT is unset — the unlock price must come from configuration");
  }

  if (environment === "production") {
    if (resolved.vars?.SSLCOMMERZ_IS_SANDBOX !== "false") {
      fail(
        `SSLCOMMERZ_IS_SANDBOX is "${resolved.vars?.SSLCOMMERZ_IS_SANDBOX}" in production — ` +
          `real payments would go to the sandbox gateway`,
      );
    }
    const patterns = (resolved.routes ?? []).map((r) => r.pattern);
    if (!patterns.includes("dayarampur.com")) {
      fail("Production is missing the dayarampur.com custom-domain route");
    }
  }

  // ---- 5. Nothing may remain for --env to select --------------------------
  if (resolved.env) {
    fail("Resolved config still contains an `env` block — it must be flattened");
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

const environment = process.argv[2];
const verifyOnly = process.argv.includes("--verify");

if (environment !== "staging" && environment !== "production") {
  console.error("usage: node scripts/prepare-deploy-config.mjs <staging|production> [--verify]");
  process.exit(1);
}
if (!existsSync(GENERATED_CONFIG)) {
  console.error(`${GENERATED_CONFIG} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const source = readJsonc(SOURCE_CONFIG);
const generated = JSON.parse(readFileSync(GENERATED_CONFIG, "utf8"));

let resolved;
if (verifyOnly) {
  resolved = generated;
} else {
  const envBlock = source.env?.[environment];
  if (!envBlock) {
    console.error(`wrangler.jsonc has no env.${environment} block.`);
    process.exit(1);
  }

  // Start from the generated config — it carries the build output details
  // (main, assets directory, module rules) that only the build knows — then
  // overwrite every environment-defining key from the source env block.
  resolved = { ...generated };
  for (const key of ENVIRONMENT_KEYS) {
    if (key in envBlock) resolved[key] = envBlock[key];
    else delete resolved[key];
  }

  // Leaving these behind would let a later `--env` silently re-resolve.
  delete resolved.env;
  delete resolved.definedEnvironments;

  // A marker so the file itself says which environment it is.
  resolved.__preparedFor = environment;
}

validate(resolved, source, environment);

if (problems.length > 0) {
  console.error(`\n  Deploy configuration for "${environment}" is NOT safe to use:\n`);
  for (const problem of problems) console.error(`   ✗ ${problem}`);
  console.error("\n  Refusing to continue. Nothing was deployed.\n");
  process.exit(1);
}

if (!verifyOnly) {
  writeFileSync(GENERATED_CONFIG, `${JSON.stringify(resolved, null, 2)}\n`);
}

const dbEntry = resolved.d1_databases[0];
console.log(`
  Deploy configuration resolved for: ${environment.toUpperCase()}

    worker name   ${resolved.name}
    D1 database   ${dbEntry.database_name}  (${dbEntry.database_id})
    R2 bucket     ${resolved.r2_buckets[0].bucket_name}
    APP_ENV       ${resolved.vars.APP_ENV}
    site URL      ${resolved.vars.NEXT_PUBLIC_SITE_URL}
    sandbox pay   ${resolved.vars.SSLCOMMERZ_IS_SANDBOX}
    routes        ${(resolved.routes ?? []).map((r) => r.pattern).join(", ") || "(workers.dev only)"}

  Written to ${GENERATED_CONFIG}. Deploy WITHOUT --env; this config is already ${environment}.
`);
