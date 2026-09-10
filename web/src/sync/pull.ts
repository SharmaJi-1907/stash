/**
 * Pulling changes down from the server.
 *
 * Spec: 03-ARCHITECTURE.md §6 · 05-ROADMAP.md P2 task 12
 *
 * The server is authoritative and the client holds a full replica. This asks for
 * everything changed since the last mark, writes it in, and stores the new mark.
 *
 * ── The mark comes from the server, and only moves on a complete page ───────
 *
 * `now` in the response is the server's own clock. Using the client's would mean
 * two devices whose clocks differ by a few minutes each skip or repeat a window
 * of changes — and skipped is the bad half: those rows would never be asked for
 * again.
 *
 * When a page is truncated the server reports the highest `updatedAt` it
 * actually sent rather than the current time, so resuming from it cannot step
 * over the rows that did not fit.
 */

import { api, NotConfigured } from '../api/client';
import { applyFromServer } from '../db/local';
import { getMeta, setMeta, LAST_SYNC } from '../db/db';
import { flushOutbox } from './outbox';

export interface PullResult {
  pulled: number;
  rounds: number;
  /** Null when there was nothing to do — not configured, or offline. */
  syncedAt: number | null;
}

let running = false;

/**
 * Fetch everything that changed, in as many rounds as it takes.
 *
 * Pushing happens first. A local change that has not reached the server yet
 * would otherwise be pulled back over by the older server copy — the outbox
 * guards against that too, but sending first means the guard rarely has to fire
 * and the shelf settles in one pass rather than two.
 */
export async function pull(maxRounds = 20): Promise<PullResult> {
  if (running) return { pulled: 0, rounds: 0, syncedAt: null };
  running = true;

  const result: PullResult = { pulled: 0, rounds: 0, syncedAt: null };

  try {
    await flushOutbox();

    let since = await getMeta<number>(LAST_SYNC, 0);

    for (let round = 0; round < maxRounds; round++) {
      const page = await api.sync(since);
      result.rounds++;

      await applyFromServer(page.items);
      result.pulled += page.items.length;

      since = page.now;
      await setMeta(LAST_SYNC, since);

      if (!page.hasMore) break;
    }

    result.syncedAt = since;
  } catch (error) {
    // Offline, or not set up yet. Neither is worth telling anyone about: the
    // shelf is rendered from the local replica and is completely usable.
    // 03-ARCHITECTURE.md §8 — degrade, never block.
    if (!(error instanceof NotConfigured)) {
      console.warn('[stash] sync could not finish:', (error as Error).message);
    }
  } finally {
    running = false;
  }

  return result;
}

/**
 * Sync on the occasions worth syncing on.
 *
 * 03-ARCHITECTURE.md §6.2: on open, on window focus, after a local write, and
 * every five minutes while the app is in front. Deliberately not on a timer
 * while the app is closed — that burns quota for nothing.
 */
export function startSync(intervalMs = 300_000): () => void {
  const tick = () => { void pull(); };

  tick();
  const timer = setInterval(() => {
    // Only while the app is actually being looked at.
    if (document.visibilityState === 'visible') tick();
  }, intervalMs);

  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
  addEventListener('focus', tick);
  addEventListener('online', tick);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(timer);
    removeEventListener('focus', tick);
    removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
