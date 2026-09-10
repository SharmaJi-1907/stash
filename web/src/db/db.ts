/**
 * The local replica.
 *
 * Spec: 02-TRD.md §3.3 · 03-ARCHITECTURE.md §6.1, §7 · 05-ROADMAP.md P2 task 5
 *
 * ── This is the source of truth for the UI, not the server ──────────────────
 *
 * Every save writes here first and renders from here. The network is a
 * background concern. That is not an optimisation, it is the product's central
 * promise: five seconds from seeing a thing to it being on the shelf, measured
 * from the first tap (01-PRD.md M1), and a save that works on a train with no
 * signal (F10).
 *
 * If a screen ever awaits the network before showing a card, that promise is
 * gone — 06-AGENT-BUILD-GUIDE.md §1.2 names this the one rule to remember if
 * you remember one.
 */

import Dexie, { type Table } from 'dexie';
import type { Item, OutboxEntry } from '../../../shared/types';

/**
 * An item as it is held locally.
 *
 * `pending` is local only and never sent. It is a number rather than a boolean
 * because IndexedDB cannot index booleans, and the shelf needs to find unsynced
 * rows cheaply to mark them.
 */
export interface LocalItem extends Item {
  pending: 0 | 1;
}

/** Small key/value store for things that are not rows: last sync mark, settings. */
export interface Meta {
  key: string;
  value: unknown;
}

class StashDb extends Dexie {
  items!: Table<LocalItem, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('stash');

    // Indexes are chosen for the queries the shelf actually runs: newest first,
    // filter by status or category, find by URL for dedupe, and find rows still
    // waiting to be pushed.
    //
    // `deletedAt` is deliberately not indexed. Tombstones are filtered in
    // memory, because a sparse index in IndexedDB skips rows where the key is
    // undefined — which is every live row, exactly the ones the shelf wants.
    this.version(1).stores({
      items:  'id, createdAt, updatedAt, status, categoryId, urlHash, pending, *tagIds',
      outbox: 'id, nextAttemptAt, itemId',
      meta:   'key',
    });
  }
}

export const db = new StashDb();

/* ── meta helpers ──────────────────────────────────────────────────────────── */

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** The timestamp the next delta sync resumes from. Spec: 03-ARCHITECTURE.md §6.1 */
export const LAST_SYNC = 'lastSyncAt';
