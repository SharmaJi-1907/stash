/**
 * Draining the outbox.
 *
 * Spec: 03-ARCHITECTURE.md §6.1, §7, §8 · 05-ROADMAP.md P2 task 13
 *
 * Every local change queued an entry here. This sends them, in order, and puts
 * anything that fails back with a longer wait: 1s, 2s, 4s, 8s, 30s, then every
 * five minutes. The queue lives in IndexedDB, so it survives the app being
 * closed, the phone restarting, and a week without signal.
 *
 * ── Nothing here is allowed to surface an error to the user ─────────────────
 *
 * 03-ARCHITECTURE.md §8 is a table of failures whose every row ends in "no
 * error": network down, 5xx, rate limited, token invalid. The save already
 * succeeded — it is in IndexedDB and on the shelf. What happens afterwards is
 * the app's problem, not the user's, and telling them about a retry that will
 * succeed in four seconds is noise, not information.
 *
 * The one exception is a permanent failure, which is dropped rather than
 * retried forever. Retrying a rejected token every five minutes for a week
 * burns quota and buries the real problem.
 */

import { db } from '../db/db';
import { nextAttemptDelay } from '../db/local';
import { api, NotConfigured, PermanentError } from '../api/client';
import type { CreateItemRequest, OutboxEntry, UpdateItemRequest } from '../../../shared/types';

export interface FlushResult {
  sent: number;
  failed: number;
  dropped: number;
  /** True when something is still queued — because it failed, or is not due yet. */
  remaining: boolean;
}

let running = false;

async function send(entry: OutboxEntry): Promise<void> {
  switch (entry.kind) {
    case 'create': {
      const created = await api.createItem(entry.payload as CreateItemRequest);
      // The server may answer with an item that already existed under this URL.
      // Take its id: two rows for one thing is what dedupe exists to prevent,
      // and the local row has to follow the server's decision.
      const local = await db.items.get(entry.itemId);
      if (local && created.item.id !== local.id) {
        await db.transaction('rw', db.items, db.outbox, async () => {
          await db.items.delete(local.id);
          await db.items.put({ ...created.item, pending: 0 });
          await db.outbox.where('itemId').equals(local.id).modify({ itemId: created.item.id });
        });
      }
      return;
    }
    case 'update':
      await api.updateItem(entry.itemId, entry.payload as UpdateItemRequest);
      return;
    case 'delete':
      await api.deleteItem(entry.itemId);
      return;
    case 'review':
      await api.reviewItem(entry.itemId);
      return;
  }
}

/** Mark the row settled if nothing else is queued for it. */
async function settle(itemId: string): Promise<void> {
  const left = await db.outbox.where('itemId').equals(itemId).count();
  if (left > 0) return;
  const row = await db.items.get(itemId);
  if (row) await db.items.put({ ...row, pending: 0 });
}

/**
 * Send everything that is due.
 *
 * Safe to call as often as you like — a second call while one is running returns
 * immediately rather than sending anything twice.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (running) return { sent: 0, failed: 0, dropped: 0, remaining: true };
  running = true;

  const result: FlushResult = { sent: 0, failed: 0, dropped: 0, remaining: false };

  try {
    const now = Date.now();
    // Oldest first: a create must reach the server before the update that
    // follows it, or the update lands on a row that does not exist yet.
    const due = (await db.outbox.orderBy('nextAttemptAt').toArray())
      .filter((entry) => entry.nextAttemptAt <= now);

    for (const entry of due) {
      try {
        await send(entry);
        await db.outbox.delete(entry.id);
        await settle(entry.itemId);
        result.sent++;
      } catch (error) {
        if (error instanceof NotConfigured) {
          // No address or token yet. Leave the queue exactly as it is: the work
          // is not wrong, the app is not set up. Stop, rather than marking every
          // entry as failed and pushing them all into a long backoff.
          result.remaining = true;
          break;
        }

        if (error instanceof PermanentError) {
          await db.outbox.delete(entry.id);
          await settle(entry.itemId);
          result.dropped++;
          console.warn('[stash] dropped a change the server will never accept:', error.message);
          continue;
        }

        const attempts = entry.attempts + 1;
        await db.outbox.put({
          ...entry,
          attempts,
          nextAttemptAt: Date.now() + nextAttemptDelay(attempts),
          lastError: String((error as Error).message ?? error),
        });
        result.failed++;
      }
    }

    result.remaining = result.remaining || (await db.outbox.count()) > 0;

    // Something is still queued. Ask the browser to wake us when the network is
    // back, so a save made on a train reaches the server without the app being
    // opened again. Not supported everywhere; where it is missing the queue
    // drains on the next open instead, which is the same outcome one step later.
    if (result.remaining) await requestBackgroundSync();
  } finally {
    running = false;
  }

  return result;
}

async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready;
    // `sync` is not in the standard ServiceWorkerRegistration type.
    const sync = (registration as unknown as { sync?: { register(tag: string): Promise<void> } })?.sync;
    await sync?.register('stash-outbox');
  } catch {
    // Unsupported, or permission refused. Neither is worth a word to anyone.
  }
}

/**
 * Flush now, and again whenever the app is likely to be able to.
 *
 * Triggers are from 03-ARCHITECTURE.md §6.2: on open, on focus, after a local
 * write, and every five minutes while foregrounded. Not on a background timer
 * while closed — that would burn quota for no benefit.
 */
export function startOutbox(intervalMs = 300_000): () => void {
  const tick = () => { void flushOutbox(); };

  tick();
  const timer = setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
  window.addEventListener('focus', tick);

  return () => {
    clearInterval(timer);
    window.removeEventListener('online', tick);
    window.removeEventListener('focus', tick);
  };
}
