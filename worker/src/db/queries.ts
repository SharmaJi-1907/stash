/**
 * Prepared statements. Every value is bound, never interpolated — 02-TRD.md §6.
 *
 * Spec: 02-TRD.md §4 · 03-ARCHITECTURE.md §2
 */

import type { Item } from '../../../shared/types';
import {
  rowToItem, rowToCategory, rowToTag,
  type ItemRow, type CategoryRow, type TagRow,
} from './schema';

const ITEM_COLUMNS = `
  id, url, canonical_url, url_hash, title, description, note,
  image_key, image_url, image_width, image_height, image_bytes,
  price_amount, price_currency, site, site_name, source,
  category_id, status, priority, enrichment, enrich_attempts,
  created_at, updated_at, reviewed_at, decided_at, deleted_at
`;

/** Tag ids for a set of items, in one query rather than one per item. */
export async function tagIdsFor(db: D1Database, itemIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (itemIds.length === 0) return map;

  const placeholders = itemIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT item_id, tag_id FROM item_tags WHERE item_id IN (${placeholders})`)
    .bind(...itemIds)
    .all<{ item_id: string; tag_id: string }>();

  for (const row of results) {
    const list = map.get(row.item_id) ?? [];
    list.push(row.tag_id);
    map.set(row.item_id, list);
  }
  return map;
}

async function hydrate(db: D1Database, rows: ItemRow[]): Promise<Item[]> {
  const tags = await tagIdsFor(db, rows.map((r) => r.id));
  return rows.map((r) => rowToItem(r, tags.get(r.id) ?? []));
}

export async function findItemById(db: D1Database, id: string): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`)
    .bind(id)
    .first<ItemRow>();
  if (!row) return null;
  return (await hydrate(db, [row]))[0]!;
}

/**
 * The dedupe lookup. Scoped to live rows: a URL saved, dropped and deleted can
 * be saved again, which is why the unique index carries the same condition.
 * Spec: 01-PRD.md F1.5
 */
export async function findLiveItemByHash(db: D1Database, urlHash: string): Promise<Item | null> {
  const row = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE url_hash = ? AND deleted_at IS NULL`)
    .bind(urlHash)
    .first<ItemRow>();
  if (!row) return null;
  return (await hydrate(db, [row]))[0]!;
}

export interface InsertItemInput {
  id: string;
  url: string;
  canonicalUrl: string;
  urlHash: string;
  title: string | null;
  description: string | null;
  note: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  site: string | null;
  siteName: string | null;
  source: string;
  categoryId: string | null;
  enrichment: string;
  createdAt: number;
  updatedAt: number;
}

export async function insertItem(db: D1Database, input: InsertItemInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO items (
         id, url, canonical_url, url_hash, title, description, note,
         image_key, image_url, price_amount, price_currency,
         site, site_name, source, category_id, enrichment,
         created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      input.id, input.url, input.canonicalUrl, input.urlHash,
      input.title, input.description, input.note,
      input.imageKey, input.imageUrl, input.priceAmount, input.priceCurrency,
      input.site, input.siteName, input.source, input.categoryId, input.enrichment,
      input.createdAt, input.updatedAt,
    )
    .run();
}

export interface ListItemsFilter {
  status?: string;
  categoryId?: string;
  tagId?: string;
  q?: string;
  since?: number;
  limit: number;
  cursor?: string;
}

/**
 * Search is LIKE with lowercase comparison, not FTS5 — adequate at one person's
 * scale and one less thing to maintain (02-TRD.md §4.1). It covers title, note
 * and site, matching 01-PRD.md F6.1.
 */
export async function listItems(
  db: D1Database,
  filter: ListItemsFilter,
): Promise<{ items: Item[]; nextCursor: string | null }> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (filter.since === undefined) where.push('deleted_at IS NULL');
  else { where.push('updated_at > ?'); binds.push(filter.since); }

  if (filter.status) { where.push('status = ?'); binds.push(filter.status); }
  if (filter.categoryId) { where.push('category_id = ?'); binds.push(filter.categoryId); }

  if (filter.tagId) {
    where.push('id IN (SELECT item_id FROM item_tags WHERE tag_id = ?)');
    binds.push(filter.tagId);
  }

  if (filter.q) {
    const needle = `%${filter.q.toLowerCase()}%`;
    where.push(`(
      lower(coalesce(title, '')) LIKE ?
      OR lower(coalesce(note, '')) LIKE ?
      OR lower(coalesce(site, '')) LIKE ?
      OR id IN (SELECT item_id FROM item_tags it
                JOIN tags t ON t.id = it.tag_id
                WHERE lower(t.name) LIKE ?)
    )`);
    binds.push(needle, needle, needle, needle);
  }

  // Keyset pagination on (created_at, id). An offset would drift as new items
  // arrive mid-scroll, which on this shelf means an item silently skipped.
  if (filter.cursor) {
    const [at, id] = filter.cursor.split('|');
    where.push('(created_at < ? OR (created_at = ? AND id < ?))');
    binds.push(Number(at), Number(at), id);
  }

  const sql = `SELECT ${ITEM_COLUMNS} FROM items
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC, id DESC
               LIMIT ?`;

  const { results } = await db.prepare(sql).bind(...binds, filter.limit + 1).all<ItemRow>();

  const hasMore = results.length > filter.limit;
  const page = hasMore ? results.slice(0, filter.limit) : results;
  const last = page[page.length - 1];

  return {
    items: await hydrate(db, page),
    nextCursor: hasMore && last ? `${last.created_at}|${last.id}` : null,
  };
}

/** Partial update. Only the columns present are touched. */
export async function updateItem(
  db: D1Database,
  id: string,
  fields: Record<string, unknown>,
  now: number,
): Promise<boolean> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return true;

  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'];
  const binds = [...keys.map((k) => fields[k]), now, id];

  const { meta } = await db
    .prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`)
    .bind(...binds)
    .run();

  return (meta.changes ?? 0) > 0;
}

/** Soft delete. Rows are never removed — sync needs the tombstone to propagate
 *  the deletion, and a hard delete resurrects the row from a stale client. */
export async function softDeleteItem(db: D1Database, id: string, now: number): Promise<boolean> {
  const { meta } = await db
    .prepare('UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(now, now, id)
    .run();
  return (meta.changes ?? 0) > 0;
}

export async function replaceItemTags(db: D1Database, itemId: string, tagIds: string[]): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM item_tags WHERE item_id = ?').bind(itemId),
  ];
  for (const tagId of tagIds) {
    statements.push(
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').bind(itemId, tagId),
    );
  }
  await db.batch(statements);
}

/* ── sync ──────────────────────────────────────────────────────────────────── */

/**
 * Everything that changed since a timestamp, tombstones included.
 *
 * Spec: 02-TRD.md §5.2 · 03-ARCHITECTURE.md §6.1
 *
 * Ordered by updated_at rather than created_at, because the client resumes from
 * the highest updated_at it received. Ordering by anything else means a row
 * changed during a paged sync can be skipped forever.
 */
export async function itemsChangedSince(
  db: D1Database,
  since: number,
  limit: number,
): Promise<{ items: Item[]; hasMore: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM items
       WHERE updated_at > ?
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(since, limit + 1)
    .all<ItemRow>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  return { items: await hydrate(db, page), hasMore };
}

export async function categoriesChangedSince(db: D1Database, since: number) {
  const { results } = await db
    .prepare('SELECT * FROM categories WHERE updated_at > ? ORDER BY updated_at ASC')
    .bind(since)
    .all<CategoryRow>();
  return results.map(rowToCategory);
}

export async function tagsChangedSince(db: D1Database, since: number) {
  const { results } = await db
    .prepare('SELECT * FROM tags WHERE created_at > ? ORDER BY created_at ASC')
    .bind(since)
    .all<TagRow>();
  return results.map(rowToTag);
}

/* ── export ────────────────────────────────────────────────────────────────── */

/** Every row of a table, for the export. Spec: 01-PRD.md F12 */
export async function allRows<T>(db: D1Database, table: string): Promise<T[]> {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all<T>();
  return results;
}
