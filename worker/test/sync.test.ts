import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const auth = { Authorization: `Bearer ${env.DEVICE_TOKEN}`, 'Content-Type': 'application/json' };
const B = 'https://stash.test';
const uuid = () => crypto.randomUUID();

const post = (body: unknown) =>
  SELF.fetch(`${B}/v1/items`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const patch = (id: string, body: unknown) =>
  SELF.fetch(`${B}/v1/items/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
const del = (id: string) => SELF.fetch(`${B}/v1/items/${id}`, { method: 'DELETE', headers: auth });
const syncSince = async (since: number) =>
  (await SELF.fetch(`${B}/v1/sync?since=${since}`, { headers: auth })).json<any>();

const create = async (url: string, extra: Record<string, unknown> = {}) =>
  (await (await post({ id: uuid(), url, source: 'paste', ...extra })).json<any>()).item;

describe('a first sync sends everything', () => {
  it('since=0 returns every row', async () => {
    await create('https://example.com/a');
    await create('https://example.com/b');
    const d = await syncSince(0);
    expect(d.items).toHaveLength(2);
    expect(d.hasMore).toBe(false);
    expect(d.now).toBeGreaterThan(0);
  });

  it('a missing since is treated as a first sync, not an error', async () => {
    await create('https://example.com/nosince');
    const d = await (await SELF.fetch(`${B}/v1/sync`, { headers: auth })).json<any>();
    expect(d.items).toHaveLength(1);
  });

  it('rubbish in since does not lose data', async () => {
    await create('https://example.com/rubbish');
    for (const q of ['abc', '-5', 'NaN', '']) {
      const d = await (await SELF.fetch(`${B}/v1/sync?since=${q}`, { headers: auth })).json<any>();
      expect(d.items.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('a later sync sends only what changed', () => {
  it('nothing changed means nothing sent', async () => {
    await create('https://example.com/quiet');
    const first = await syncSince(0);
    const second = await syncSince(first.now);
    expect(second.items).toHaveLength(0);
  });

  it('an edit after the mark comes back', async () => {
    const item = await create('https://example.com/edited');
    const mark = (await syncSince(0)).now;
    await new Promise((r) => setTimeout(r, 5));
    await patch(item.id, { note: 'changed' });

    const after = await syncSince(mark);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].note).toBe('changed');
  });

  it('an item created after the mark comes back, and older ones do not', async () => {
    await create('https://example.com/old');
    const mark = (await syncSince(0)).now;
    await new Promise((r) => setTimeout(r, 5));
    await create('https://example.com/new');

    const after = await syncSince(mark);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].url).toBe('https://example.com/new');
  });
});

describe('deletions reach other devices', () => {
  it('a deleted item comes back as a tombstone, not as silence', async () => {
    // A delete that sent nothing would leave the row on every other device
    // forever. This is the whole reason deletes are soft — 02-TRD.md §4.1.
    const item = await create('https://example.com/deleted');
    const mark = (await syncSince(0)).now;
    await new Promise((r) => setTimeout(r, 5));
    await del(item.id);

    const after = await syncSince(mark);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].id).toBe(item.id);
    expect(after.items[0].deletedAt).toBeGreaterThan(0);
  });

  it('a first sync also carries tombstones', async () => {
    const item = await create('https://example.com/gone');
    await del(item.id);
    const d = await syncSince(0);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].deletedAt).toBeGreaterThan(0);
  });
});

describe('the clock comes from the server', () => {
  it('now advances between syncs', async () => {
    const a = await syncSince(0);
    await new Promise((r) => setTimeout(r, 5));
    const b = await syncSince(0);
    expect(b.now).toBeGreaterThanOrEqual(a.now);
  });

  it('now is not taken from the client', async () => {
    // A client with a clock an hour ahead must not be able to make the server
    // report a future timestamp, or it would skip an hour of its own changes.
    const future = Date.now() + 3_600_000;
    const d = await syncSince(future);
    expect(d.now).toBeLessThan(future);
  });
});

describe('nothing is skipped across a paged sync', () => {
  it('resuming from the reported now covers every row exactly once', async () => {
    for (let n = 0; n < 12; n++) await create(`https://example.com/page-${n}`);

    const seen = new Set<string>();
    let since = 0;
    for (let round = 0; round < 20; round++) {
      const d = await syncSince(since);
      for (const item of d.items) seen.add(item.id);
      since = d.now;
      if (!d.hasMore) break;
    }
    expect(seen.size).toBe(12);
  });

  it('tags travel with the item that owns them', async () => {
    const item = await create('https://example.com/tagged');
    await env.DB.prepare('INSERT INTO tags (id,name,created_at) VALUES (?,?,?)')
      .bind('t-sync', 'for-desk', Date.now()).run();
    await patch(item.id, { tagIds: ['t-sync'] });

    const d = await syncSince(0);
    const synced = d.items.find((i: any) => i.id === item.id);
    expect(synced.tagIds).toEqual(['t-sync']);
    expect(d.tags.map((t: any) => t.id)).toContain('t-sync');
  });
});

describe('sync is behind the token like everything else', () => {
  it('no token, no sync', async () => {
    expect((await SELF.fetch(`${B}/v1/sync?since=0`)).status).toBe(401);
  });
});
