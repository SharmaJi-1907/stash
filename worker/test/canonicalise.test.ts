import { describe, it, expect } from 'vitest';
import { canonicalise, urlHash, isShortener } from '../src/lib/canonicalise';
import fixtures from './fixtures/links.json';

/**
 * Spec: 03-ARCHITECTURE.md §4.1. The cases in 06-AGENT-BUILD-GUIDE.md §4.1 are
 * reproduced verbatim below and are the minimum bar.
 */

describe('the cases the build guide names', () => {
  const cases: [string, string][] = [
    ['https://www.amazon.in/dp/B0ABC?ref=sr_1_3&th=1', 'https://amazon.in/dp/B0ABC'],
    ['https://amazon.in/Some-Product-Name/dp/B0ABC/', 'https://amazon.in/dp/B0ABC'],
    ['https://youtu.be/xyz', 'https://youtube.com/watch?v=xyz'],
    ['https://youtube.com/watch?v=xyz&t=42&si=abc', 'https://youtube.com/watch?v=xyz'],
    ['https://flipkart.com/p/itm123?pid=XYZ&lid=99', 'https://flipkart.com/p/itm123?pid=XYZ'],
    ['https://example.com/page/?utm_source=x#section', 'https://example.com/page'],
  ];
  for (const [input, want] of cases) {
    it(`${input} -> ${want}`, () => expect(canonicalise(input)).toBe(want));
  }
});

describe('two URLs for the same thing collapse to one hash', () => {
  const same: [string, string, string][] = [
    ['amazon: slug and tracking differ',
      'https://www.amazon.com/Bose-Headphones/dp/B0DZ6ZV9B3?tag=techfusion98-20',
      'https://amazon.com/dp/B0DZ6ZV9B3'],
    ['amazon: /gp/product/ is the same product as /dp/',
      'https://www.amazon.in/gp/product/B0ABCDEFGH', 'https://amazon.in/dp/B0ABCDEFGH'],
    ['youtube: short link and watch link',
      'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=share'],
    ['query order does not matter',
      'https://shop.com/p?b=2&a=1', 'https://shop.com/p?a=1&b=2'],
    ['www and no-www',
      'https://www.crowdsupply.com/x/y', 'https://crowdsupply.com/x/y'],
    ['trailing slash',
      'https://example.com/a/b/', 'https://example.com/a/b'],
    ['fragment is not part of the address',
      'https://www.crowdsupply.com/upside-down-labs/neuro-playground-lite#products',
      'https://crowdsupply.com/upside-down-labs/neuro-playground-lite'],
    ['a bare trailing ? is not a query',
      'https://www.ajio.com/p/4948119920_multi?', 'https://ajio.com/p/4948119920_multi'],
    ['host case is not meaningful',
      'https://EXAMPLE.com/Path', 'https://example.com/Path'],
    ['default port is implied',
      'https://example.com:443/p', 'https://example.com/p'],
  ];
  for (const [name, a, b] of same) {
    it(name, async () => {
      expect(canonicalise(a)).toBe(canonicalise(b));
      expect(await urlHash(canonicalise(a))).toBe(await urlHash(canonicalise(b)));
    });
  }
});

describe('different things stay different', () => {
  const different: [string, string, string][] = [
    ['different ASIN', 'https://amazon.in/dp/B0AAAAAAAA', 'https://amazon.in/dp/B0BBBBBBBB'],
    ['different video', 'https://youtu.be/aaa', 'https://youtu.be/bbb'],
    ['different pid', 'https://flipkart.com/p/x?pid=A', 'https://flipkart.com/p/x?pid=B'],
    ['path case IS meaningful', 'https://example.com/A', 'https://example.com/a'],
    ['a real query is kept', 'https://shop.com/s?q=lamp', 'https://shop.com/s?q=desk'],
    ['hashbang is part of the address', 'https://app.com/#!/a', 'https://app.com/#!/b'],
    ['http and https are not the same origin', 'http://example.com/p', 'https://example.com/p'],
  ];
  for (const [name, a, b] of different) {
    it(name, () => expect(canonicalise(a)).not.toBe(canonicalise(b)));
  }
});

describe('rubbish input is rejected, not guessed at', () => {
  for (const bad of ['', '   ', 'not a url', 'ftp://example.com/f', 'file:///etc/passwd',
                     'javascript:alert(1)', 'data:text/html,<b>x', '//example.com/p']) {
    it(JSON.stringify(bad), () => expect(() => canonicalise(bad)).toThrow());
  }
});

describe('shorteners are recognised so they can be expanded first', () => {
  for (const h of ['https://bit.ly/abc', 'https://amzn.to/abc', 'https://www.fkrt.it/abc', 'https://t.co/abc']) {
    it(h, () => expect(isShortener(new URL(h))).toBe(true));
  }
  it('a normal host is not a shortener', () =>
    expect(isShortener(new URL('https://amazon.in/dp/X'))).toBe(false));
});

describe('every fixture URL canonicalises without throwing', () => {
  for (const link of fixtures.links) {
    it(link.id, () => {
      const c = canonicalise(link.url);
      expect(c).not.toMatch(/[?&](utm_|fbclid|gclid|tag=|si=|ref=)/);
      expect(c).not.toMatch(/\?$/);
      expect(c.startsWith('https://') || c.startsWith('http://')).toBe(true);
    });
  }
});

describe('the hash is a real sha256 and is stable', () => {
  it('64 hex characters', async () =>
    expect(await urlHash('https://example.com/p')).toMatch(/^[0-9a-f]{64}$/));
  it('same input, same hash', async () =>
    expect(await urlHash('https://example.com/p')).toBe(await urlHash('https://example.com/p')));
  it('one character difference changes it completely', async () => {
    const a = await urlHash('https://example.com/p');
    const b = await urlHash('https://example.com/q');
    expect(a).not.toBe(b);
  });
});
