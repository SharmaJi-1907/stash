import { describe, it, expect, vi } from 'vitest';
import { db } from '../src/db/db';
import { saveLocal, updateLocal, deleteLocal, listLocal } from '../src/db/local';
import { flushOutbox } from '../src/sync/outbox';
import { saveSettings } from '../src/api/client';

const configure = () => saveSettings({ apiBase: 'https://api.test/v1', deviceToken: 'tok' });

/** Answer every request with the same thing. */
function server(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: any, init?: any) => handler(String(input?.url ?? input), init),
  );
}

const created = (id: string) =>
  new Response(JSON.stringify({
    item: { id, url: 'https://example.com/x', canonicalUrl: 'https://example.com/x',
            urlHash: 'h', title: null, description: null, note: null, imageKey: null,
            imageUrl: null, imageWidth: null, imageHeight: null, imageBytes: null,
            priceAmount: null, priceCurrency: null, site: 'example.com', siteName: null,
            source: 'paste', categoryId: null, tagIds: [], status: 'open', priority: 0,
            enrichment: 'pending', enrichAttempts: 0, createdAt: 1, updatedAt: 1,
            reviewedAt: null, decidedAt: null, deletedAt: null },
    duplicate: false,
  }), { status: 201, headers: { 'content-type': 'application/json' } });

describe('the queue drains when the network is there', () => {
  it('sends a create and clears it', async () => {
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/a', source: 'paste' });
    server(() => created(item.id));

    const result = await flushOutbox();
    expect(result.sent).toBe(1);
    expect(await db.outbox.count()).toBe(0);

    const row = await db.items.get(item.id);
    expect(row!.pending).toBe(0);
  });

  it('sends in the order the changes were made', async () => {
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/order', source: 'paste' });
    await updateLocal(item.id, { note: 'second' });

    const methods: string[] = [];
    server((url, init) => {
      methods.push(String(init?.method ?? 'GET'));
      return created(item.id);
    });

    await flushOutbox();
    // A create must arrive before the update that follows it, or the update
    // lands on a row the server has never heard of.
    expect(methods).toEqual(['POST', 'PATCH']);
  });

  it('a delete reaches the server too', async () => {
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/del', source: 'paste' });
    await db.outbox.clear();
    await deleteLocal(item.id);

    let sawDelete = false;
    server((_url, init) => {
      if (init?.method === 'DELETE') sawDelete = true;
      return new Response(null, { status: 204 });
    });

    await flushOutbox();
    expect(sawDelete).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('when the network is not there', () => {
  it('the save survives and the queue keeps it', async () => {
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/train', source: 'paste' });
    server(() => { throw new Error('offline'); });

    const result = await flushOutbox();
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    // The item is still on the shelf. This is the promise: a save on a train is
    // a save (01-PRD.md F10).
    expect(await listLocal()).toHaveLength(1);
    expect((await db.items.get(item.id))!.pending).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('five offline saves all survive and all send on reconnect', async () => {
    // 05-ROADMAP.md P2's own acceptance, in a test.
    configure();
    server(() => { throw new Error('offline'); });
    for (let n = 0; n < 5; n++) {
      await saveLocal({ url: `https://example.com/air-${n}`, source: 'share' });
    }
    await flushOutbox();
    expect(await listLocal()).toHaveLength(5);
    expect(await db.outbox.count()).toBe(5);

    // Reconnect. Everything is due again because the first backoff is a second.
    vi.restoreAllMocks();
    await db.outbox.toCollection().modify({ nextAttemptAt: 0, attempts: 0 });
    const rows = await db.items.toArray();
    let n = 0;
    server(() => created(rows[n++]!.id));

    const after = await flushOutbox();
    expect(after.sent).toBe(5);
    expect(await db.outbox.count()).toBe(0);
  });

  it('backs off further each time rather than hammering', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/backoff', source: 'paste' });
    server(() => { throw new Error('offline'); });

    const delays: number[] = [];
    for (let round = 0; round < 3; round++) {
      await db.outbox.toCollection().modify({ nextAttemptAt: 0 });
      const before = Date.now();
      await flushOutbox();
      const entry = (await db.outbox.toArray())[0]!;
      delays.push(entry.nextAttemptAt - before);
    }
    expect(delays[0]).toBeGreaterThanOrEqual(1_000);
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[2]).toBeGreaterThan(delays[1]!);
  });

  it('a server error is retried, not dropped', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/500', source: 'paste' });
    server(() => new Response('boom', { status: 500 }));

    const result = await flushOutbox();
    expect(result.failed).toBe(1);
    expect(result.dropped).toBe(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it('being rate limited is a pause, not a refusal', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/429', source: 'paste' });
    server(() => new Response('{}', { status: 429 }));

    const result = await flushOutbox();
    expect(result.dropped).toBe(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it('nothing waiting to send raises an error to anyone', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/quiet', source: 'paste' });
    server(() => { throw new Error('offline'); });
    // 03-ARCHITECTURE.md §8: every row of the failure table ends in "no error".
    await expect(flushOutbox()).resolves.toBeDefined();
  });
});

describe('failures that retrying cannot fix', () => {
  it('a rejected token drops the entry instead of retrying for a week', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/401', source: 'paste' });
    server(() => new Response('{"error":{"code":"UNAUTHORIZED"}}', { status: 401 }));

    const result = await flushOutbox();
    expect(result.dropped).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('a body the server will never accept is dropped', async () => {
    configure();
    await saveLocal({ url: 'https://example.com/400', source: 'paste' });
    server(() => new Response('{"error":{"message":"Not a fetchable URL"}}', { status: 400 }));

    const result = await flushOutbox();
    expect(result.dropped).toBe(1);
  });

  it('the item stays on the shelf even when its push is dropped', async () => {
    // Dropping the push does not drop the thing the user saved.
    configure();
    await saveLocal({ url: 'https://example.com/kept', source: 'paste' });
    server(() => new Response('{}', { status: 401 }));
    await flushOutbox();
    expect(await listLocal()).toHaveLength(1);
  });
});

describe('before the app is set up', () => {
  it('leaves the queue untouched rather than burning its retries', async () => {
    // No address or token yet. The work is not wrong, the app is not configured.
    // Marking everything failed would push it all into a long backoff for a
    // reason that has nothing to do with the network.
    localStorage.clear();
    await saveLocal({ url: 'https://example.com/unset', source: 'paste' });
    const result = await flushOutbox();

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(true);
    expect((await db.outbox.toArray())[0]!.attempts).toBe(0);
  });
});

describe('the server having its own idea of the id', () => {
  it('adopts the server row when the URL was already saved elsewhere', async () => {
    // Saved on the phone, then saved again on the laptop before either synced.
    // The server answers with the row that already exists, and the local copy
    // has to follow — two rows for one thing is what dedupe exists to prevent.
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/dup', source: 'paste' });
    server(() => created('id-from-the-server'));

    await flushOutbox();

    expect(await db.items.get(item.id)).toBeUndefined();
    expect(await db.items.get('id-from-the-server')).toBeDefined();
    expect(await listLocal()).toHaveLength(1);
  });
});

describe('flushing twice at once', () => {
  it('does not send anything twice', async () => {
    configure();
    const { item } = await saveLocal({ url: 'https://example.com/race', source: 'paste' });
    let calls = 0;
    server(async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return created(item.id); });

    await Promise.all([flushOutbox(), flushOutbox(), flushOutbox()]);
    expect(calls).toBe(1);
  });
});
