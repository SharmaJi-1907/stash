import { describe, it, expect, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const TOKEN = env.DEVICE_TOKEN;
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const B = 'https://stash.test';

const post = (body: unknown) =>
  SELF.fetch(`${B}/v1/items`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const get = (path: string) => SELF.fetch(`${B}${path}`, { headers: auth });
const patch = (id: string, body: unknown) =>
  SELF.fetch(`${B}/v1/items/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify(body) });
const del = (id: string) =>
  SELF.fetch(`${B}/v1/items/${id}`, { method: 'DELETE', headers: auth });

const uuid = () => crypto.randomUUID();

/**
 * Wait for background work (ctx.waitUntil) to land, or give up.
 *
 * The budget is generous on purpose. This failed once in eleven runs, and only
 * when three typecheck processes happened to be running alongside — a loaded
 * machine, not a broken assertion. A test that fails on load is a test that
 * gets ignored, and an ignored test protects nothing.
 */
async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('background work did not finish in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('a save always succeeds, and succeeds immediately', () => {
  it('creates an item and returns 201 with the row', async () => {
    const id = uuid();
    const r = await post({ id, url: 'https://www.amazon.com/dp/B0DZ6ZV9B3?tag=x', source: 'paste' });
    expect(r.status).toBe(201);
    const { item, duplicate } = await r.json<any>();
    expect(duplicate).toBe(false);
    expect(item.id).toBe(id);
    expect(item.canonicalUrl).toBe('https://amazon.com/dp/B0DZ6ZV9B3');
    expect(item.url).toBe('https://www.amazon.com/dp/B0DZ6ZV9B3?tag=x'); // as given
    expect(item.site).toBe('amazon.com');
    expect(item.status).toBe('open');
    expect(item.enrichment).toBe('pending');
    expect(item.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not wait for enrichment — the row is complete on return', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/thing', source: 'paste' });
    const { item } = await r.json<any>();
    // A pending item is a saved item. The metadata arrives later.
    expect(item.enrichment).toBe('pending');
    expect(item.createdAt).toBeGreaterThan(0);
  });

  it('generates an id when the client does not send one', async () => {
    const r = await post({ url: 'https://example.com/no-id', source: 'paste' });
    const { item } = await r.json<any>();
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('honours a client createdAt so an offline save keeps its real moment', async () => {
    const when = Date.now() - 86_400_000;   // yesterday
    const r = await post({ id: uuid(), url: 'https://example.com/queued', source: 'share', createdAt: when });
    const { item } = await r.json<any>();
    expect(item.createdAt).toBe(when);
    expect(item.updatedAt).toBeGreaterThan(when);
  });

  it('takes extension scrape data and marks the item rich straight away', async () => {
    const r = await post({
      id: uuid(), url: 'https://www.amazon.in/dp/B0KEYCHRON', source: 'extension',
      scraped: { title: 'Keychron K2 Pro', image: 'https://m.media-amazon.com/i.jpg',
                 priceAmount: 899900, priceCurrency: 'INR', siteName: 'Amazon' },
    });
    const { item } = await r.json<any>();
    expect(item.enrichment).toBe('rich');
    expect(item.title).toBe('Keychron K2 Pro');
    expect(item.priceAmount).toBe(899900);
    expect(item.priceCurrency).toBe('INR');
  });
});

describe('the same thing saved twice stays one row', () => {
  it('returns the existing item with duplicate: true and status 200', async () => {
    const first = await post({ id: uuid(), url: 'https://amazon.in/dp/B0SAME', source: 'paste' });
    expect(first.status).toBe(201);
    const original = (await first.json<any>()).item;

    const second = await post({ id: uuid(), url: 'https://amazon.in/dp/B0SAME', source: 'paste' });
    expect(second.status).toBe(200);
    const { item, duplicate } = await second.json<any>();
    expect(duplicate).toBe(true);
    expect(item.id).toBe(original.id);          // the first row, not the new id
  });

  it('recognises the same product through a different URL spelling', async () => {
    await post({ id: uuid(), url: 'https://amazon.in/dp/B0DUP', source: 'paste' });
    const r = await post({
      id: uuid(),
      url: 'https://www.amazon.in/Some-Long-Product-Name/dp/B0DUP/ref=sr_1_3?th=1',
      source: 'extension',
    });
    expect((await r.json<any>()).duplicate).toBe(true);
  });

  it('youtu.be and youtube.com are the same video', async () => {
    await post({ id: uuid(), url: 'https://youtu.be/dQw4w9WgXcQ', source: 'share' });
    const r = await post({ id: uuid(), url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', source: 'paste' });
    expect((await r.json<any>()).duplicate).toBe(true);
  });

  it('a deleted item does not block saving the same URL again', async () => {
    const first = await post({ id: uuid(), url: 'https://amazon.in/dp/B0GONE', source: 'paste' });
    const id = (await first.json<any>()).item.id;
    expect((await del(id)).status).toBe(204);

    const again = await post({ id: uuid(), url: 'https://amazon.in/dp/B0GONE', source: 'paste' });
    expect(again.status).toBe(201);
    expect((await again.json<any>()).duplicate).toBe(false);
  });

  it('different products stay different', async () => {
    await post({ id: uuid(), url: 'https://amazon.in/dp/B0AAA', source: 'paste' });
    const r = await post({ id: uuid(), url: 'https://amazon.in/dp/B0BBB', source: 'paste' });
    expect((await r.json<any>()).duplicate).toBe(false);
  });
});

describe('items with no fetchable URL', () => {
  it('accepts a manual item with a title', async () => {
    const r = await post({ id: uuid(), manual: true, title: 'Lamp from an Instagram reel', source: 'manual' });
    expect(r.status).toBe(201);
    const { item } = await r.json<any>();
    expect(item.enrichment).toBe('manual');
    expect(item.title).toBe('Lamp from an Instagram reel');
  });

  it('refuses a manual item with no title, since nothing would identify it', async () => {
    const r = await post({ id: uuid(), manual: true, source: 'manual' });
    expect(r.status).toBe(400);
  });

  it('two manual items do not collide with each other', async () => {
    const a = await post({ id: uuid(), manual: true, title: 'One', source: 'manual' });
    const b = await post({ id: uuid(), manual: true, title: 'Two', source: 'manual' });
    expect((await a.json<any>()).duplicate).toBe(false);
    expect((await b.json<any>()).duplicate).toBe(false);
  });
});

describe('bad input is refused clearly', () => {
  for (const [name, body] of [
    ['no url and not manual', { id: 'x', source: 'paste' }],
    ['a URL that is not http', { id: 'x', url: 'ftp://example.com/f', source: 'paste' }],
    ['a URL that is not a URL', { id: 'x', url: 'not a url', source: 'paste' }],
  ] as [string, unknown][]) {
    it(name, async () => {
      const r = await post(body);
      expect(r.status).toBe(400);
      expect((await r.json<any>()).error.code).toBe('INVALID_URL');
    });
  }

  it('a body that is not JSON', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, { method: 'POST', headers: auth, body: 'not json' });
    expect(r.status).toBe(400);
  });

  it('an over-long title is trimmed rather than rejected', async () => {
    const r = await post({ id: uuid(), manual: true, title: 'x'.repeat(900), source: 'manual' });
    expect(r.status).toBe(201);
    expect((await r.json<any>()).item.title.length).toBe(500);
  });
});

describe('reading the shelf', () => {
  it('lists newest first', async () => {
    for (const n of [1, 2, 3]) {
      await post({ id: uuid(), url: `https://example.com/p${n}`, source: 'paste', createdAt: 1000 + n });
    }
    const { items } = await (await get('/v1/items')).json<any>();
    expect(items.map((i: any) => i.createdAt)).toEqual([1003, 1002, 1001]);
  });

  it('fetches one item by id', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/one', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    const one = await get(`/v1/items/${id}`);
    expect(one.status).toBe(200);
    expect((await one.json<any>()).id).toBe(id);
  });

  it('404s for an id that does not exist', async () => {
    expect((await get('/v1/items/nope')).status).toBe(404);
  });

  it('searches title, note and site together', async () => {
    await post({ id: uuid(), url: 'https://amazon.in/dp/B0KB', source: 'paste',
                 scraped: { title: 'Keychron keyboard' } });
    await post({ id: uuid(), url: 'https://pepperfry.com/riser', source: 'paste', note: 'for the desk' });

    const byTitle = await (await get('/v1/items?q=keychron')).json<any>();
    expect(byTitle.items).toHaveLength(1);

    const byNote = await (await get('/v1/items?q=desk')).json<any>();
    expect(byNote.items).toHaveLength(1);

    const bySite = await (await get('/v1/items?q=pepperfry')).json<any>();
    expect(bySite.items).toHaveLength(1);

    const none = await (await get('/v1/items?q=zzzzz')).json<any>();
    expect(none.items).toHaveLength(0);
  });

  it('filters by status', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/s', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    await patch(id, { status: 'bought' });
    await post({ id: uuid(), url: 'https://example.com/t', source: 'paste' });

    expect((await (await get('/v1/items?status=bought')).json<any>()).items).toHaveLength(1);
    expect((await (await get('/v1/items?status=open')).json<any>()).items).toHaveLength(1);
  });

  it('pages without skipping or repeating an item', async () => {
    for (let n = 0; n < 7; n++) {
      await post({ id: uuid(), url: `https://example.com/page${n}`, source: 'paste', createdAt: 2000 + n });
    }
    const first = await (await get('/v1/items?limit=3')).json<any>();
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();

    const second = await (await get(`/v1/items?limit=3&cursor=${encodeURIComponent(first.nextCursor)}`)).json<any>();
    const seen = [...first.items, ...second.items].map((i: any) => i.id);
    expect(new Set(seen).size).toBe(6);        // no repeats
  });

  it('deleted items disappear from the shelf', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/bye', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    await del(id);
    expect((await (await get('/v1/items')).json<any>()).items).toHaveLength(0);
    expect((await get(`/v1/items/${id}`)).status).toBe(404);
  });
});

describe('the lifecycle', () => {
  it('records decidedAt when an item is bought, and clears it if undone', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/buy', source: 'paste' });
    const id = (await r.json<any>()).item.id;

    const bought = await (await patch(id, { status: 'bought' })).json<any>();
    expect(bought.status).toBe('bought');
    expect(bought.decidedAt).toBeGreaterThan(0);

    const undone = await (await patch(id, { status: 'open' })).json<any>();
    expect(undone.decidedAt).toBeNull();
  });

  it('rejects a status that is not one of the four', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/bad', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    expect((await patch(id, { status: 'purchased' })).status).toBe(400);
  });

  it('a note can be added and cleared', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/n', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    expect((await (await patch(id, { note: 'for the desk' })).json<any>()).note).toBe('for the desk');
    expect((await (await patch(id, { note: null })).json<any>()).note).toBeNull();
  });

  it('editing a note does not touch reviewedAt', async () => {
    // Spec 02-TRD.md §4.1: only an explicit "still want this" resets the clock.
    const r = await post({ id: uuid(), url: 'https://example.com/r', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    const after = await (await patch(id, { note: 'changed' })).json<any>();
    expect(after.reviewedAt).toBeNull();
  });

  it('deleting is soft — the tombstone survives for sync', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/soft', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    await del(id);
    const row = await env.DB.prepare('SELECT deleted_at FROM items WHERE id = ?').bind(id).first<any>();
    expect(row).not.toBeNull();
    expect(row.deleted_at).toBeGreaterThan(0);
  });

  it('deleting twice is a 404 the second time', async () => {
    const r = await post({ id: uuid(), url: 'https://example.com/twice', source: 'paste' });
    const id = (await r.json<any>()).item.id;
    expect((await del(id)).status).toBe(204);
    expect((await del(id)).status).toBe(404);
  });
});

describe('every route is behind the token', () => {
  const noAuth = { 'Content-Type': 'application/json' };
  it('POST without a token', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, { method: 'POST', headers: noAuth, body: '{}' });
    expect(r.status).toBe(401);
  });
  it('GET without a token', async () => {
    expect((await SELF.fetch(`${B}/v1/items`)).status).toBe(401);
  });
  it('DELETE without a token', async () => {
    expect((await SELF.fetch(`${B}/v1/items/x`, { method: 'DELETE' })).status).toBe(401);
  });
});

describe('the contract the extension actually uses', () => {
  // The extension sends the price as the page showed it and the server parses
  // it. This is the seam between two codebases, so it is tested at the seam
  // rather than on either side of it.
  const cases: [string, string | undefined, number, string][] = [
    ['₹8,999.00', undefined, 899900, 'INR'],
    ['Rs. 8999', undefined, 899900, 'INR'],
    ['$129.99', undefined, 12999, 'USD'],
    ['8999.00', 'INR', 899900, 'INR'],
    ['74.99', 'USD', 7499, 'USD'],
    ['1.299,00 €', undefined, 129900, 'EUR'],
  ];

  cases.forEach(([priceText, priceCurrency, amount, currency], index) => {
    it(`${priceText}${priceCurrency ? ` (${priceCurrency})` : ''} -> ${amount} ${currency}`, async () => {
      const r = await post({
        id: uuid(), url: `https://shop.example/case-${index}`, source: 'extension',
        scraped: { title: 'Scraped thing', priceText, priceCurrency },
      });
      const { item } = await r.json<any>();
      expect(item.priceAmount).toBe(amount);
      expect(item.priceCurrency).toBe(currency);
      expect(item.enrichment).toBe('rich');
    });
  });

  it('an unparseable price leaves the item without one rather than guessing', async () => {
    const r = await post({
      id: uuid(), url: 'https://shop.example/free', source: 'extension',
      scraped: { title: 'Free thing', priceText: 'Free' },
    });
    const { item } = await r.json<any>();
    expect(item.title).toBe('Free thing');
    expect(item.priceAmount).toBeNull();
  });

  it('a scrape with only a title still marks the item rich and skips the ladder', async () => {
    const r = await post({
      id: uuid(), url: 'https://shop.example/titleonly', source: 'extension',
      scraped: { title: 'Just a title' },
    });
    const { item } = await r.json<any>();
    expect(item.enrichment).toBe('rich');
    expect(item.title).toBe('Just a title');
  });

  it('an absurd scraped price is dropped, not stored', async () => {
    const r = await post({
      id: uuid(), url: 'https://shop.example/absurd', source: 'extension',
      scraped: { title: 'Thing', priceText: '₹99,99,99,999' },
    });
    expect((await r.json<any>()).item.priceAmount).toBeNull();
  });
});

describe('an extension scrape still gets its image copied', () => {
  it('a rich item from the extension does not keep hotlinking', async () => {
    // The ladder is skipped for a scraped item, so the image copy has to be
    // triggered separately. Before that existed, every save from the extension —
    // the highest-quality path in the system — stored only a remote URL.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(50_000), { headers: { 'content-type': 'image/jpeg' } }) as Response);

    const r = await post({
      id: uuid(), url: 'https://shop.example/scraped-image', source: 'extension',
      scraped: { title: 'Scraped', image: 'https://cdn.example/photo.jpg' },
    });
    const { item } = await r.json<any>();
    expect(item.enrichment).toBe('rich');

    // The copy runs in waitUntil, which is not finished when the response
    // resolves. Poll rather than sleep a fixed amount: a fixed sleep is either
    // flaky or slow, and usually both.
    const row = await waitFor(async () => {
      const r = await env.DB.prepare('SELECT image_key, image_bytes FROM items WHERE id = ?')
        .bind(item.id).first<any>();
      return r?.image_key ? r : null;
    });

    expect(row.image_key).toMatch(/^img\//);
    expect(row.image_bytes).toBe(50_000);
    vi.restoreAllMocks();
  });
});
