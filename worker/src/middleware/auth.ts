/**
 * Bearer token authentication.
 *
 * Spec: 02-TRD.md §6 · 05-ROADMAP.md P0 task 7 and its "Watch for" note.
 *
 * ── Why this file is more careful than it looks ──────────────────────────────
 *
 * The obvious way to check a token is `provided === expected`. That is a timing
 * oracle. String comparison stops at the first byte that differs, so a wrong
 * token that shares the first character takes measurably longer to reject than
 * one that differs immediately. An attacker who can time responses recovers the
 * secret one byte at a time — thousands of guesses, not 2^256.
 *
 * The fix is a comparison whose duration does not depend on *where* the inputs
 * differ. `crypto.subtle.timingSafeEqual` provides that, but it requires both
 * inputs to be the same byte length and throws otherwise — and reacting to a
 * length mismatch is itself a leak, of the secret's length.
 *
 * So both values are hashed with SHA-256 first. A hash is always 32 bytes, so
 * the comparison is always over the same length no matter what was supplied,
 * and the hash of a wrong guess reveals nothing about the right answer.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { ApiError } from '../../../shared/types';

const encoder = new TextEncoder();

/** `Bearer <token>`. The scheme is case-insensitive per RFC 7235. */
const BEARER = /^bearer\s+(\S+)\s*$/i;

const UNAUTHORIZED: ApiError = {
  error: { code: 'UNAUTHORIZED', message: 'Bad or missing token' },
};

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

/**
 * Compare two secrets without leaking, through timing, how much of the guess
 * was correct or how long the real secret is.
 */
async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export const auth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.DEVICE_TOKEN;

  // Fail closed. A Worker deployed without its secret must reject everything
  // rather than wave everything through. The token itself is never logged.
  if (!expected) {
    console.error('DEVICE_TOKEN is not configured — rejecting all authenticated requests');
    return c.json(UNAUTHORIZED, 401);
  }

  const supplied = BEARER.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!supplied) return c.json(UNAUTHORIZED, 401);

  if (!(await secretsMatch(supplied, expected))) return c.json(UNAUTHORIZED, 401);

  await next();
};
