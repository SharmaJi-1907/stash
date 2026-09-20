import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { fromJsonLd } from '../src/lib/extractors/jsonld';
import { fromOpenGraph } from '../src/lib/extractors/opengraph';
import { fromBareHtml } from '../src/lib/extractors/bare';
import { collect } from '../src/lib/extractors/collect';
import { extract } from '../src/lib/enrich';

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });
const BUDGET = 512 * 1024;

afterEach(() => vi.restoreAllMocks());

describe('JSON-LD, in the shapes it actually arrives in', () => {
  const parse = (obj: unknown) => fromJsonLd([JSON.stringify(obj)]);

  it('a plain Product with an offer', () => {
    const r = parse({ '@type': 'Product', name: 'Keychron K2 Pro',
      image: 'https://cdn/x.jpg', offers: { '@type': 'Offer', price: '8999.00', priceCurrency: 'INR' } });
    expect(r).toMatchObject({ title: 'Keychron K2 Pro', quality: 'rich' });
    expect(r!.price).toEqual({ amount: 899900, currency: 'INR' });
  });

  it('image as an array', () => {
    expect(parse({ '@type': 'Product', name: 'X', image: ['https://a.jpg', 'https://b.jpg'] })!.image)
      .toBe('https://a.jpg');
  });

  it('image as an ImageObject', () => {
    expect(parse({ '@type': 'Product', name: 'X', image: { '@type': 'ImageObject', url: 'https://c.jpg' } })!.image)
      .toBe('https://c.jpg');
  });

  it('offers as an array', () => {
    expect(parse({ '@type': 'Product', name: 'X',
      offers: [{ price: 1500, priceCurrency: 'INR' }] })!.price).toEqual({ amount: 150000, currency: 'INR' });
  });

  it('an AggregateOffer with lowPrice', () => {
    expect(parse({ '@type': 'Product', name: 'X',
      offers: { '@type': 'AggregateOffer', lowPrice: '2499', priceCurrency: 'INR' } })!.price)
      .toEqual({ amount: 249900, currency: 'INR' });
  });

  it('price as a number, not a string', () => {
    expect(parse({ '@type': 'Product', name: 'X', offers: { price: 129.99, priceCurrency: 'USD' } })!.price)
      .toEqual({ amount: 12999, currency: 'USD' });
  });

  it('@type as an array', () => {
    expect(parse({ '@type': ['Product', 'Thing'], name: 'X' })!.title).toBe('X');
  });

  it('buried in an @graph', () => {
    expect(parse({ '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'Buried' }] })!.title).toBe('Buried');
  });

  it('no price means partial, not failure', () => {
    expect(parse({ '@type': 'Product', name: 'X' })!.quality).toBe('partial');
  });

  it('malformed JSON is skipped and the next block still works', () => {
    const r = fromJsonLd(['{ this is not json', JSON.stringify({ '@type': 'Product', name: 'Second' })]);
    expect(r!.title).toBe('Second');
  });

  it('a non-Product block is ignored', () => {
    expect(fromJsonLd([JSON.stringify({ '@type': 'BreadcrumbList', name: 'nav' })])).toBeNull();
  });

  it('a Product with no name is not usable', () => {
    expect(parse({ '@type': 'Product', offers: { price: '99' } })).toBeNull();
  });

  it('an absurd price is dropped but the title is kept', () => {
    const r = parse({ '@type': 'Product', name: 'X', offers: { price: '0.01', priceCurrency: 'INR' } });
    expect(r!.title).toBe('X');
    expect(r!.price).toBeUndefined();
    expect(r!.quality).toBe('partial');
  });
});

describe('Open Graph and Twitter Card', () => {
  const from = async (body: string) => fromOpenGraph(await collect(html(body), BUDGET));

  it('reads og:title, image and site_name', async () => {
    const r = await from(`<html><head>
      <meta property="og:title" content="Neuro PlayGround Lite">
      <meta property="og:image" content="https://cdn/np.jpg">
      <meta property="og:site_name" content="Crowd Supply"></head><body></body></html>`);
    expect(r).toMatchObject({ title: 'Neuro PlayGround Lite', image: 'https://cdn/np.jpg',
      siteName: 'Crowd Supply', tier: 'opengraph', quality: 'partial' });
  });

  it('product:price makes it rich', async () => {
    const r = await from(`<html><head>
      <meta property="og:title" content="Thing">
      <meta property="product:price:amount" content="1499.00">
      <meta property="product:price:currency" content="INR"></head></html>`);
    expect(r!.quality).toBe('rich');
    expect(r!.price).toEqual({ amount: 149900, currency: 'INR' });
  });

  // B1 — Shopify writes og:price:amount, not product:price:amount. Measured
  // on quartzcomponents.com, 2026-09-10.
  it('reads Shopify\'s og:price:amount spelling', async () => {
    const r = await from(`<html><head>
      <meta property="og:title" content="Thing">
      <meta property="og:price:amount" content="138.00">
      <meta property="og:price:currency" content="INR"></head></html>`);
    expect(r!.quality).toBe('rich');
    expect(r!.price).toEqual({ amount: 13800, currency: 'INR' });
  });

  it('prefers product: over og: price when a page emits both', async () => {
    const r = await from(`<html><head>
      <meta property="og:title" content="Thing">
      <meta property="product:price:amount" content="1499.00">
      <meta property="product:price:currency" content="INR">
      <meta property="og:price:amount" content="1.00">
      <meta property="og:price:currency" content="USD"></head></html>`);
    expect(r!.price).toEqual({ amount: 149900, currency: 'INR' });
  });

  it('falls back to Twitter Card when Open Graph has no title', async () => {
    const r = await from(`<html><head>
      <meta name="twitter:title" content="From Twitter">
      <meta name="twitter:image" content="https://cdn/t.jpg"></head></html>`);
    expect(r).toMatchObject({ title: 'From Twitter', image: 'https://cdn/t.jpg', tier: 'twitter' });
  });

  it('Open Graph wins when both are present', async () => {
    const r = await from(`<html><head>
      <meta property="og:title" content="OG wins">
      <meta name="twitter:title" content="TW loses"></head></html>`);
    expect(r!.title).toBe('OG wins');
    expect(r!.tier).toBe('opengraph');
  });

  it('no title anywhere means this tier declines', async () => {
    expect(await from('<html><head><meta property="og:image" content="https://x.jpg"></head></html>')).toBeNull();
  });
});

describe('bare HTML, the last rung', () => {
  const from = async (body: string) => fromBareHtml(await collect(html(body), BUDGET));

  it('uses the title element', async () => {
    const r = await from('<html><head><title>Wooden monitor riser</title></head><body></body></html>');
    expect(r).toMatchObject({ title: 'Wooden monitor riser', tier: 'bare', quality: 'partial' });
  });

  it('trims a site name off the end of the title', async () => {
    expect((await from('<html><head><title>Neuro PlayGround Lite | Crowd Supply</title></head></html>'))!.title)
      .toBe('Neuro PlayGround Lite');
  });

  it('picks the first plausible image and skips the junk', async () => {
    const r = await from(`<html><head><title>Page</title></head><body>
      <img src="/logo.png"><img src="data:image/gif;base64,R0lGOD"><img src="/tracking-pixel.gif">
      <img src="https://cdn/product-photo.jpg"></body></html>`);
    expect(r!.image).toBe('https://cdn/product-photo.jpg');
  });

  it('an empty title is not usable', async () => {
    expect(await from('<html><head><title>  </title></head></html>')).toBeNull();
  });
});

describe('the ladder picks the best tier available', () => {
  // mockImplementation, not mockResolvedValue: a Response body can be read once,
  // and the same instance handed to two callers leaves the second with nothing.
  const serve = (body: string) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => html(body) as Response);
  };

  it('JSON-LD beats Open Graph when both are present', async () => {
    serve(`<html><head>
      <meta property="og:title" content="OG title">
      <script type="application/ld+json">
        {"@type":"Product","name":"JSON-LD title","offers":{"price":"999","priceCurrency":"INR"}}
      </script></head></html>`);
    const r = await extract('https://shop.example/p');
    expect(r).toMatchObject({ title: 'JSON-LD title', tier: 'jsonld', quality: 'rich' });
  });

  it('Open Graph beats bare HTML', async () => {
    serve('<html><head><title>Bare title</title><meta property="og:title" content="OG title"></head></html>');
    expect((await extract('https://shop.example/p'))!.tier).toBe('opengraph');
  });

  it('falls all the way to bare HTML', async () => {
    serve('<html><head><title>Only a title</title></head></html>');
    expect((await extract('https://shop.example/p'))!.tier).toBe('bare');
  });

  it('a page with nothing usable yields null, and that is tier 6', async () => {
    serve('<html><head></head><body>no metadata at all</body></html>');
    expect(await extract('https://shop.example/p')).toBeNull();
  });

  it('a non-HTML response is not parsed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }) as Response);
    expect(await extract('https://shop.example/p.json')).toBeNull();
  });

  it('a 404 yields null rather than a broken title', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }) as Response);
    expect(await extract('https://shop.example/gone')).toBeNull();
  });

  it('a URL that resolves into the private network is refused, not fetched', async () => {
    await expect(extract('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
  });
});

describe('the parse budget', () => {
  it('stops reading a huge document and says so', async () => {
    const filler = '<p>x</p>'.repeat(200_000);            // well over the budget
    const body = `<html><head><title>Early title</title></head><body>${filler}</body></html>`;
    const c = await collect(html(body), 64 * 1024);
    expect(c.truncated).toBe(true);
    expect(c.title).toBe('Early title');                  // what was early still arrived
  });

  it('a document inside the budget is not marked truncated', async () => {
    const c = await collect(html('<html><head><title>Small</title></head></html>'), 64 * 1024);
    expect(c.truncated).toBe(false);
  });
});

describe('enrichment writes back and never fails the item', () => {
  const TOKEN = env.DEVICE_TOKEN;
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  it('a page that cannot be fetched leaves a failed item, not an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const r = await SELF.fetch('https://stash.test/v1/items', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ url: 'https://unreachable.example/p', source: 'paste' }),
    });
    expect(r.status).toBe(201);                            // the save still succeeded
    const id = (await r.json<any>()).item.id;

    // waitUntil has run by the time the test's own fetch resolves in this pool.
    const row = await env.DB.prepare('SELECT enrichment, enrich_attempts FROM items WHERE id = ?')
      .bind(id).first<any>();
    expect(['pending', 'failed']).toContain(row.enrichment);
  });

  it('a price snapshot is written whenever a price was found', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => html(
      `<html><head><script type="application/ld+json">
        {"@type":"Product","name":"Tracked","offers":{"price":"2499","priceCurrency":"INR"}}
      </script></head></html>`) as Response);

    const r = await SELF.fetch('https://stash.test/v1/items', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ url: 'https://shop.example/tracked', source: 'paste' }),
    });
    const id = (await r.json<any>()).item.id;

    await SELF.fetch(`https://stash.test/v1/items/${id}/enrich`, { method: 'POST', headers: auth });

    const item = await env.DB.prepare('SELECT title, price_amount, enrichment FROM items WHERE id = ?')
      .bind(id).first<any>();
    expect(item.title).toBe('Tracked');
    expect(item.price_amount).toBe(249900);

    const snap = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_snapshots WHERE item_id = ?')
      .bind(id).first<any>();
    expect(snap.n).toBeGreaterThan(0);
  });

  it('a manual item has nothing to fetch and says so', async () => {
    const r = await SELF.fetch('https://stash.test/v1/items', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ manual: true, title: 'Screenshot thing', source: 'manual' }),
    });
    const id = (await r.json<any>()).item.id;
    const again = await SELF.fetch(`https://stash.test/v1/items/${id}/enrich`, { method: 'POST', headers: auth });
    expect(again.status).toBe(400);
  });
});

describe('enrichment fetches the URL as given, not the canonical form', () => {
  const TOKEN = env.DEVICE_TOKEN;
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  it('the fetched URL keeps the full path the user saved', async () => {
    // Canonicalisation is an identity key, not an address. Measured 2026-09-09:
    // myntra.com's canonical /1700944/buy does not serve the product page that
    // the full slug does, and amazon.com and youtube.com answer their canonical
    // forms with a 301. This is how a page that enriches in a unit test comes
    // back empty in production.
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      seen.push(typeof input === 'string' ? input : input.url ?? String(input));
      return html('<html><head><title>Fetched</title></head></html>') as Response;
    });

    const long = 'https://www.myntra.com/tshirts/roadster/roadster-men-black-solid-round-neck-t-shirt/1700944/buy';
    const r = await SELF.fetch('https://stash.test/v1/items', {
      method: 'POST', headers: auth, body: JSON.stringify({ url: long, source: 'paste' }),
    });
    const { item } = await r.json<any>();

    // The canonical form is shorter and is stored, but must not be what we fetch.
    expect(item.canonicalUrl).toBe('https://myntra.com/1700944/buy');

    await SELF.fetch(`https://stash.test/v1/items/${item.id}/enrich`, { method: 'POST', headers: auth });
    expect(seen.some((u) => u === long)).toBe(true);
    expect(seen.some((u) => u === 'https://myntra.com/1700944/buy')).toBe(false);
  });
});

describe('a tracking beacon is not a product photo', () => {
  it('an image below the minimum size is not stored', async () => {
    // A 43-byte GIF from amazon.com's logging endpoint was stored as a product
    // photo before MIN_IMAGE_BYTES existed. Measured 2026-09-09.
    const { storeImage, MIN_IMAGE_BYTES } = await import('../src/lib/images');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(43), { headers: { 'content-type': 'image/gif' } }) as Response);

    const stored = await storeImage(env.BUCKET, 'item-1', 'https://fls-na.amazon.com/1/batch/1/OP/x');
    expect(stored).toBeNull();
    expect(MIN_IMAGE_BYTES).toBeGreaterThan(43);
  });

  it('a real-sized image is stored', async () => {
    const { storeImage } = await import('../src/lib/images');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(40_000), { headers: { 'content-type': 'image/jpeg' } }) as Response);

    const stored = await storeImage(env.BUCKET, 'item-2', 'https://cdn.example/photo.jpg');
    expect(stored).not.toBeNull();
    expect(stored!.bytes).toBe(40_000);
    expect(stored!.key).toMatch(/^img\/item-2\/[0-9a-f]{16}$/);
  });

  it('a non-image content type is refused', async () => {
    const { storeImage } = await import('../src/lib/images');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) as Response);
    expect(await storeImage(env.BUCKET, 'item-3', 'https://cdn.example/blocked.jpg')).toBeNull();
  });

  it('an image over the 2 MB cap is refused rather than truncated', async () => {
    const { storeImage } = await import('../src/lib/images');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(3 * 1024 * 1024), { headers: { 'content-type': 'image/jpeg' } }) as Response);
    expect(await storeImage(env.BUCKET, 'item-4', 'https://cdn.example/huge.jpg')).toBeNull();
  });
});

describe('a stored image is served at a sane URL', () => {
  it('the URL is /img/<item>/<hash>, not /img/img/<item>/<hash>', async () => {
    const { storeImage } = await import('../src/lib/images');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(30_000), { headers: { 'content-type': 'image/jpeg' } }) as Response);

    const stored = await storeImage(env.BUCKET, 'item-url', 'https://cdn.example/p.jpg');
    expect(stored!.key).toBe(`img/item-url/${stored!.key.split('/')[2]}`);

    // The key already carries the img/ prefix, so the served path is one slash
    // plus the key. Getting this wrong produces /img/img/... which works by
    // accident and reads as a bug for the rest of the project's life.
    const ok = await SELF.fetch(`https://stash.test/${stored!.key}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('immutable');

    const doubled = await SELF.fetch(`https://stash.test/img/${stored!.key}`);
    expect(doubled.status).toBe(404);
  });

  it('a path outside img/ is refused', async () => {
    expect((await SELF.fetch('https://stash.test/img/../secret')).status).toBe(404);
  });

  it('an unknown key is a 404, not an error', async () => {
    expect((await SELF.fetch('https://stash.test/img/nope/nothing')).status).toBe(404);
  });
});
