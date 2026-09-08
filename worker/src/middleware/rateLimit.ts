/**
 * Per-token request throttling.
 *
 * Spec: 02-TRD.md §6 (60 writes/min, 600 reads/min) · 03-ARCHITECTURE.md §8
 *
 * ── Why the counter is not in KV, as 02-TRD.md §6 suggests ───────────────────
 *
 * A counter has to be written on every request. KV allows 1,000 writes per day
 * on the free tier (07-RESEARCH.md §2.1) against an expected ~800 requests per
 * day (02-TRD.md §2.2) — so the limiter would consume 80% of a quota it exists
 * to protect. Worse, the failure it is built for is a runaway client loop, which
 * would exhaust KV's daily writes within minutes and switch the limiter off at
 * exactly the moment it is needed.
 *
 * The counter therefore lives in the isolate's own memory. It costs nothing, and
 * it stops the D1 and R2 work that a runaway loop would otherwise generate.
 *
 * What this deliberately does NOT do: reduce the Worker's own request count. A
 * request has already been billed against the 100,000/day allowance by the time
 * any code here runs. No in-Worker limiter can change that, KV-based or not —
 * only an edge rule could, and that is not free. This limiter protects the
 * database and the object store, which are the meters a loop would actually burn.
 *
 * Isolates are per-location and get recycled, so a count can reset early and two
 * isolates can each allow a full budget. For one user on one device that drift is
 * immaterial, and being approximately right at zero cost beats being exactly
 * right at the cost of the thing being protected.
 *
 * It also keeps the Worker portable, which 02-TRD.md §9.2 asks for: there is no
 * Cloudflare-specific API here at all.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { ApiError } from '../../../shared/types';

/** Rolling window width. Spec: 02-TRD.md §6 */
export const WINDOW_MS = 60_000;

/** Reads are cheap and the shelf polls; writes touch D1. Spec: 02-TRD.md §6 */
export const MAX_READS_PER_WINDOW = 600;
export const MAX_WRITES_PER_WINDOW = 60;

const RATE_LIMITED: ApiError = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
};

/** Timestamps of recent requests, per principal and kind. */
const hits = new Map<string, number[]>();

/**
 * A short, stable, non-reversible fingerprint of the token.
 *
 * The raw token is never used as a map key. It is already in memory as a binding,
 * but there is no reason to also scatter it through a data structure that could
 * end up in a heap dump or a debug print. FNV-1a is not a security hash and does
 * not need to be — it only has to be stable and not readable back.
 */
function fingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function isWrite(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export const rateLimit: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const write = isWrite(c.req.method);
  const limit = write ? MAX_WRITES_PER_WINDOW : MAX_READS_PER_WINDOW;
  const key = `${fingerprint(c.env.DEVICE_TOKEN ?? '')}:${write ? 'w' : 'r'}`;

  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Drop anything that has fallen out of the window. This is also what bounds
  // memory: the array can never hold more than `limit` live entries.
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= limit) {
    hits.set(key, recent);
    // Oldest live hit decides when a slot frees up. Always at least 1s, so a
    // client backing off never busy-loops on Retry-After: 0.
    const retryAfter = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000));
    return c.json(RATE_LIMITED, 429, { 'Retry-After': String(retryAfter) });
  }

  recent.push(now);
  hits.set(key, recent);

  await next();
};

/** Test seam. Not called by the Worker itself. */
export function __resetRateLimits(): void {
  hits.clear();
}
