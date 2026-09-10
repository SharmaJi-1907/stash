/**
 * POST /v1/uploads/image — store a picture the user supplied.
 *
 * Spec: 02-TRD.md §5 · 01-PRD.md F4.2, F4.3
 *
 * This is the path for things with no fetchable URL at all: a WhatsApp forward,
 * a screenshot of an Instagram reel. The client uploads the image, gets a key
 * back, and passes that key when it creates the item.
 *
 * Separate from the enrichment image copy on purpose. That one fetches a remote
 * URL and may decline; this one is handed bytes by the user and must simply
 * keep them.
 */

import { Hono } from 'hono';
import type { Env } from '../env';
import { LIMITS } from '../../../shared/types';
import type { ApiError, ErrorCode, UploadImageResponse } from '../../../shared/types';

const err = (code: ErrorCode, message: string): ApiError => ({ error: { code, message } });

export const uploads = new Hono<{ Bindings: Env }>();

uploads.post('/image', async (c) => {
  // Reject on the declared length before reading a byte of it.
  const declared = Number(c.req.header('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > LIMITS.uploadBytes) {
    return c.json(err('PAYLOAD_TOO_LARGE', 'Images are limited to 5 MB'), 413);
  }

  let file: unknown;
  try {
    const form = await c.req.formData();
    file = form.get('image') ?? form.get('file');
  } catch {
    return c.json(err('INVALID_URL', 'Send the image as multipart form data'), 400);
  }

  if (!(file instanceof File)) {
    return c.json(err('INVALID_URL', 'No image in the request'), 400);
  }

  const type = file.type.toLowerCase();
  if (!type.startsWith('image/')) {
    return c.json(err('INVALID_URL', 'That is not an image'), 400);
  }

  const bytes = await file.arrayBuffer();
  // A lying or absent Content-Length is caught here, once the real size is known.
  if (bytes.byteLength > LIMITS.uploadBytes) {
    return c.json(err('PAYLOAD_TOO_LARGE', 'Images are limited to 5 MB'), 413);
  }
  if (bytes.byteLength === 0) {
    return c.json(err('INVALID_URL', 'That image is empty'), 400);
  }

  // Keyed by content, so the same screenshot uploaded twice occupies one object.
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `img/upload/${hex.slice(0, 32)}`;

  await c.env.BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return c.json<UploadImageResponse>({ key }, 201);
});
