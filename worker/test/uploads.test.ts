import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const B = 'https://stash.test';
const bearer = { Authorization: `Bearer ${env.DEVICE_TOKEN}` };
const uuid = () => crypto.randomUUID();

/** A file of a given size and type, as a browser would send one. */
const fileOf = (bytes: number, type = 'image/png', name = 'shot.png') =>
  new File([new Uint8Array(bytes).fill(1)], name, { type });

async function upload(file: File | null, field = 'image') {
  const form = new FormData();
  if (file) form.append(field, file);
  return SELF.fetch(`${B}/v1/uploads/image`, { method: 'POST', headers: bearer, body: form });
}

describe('a screenshot can be uploaded and used', () => {
  it('stores it and returns a key', async () => {
    const r = await upload(fileOf(40_000));
    expect(r.status).toBe(201);
    const { key } = await r.json<any>();
    expect(key).toMatch(/^img\/upload\/[0-9a-f]{32}$/);

    const stored = await env.BUCKET.get(key);
    expect(stored).not.toBeNull();
    expect(stored!.size).toBe(40_000);
  });

  it('the key works on the image route straight away', async () => {
    const { key } = await (await upload(fileOf(20_000, 'image/jpeg'))).json<any>();
    const served = await SELF.fetch(`${B}/${key}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toContain('immutable');
  });

  it('the same screenshot twice occupies one object', async () => {
    // Keyed by content. A user sharing the same WhatsApp forward twice should
    // not pay for it twice — R2 is the one meter here with a card behind it.
    const a = await (await upload(fileOf(10_000))).json<any>();
    const b = await (await upload(fileOf(10_000))).json<any>();
    expect(a.key).toBe(b.key);
  });

  it('a manual item can be created with the uploaded key', async () => {
    const { key } = await (await upload(fileOf(15_000))).json<any>();
    const r = await SELF.fetch(`${B}/v1/items`, {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: uuid(), manual: true, title: 'Lamp from a reel', source: 'manual', imageKey: key,
      }),
    });
    expect(r.status).toBe(201);
    const { item } = await r.json<any>();
    expect(item.imageKey).toBe(key);
    expect(item.enrichment).toBe('manual');
  });

  it('accepts the field named file as well as image', async () => {
    expect((await upload(fileOf(5000), 'file')).status).toBe(201);
  });
});

describe('what is refused, and why', () => {
  it('nothing attached', async () => {
    const r = await upload(null);
    expect(r.status).toBe(400);
    expect((await r.json<any>()).error.code).toBe('INVALID_URL');
  });

  it('not an image', async () => {
    const r = await upload(new File(['<html>'], 'page.html', { type: 'text/html' }));
    expect(r.status).toBe(400);
  });

  it('an empty file', async () => {
    const r = await upload(fileOf(0));
    expect(r.status).toBe(400);
  });

  it('over the 5 MB cap', async () => {
    const r = await upload(fileOf(6 * 1024 * 1024));
    expect(r.status).toBe(413);
    expect((await r.json<any>()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a body that is not form data', async () => {
    const r = await SELF.fetch(`${B}/v1/uploads/image`, {
      method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
    expect(r.status).toBe(400);
  });

  it('no token', async () => {
    const form = new FormData();
    form.append('image', fileOf(1000));
    expect((await SELF.fetch(`${B}/v1/uploads/image`, { method: 'POST', body: form })).status).toBe(401);
  });
});

describe('export carries everything, including what was deleted', () => {
  it('round-trips items, tombstones and tags', async () => {
    const headers = { ...bearer, 'Content-Type': 'application/json' };
    const mk = async (url: string) =>
      (await (await SELF.fetch(`${B}/v1/items`, {
        method: 'POST', headers, body: JSON.stringify({ id: uuid(), url, source: 'paste' }),
      })).json<any>()).item;

    const kept = await mk('https://example.com/kept');
    const gone = await mk('https://example.com/gone');
    await SELF.fetch(`${B}/v1/items/${gone.id}`, { method: 'DELETE', headers: bearer });

    await env.DB.prepare('INSERT INTO tags (id,name,created_at) VALUES (?,?,?)')
      .bind('t-exp', 'exported', Date.now()).run();
    await SELF.fetch(`${B}/v1/items/${kept.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ tagIds: ['t-exp'] }),
    });

    const r = await SELF.fetch(`${B}/v1/export`, { headers: bearer });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toContain('attachment');

    const d = await r.json<any>();
    expect(d.version).toBe(1);
    expect(d.exportedAt).toBeGreaterThan(0);
    expect(d.items).toHaveLength(2);

    // A deleted row has to be in the export, or a re-import would resurrect it
    // on the next sync. 01-PRD.md F12 wants an identical shelf back.
    const tomb = d.items.find((i: any) => i.id === gone.id);
    expect(tomb.deletedAt).toBeGreaterThan(0);

    expect(d.items.find((i: any) => i.id === kept.id).tagIds).toEqual(['t-exp']);
    expect(d.tags.map((t: any) => t.id)).toContain('t-exp');
    expect(Array.isArray(d.classifyRules)).toBe(true);
    expect(Array.isArray(d.priceSnapshots)).toBe(true);
    expect(Array.isArray(d.settings)).toBe(true);
  });

  it('an empty shelf exports as empty, not as an error', async () => {
    const d = await (await SELF.fetch(`${B}/v1/export`, { headers: bearer })).json<any>();
    expect(d.items).toEqual([]);
  });

  it('no token, no export', async () => {
    expect((await SELF.fetch(`${B}/v1/export`)).status).toBe(401);
  });
});

describe('the size cap holds when Content-Length does not', () => {
  /**
   * Build a multipart body as a stream, so the request carries no
   * Content-Length at all.
   *
   * This exists because deliberately deleting the byte-length check left every
   * other test green: they all send a body with an honest Content-Length, so the
   * header check catches the oversize first and the real guard is never reached.
   * An absent or lying Content-Length is exactly the case an attacker controls.
   */
  function streamedMultipart(totalBytes: number, boundary = 'stashtest') {
    const head = new TextEncoder().encode(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="image"; filename="big.png"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const chunk = new Uint8Array(64 * 1024).fill(1);

    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(head); },
      pull(controller) {
        if (sent >= totalBytes) { controller.enqueue(tail); controller.close(); return; }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it('refuses an oversize upload that declares no length', async () => {
    const { body, contentType } = streamedMultipart(6 * 1024 * 1024);
    const r = await SELF.fetch(`${B}/v1/uploads/image`, {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': contentType },
      body,
      // @ts-expect-error duplex is required for a streamed request body
      duplex: 'half',
    });
    expect(r.status).toBe(413);
  });

  it('still accepts a normal upload that declares no length', async () => {
    const { body, contentType } = streamedMultipart(100 * 1024);
    const r = await SELF.fetch(`${B}/v1/uploads/image`, {
      method: 'POST',
      headers: { ...bearer, 'Content-Type': contentType },
      body,
      // @ts-expect-error duplex is required for a streamed request body
      duplex: 'half',
    });
    expect(r.status).toBe(201);
  });
});
