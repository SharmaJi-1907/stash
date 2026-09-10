/**
 * Stash Worker — application entry point.
 *
 * Spec: 03-ARCHITECTURE.md §1, §10 · 02-TRD.md §5
 *
 * Route layout:
 *   GET /health   liveness. Unauthenticated, and touches neither D1 nor R2, so it
 *                 still answers when the database is down — which is exactly when
 *                 you need to know whether the Worker itself is alive.
 *   /v1/*         everything else. Bearer-token authenticated, no exceptions.
 *
 * Routes are added under `v1` as the phases land: items and enrichment in P1,
 * sync and uploads in P2. The auth middleware is mounted on the whole prefix
 * rather than per route, so a new route cannot be added unprotected by accident.
 */

import { Hono } from 'hono';
import type { Env } from './env';
import { auth } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { items } from './routes/items';
import { sync } from './routes/sync';
import { images } from './routes/images';
import type { ApiError, ErrorCode, HealthResponse } from '../../shared/types';

type App = { Bindings: Env };

const app = new Hono<App>();

/** The error envelope from 02-TRD.md §5.3. One shape for every failure. */
function apiError(code: ErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

// Images are served outside /v1 and outside auth: an <img> tag cannot send an
// Authorization header. See the note at the top of routes/images.ts.
app.route('/img', images);

app.get('/health', (c) => {
  const body: HealthResponse = { ok: true, time: Date.now() };
  return c.json(body);
});

const v1 = new Hono<App>();

// Order matters. Authenticate first, then throttle: an unauthenticated caller
// must not be able to consume the real token's budget, and the limiter keys on
// the token, which only exists once auth has run.
v1.use('*', auth);
v1.use('*', rateLimit);

v1.route('/items', items);
v1.route('/sync', sync);

// P2 adds uploads and export.

app.route('/v1', v1);

app.notFound((c) => c.json(apiError('NOT_FOUND', 'No such route'), 404));

app.onError((err, c) => {
  // Logged, never returned — an internal error must not leak stack traces,
  // query text or secrets to a caller. Spec: 02-TRD.md §6
  console.error('unhandled error:', err);
  return c.json(apiError('INTERNAL', 'Something went wrong'), 500);
});

export default app;
