import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isAllowedOrigin } from '../src/middleware/cors';

const B = 'https://stash.test';
const APP = 'https://stash-1ju.pages.dev';
const bearer = { Authorization: `Bearer ${env.DEVICE_TOKEN}` };

describe('which origins are allowed', () => {
  for (const origin of [
    'https://stash-1ju.pages.dev',
    'https://a5d0dc9d.stash-1ju.pages.dev',
    'https://app.stash-1ju.pages.dev',
    'http://localhost:5173',
    'http://127.0.0.1:8788',
  ]) {
    it(`${origin} is allowed`, () => expect(isAllowedOrigin(origin)).toBe(true));
  }

  for (const origin of [
    'https://evil.example',
    'https://stash-1ju.pages.dev.evil.example',
    'https://notstash-1ju.pages.dev',
    'http://stash-1ju.pages.dev',       // http, not https
    '',
    undefined,
  ]) {
    it(`${origin || '(none)'} is refused`, () => expect(isAllowedOrigin(origin)).toBe(false));
  }
});

describe('the preflight, which arrives without a token', () => {
  it('is answered before auth gets to refuse it', async () => {
    // This was the bug: auth returned 401 to the preflight, so the browser never
    // sent the real request, and the app could neither save nor sync while the
    // extension worked fine.
    const r = await SELF.fetch(`${B}/v1/items`, {
      method: 'OPTIONS',
      headers: {
        Origin: APP,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('allows the headers the client actually sends', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, { method: 'OPTIONS', headers: { Origin: APP } });
    const allowed = r.headers.get('access-control-allow-headers') ?? '';
    expect(allowed).toContain('authorization');
    expect(allowed).toContain('content-type');
  });

  it('allows every method the app uses', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, { method: 'OPTIONS', headers: { Origin: APP } });
    const methods = r.headers.get('access-control-allow-methods') ?? '';
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) expect(methods).toContain(method);
  });

  it('a preflight from somewhere else is refused', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, {
      method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('real responses carry the header too', () => {
  it('on an authenticated read', async () => {
    const r = await SELF.fetch(`${B}/v1/items?limit=1`, { headers: { ...bearer, Origin: APP } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(APP);
    // A cache keyed without Origin would hand one origin's response to another.
    expect(r.headers.get('vary')).toContain('Origin');
  });

  it('on /health, which the app checks before anything else', async () => {
    const r = await SELF.fetch(`${B}/health`, { headers: { Origin: APP } });
    expect(r.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('on a 401, so the app can read the status rather than a network error', async () => {
    const r = await SELF.fetch(`${B}/v1/items`, { headers: { Origin: APP } });
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBe(APP);
  });

  it('never for an origin that is not allowed', async () => {
    const r = await SELF.fetch(`${B}/health`, { headers: { Origin: 'https://evil.example' } });
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('a request with no Origin at all still works — curl, the extension', async () => {
    const r = await SELF.fetch(`${B}/health`);
    expect(r.status).toBe(200);
  });
});
