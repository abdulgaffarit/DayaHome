/**
 * Deploy-configuration safety.
 *
 * `vinext build` writes `dist/server/wrangler.json` with the DEVELOPMENT
 * environment flattened in and the `env` block dropped, and points Wrangler at
 * it via `.wrangler/deploy/config.json`. Wrangler then ignores `wrangler.jsonc`
 * entirely, so `--env production` matches nothing and silently resolves the dev
 * D1 database, dev R2 bucket, APP_ENV=development and a localhost site URL.
 *
 * `scripts/prepare-deploy-config.mjs` is what stops that. These tests drive it
 * as a subprocess against fixture configs, so they assert the real behaviour of
 * the script the deploy path actually runs.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = process.cwd();
const SCRIPT = "scripts/prepare-deploy-config.mjs";

let workspace: string | null = null;

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = null;
});

/**
 * A throwaway copy of the repo's config plus a generated config, so the tests
 * never touch the real `wrangler.jsonc` or `dist/`.
 */
function makeWorkspace(generated: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "deploy-config-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "dist", "server"), { recursive: true });

  cpSync(join(REPO, "wrangler.jsonc"), join(dir, "wrangler.jsonc"));
  cpSync(join(REPO, SCRIPT), join(dir, SCRIPT));
  writeFileSync(
    join(dir, "dist/server/wrangler.json"),
    JSON.stringify(generated, null, 2),
  );

  workspace = dir;
  return dir;
}

/** What `vinext build` actually emits: development flattened, no `env`. */
function generatedDevConfig() {
  return {
    name: "dayarampur",
    main: "index.js",
    compatibility_date: "2026-08-26",
    assets: { directory: "dist/client", binding: "ASSETS" },
    vars: {
      APP_ENV: "development",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      SSLCOMMERZ_IS_SANDBOX: "true",
      CONTACT_UNLOCK_PRICE_BDT: "50",
    },
    d1_databases: [
      { binding: "DB", database_name: "dayarampur-dev", database_id: "dev-uuid" },
    ],
    r2_buckets: [
      { binding: "PROPERTY_IMAGES", bucket_name: "dayarampur-property-images-dev" },
    ],
    // vinext carries `triggers` through from wrangler.jsonc, so a realistic
    // fixture has them. The cron check is exercised deliberately below.
    triggers: { crons: ["0 * * * *"] },
    definedEnvironments: ["staging", "production"],
  };
}

interface RunResult {
  ok: boolean;
  output: string;
}

function run(dir: string, args: string[]): RunResult {
  try {
    return { ok: true, output: execFileSync("node", [SCRIPT, ...args], { cwd: dir, encoding: "utf8" }) };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Gives every environment a non-placeholder id, so other checks are reached. */
function withRealDatabaseIds(dir: string) {
  const path = join(dir, "wrangler.jsonc");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replaceAll(
      "00000000-0000-0000-0000-000000000000",
      "11111111-2222-3333-4444-555555555555",
    ),
  );
}

describe("the bug this guards against", () => {
  it("REJECTS a raw generated config as production — it carries dev bindings", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);

    const result = run(dir, ["production", "--verify"]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("DEVELOPMENT database");
    expect(result.output).toContain("Refusing to continue");
  });

  it("REJECTS a config prepared for staging when production was asked for", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);

    expect(run(dir, ["staging"]).ok).toBe(true);
    const result = run(dir, ["production", "--verify"]);

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/APP_ENV is "staging"/);
  });
});

describe("preparing an environment", () => {
  it("resolves production bindings from wrangler.jsonc", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);

    expect(run(dir, ["production"]).ok).toBe(true);

    const resolved = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    expect(resolved.name).toBe("dayarampur");
    expect(resolved.d1_databases[0].database_name).toBe("dayarampur-production");
    expect(resolved.r2_buckets[0].bucket_name).toBe("dayarampur-property-images");
    expect(resolved.vars.APP_ENV).toBe("production");
    expect(resolved.vars.NEXT_PUBLIC_SITE_URL).toBe("https://dayarampur.com");
    expect(resolved.vars.SSLCOMMERZ_IS_SANDBOX).toBe("false");
    expect(resolved.routes.map((r: { pattern: string }) => r.pattern)).toContain("dayarampur.com");
  });

  it("resolves staging bindings", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);

    expect(run(dir, ["staging"]).ok).toBe(true);

    const resolved = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    expect(resolved.name).toBe("dayarampur-staging");
    expect(resolved.d1_databases[0].database_name).toBe("dayarampur-staging");
    expect(resolved.vars.APP_ENV).toBe("staging");
  });

  it("keeps the build output details the generated config alone knows", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);
    run(dir, ["production"]);

    const resolved = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    // `main` and the assets directory come from the build, not from wrangler.jsonc.
    expect(resolved.main).toBe("index.js");
    expect(resolved.assets.binding).toBe("ASSETS");
  });

  it("leaves nothing for --env to select", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);
    run(dir, ["production"]);

    const resolved = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    expect(resolved.env).toBeUndefined();
    expect(resolved.definedEnvironments).toBeUndefined();
    expect(resolved.__preparedFor).toBe("production");
  });
});

describe("bindings that must never be missing", () => {
  it("REJECTS a placeholder database_id — it would bind a database that does not exist", () => {
    // The repo's wrangler.jsonc ships placeholder ids on purpose.
    const dir = makeWorkspace(generatedDevConfig());

    const result = run(dir, ["production"]);

    expect(result.ok).toBe(false);
    expect(result.output).toContain("still the placeholder");
    expect(result.output).toContain("wrangler d1 create dayarampur-production");
  });

  it("REJECTS a missing D1 binding", () => {
    const dir = makeWorkspace({ ...generatedDevConfig(), d1_databases: [] });
    withRealDatabaseIds(dir);
    // Strip the env's own D1 so the merge cannot restore it.
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        /"database_name": "dayarampur-production",[\s\S]*?"migrations_dir": "migrations"/,
        '"database_name": "wrong", "database_id": "x"',
      ),
    );

    expect(run(dir, ["production", "--verify"]).ok).toBe(false);
  });

  it("REJECTS a localhost site URL in a deployed environment", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"NEXT_PUBLIC_SITE_URL": "https://dayarampur.com"',
        '"NEXT_PUBLIC_SITE_URL": "http://localhost:3000"',
      ),
    );

    const result = run(dir, ["production"]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("NEXT_PUBLIC_SITE_URL");
  });

  it("REJECTS production still pointed at the SSLCOMMERZ sandbox", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);
    const path = join(dir, "wrangler.jsonc");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"SSLCOMMERZ_IS_SANDBOX": "false"',
        '"SSLCOMMERZ_IS_SANDBOX": "true"',
      ),
    );

    const result = run(dir, ["production"]);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("sandbox gateway");
  });
});

describe("scheduled execution", () => {
  it("REJECTS a config with no cron triggers", () => {
    // The silent-failure shape: every request is served correctly while
    // expired listings stay up and paid campaigns never start.
    const dir = makeWorkspace({ ...generatedDevConfig(), triggers: { crons: [] } });
    withRealDatabaseIds(dir);

    const result = run(dir, ["production"]);

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/No cron triggers/i);
  });

  it("carries the cron triggers through into the prepared production config", () => {
    const dir = makeWorkspace({ ...generatedDevConfig(), triggers: { crons: ["0 * * * *"] } });
    withRealDatabaseIds(dir);

    expect(run(dir, ["production"]).ok).toBe(true);

    const prepared = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    expect(prepared.triggers.crons).toContain("0 * * * *");
  });
});

describe("JSONC parsing", () => {
  it("does not corrupt URLs while stripping // comments", () => {
    const dir = makeWorkspace(generatedDevConfig());
    withRealDatabaseIds(dir);
    run(dir, ["production"]);

    const resolved = JSON.parse(readFileSync(join(dir, "dist/server/wrangler.json"), "utf8"));
    // A naive comment-stripping regex would truncate this at the "//".
    expect(resolved.vars.NEXT_PUBLIC_SITE_URL).toBe("https://dayarampur.com");
  });
});

describe("the deploy path never uses --env", () => {
  it("npm deploy scripts target the prepared config directly", () => {
    const scripts = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;

    for (const name of ["cf:deploy:staging", "cf:deploy:production"]) {
      const script = scripts[name];
      expect(script, `${name} must resolve the config first`).toContain(
        "prepare-deploy-config.mjs",
      );
      expect(script, `${name} must re-verify before deploying`).toContain("--verify");
      expect(script, `${name} must not rely on --env`).not.toMatch(/wrangler deploy[^&]*--env/);
    }
  });

  it("deploy.sh resolves and re-verifies before deploying", () => {
    const shell = readFileSync(join(REPO, "scripts/deploy.sh"), "utf8");
    expect(shell).toContain("prepare-deploy-config.mjs");
    expect(shell).toContain('--verify');
    expect(shell).not.toMatch(/wrangler deploy .*--env/);
  });
});
