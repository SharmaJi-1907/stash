/**
 * Worker bindings and secrets.
 *
 * Every value here is declared in worker/wrangler.toml, except DEVICE_TOKEN which
 * is a secret set with `wrangler secret put DEVICE_TOKEN`.
 *
 * Spec: 02-TRD.md §8
 */

export interface Env {
  /** D1 (SQLite). Schema: worker/migrations/0001_init.sql */
  DB: D1Database;

  /** R2 bucket holding copied product images. Spec: 03-ARCHITECTURE.md §4.5 */
  BUCKET: R2Bucket;

  // No KV binding. 02-TRD.md §8 lists one for rate limiting, but the counter was
  // moved into isolate memory — KV's 1,000 writes/day cannot carry a per-request
  // counter. See the note at the top of src/middleware/rateLimit.ts.

  /** 32-byte base64url random string. Compared in constant time, never logged.
   *  Spec: 02-TRD.md §6 */
  DEVICE_TOKEN: string;
}
