/**
 * Local writes. Every one of them lands here before the network hears about it.
 *
 * Spec: 03-ARCHITECTURE.md §2, §7 · 01-PRD.md F1.4, F1.5, F10
 *
 * Each mutation does two things in one transaction: change the row, and queue
 * the change for pushing. One transaction, because a crash between the two
 * leaves either an item the server never learns about or a push for a row that
 * does not exist — and the first of those is a save the user believes happened
 * and which silently did not.
 */

import { canonicalise, urlHash } from '../../../shared/canonicalise';
import { db, type LocalItem } from './db';
import type { Item, ItemSource, OutboxEntry, UpdateItemRequest } from '../../../shared/types';

/** Retry schedule from 03-ARCHITECTURE.md §6.1: 1s, 2s, 4s, 8s, 30s, then every 5 min. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000, 300_000];

export function nextAttemptDelay(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
}

function queued(kind: OutboxEntry['kind'], itemId: string, payload: unknown): OutboxEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    kind,
    itemId,
    payload,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
  };
}

export interface SaveInput {
  url?: string;
  title?: string;
  note?: string;
  source: ItemSource;
  manual?: boolean;
  imageKey?: string;
}

export interface SaveResult {
  item: LocalItem;
  /** True when this URL was already on the shelf. Spec: 01-PRD.md F1.5 */
  duplicate: boolean;
}

/**
 * Save something.
 *
 * Returns as soon as the row is in IndexedDB. Nothing here touches the network,
 * and nothing here can fail in a way the user should see: a bad URL is the only
 * rejection, and even that only when there is no title to fall back on.
 */
export async function saveLocal(input: SaveInput): Promise<SaveResult> {
  const now = Date.now();
  const id = crypto.randomUUID();

  const manual = input.manual === true || !input.url;
  if (manual && !input.title?.trim()) {
    throw new Error('A manual item needs a title');
  }

  const raw = input.url?.trim() ?? `stash:manual/${id}`;
  let canonical: string;
  if (manual && raw.startsWith('stash:manual/')) {
    canonical = raw;
  } else {
    // A URL that cannot be parsed is the one thing worth refusing, because
    // there is nothing to save and nothing to enrich later.
    canonical = canonicalise(raw);
  }
  const hash = await urlHash(canonical);

  // Saving something already on the shelf surfaces it rather than making a
  // second row. The check runs locally so it works with no signal, which is
  // where duplicates are most likely — you cannot see the shelf to check.
  const existing = await db.items.where('urlHash').equals(hash).first();
  if (existing && !existing.deletedAt) {
    return { item: existing, duplicate: true };
  }

  let site: string | null = null;
  try { site = new URL(canonical).hostname || null; } catch { site = null; }

  const item: LocalItem = {
    id,
    url: raw,
    canonicalUrl: canonical,
    urlHash: hash,
    title: input.title?.trim().slice(0, 500) ?? null,
    description: null,
    note: input.note?.trim().slice(0, 2000) || null,
    imageKey: input.imageKey ?? null,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    imageBytes: null,
    priceAmount: null,
    priceCurrency: null,
    site,
    siteName: null,
    source: input.source,
    categoryId: null,
    tagIds: [],
    status: 'open',
    priority: 0,
    enrichment: manual ? 'manual' : 'pending',
    enrichAttempts: 0,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    decidedAt: null,
    deletedAt: null,
    pending: 1,
  };

  await db.transaction('rw', db.items, db.outbox, async () => {
    await db.items.put(item);
    await db.outbox.put(queued('create', id, {
      id,
      url: manual ? undefined : raw,
      manual: manual || undefined,
      title: item.title ?? undefined,
      note: item.note ?? undefined,
      source: item.source,
      imageKey: item.imageKey ?? undefined,
      createdAt: now,
    }));
  });

  return { item, duplicate: false };
}

/** Change an item. The row updates immediately; the push is queued. */
export async function updateLocal(id: string, patch: UpdateItemRequest): Promise<LocalItem | null> {
  const now = Date.now();

  return db.transaction('rw', db.items, db.outbox, async () => {
    const current = await db.items.get(id);
    if (!current || current.deletedAt) return null;

    const next: LocalItem = { ...current, ...patch, updatedAt: now, pending: 1 };

    // decidedAt is what the decision-rate metric counts, and it has to be right
    // locally too — the metric is computed from the client's own data, with no
    // third-party analytics (01-PRD.md §8).
    if (patch.status !== undefined) {
      next.decidedAt = patch.status === 'bought' || patch.status === 'dropped' ? now : null;
    }

    await db.items.put(next);
    await db.outbox.put(queued('update', id, patch));
    return next;
  });
}

/**
 * Delete an item.
 *
 * Soft, here as on the server: the row keeps a `deletedAt` so the deletion can
 * be pushed and so an undo has something to restore. Hard-deleting locally would
 * also mean the next sync pulls the row straight back from the server.
 */
export async function deleteLocal(id: string): Promise<boolean> {
  const now = Date.now();

  return db.transaction('rw', db.items, db.outbox, async () => {
    const current = await db.items.get(id);
    if (!current || current.deletedAt) return false;

    await db.items.put({ ...current, deletedAt: now, updatedAt: now, pending: 1 });
    await db.outbox.put(queued('delete', id, null));
    return true;
  });
}

/** Undo a delete within the undo window. Spec: 04-DESIGN-SYSTEM.md §7.2 */
export async function restoreLocal(id: string): Promise<boolean> {
  const now = Date.now();

  return db.transaction('rw', db.items, db.outbox, async () => {
    const current = await db.items.get(id);
    if (!current?.deletedAt) return false;

    await db.items.put({ ...current, deletedAt: null, updatedAt: now, pending: 1 });
    await db.outbox.put(queued('update', id, { status: current.status }));
    return true;
  });
}

/** Rows the server has since confirmed, written back without queueing a push. */
export async function applyFromServer(items: Item[]): Promise<void> {
  await db.transaction('rw', db.items, db.outbox, async () => {
    for (const item of items) {
      // A row with a queued local change is not overwritten. The user's
      // unsynced edit is newer than anything the server can be telling us, and
      // losing it would be a silent data loss they never asked for.
      const waiting = await db.outbox.where('itemId').equals(item.id).count();
      if (waiting > 0) continue;

      if (item.deletedAt) await db.items.delete(item.id);
      else await db.items.put({ ...item, pending: 0 });
    }
  });
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export interface ShelfQuery {
  status?: Item['status'];
  /** Bought and dropped items, instead of the shelf. Spec: 01-PRD.md F7.3 */
  decided?: boolean;
  categoryId?: string;
  search?: string;
}

/** Still being thought about. Everything else has had its decision made. */
const UNDECIDED: Item['status'][] = ['open', 'shortlist'];

/**
 * The shelf: live rows, newest first.
 *
 * Spec: 01-PRD.md F5.2, F7.3
 *
 * Bought and dropped items are not on it. They are kept, findable and
 * restorable, but they are gone from the main view — 01-PRD.md principle 2 is
 * that the shelf must stay finite, and "every feature is judged on whether it
 * helps items leave". A shelf that keeps what has already been decided is a
 * shelf that only ever grows, which is the failure this product exists to fix
 * (R1, the one risk rated fatal).
 */
export async function listLocal(query: ShelfQuery = {}): Promise<LocalItem[]> {
  let rows = await db.items.orderBy('createdAt').reverse().toArray();
  rows = rows.filter((r) => !r.deletedAt);

  if (query.status) rows = rows.filter((r) => r.status === query.status);
  else if (query.decided) rows = rows.filter((r) => !UNDECIDED.includes(r.status));
  else rows = rows.filter((r) => UNDECIDED.includes(r.status));
  if (query.categoryId) rows = rows.filter((r) => r.categoryId === query.categoryId);

  if (query.search?.trim()) {
    // Title, note and site together, no search mode selector, no syntax —
    // 01-PRD.md F6.1. Local, so it answers instantly and works offline.
    const needle = query.search.trim().toLowerCase();
    rows = rows.filter((r) =>
      (r.title ?? '').toLowerCase().includes(needle) ||
      (r.note ?? '').toLowerCase().includes(needle) ||
      (r.site ?? '').toLowerCase().includes(needle));
  }

  return rows;
}

export async function getLocal(id: string): Promise<LocalItem | undefined> {
  const row = await db.items.get(id);
  return row?.deletedAt ? undefined : row;
}

/** How many changes are still waiting to reach the server. */
export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}
