import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';
import { __resetRateLimits } from '../src/middleware/rateLimit';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);
});

/**
 * Each test starts from an empty shelf and a fresh write budget.
 *
 * The rate limiter holds its counters in module state, which the pool shares
 * across every test in a file. Without this reset a long test file quietly
 * crosses 60 writes a minute and every later test gets a 429 — which surfaces
 * as `undefined` where an item was expected, and looks like a bug in whatever
 * was being tested rather than in the harness.
 */
beforeEach(async () => {
  __resetRateLimits();
  for (const table of ['item_tags', 'price_snapshots', 'classify_rules', 'items', 'tags', 'categories']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});
