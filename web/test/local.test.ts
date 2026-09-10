import { describe, it, expect, vi } from 'vitest';
import { db } from '../src/db/db';
import {
  saveLocal, updateLocal, deleteLocal, restoreLocal,
  listLocal, getLocal, pendingCount, applyFromServer, nextAttemptDelay, BACKOFF_MS,
} from '../src/db/local';
import type { Item } from '../../shared/types';

describe('a save lands locally and does not wait for anything', () => {
  it('returns a complete row', async () => {
    const { item, duplicate } = await saveLocal({
      url: 'https://www.amazon.in/dp/B0ABC?ref=sr_1_3', source: 'share', note: 'for the desk',
    });
    expect(duplicate).toBe(false);
    expect(item.canonicalUrl).toBe('https://amazon.in/dp/B0ABC');
    expect(item.url).toBe('https://www.amazon.in/dp/B0ABC?ref=sr_1_3');  // as given
    expect(item.site).toBe('amazon.in');
    expect(item.status).toBe('open');
    expect(item.enrichment).toBe('pending');
    expect(item.pending).toBe(1);
    expect(item.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('touches the network not at all', async () => {
    // The whole promise in one assertion. If a save ever awaits fetch, the
    // five-second budget is gone and so is saving on a train.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await saveLocal({ url: 'https://example.com/offline', source: 'paste' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is on the shelf immediately afterwards', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/now', source: 'paste' });
    const shelf = await listLocal();
    expect(shelf.map((i) => i.id)).toContain(item.id);
  });

  it('queues exactly one push', async () => {
    await saveLocal({ url: 'https://example.com/queued', source: 'paste' });
    const queue = await db.outbox.toArray();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.kind).toBe('create');
  });

  it('the row and its push are written together or not at all', async () => {
    // One transaction. A crash between them would leave a save the user believes
    // happened and which the server never hears about.
    await saveLocal({ url: 'https://example.com/atomic', source: 'paste' });
    const items = await db.items.count();
    const queued = await db.outbox.count();
    expect(items).toBe(1);
    expect(queued).toBe(1);
  });

  it('generates an id without asking the server', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/id', source: 'paste' });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('saving the same thing twice', () => {
  it('surfaces the row already there instead of making a second', async () => {
    const first = await saveLocal({ url: 'https://amazon.in/dp/B0SAME', source: 'paste', note: 'keep me' });
    const second = await saveLocal({
      url: 'https://www.amazon.in/Long-Product-Name/dp/B0SAME/ref=sr_1_3?th=1', source: 'extension',
    });
    expect(second.duplicate).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.note).toBe('keep me');
    expect(await db.items.count()).toBe(1);
  });

  it('works with no signal, which is when it matters most', async () => {
    // Dedupe on the client is not a nicety. Offline you cannot look at the shelf
    // to check, so the same link gets saved twice, and without this both rows
    // survive until a sync quietly merges them.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await saveLocal({ url: 'https://youtu.be/dQw4w9WgXcQ', source: 'share' });
    const again = await saveLocal({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', source: 'paste' });
    expect(again.duplicate).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a deleted row does not block saving the URL again', async () => {
    const first = await saveLocal({ url: 'https://example.com/again', source: 'paste' });
    await deleteLocal(first.item.id);
    const second = await saveLocal({ url: 'https://example.com/again', source: 'paste' });
    expect(second.duplicate).toBe(false);
  });

  it('different things stay different', async () => {
    await saveLocal({ url: 'https://amazon.in/dp/B0AAA', source: 'paste' });
    const other = await saveLocal({ url: 'https://amazon.in/dp/B0BBB', source: 'paste' });
    expect(other.duplicate).toBe(false);
    expect(await db.items.count()).toBe(2);
  });
});

describe('items with no URL', () => {
  it('a manual item saves with just a title', async () => {
    const { item } = await saveLocal({ manual: true, title: 'Lamp from a reel', source: 'manual' });
    expect(item.enrichment).toBe('manual');
    expect(item.title).toBe('Lamp from a reel');
  });

  it('two manual items do not collide', async () => {
    await saveLocal({ manual: true, title: 'One', source: 'manual' });
    const b = await saveLocal({ manual: true, title: 'Two', source: 'manual' });
    expect(b.duplicate).toBe(false);
  });

  it('a manual item with no title is refused, since nothing would identify it', async () => {
    await expect(saveLocal({ manual: true, source: 'manual' })).rejects.toThrow();
  });

  it('a URL that is not a URL is refused', async () => {
    await expect(saveLocal({ url: 'not a url', source: 'paste' })).rejects.toThrow();
  });
});

describe('changing an item', () => {
  it('updates the row and queues the change', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/edit', source: 'paste' });
    await db.outbox.clear();

    const updated = await updateLocal(item.id, { note: 'changed' });
    expect(updated!.note).toBe('changed');
    expect(updated!.pending).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('records decidedAt when the item leaves the shelf, and clears it on undo', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/decide', source: 'paste' });
    const bought = await updateLocal(item.id, { status: 'bought' });
    expect(bought!.decidedAt).toBeGreaterThan(0);
    const undone = await updateLocal(item.id, { status: 'open' });
    expect(undone!.decidedAt).toBeNull();
  });

  it('editing a note leaves reviewedAt alone', async () => {
    // Only an explicit "still want this" resets the staleness clock, or every
    // edit would quietly tell the shelf the item is fresh.
    const { item } = await saveLocal({ url: 'https://example.com/clock', source: 'paste' });
    const after = await updateLocal(item.id, { note: 'typing' });
    expect(after!.reviewedAt).toBeNull();
  });

  it('updating something that does not exist returns null rather than throwing', async () => {
    expect(await updateLocal('nope', { note: 'x' })).toBeNull();
  });
});

describe('deleting is soft, and undoable', () => {
  it('leaves a tombstone rather than removing the row', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/soft', source: 'paste' });
    expect(await deleteLocal(item.id)).toBe(true);

    const row = await db.items.get(item.id);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeGreaterThan(0);
    expect(await getLocal(item.id)).toBeUndefined();
    expect(await listLocal()).toHaveLength(0);
  });

  it('restores within the undo window', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/undo', source: 'paste' });
    await deleteLocal(item.id);
    expect(await restoreLocal(item.id)).toBe(true);
    expect(await listLocal()).toHaveLength(1);
  });

  it('deleting twice is not an error the second time', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/twice', source: 'paste' });
    expect(await deleteLocal(item.id)).toBe(true);
    expect(await deleteLocal(item.id)).toBe(false);
  });
});

describe('reading the shelf', () => {
  it('is newest first', async () => {
    for (const n of [1, 2, 3]) {
      await saveLocal({ url: `https://example.com/p${n}`, source: 'paste' });
      await new Promise((r) => setTimeout(r, 2));
    }
    const shelf = await listLocal();
    expect(shelf[0]!.url).toBe('https://example.com/p3');
    expect(shelf[2]!.url).toBe('https://example.com/p1');
  });

  it('searches title, note and site at once', async () => {
    const a = await saveLocal({ url: 'https://amazon.in/dp/B0KB', source: 'paste' });
    await updateLocal(a.item.id, { title: 'Keychron keyboard' });
    await saveLocal({ url: 'https://pepperfry.com/riser', source: 'paste', note: 'for the desk' });

    expect(await listLocal({ search: 'keychron' })).toHaveLength(1);
    expect(await listLocal({ search: 'desk' })).toHaveLength(1);
    expect(await listLocal({ search: 'pepperfry' })).toHaveLength(1);
    expect(await listLocal({ search: 'zzzz' })).toHaveLength(0);
  });

  it('filters by status', async () => {
    const a = await saveLocal({ url: 'https://example.com/s1', source: 'paste' });
    await saveLocal({ url: 'https://example.com/s2', source: 'paste' });
    await updateLocal(a.item.id, { status: 'bought' });

    expect(await listLocal({ status: 'bought' })).toHaveLength(1);
    expect(await listLocal({ status: 'open' })).toHaveLength(1);
  });
});

describe('rows coming back from the server', () => {
  const serverItem = (id: string, extra: Partial<Item> = {}): Item => ({
    id, url: `https://example.com/${id}`, canonicalUrl: `https://example.com/${id}`,
    urlHash: `hash-${id}`, title: 'From the server', description: null, note: null,
    imageKey: null, imageUrl: null, imageWidth: null, imageHeight: null, imageBytes: null,
    priceAmount: null, priceCurrency: null, site: 'example.com', siteName: null,
    source: 'paste', categoryId: null, tagIds: [], status: 'open', priority: 0,
    enrichment: 'rich', enrichAttempts: 1, createdAt: 1000, updatedAt: 2000,
    reviewedAt: null, decidedAt: null, deletedAt: null, ...extra,
  });

  it('are written in and marked settled', async () => {
    await applyFromServer([serverItem('a')]);
    const row = await db.items.get('a');
    expect(row!.title).toBe('From the server');
    expect(row!.pending).toBe(0);
  });

  it('a tombstone removes the local row', async () => {
    await applyFromServer([serverItem('b')]);
    await applyFromServer([serverItem('b', { deletedAt: 3000 })]);
    expect(await db.items.get('b')).toBeUndefined();
  });

  it('never overwrite a change that has not been pushed yet', async () => {
    // The user's unsynced edit is newer than anything the server can be telling
    // us. Overwriting it is silent data loss they never asked for.
    const { item } = await saveLocal({ url: 'https://example.com/mine', source: 'paste' });
    await updateLocal(item.id, { note: 'my unsynced note' });

    await applyFromServer([serverItem(item.id, { note: 'stale server note' })]);

    const row = await db.items.get(item.id);
    expect(row!.note).toBe('my unsynced note');
  });
});

describe('the retry schedule', () => {
  it('follows 1s, 2s, 4s, 8s, 30s, then every five minutes', () => {
    expect(BACKOFF_MS).toEqual([1_000, 2_000, 4_000, 8_000, 30_000, 300_000]);
    expect(nextAttemptDelay(0)).toBe(1_000);
    expect(nextAttemptDelay(4)).toBe(30_000);
    expect(nextAttemptDelay(5)).toBe(300_000);
  });

  it('stops growing rather than backing off forever', () => {
    expect(nextAttemptDelay(50)).toBe(300_000);
  });
});

describe('how much is waiting', () => {
  it('counts what has not reached the server', async () => {
    expect(await pendingCount()).toBe(0);
    await saveLocal({ url: 'https://example.com/x', source: 'paste' });
    await saveLocal({ url: 'https://example.com/y', source: 'paste' });
    expect(await pendingCount()).toBe(2);
  });
});

describe('a decision takes the item off the shelf', () => {
  /**
   * 01-PRD.md F7.3, and principle 2 behind it: the shelf must stay finite, and
   * every feature is judged on whether it helps items leave. A shelf that keeps
   * what has already been decided only ever grows — which is R1, the one risk
   * the document rates fatal.
   */
  it('bought is gone from the shelf but not from the database', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/bought', source: 'paste' });
    expect(await listLocal()).toHaveLength(1);

    await updateLocal(item.id, { status: 'bought' });
    expect(await listLocal()).toHaveLength(0);

    // Kept, and findable.
    expect(await listLocal({ decided: true })).toHaveLength(1);
    expect(await db.items.get(item.id)).toBeDefined();
  });

  it('dropped is the same', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/dropped', source: 'paste' });
    await updateLocal(item.id, { status: 'dropped' });
    expect(await listLocal()).toHaveLength(0);
    expect(await listLocal({ decided: true })).toHaveLength(1);
  });

  it('shortlist stays on the shelf — it is not a decision', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/short', source: 'paste' });
    await updateLocal(item.id, { status: 'shortlist' });
    expect(await listLocal()).toHaveLength(1);
  });

  it('a decision can be undone and the item comes back', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/undo', source: 'paste' });
    await updateLocal(item.id, { status: 'bought' });
    expect(await listLocal()).toHaveLength(0);

    await updateLocal(item.id, { status: 'open' });
    expect(await listLocal()).toHaveLength(1);
  });

  it('asking for one status still works exactly', async () => {
    const a = await saveLocal({ url: 'https://example.com/a', source: 'paste' });
    const b = await saveLocal({ url: 'https://example.com/b', source: 'paste' });
    await updateLocal(a.item.id, { status: 'bought' });
    await updateLocal(b.item.id, { status: 'dropped' });

    expect(await listLocal({ status: 'bought' })).toHaveLength(1);
    expect(await listLocal({ status: 'dropped' })).toHaveLength(1);
    expect(await listLocal({ decided: true })).toHaveLength(2);
    expect(await listLocal()).toHaveLength(0);
  });

  it('a deleted item is off both lists', async () => {
    const { item } = await saveLocal({ url: 'https://example.com/gone', source: 'paste' });
    await updateLocal(item.id, { status: 'bought' });
    await deleteLocal(item.id);
    expect(await listLocal()).toHaveLength(0);
    expect(await listLocal({ decided: true })).toHaveLength(0);
  });
});
