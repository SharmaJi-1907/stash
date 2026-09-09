import { describe, it, expect } from 'vitest';
import { assertFetchable, safeFetch, readCappedText, BlockedUrlError } from '../src/lib/ssrf';

const blocked = (url: string) => {
  expect(() => assertFetchable(url)).toThrow(BlockedUrlError);
};
const allowed = (url: string) => {
  expect(() => assertFetchable(url)).not.toThrow();
};

describe('every case the build guide names is rejected', () => {
  // 06-AGENT-BUILD-GUIDE.md §4.2, verbatim.
  const cases = [
    'http://localhost:8080/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'http://internal/',
    'http://something.local/',
  ];
  for (const url of cases) it(url, () => blocked(url));
});

describe('numeric spellings of loopback are blocked', () => {
  // Each of these is 127.0.0.1 written differently.
  //
  // Honest note on what this group proves: for the decimal, hex and octal forms
  // the WHATWG URL parser normalises to 127.0.0.1 before our checks run, so the
  // test is confirming that platform behaviour holds rather than exercising our
  // own decoder. Deliberately breaking the decoder leaves these passing. The
  // IPv6 cases below are the ones our code has to catch itself — the parser
  // rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1 and stops there.
  for (const url of [
    'http://2130706433/',          // decimal
    'http://0x7f000001/',          // hex
    'http://017700000001/',        // octal
    'http://[::ffff:127.0.0.1]/',  // IPv4-mapped IPv6
    'http://[0:0:0:0:0:0:0:1]/',   // ::1 written out
  ]) it(url, () => blocked(url));
});

describe('the rest of the private space', () => {
  for (const url of [
    'http://0.0.0.0/',
    'http://10.255.255.255/',
    'http://172.31.255.254/',
    'http://169.254.1.1/',
    'http://100.64.0.1/',          // carrier-grade NAT
    'http://198.18.0.1/',          // benchmarking
    'http://224.0.0.1/',           // multicast
    'http://[fc00::1]/',           // IPv6 unique local
    'http://[fe80::1]/',           // IPv6 link-local
    'http://router/',              // bare LAN name
    'http://nas.home.arpa/',
    'http://printer.lan/',
    'http://wiki.intranet/',
    'http://instance-data/',
  ]) it(url, () => blocked(url));
});

describe('bypasses that a hand-rolled guard usually misses', () => {
  // Each of these reaches a private address. They are here because the first
  // version of this guard let ::ffff:127.0.0.1 straight through: the URL parser
  // rewrites it to ::ffff:7f00:1, so matching the dotted spelling found nothing.
  for (const url of [
    'http://[::ffff:7f00:1]/',            // the hex form the parser produces
    'http://[::ffff:169.254.169.254]/',   // metadata endpoint, mapped
    'http://[::ffff:a9fe:a9fe]/',         // the same, in hex
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:192.168.1.1]/',
    'http://[::127.0.0.1]/',              // IPv4-compatible, not mapped
    'http://[0:0:0:0:0:ffff:7f00:0001]/', // uncompressed
    'http://[fd00::1]/',                  // fc00::/7, second half
    'http://[FE80::1]/',                  // uppercase
    'http://[ff02::1]/',                  // multicast
    'http://127.1/',                      // short-form loopback
    'http://0177.0.0.1/',                 // octal first octet
    'http://LOCALHOST/',                  // case
    'http://LocalHost.LOCAL/',
  ]) it(url, () => blocked(url));

  // Public IPv6 must still work — a guard that blocks everything is not a guard.
  for (const url of ['http://[2606:4700::1111]/', 'http://[2001:4860:4860::8888]/']) {
    it(`${url} is allowed`, () => allowed(url));
  }
});

describe('other schemes and shapes', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'gopher://example.com/',
    'ws://example.com/',
    'not a url at all',
    '',
    'http://user:pass@example.com/',   // credentials laundering
  ]) it(JSON.stringify(url), () => blocked(url));
});

describe('real public URLs are allowed', () => {
  for (const url of [
    'https://amazon.in/dp/B0ABCDEFGH',
    'https://www.flipkart.com/p/itm123?pid=X',
    'http://example.com/page',
    'https://blog.cloudflare.com/introducing-htmlrewriter/',
    'https://8.8.8.8/',              // public IP literal
    'https://172.15.0.1/',           // just outside 172.16/12
    'https://172.32.0.1/',           // just outside the other end
    'https://192.169.0.1/',          // just outside 192.168/16
    'https://100.63.255.255/',       // just outside 100.64/10
    'https://11.0.0.1/',             // just outside 10/8
    'https://126.0.0.1/',            // just outside 127/8
    'https://128.0.0.1/',
  ]) it(url, () => allowed(url));
});

describe('a redirect into the private network is caught', () => {
  it('rejects when Location points at 127.0.0.1', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })) as typeof fetch;
    try {
      await expect(safeFetch('https://example.com/start')).rejects.toThrow(BlockedUrlError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects when a relative Location resolves into link-local', async () => {
    const original = globalThis.fetch;
    let hop = 0;
    globalThis.fetch = (async () => {
      hop++;
      return hop === 1
        ? new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
        : new Response('secret', { status: 200 });
    }) as typeof fetch;
    try {
      await expect(safeFetch('https://example.com/')).rejects.toThrow(BlockedUrlError);
      expect(hop).toBe(1);   // never reached the metadata endpoint
    } finally {
      globalThis.fetch = original;
    }
  });

  it('stops after 3 hops rather than following forever', async () => {
    const original = globalThis.fetch;
    let hop = 0;
    globalThis.fetch = (async () => {
      hop++;
      return new Response(null, { status: 302, headers: { location: `https://example.com/${hop}` } });
    }) as typeof fetch;
    try {
      await expect(safeFetch('https://example.com/')).rejects.toThrow(/more than 3 redirects/);
      expect(hop).toBe(4);   // the initial request plus three hops
    } finally {
      globalThis.fetch = original;
    }
  });

  it('follows a normal redirect chain and reports where it landed', async () => {
    const original = globalThis.fetch;
    let hop = 0;
    globalThis.fetch = (async () => {
      hop++;
      return hop === 1
        ? new Response(null, { status: 302, headers: { location: 'https://example.com/final' } })
        : new Response('<title>ok</title>', { status: 200 });
    }) as typeof fetch;
    try {
      const { response, finalUrl } = await safeFetch('https://example.com/start');
      expect(response.status).toBe(200);
      expect(finalUrl).toBe('https://example.com/final');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('the body cap holds even when the server lies', () => {
  it('rejects early on an oversized content-length', async () => {
    const r = new Response('x', { headers: { 'content-length': String(50 * 1024 * 1024) } });
    await expect(readCappedText(r)).rejects.toThrow(BlockedUrlError);
  });

  it('stops reading at the cap when no content-length is sent', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(97);      // 64 KB of "a"
    let sent = 0;
    const body = new ReadableStream({
      pull(c) {
        if (sent > 8 * 1024 * 1024) return c.close();      // would be 8 MB
        sent += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const text = await readCappedText(new Response(body), 1024 * 1024);
    expect(text.length).toBeLessThanOrEqual(1024 * 1024);
    expect(sent).toBeLessThan(8 * 1024 * 1024);            // it stopped early
  });

  it('reads a small body whole', async () => {
    expect(await readCappedText(new Response('<title>hi</title>'))).toBe('<title>hi</title>');
  });
});
