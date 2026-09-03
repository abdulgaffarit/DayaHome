#!/usr/bin/env bash
#
# One-command deploy of dayarampur.com to Cloudflare.
#
#   sh scripts/deploy.sh staging       # fastest path to a live URL
#   sh scripts/deploy.sh production
#
# Creates the D1 database and R2 bucket if they do not exist, writes the real
# database id into wrangler.jsonc, applies migrations, checks that the required
# secrets are set, builds, and deploys. Safe to re-run — every step is a no-op
# when the resource already exists.
#
# Prerequisite: `npx wrangler login` (opens a browser once).

set -euo pipefail

ENVIRONMENT="${1:-staging}"

case "$ENVIRONMENT" in
  staging)
    DB_NAME="dayarampur-staging"
    BUCKET="dayarampur-property-images-staging"
    WORKER_NAME="dayarampur-staging"
    ;;
  production)
    DB_NAME="dayarampur-production"
    BUCKET="dayarampur-property-images"
    WORKER_NAME="dayarampur"
    ;;
  *)
    echo "usage: sh scripts/deploy.sh [staging|production]" >&2
    exit 1
    ;;
esac

# The one config every Cloudflare command in this script points at.
DEPLOY_CONFIG="dist/server/wrangler.json"

step() { printf '\n\033[1;32m==>\033[0m \033[1m%s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
step "Verifying (typecheck, lint, tests)"
npm run verify

step "Checking Cloudflare authentication"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in. Run:  npx wrangler login" >&2
  exit 1
fi
npx wrangler whoami | sed -n '/Account Name/,+2p' || true

# ---------------------------------------------------------------------------
step "Ensuring D1 database '$DB_NAME' exists"
if npx wrangler d1 info "$DB_NAME" >/dev/null 2>&1; then
  echo "already exists"
else
  npx wrangler d1 create "$DB_NAME"
fi

# `d1 info --json` is the stable way to read the uuid back, whether the
# database was just created or already existed.
DB_ID="$(npx wrangler d1 info "$DB_NAME" --json | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    // Wrangler prefixes JSON output with human-readable lines on some versions.
    const start = raw.indexOf("{");
    const parsed = JSON.parse(raw.slice(start));
    process.stdout.write(parsed.uuid ?? parsed.database_id ?? "");
  });
')"

if [ -z "$DB_ID" ]; then
  echo "Could not read the database id for $DB_NAME." >&2
  echo "Run:  npx wrangler d1 info $DB_NAME    and paste the uuid into wrangler.jsonc" >&2
  exit 1
fi

step "Writing database id into wrangler.jsonc"
node scripts/set-database-id.mjs "$DB_NAME" "$DB_ID"

# ---------------------------------------------------------------------------
step "Ensuring R2 bucket '$BUCKET' exists"
if npx wrangler r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "already exists"
else
  npx wrangler r2 bucket create "$BUCKET"
fi

# ---------------------------------------------------------------------------
step "Building"
npm run build

# `vinext build` emits dist/server/wrangler.json with the DEVELOPMENT
# environment flattened in and the `env` block dropped, plus a Wrangler
# "redirected configuration" pointer. Wrangler then ignores wrangler.jsonc, so
# `--env production` silently matches nothing and falls back to the dev
# bindings. This step rewrites that file to be the requested environment and
# refuses to continue if the result is not genuinely that environment.
step "Resolving deploy configuration for $ENVIRONMENT"
node scripts/prepare-deploy-config.mjs "$ENVIRONMENT"

# ---------------------------------------------------------------------------
step "Checking required secrets"
# `--name` addresses the Worker directly. Using `--env` here would be subject
# to the same redirected-config problem that this script exists to solve.
EXISTING_SECRETS="$(npx wrangler secret list --name "$WORKER_NAME" 2>/dev/null || echo '[]')"
MISSING=""
for SECRET in SESSION_SECRET SSLCOMMERZ_STORE_ID SSLCOMMERZ_STORE_PASSWORD; do
  case "$EXISTING_SECRETS" in
    *"$SECRET"*) echo "  $SECRET: set" ;;
    *) echo "  $SECRET: MISSING"; MISSING="$MISSING $SECRET" ;;
  esac
done

if [ -n "$MISSING" ]; then
  warn "Set the missing secrets, then re-run this script:"
  for SECRET in $MISSING; do
    if [ "$SECRET" = "SESSION_SECRET" ]; then
      echo "    node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\" \\"
      echo "      | npx wrangler secret put SESSION_SECRET --name $WORKER_NAME"
    else
      echo "    npx wrangler secret put $SECRET --name $WORKER_NAME"
    fi
  done
  echo
  warn "Without SSLCOMMERZ credentials the site works but payment fails cleanly."
  printf 'Continue anyway? [y/N] '
  read -r REPLY
  case "$REPLY" in [yY]*) ;; *) exit 1 ;; esac
fi

step "Applying database migrations"
npx wrangler d1 migrations apply "$DB_NAME" --config "$DEPLOY_CONFIG" --remote

# ---------------------------------------------------------------------------
step "Final check — the config really is $ENVIRONMENT"
node scripts/prepare-deploy-config.mjs "$ENVIRONMENT" --verify

step "Deploying to $ENVIRONMENT"
# No --env: the config IS this environment, so there is nothing to select and
# nothing to fall back to.
npx wrangler deploy --config "$DEPLOY_CONFIG"

# ---------------------------------------------------------------------------
step "Done"

if [ "$ENVIRONMENT" = "production" ]; then
  SITE_URL="https://dayarampur.com"
  cat <<NOTE

Live at $SITE_URL  (www.dayarampur.com 308-redirects to it).

A brand-new custom domain can take a few minutes for its certificate to issue.
Until it does, the workers.dev address printed in the deploy output above is
already serving the same app.
NOTE
else
  SITE_URL="the workers.dev URL printed above"
  cat <<NOTE

Live at $SITE_URL
NOTE
fi

cat <<NOTE

Next:
  1. Open it and check the homepage renders.
  2. Register an account, then promote it to SUPER_ADMIN:
       npx wrangler d1 execute $DB_NAME --config $DEPLOY_CONFIG --remote \\
         --command "UPDATE users SET role='SUPER_ADMIN' WHERE phone='01XXXXXXXXX'"
  3. Set the IPN URL in the SSLCOMMERZ merchant panel to:
       $SITE_URL/api/payments/sslcommerz/ipn
  4. Run one sandbox payment end to end. The live gateway handshake has never
     been exercised — this is the last unverified path in the system.

NOTE
