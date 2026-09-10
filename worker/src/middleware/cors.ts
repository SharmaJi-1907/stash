/**
 * Cross-origin access for the web app.
 *
 * ── Not in the documents, and it has to be ──────────────────────────────────
 *
 * 02-TRD.md §5 specifies the API contract and never mentions CORS, but the
 * architecture puts the app and the API on different origins by design: the PWA
 * on Cloudflare Pages, the API on a Worker (§2.1). A browser will not let one
 * call the other without permission, so without this the app can save nothing
 * and sync nothing — while the extension, which is not subject to the same rule,
 * works perfectly. That asymmetry is what made it look like an app bug.
 *
 * Two halves, and missing either one is enough to break it:
 *
 *   · the response needs Access-Control-Allow-Origin
 *   · the preflight OPTIONS must be answered BEFORE auth, because a browser
 *     sends it without the Authorization header. Auth was returning 401 to the
 *     preflight, so the real request never happened.
 *
 * ── Why an allowlist and not `*` ────────────────────────────────────────────
 *
 * `*` would work — the API authenticates with a bearer token rather than
 * cookies, so a wildcard grants nothing a token holder does not already have.
 * It is still refused: with a wildcard, any page on the internet can put this
 * API's address in a fetch and watch what comes back if the token ever leaks
 * into a browser it should not be in. An allowlist costs nothing and removes a
 * whole class of "how did that happen".
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/** Exact origins, plus preview deployments of the same Pages project. */
const ALLOWED = [
  /^https:\/\/stash-1ju\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.stash-1ju\.pages\.dev$/,
  // Vite's dev server, so the app can be worked on against the real API.
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return ALLOWED.some((pattern) => pattern.test(origin));
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    // The allowed origin varies by request, so a cache must key on it.
    vary: 'Origin',
  };
}

export const cors: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const origin = c.req.header('Origin');

  // Answer the preflight here and go no further. It arrives without a token by
  // definition, so anything downstream would refuse it.
  if (c.req.method === 'OPTIONS') {
    return isAllowedOrigin(origin)
      ? new Response(null, { status: 204, headers: corsHeaders(origin!) })
      : new Response(null, { status: 403 });
  }

  await next();

  if (isAllowedOrigin(origin)) {
    for (const [key, value] of Object.entries(corsHeaders(origin!))) {
      c.res.headers.set(key, value);
    }
  }
};
