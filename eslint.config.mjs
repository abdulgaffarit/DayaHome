import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and generated files.
    "dist/**",
    ".open-next/**",
    ".wrangler/**",
    ".seed-images/**",
    "coverage/**",
    "worker-configuration.d.ts",
  ]),

  {
    rules: {
      /**
       * `next/image` requires an image optimizer. This deployment targets
       * Cloudflare Workers without Cloudflare Images, so images are served
       * straight from R2 through /api/images with immutable cache headers,
       * explicit width/height to avoid layout shift, and `loading="lazy"` on
       * everything below the fold. A plain <img> is the correct primitive here.
       */
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
