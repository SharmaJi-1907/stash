/**
 * GET /img/:key — serve a stored image from R2.
 *
 * Spec: 02-TRD.md §5 · 03-ARCHITECTURE.md §4.5
 *
 * Unauthenticated on purpose: an <img> tag cannot send an Authorization header,
 * so requiring one would mean no images render anywhere. The keys are
 * unguessable (an item UUID plus sixteen hex characters of the source URL's
 * hash) and the objects are product photographs that are already public on the
 * seller's own CDN, so there is nothing here worth protecting with a token.
 *
 * Served immutable: a key is derived from the source URL, so the bytes behind
 * one never change.
 */

import { Hono } from 'hono';
import type { Env } from '../env';

export const images = new Hono<{ Bindings: Env }>();

images.get('/*', async (c) => {
  // The R2 key already begins with `img/` (03-ARCHITECTURE.md §4.5), and this
  // router is mounted at `/img`, so the key is the request path minus its
  // leading slash — not the path with `/img/` stripped, which would have made
  // every image URL read `/img/img/<item>/<hash>`.
  const key = c.req.path.replace(/^\/+/, '');
  if (!key.startsWith('img/') || key.includes('..')) return c.notFound();

  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  // Honour a conditional request so a returning shelf re-downloads nothing.
  if (c.req.header('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
});
