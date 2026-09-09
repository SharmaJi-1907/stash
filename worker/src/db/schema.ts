/**
 * The one place the database's snake_case meets the API's camelCase.
 *
 * Spec: 02-TRD.md §4 (tables) and §5 (wire shapes)
 * CLAUDE.md: "the mapping lives in worker/src/db/schema.ts and nowhere else."
 *
 * Every row that leaves D1 passes through here, so a column rename is a change
 * in exactly two files — the migration and this one.
 */

import type { Category, Item, ItemPriority, ItemSource, ItemStatus, EnrichmentState, Tag }
  from '../../../shared/types';

/** A row of `items` exactly as D1 returns it. */
export interface ItemRow {
  id: string;
  url: string;
  canonical_url: string;
  url_hash: string;
  title: string | null;
  description: string | null;
  note: string | null;
  image_key: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  image_bytes: number | null;
  price_amount: number | null;
  price_currency: string | null;
  site: string | null;
  site_name: string | null;
  source: string;
  category_id: string | null;
  status: string;
  priority: number;
  enrichment: string;
  enrich_attempts: number;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  decided_at: number | null;
  deleted_at: number | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  is_system: number;
  created_at: number;
  updated_at: number;
}

export interface TagRow {
  id: string;
  name: string;
  created_at: number;
}

/**
 * D1 hands back whatever SQLite stored. These narrow the strings back to the
 * unions declared in shared/types.ts, falling back rather than throwing — a row
 * with an unexpected status should still render, not break the shelf.
 */
const asStatus = (v: string): ItemStatus =>
  v === 'shortlist' || v === 'bought' || v === 'dropped' ? v : 'open';

const asSource = (v: string): ItemSource =>
  v === 'extension' || v === 'share' || v === 'paste' ? v : 'manual';

const asEnrichment = (v: string): EnrichmentState =>
  v === 'rich' || v === 'partial' || v === 'manual' || v === 'failed' ? v : 'pending';

const asPriority = (v: number): ItemPriority => (v === 1 || v === 2 ? v : 0);

/** A row plus the tag ids joined in. Tags ride with the item so one sync
 *  payload carries the relation with the thing it belongs to. */
export function rowToItem(row: ItemRow, tagIds: string[] = []): Item {
  return {
    id: row.id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    urlHash: row.url_hash,
    title: row.title,
    description: row.description,
    note: row.note,
    imageKey: row.image_key,
    imageUrl: row.image_url,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageBytes: row.image_bytes,
    priceAmount: row.price_amount,
    priceCurrency: row.price_currency,
    site: row.site,
    siteName: row.site_name,
    source: asSource(row.source),
    categoryId: row.category_id,
    tagIds,
    status: asStatus(row.status),
    priority: asPriority(row.priority),
    enrichment: asEnrichment(row.enrichment),
    enrichAttempts: row.enrich_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    decidedAt: row.decided_at,
    deletedAt: row.deleted_at,
  };
}

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    sortOrder: row.sort_order,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}
