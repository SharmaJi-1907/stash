/**
 * Copying product images into R2.
 *
 * Spec: 03-ARCHITECTURE.md §4.5 · 01-PRD.md F2.4
 *
 * Never hotlink. Three reasons, and all three are ordinary rather than
 * theoretical: source CDNs expire their URLs, many block cross-origin referers,
 * and the PWA's Content Security Policy would otherwise have to allow images
 * from anywhere, which defeats the point of having one.
 *
 * No resizing. Image processing would blow the 10 ms CPU budget (02-TRD.md §7),
 * so originals are stored as-is and served immutable. Display size is controlled
 * by width/height attributes and lazy loading. At one person's scale this trades
 * a little bandwidth for a lot of simplicity, and R2 egress is free.
 */

import { safeFetch, MAX_BODY_BYTES, BlockedUrlError } from './ssrf';

/**
 * Below this, it is not a photograph of anything.
 *
 * Measured 2026-09-09: enriching an amazon.com product page stored a 43-byte GIF
 * from fls-na.amazon.com/1/batch/... — a logging beacon that the bare-HTML
 * fallback picked up as the page's first image. Name-based filtering cannot
 * catch that URL; size can, and it catches every future variant of the same
 * mistake without a list to maintain.
 *
 * 2 KB is comfortably below any real product thumbnail and comfortably above
 * every tracking pixel, which are tens of bytes.
 */
export const MIN_IMAGE_BYTES = 2048;

export interface StoredImage {
  key: string;
  bytes: number;
  contentType: string;
}

/** Deterministic key so re-enriching the same image overwrites rather than piles up. */
async function keyFor(itemId: string, sourceUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceUrl));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `img/${itemId}/${hex.slice(0, 16)}`;
}

/**
 * Fetch an image and put it in R2.
 *
 * Returns null rather than throwing on every ordinary failure — a missing image
 * marks the item `partial`, it does not fail the save (03-ARCHITECTURE.md §8).
 */
export async function storeImage(
  bucket: R2Bucket,
  itemId: string,
  sourceUrl: string,
  pageUrl?: string,
): Promise<StoredImage | null> {
  let absolute: string;
  try {
    absolute = pageUrl ? new URL(sourceUrl, pageUrl).href : new URL(sourceUrl).href;
  } catch {
    return null;
  }

  try {
    const { response } = await safeFetch(absolute, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        // Some CDNs serve a placeholder without a referer from the page.
        ...(pageUrl ? { referer: pageUrl } : {}),
      },
    });
    if (!response.ok || !response.body) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) return null;

    // Reject on a declared size before spending bandwidth on it — too big to
    // store, or too small to be a photograph.
    const declared = Number(response.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && (declared > MAX_BODY_BYTES || declared < MIN_IMAGE_BYTES)) {
      return null;
    }

    // A missing or lying Content-Length is caught by counting as we read.
    const buffer = await readCapped(response.body, MAX_BODY_BYTES);
    if (!buffer) return null;
    if (buffer.byteLength < MIN_IMAGE_BYTES) return null;

    const key = await keyFor(itemId, absolute);
    await bucket.put(key, buffer, {
      httpMetadata: {
        contentType,
        // Immutable: the key is derived from the source URL, so the bytes at a
        // key never change. Spec: 03-ARCHITECTURE.md §4.5
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    return { key, bytes: buffer.byteLength, contentType };
  } catch (e) {
    if (e instanceof BlockedUrlError) return null;
    return null;
  }
}

/** Read a stream into a buffer, giving up if it goes past the cap. */
async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Over the cap: keep the original URL as a fallback and mark the item
      // partial rather than storing a truncated, corrupt image.
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}
