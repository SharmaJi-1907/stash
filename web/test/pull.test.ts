import { describe, it, expect, vi } from 'vitest';
import { db, getMeta, LAST_SYNC } from '../src/db/db';
import { saveLocal, listLocal, updateLocal } from '../src/db/local';
import { pull } from '../src/sync/pull';
import { saveSettings } from '../src/api/client';
import type { Item } from '../../shared/types';

const configure = () => saveSettings({ apiBase: 'https://api.test/v1', deviceToken: 'tok' });

const serverItem = (id: string, extra: Partial<Item> = {}): Item => ({
  id, url: `https://example.com/${id}`, canonicalUrl: `https://example.com/${id}`,
  urlHash: `hash-${id}`, title: `Item ${id}`, description: null, note: null,
  imageKey: null, imageUrl: null, imageWidth: null, imageHeight: null, imageBytes: null,
  priceAmount: null, priceCurrency: null, site: 'example.com', siteName: null,
  source: 'paste', categoryId: null, tagIds: [], status: 'open', priority: 0,
  enrichment: 'rich', enrichAttempts: 1, createdAt: 1000, updatedAt: 2000,
  reviewedAt: null, decidedAt: null, deletedAt: null, ...extra,
});

/** Answer /sync with these pages in turn; everything else is a plain 200. */
function serverPages(pages: { items: Item[]; now: number; hasMore: boolean }[]) {
  let page = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input?.url ?? input);
    if (url.includes('/sync')) {
      const body = pages[Math.min(page, pages.length - 1)]!;
      page++;
      return new Response(JSON.stringify({ ...body, categories: [], tags: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('a first sync fills an empty shelf', () => {
  it('writes what the server sent', async () => {
    configure();
    serverPages([{ items: [serverItem('a'), serverItem('b')], now: 5000, hasMore: false }]);

    const result = await pull();
    expect(result.pulled).toBe(2);
    expect(await listLocal()).toHaveLength(2);
  });

  it('remembers where to resume from', async () => {
    configure();
    serverPages([{ items: [serverItem('a')], now: 5000, hasMore: false }]);
    await pull();
    expect(await getMeta(LAST_SYNC, 0)).toBe(5000);
  });

  it('asks from zero the first time', async () => {
    configure();
    const asked: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      asked.push(String(input?.url ?? input));
      return new Response(JSON.stringify({ items: [], categories: [], tags: [], now: 1, hasMore: false }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await pull();
    expect(asked.some((u) => u.includes('since=0'))).toBe(true);
  });
});

describe('nothing is skipped across pages', () => {
  it('keeps asking while the server says there is more', async () => {
    configure();
    serverPages([
      { items: [serverItem('a'), serverItem('b')], now: 2000, hasMore: true },
      { items: [serverItem('c')], now: 3000, hasMore: false },
    ]);

    const result = await pull();
    expect(result.rounds).toBe(2);
    expect(await listLocal()).toHaveLength(3);
    expect(await getMeta(LAST_SYNC, 0)).toBe(3000);
  });

  it('stops rather than looping forever if the server always says more', async () => {
    // A server that never sets hasMore false would otherwise spin until the tab
    // dies, which on a phone means a hot battery and no shelf.
    configure();
    serverPages([{ items: [serverItem('x')], now: 1, hasMore: true }]);
    const result = await pull(5);
    expect(result.rounds).toBe(5);
  });
});

describe('deletions arrive as tombstones', () => {
  it('a deleted row is removed locally', async () => {
    configure();
    serverPages([{ items: [serverItem('gone')], now: 1000, hasMore: false }]);
    await pull();
    expect(await listLocal()).toHaveLength(1);

    vi.restoreAllMocks();
    serverPages([{ items: [serverItem('gone', { deletedAt: 4000, updatedAt: 4000 })], now: 5000, hasMore: false }]);
    await pull();
    expect(await listLocal()).toHaveLength(0);
  });
});

describe('a local change is never lost to a pull', () => {
  it('an unsynced edit survives the server sending an older copy', async () => {
    // The user edited offline. The server's copy is older by definition, and
    // overwriting is silent data loss they never asked for.
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/mine', source: 'paste' });
    await updateLocal(item.id, { note: 'written on a train' });

    // The push fails; the pull then offers a stale version of the same row.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input?.url ?? input);
      if (url.includes('/sync')) {
        return new Response(JSON.stringify({
          items: [serverItem(item.id, { note: 'stale server note' })],
          categories: [], tags: [], now: 9000, hasMore: false,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('offline');
    });

    await pull();
    const row = await db.items.get(item.id);
    expect(row!.note).toBe('written on a train');
  });
});

describe('when there is nothing to sync with', () => {
  it('being offline leaves the shelf alone and raises nothing', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/local', source: 'paste' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('offline'); });

    await expect(pull()).resolves.toBeDefined();
    expect(await listLocal()).toHaveLength(1);
  });

  it('not being set up yet is not an error either', async () => {
    localStorage.clear();
    const result = await pull();
    expect(result.syncedAt).toBeNull();
  });

  it('a failed sync does not move the mark', async () => {
    // Moving it would step over every change that failed to arrive.
    configure();
    serverPages([{ items: [serverItem('a')], now: 7000, hasMore: false }]);
    await pull();
    expect(await getMeta(LAST_SYNC, 0)).toBe(7000);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('offline'); });
    await pull();
    expect(await getMeta(LAST_SYNC, 0)).toBe(7000);
  });
});

describe('two syncs at once', () => {
  it('the second returns immediately rather than duplicating the work', async () => {
    configure();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input?.url ?? input);
      if (url.includes('/sync')) {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
      }
      return new Response(JSON.stringify({ items: [], categories: [], tags: [], now: 1, hasMore: false }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    });

    await Promise.all([pull(), pull(), pull()]);
    expect(calls).toBe(1);
  });
});
