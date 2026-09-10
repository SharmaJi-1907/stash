/**
 * GET /v1/export — every row, as JSON.
 *
 * Spec: 01-PRD.md F12 · 02-TRD.md §5
 *
 * Principle 4 is "yours, offline, exportable — no lock-in, including no lock-in
 * to Stash." This is that promise kept in one route: everything the system knows,
 * in a form that can be read without it.
 *
 * Tombstones are included. An export that silently dropped deleted rows would
 * not round-trip, and F12's acceptance is that a re-import produces an identical
 * shelf.
 */

import { Hono } from 'hono';
import type { Env } from '../env';
import { allRows } from '../db/queries';
import { rowToItem, rowToCategory, rowToTag, type ItemRow, type CategoryRow, type TagRow }
  from '../db/schema';
import type { ClassifyRule, ExportResponse, PriceSnapshot, Setting } from '../../../shared/types';

export const exportRoute = new Hono<{ Bindings: Env }>();

exportRoute.get('/', async (c) => {
  const db = c.env.DB;

  const [items, categories, tags, itemTags, rules, snapshots, settings] = await Promise.all([
    allRows<ItemRow>(db, 'items'),
    allRows<CategoryRow>(db, 'categories'),
    allRows<TagRow>(db, 'tags'),
    allRows<{ item_id: string; tag_id: string }>(db, 'item_tags'),
    allRows<Record<string, unknown>>(db, 'classify_rules'),
    allRows<Record<string, unknown>>(db, 'price_snapshots'),
    allRows<Record<string, unknown>>(db, 'settings'),
  ]);

  const tagsByItem = new Map<string, string[]>();
  for (const row of itemTags) {
    const list = tagsByItem.get(row.item_id) ?? [];
    list.push(row.tag_id);
    tagsByItem.set(row.item_id, list);
  }

  const body: ExportResponse = {
    exportedAt: Date.now(),
    version: 1,
    items: items.map((row) => rowToItem(row, tagsByItem.get(row.id) ?? [])),
    categories: categories.map(rowToCategory),
    tags: tags.map(rowToTag),
    classifyRules: rules as unknown as ClassifyRule[],
    priceSnapshots: snapshots as unknown as PriceSnapshot[],
    settings: settings as unknown as Setting[],
  };

  return c.json(body, 200, {
    // A browser hitting this should get a file, not a wall of text.
    'content-disposition': `attachment; filename="stash-export-${new Date().toISOString().slice(0, 10)}.json"`,
  });
});
