/**
 * The extraction ladder.
 *
 * Spec: 03-ARCHITECTURE.md §4.2 · 01-PRD.md F2
 *
 * Runs inside ctx.waitUntil() after the create response has already been sent,
 * so nothing here is on the five-second capture path. Its failure is never an
 * API error: it sets `enrichment` on the row and the save stands
 * (06-AGENT-BUILD-GUIDE.md §1.3).
 *
 * Tiers are tried in order and the first that yields a title wins:
 *   0  extension scrape   handled at create time, never reaches here
 *   1  JSON-LD Product    structured, carries a real price
 *   2  Open Graph         nearly universal
 *   3  Twitter Card       fills what Open Graph left empty (resolved with tier 2)
 *   4  oEmbed             providers that publish one; YouTube needs it
 *   5  bare HTML          <title> plus the first plausible image
 *   6  failed             the item still exists and offers manual capture
 */

import { collect } from './extractors/collect';
import { fromJsonLd } from './extractors/jsonld';
import { fromOpenGraph } from './extractors/opengraph';
import { fromOEmbed, hasOEmbed } from './extractors/oembed';
import { fromBareHtml } from './extractors/bare';
import { storeImage } from './images';
import { safeFetch, BlockedUrlError, FETCH_TIMEOUT_MS } from './ssrf';
import type { Extracted } from './extractors/types';
import type { Env } from '../env';

/**
 * How much of a document to parse.
 *
 * 03-ARCHITECTURE.md §4.3 says to abort at `</head>`, on the grounds that every
 * tag of interest lives there. Measured against the fixture set on 2026-09-09,
 * that is true for Open Graph and false for JSON-LD:
 *
 *   myntra.com      </head> at 151 KB, Product JSON-LD at  10 KB   (inside)
 *   keychron.com    </head> at 922 KB, Product JSON-LD at 2.5 MB   (after)
 *   woocommerce.com </head> at 112 KB, Product JSON-LD at 361 KB   (after)
 *
 * So the parse is bounded by bytes instead, and the size of that bound is a
 * trade rather than an obvious choice. Two measurements set it.
 *
 * What a bigger budget buys, across the twenty-link set:
 *
 *   0.5 MB   19/20 usable, 1 price
 *   1.0 MB   19/20 usable, 1 price
 *   3.0 MB   19/20 usable, 2 prices   (+ keychron.com, a Shopify ProductGroup)
 *
 * What it costs, timing collect() alone on synthetic documents:
 *
 *   0.5 MB   147 ms      1 MB   282 ms      2 MB   569 ms      3 MB   864 ms
 *
 * Those are wall-clock in the local test runtime, not the CPU figure Cloudflare
 * meters, and they include stream scheduling that does not count against the
 * limit. But the shape is linear and the limit is 10 ms per invocation
 * (02-TRD.md §7), so tripling the budget to win one more price on twenty links
 * is the wrong side of that trade.
 *
 * 512 KB is chosen because it covers what is reliably early: og:title has never
 * appeared later than 31 KB in the fixture set, and a Product JSON-LD that sits
 * in the head arrives by 11 KB. What it gives up is the late JSON-LD on
 * Shopify-shaped pages — and that is the loss the extension exists to cover,
 * since it reads the rendered page directly (03-ARCHITECTURE.md §3).
 *
 * A cheaper way to reach those prices exists and is not built yet: Shopify
 * serves the same product as JSON at `<product-url>.json`, a few kilobytes
 * rather than three megabytes. 01-PRD.md principle 3 permits exactly this — a
 * site-specific rule layered on top of a generic path that already works.
 */
export const ENRICH_PARSE_BUDGET = 512 * 1024;

const MAX_TITLE = 500;

export interface EnrichResult {
  extracted: Extracted | null;
  imageKey: string | null;
  imageBytes: number | null;
  /** What to write to items.enrichment. */
  state: 'rich' | 'partial' | 'failed';
}

/** Pick the best of the tiers, in the order the spec sets. */
export async function extract(url: string, budget = ENRICH_PARSE_BUDGET): Promise<Extracted | null> {
  // oEmbed first for providers that have one, because for those the HTML is
  // worthless — youtube.com returns nothing usable to a server fetch at all.
  if (hasOEmbed(url)) {
    const viaOEmbed = await fromOEmbed(url);
    if (viaOEmbed) return viaOEmbed;
  }

  let collected;
  try {
    const { response } = await safeFetch(url, {
      headers: {
        // A browser user agent, and it is load-bearing rather than cosmetic.
        // Measured 2026-09-09: myntra.com answers 200 with 464 KB and a full
        // Product JSON-LD to a Chrome user agent, and refuses the connection
        // outright — no response at all — to a self-identifying bot string. The
        // page being fetched is one the user just chose to save and could open
        // themselves; this asks for the same document they would get.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-IN,en;q=0.9',
      },
    });
    if (!response.ok) return null;

    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) return null;

    collected = await collect(response, budget);
  } catch (e) {
    if (e instanceof BlockedUrlError) throw e;   // a blocked URL is not a soft failure
    return null;
  }

  return fromJsonLd(collected.jsonLd)
    ?? fromOpenGraph(collected)
    ?? fromBareHtml(collected);
}

/**
 * Copy an image the extension already found, without running the ladder.
 *
 * An item created from an extension scrape arrives complete and is marked `rich`
 * straight away, so enrichItem never runs for it — which means, before this
 * existed, its image was never copied into R2 and the row kept only the remote
 * URL. Every save from the extension, the highest-quality path in the system,
 * ended up hotlinking. 01-PRD.md F2.4 says hotlinking is not acceptable.
 */
export async function storeScrapedImage(env: Env, itemId: string, imageUrl: string, pageUrl: string): Promise<void> {
  const stored = await storeImage(env.BUCKET, itemId, imageUrl, pageUrl);
  if (!stored) return;

  await env.DB.prepare(
    'UPDATE items SET image_key = ?, image_bytes = ?, updated_at = ? WHERE id = ?',
  ).bind(stored.key, stored.bytes, Date.now(), itemId).run();
}

/**
 * Enrich one item and write the result back. Never throws: every failure path
 * ends in a row update, because the alternative is an item that stays `pending`
 * forever with no way for the user to tell why.
 */
export async function enrichItem(env: Env, itemId: string, url: string): Promise<EnrichResult> {
  let extracted: Extracted | null = null;

  try {
    extracted = await Promise.race([
      extract(url),
      // 8 seconds, then give up. Spec: 01-PRD.md F2.5
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
    ]);
  } catch {
    extracted = null;
  }

  let imageKey: string | null = null;
  let imageBytes: number | null = null;

  if (extracted?.image) {
    const stored = await storeImage(env.BUCKET, itemId, extracted.image, url);
    if (stored) { imageKey = stored.key; imageBytes = stored.bytes; }
  }

  // An image that could not be copied does not make the item a failure — the
  // original URL stays as a fallback and the item is partial.
  // Spec: 03-ARCHITECTURE.md §8
  const state: EnrichResult['state'] = !extracted
    ? 'failed'
    : extracted.quality === 'rich' && (imageKey || !extracted.image)
      ? 'rich'
      : extracted.quality === 'rich' ? 'partial' : 'partial';

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE items SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       image_key = COALESCE(?, image_key),
       image_url = COALESCE(?, image_url),
       image_bytes = COALESCE(?, image_bytes),
       price_amount = COALESCE(?, price_amount),
       price_currency = COALESCE(?, price_currency),
       site_name = COALESCE(?, site_name),
       enrichment = ?,
       enrich_attempts = enrich_attempts + 1,
       updated_at = ?
     WHERE id = ?`,
  ).bind(
    extracted?.title?.slice(0, MAX_TITLE) ?? null,
    extracted?.description?.slice(0, 2000) ?? null,
    imageKey,
    extracted?.image ?? null,
    imageBytes,
    extracted?.price?.amount ?? null,
    extracted?.price?.currency ?? null,
    extracted?.siteName ?? null,
    state,
    now,
    itemId,
  ).run();

  // Written on every enrichment, never read by v1. Reserved so the deferred
  // price-tracking feature arrives with history. Spec: 01-PRD.md §5.3
  if (extracted?.price) {
    await env.DB.prepare(
      'INSERT INTO price_snapshots (id, item_id, amount, currency, captured_at) VALUES (?,?,?,?,?)',
    ).bind(crypto.randomUUID(), itemId, extracted.price.amount, extracted.price.currency, now).run();
  }

  return { extracted, imageKey, imageBytes, state };
}
