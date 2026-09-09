import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Tests get the real schema, read from the same migration files production
// applies. A hand-written copy of the schema in a test helper would drift.
const migrations = await readD1Migrations('./migrations');

/**
 * Tests run inside workerd, not Node, so they exercise the same runtime the
 * Worker deploys to — crypto.subtle, HTMLRewriter and the D1/R2 bindings all
 * behave as they will in production. A pure-Node test runner would let code
 * pass here and fail on deploy.
 *
 * Setup note for anyone updating this: @cloudflare/vitest-pool-workers changed
 * shape in v0.22 for Vitest 4. The old `defineWorkersConfig` helper and the
 * `/config` entry point are gone, and `test.pool: '<name>'` is rejected with
 * "Runner ... is not supported". The pool is now installed as a Vite plugin via
 * `cloudflareTest()`.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
