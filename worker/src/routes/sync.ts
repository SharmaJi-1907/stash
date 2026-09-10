/**
 * GET /v1/sync?since=<ms> — everything that changed since a timestamp.
 *
 * Spec: 02-TRD.md §5.2 · 03-ARCHITECTURE.md §6
 *
 * The server is authoritative and clients hold a full local replica, so this is
 * the only route that matters for keeping a phone and a laptop showing the same
 * shelf. It answers with rows changed since `since`, plus the server's own clock
 * for the client to store as its next `since`.
 *
 * Tombstones are included deliberately. A deleted row still comes back, with a
 * `deletedAt`, and the client removes it locally. Sending only live rows would
 * leave a deletion invisible to every other device forever — which is why
 * deletes are soft in the first place (02-TRD.md §4.1).
 *
 * `now` comes from the server, never from the client. Two devices with clocks a
 * few minutes apart would otherwise each skip or repeat a window of changes.
 */

import { Hono } from 'hono';
import type { Env } from '../env';
import { itemsChangedSince, categoriesChangedSince, tagsChangedSince } from '../db/queries';
import { LIMITS } from '../../../shared/types';
import type { SyncResponse } from '../../../shared/types';

export const sync = new Hono<{ Bindings: Env }>();

sync.get('/', async (c) => {
  const raw = Number(c.req.query('since'));
  // A missing or nonsensical `since` means a first sync: send everything.
  const since = Number.isFinite(raw) && raw >= 0 ? raw : 0;

  // The clock is read before the queries, not after. Reading it afterwards would
  // hand back a timestamp covering rows written during the query itself, and
  // those rows would never be sent again.
  const now = Date.now();

  const { items, hasMore } = await itemsChangedSince(c.env.DB, since, LIMITS.syncPageSize);
  const [categories, tags] = await Promise.all([
    categoriesChangedSince(c.env.DB, since),
    tagsChangedSince(c.env.DB, since),
  ]);

  // When the page was truncated the client must resume from the highest
  // updated_at it actually received, not from `now` — otherwise everything after
  // the cut is skipped. Reporting `now` only on a complete page makes that
  // impossible to get wrong from the client side.
  const highest = items.length ? Math.max(...items.map((i) => i.updatedAt)) : since;

  return c.json<SyncResponse>({
    now: hasMore ? highest : now,
    items,
    categories,
    tags,
    hasMore,
  });
});
