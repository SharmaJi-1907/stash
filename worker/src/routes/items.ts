/**
 * Item routes.
 *
 * Spec: 02-TRD.md §5, §5.1 · 03-ARCHITECTURE.md §2
 *
 * The rule that shapes this whole file: **the save is the contract.** A create
 * returns 201 as soon as the row exists. Nothing that could fail — fetching the
 * page, reading its metadata, copying its image — is allowed onto that path.
 * Enrichment is handed to ctx.waitUntil() and its failure sets a field on the
 * item rather than returning an error (06-AGENT-BUILD-GUIDE.md §1.2, §1.3).
 */

import { Hono } from 'hono';
import type { Env } from '../env';
import { canonicalise, urlHash } from '../../../shared/canonicalise';
import { enrichItem, storeScrapedImage } from '../lib/enrich';
import { parsePrice } from '../lib/price';
import {
  findItemById, findLiveItemByHash, insertItem, listItems,
  replaceItemTags, softDeleteItem, updateItem,
} from '../db/queries';
import { LIMITS, ITEM_STATUSES, ITEM_PRIORITIES } from '../../../shared/types';
import type {
  ApiError, CreateItemRequest, CreateItemResponse, ErrorCode,
  ListItemsResponse, UpdateItemRequest,
} from '../../../shared/types';

type App = { Bindings: Env };

const err = (code: ErrorCode, message: string): ApiError => ({ error: { code, message } });

/** Trim to a cap rather than rejecting. A title two characters over the limit is
 *  not a reason to refuse a save. Spec: 02-TRD.md §6 "Input handling". */
const capped = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** The registrable-ish domain, for display and for the classifier. */
function siteOf(canonical: string): string | null {
  try { return new URL(canonical).hostname || null; } catch { return null; }
}

export const items = new Hono<App>();

/* ── create ────────────────────────────────────────────────────────────────── */

items.post('/', async (c) => {
  let body: CreateItemRequest;
  try {
    body = await c.req.json<CreateItemRequest>();
  } catch {
    return c.json(err('INVALID_URL', 'Body must be JSON'), 400);
  }

  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID();
  const now = Date.now();
  // The client's own creation time is honoured so an item queued offline keeps
  // the moment it was actually saved, not the moment it finally synced.
  const createdAt = Number.isFinite(body.createdAt) ? Number(body.createdAt) : now;

  const manual = body.manual === true;
  const title = capped(body.title, LIMITS.titleLength);

  if (manual && !title) {
    return c.json(err('INVALID_URL', 'A manual item needs a title'), 400);
  }
  if (!manual && typeof body.url !== 'string') {
    return c.json(err('INVALID_URL', 'Give a url, or manual: true with a title'), 400);
  }

  // A manual item has no fetchable URL; give it a stable internal one so the
  // dedupe key and the NOT NULL columns still hold.
  const rawUrl = manual && !body.url ? `stash:manual/${id}` : String(body.url);

  let canonical: string;
  if (manual && rawUrl.startsWith('stash:manual/')) {
    canonical = rawUrl;
  } else {
    try {
      canonical = canonicalise(rawUrl);
    } catch {
      return c.json(err('INVALID_URL', 'Not a fetchable http(s) URL'), 400);
    }
  }

  const hash = await urlHash(canonical);

  // Saving something already on the shelf is not an error and not a second row.
  // Surface what is already there. Spec: 01-PRD.md F1.5, 02-TRD.md §5.1
  const existing = await findLiveItemByHash(c.env.DB, hash);
  if (existing) {
    return c.json<CreateItemResponse>({ item: existing, duplicate: true }, 200);
  }

  const scraped = body.scraped ?? {};
  const scrapedTitle = capped(scraped.title, LIMITS.titleLength);

  // The extension sends the price as the page showed it and the server parses
  // it, so there is one price parser and one set of tests for it.
  const scrapedPrice = scraped.priceText
    ? parsePrice(scraped.priceText, scraped.priceCurrency ?? null)
    : null;

  const hasScrape = Boolean(scrapedTitle || scraped.image || scraped.priceAmount || scrapedPrice);

  await insertItem(c.env.DB, {
    id,
    url: rawUrl,
    canonicalUrl: canonical,
    urlHash: hash,
    title: title ?? scrapedTitle,
    description: capped(scraped.description, 2000),
    note: capped(body.note, LIMITS.noteLength),
    imageKey: typeof body.imageKey === 'string' ? body.imageKey : null,
    imageUrl: typeof scraped.image === 'string' ? scraped.image : null,
    priceAmount: Number.isInteger(body.priceAmount) ? Number(body.priceAmount)
               : Number.isInteger(scraped.priceAmount) ? Number(scraped.priceAmount)
               : scrapedPrice?.amount ?? null,
    priceCurrency: body.priceCurrency ?? scraped.priceCurrency ?? scrapedPrice?.currency ?? null,
    site: siteOf(canonical),
    siteName: capped(scraped.siteName, 200),
    source: body.source ?? 'paste',
    categoryId: typeof body.categoryId === 'string' ? body.categoryId : null,
    // An extension scrape arrives complete; a manual item is complete by
    // definition. Anything else waits for the ladder. Spec: 02-TRD.md §5.1
    enrichment: manual ? 'manual' : hasScrape ? 'rich' : 'pending',
    createdAt,
    updatedAt: now,
  });

  const created = await findItemById(c.env.DB, id);
  if (!created) return c.json(err('INTERNAL', 'Item did not persist'), 500);

  // The response is already decided. Enrichment runs after it has been sent, so
  // nothing below can slow a save down or turn one into an error.
  // Spec: 03-ARCHITECTURE.md §2 step 5 · 06-AGENT-BUILD-GUIDE.md §1.2
  if (created.enrichment === 'pending') {
    // The URL as the user gave it, not the canonical form. Canonicalisation is
    // an identity key, not an address: measured 2026-09-09, myntra.com's
    // canonical `/1700944/buy` does not serve the product page the full slug
    // does, and amazon.com and youtube.com both answer their canonical forms
    // with a 301. Fetching the canonical URL is how a page that enriches
    // perfectly in a unit test comes back empty in production.
    c.executionCtx.waitUntil(
      enrichItem(c.env, id, created.url).catch((e) => {
        console.error('enrichment failed for', id, e);
      }),
    );
  } else if (created.imageUrl && !created.imageKey) {
    // An extension scrape skips the ladder, but its image still has to be copied
    // out of the seller's CDN — those URLs expire and many block cross-origin
    // referers. Same rule, different path in.
    c.executionCtx.waitUntil(
      storeScrapedImage(c.env, id, created.imageUrl, created.url).catch((e) => {
        console.error('image copy failed for', id, e);
      }),
    );
  }

  return c.json<CreateItemResponse>({ item: created, duplicate: false }, 201);
});

/* ── read ──────────────────────────────────────────────────────────────────── */

items.get('/', async (c) => {
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const since = q.since !== undefined ? Number(q.since) : undefined;

  const { items: rows, nextCursor } = await listItems(c.env.DB, {
    status: q.status,
    categoryId: q.category,
    tagId: q.tag,
    q: q.q,
    since: Number.isFinite(since) ? since : undefined,
    limit,
    cursor: q.cursor,
  });

  return c.json<ListItemsResponse>({ items: rows, nextCursor });
});

items.get('/:id', async (c) => {
  const item = await findItemById(c.env.DB, c.req.param('id'));
  if (!item || item.deletedAt) return c.json(err('NOT_FOUND', 'No such item'), 404);
  return c.json(item);
});

/* ── update ────────────────────────────────────────────────────────────────── */

items.patch('/:id', async (c) => {
  const id = c.req.param('id');

  let body: UpdateItemRequest;
  try {
    body = await c.req.json<UpdateItemRequest>();
  } catch {
    return c.json(err('INVALID_URL', 'Body must be JSON'), 400);
  }

  const fields: Record<string, unknown> = {};
  const now = Date.now();

  // `undefined` means "not sent"; `null` means "clear it". Distinguishing the
  // two is why the wire types never use undefined for a nullable field.
  if ('title' in body) fields.title = body.title === null ? null : capped(body.title, LIMITS.titleLength);
  if ('note' in body) fields.note = body.note === null ? null : capped(body.note, LIMITS.noteLength);
  if ('categoryId' in body) fields.category_id = body.categoryId ?? null;
  if ('priceAmount' in body) fields.price_amount = body.priceAmount ?? null;
  if ('priceCurrency' in body) fields.price_currency = body.priceCurrency ?? null;

  if (body.priority !== undefined) {
    if (!ITEM_PRIORITIES.includes(body.priority)) {
      return c.json(err('INVALID_URL', 'priority must be 0, 1 or 2'), 400);
    }
    fields.priority = body.priority;
  }

  if (body.status !== undefined) {
    if (!ITEM_STATUSES.includes(body.status)) {
      return c.json(err('INVALID_URL', `status must be one of ${ITEM_STATUSES.join(', ')}`), 400);
    }
    fields.status = body.status;
    // decided_at is what the decision-rate metric counts. Set it when the item
    // leaves the shelf, clear it if the decision is undone. Spec: 01-PRD.md §8 M2
    fields.decided_at = body.status === 'bought' || body.status === 'dropped' ? now : null;
  }

  const changed = await updateItem(c.env.DB, id, fields, now);
  if (!changed && Object.keys(fields).length > 0) {
    return c.json(err('NOT_FOUND', 'No such item'), 404);
  }

  if (body.tagIds !== undefined) {
    const item = await findItemById(c.env.DB, id);
    if (!item || item.deletedAt) return c.json(err('NOT_FOUND', 'No such item'), 404);
    await replaceItemTags(c.env.DB, id, body.tagIds);
    await updateItem(c.env.DB, id, {}, now);
  }

  const item = await findItemById(c.env.DB, id);
  if (!item || item.deletedAt) return c.json(err('NOT_FOUND', 'No such item'), 404);
  return c.json(item);
});

/* ── force a re-fetch ──────────────────────────────────────────────────────── */

/**
 * POST /v1/items/:id/enrich — try the ladder again on demand.
 *
 * The one place enrichment is awaited rather than backgrounded: the caller asked
 * for it explicitly and wants to see the result, so a slow answer is expected
 * here in a way it never is on a save.
 */
items.post('/:id/enrich', async (c) => {
  const id = c.req.param('id');
  const item = await findItemById(c.env.DB, id);
  if (!item || item.deletedAt) return c.json(err('NOT_FOUND', 'No such item'), 404);

  if (item.url.startsWith('stash:manual/')) {
    return c.json(err('INVALID_URL', 'A manual item has no page to fetch'), 400);
  }

  // item.url, not item.canonicalUrl — see the note in the create handler.
  await enrichItem(c.env, id, item.url).catch(() => {});
  const updated = await findItemById(c.env.DB, id);
  return c.json(updated);
});

/* ── delete ────────────────────────────────────────────────────────────────── */

items.delete('/:id', async (c) => {
  const ok = await softDeleteItem(c.env.DB, c.req.param('id'), Date.now());
  if (!ok) return c.json(err('NOT_FOUND', 'No such item'), 404);
  return c.body(null, 204);
});
