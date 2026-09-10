import { describe, it, expect } from 'vitest';
import { urlIn } from '../src/screens/Capture';

/**
 * What Android actually hands over.
 *
 * Measured on the user's phone, 2026-09-10, sharing a video from YouTube: the
 * `url` field was empty and the URL arrived inside `text`. The guide warns this
 * happens "depending on the sharing app"; here it is simply what happens. Code
 * that reads `url` and stops receives nothing and looks like a broken share
 * target, which is why this has its own tests.
 */
describe('finding the URL in whatever field carries it', () => {
  it('takes url when it is there', () => {
    expect(urlIn('https://example.com/a', undefined)).toBe('https://example.com/a');
  });

  it('falls back to text, which is where YouTube on Android puts it', () => {
    expect(urlIn('', 'https://youtu.be/dQw4w9WgXcQ')).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('digs a URL out of a sentence, which is how WhatsApp shares', () => {
    expect(urlIn('', 'Look at this https://amazon.in/dp/B0ABC it is nice'))
      .toBe('https://amazon.in/dp/B0ABC');
  });

  it('prefers url over text when both are present', () => {
    expect(urlIn('https://first.com/a', 'https://second.com/b')).toBe('https://first.com/a');
  });

  it('ignores a url field that holds no URL', () => {
    expect(urlIn('Some title', 'https://real.com/x')).toBe('https://real.com/x');
  });

  it('returns nothing when there is no URL anywhere', () => {
    expect(urlIn('', 'just some words', undefined)).toBe('');
  });

  it('handles a bare share with nothing in it', () => {
    expect(urlIn(undefined, undefined, undefined)).toBe('');
  });

  it('does not mistake a trailing bracket for part of the URL', () => {
    expect(urlIn('', 'see (https://example.com/p) here')).toBe('https://example.com/p');
  });

  it('leaves tracking parameters alone — canonicalisation deals with those', () => {
    expect(urlIn('https://www.amazon.com/dp/B0X?tag=aff-20', undefined))
      .toBe('https://www.amazon.com/dp/B0X?tag=aff-20');
  });
});

describe('punctuation a sentence left attached', () => {
  const cases: [string, string][] = [
    ['see (https://example.com/p) here',        'https://example.com/p'],
    ['look at https://example.com/p.',          'https://example.com/p'],
    ['this one https://example.com/p, and',     'https://example.com/p'],
    ['really? https://example.com/p!',          'https://example.com/p'],
    ['[https://example.com/p]',                 'https://example.com/p'],
  ];
  for (const [text, want] of cases) {
    it(JSON.stringify(text), () => expect(urlIn('', text)).toBe(want));
  }

  it('keeps a bracket that belongs to the URL', () => {
    // Wikipedia is full of these. Dropping it silently gives a 404 six months
    // later, which is exactly when the shelf is supposed to still work.
    expect(urlIn('', 'https://en.wikipedia.org/wiki/Mercury_(planet)'))
      .toBe('https://en.wikipedia.org/wiki/Mercury_(planet)');
  });

  it('keeps a full stop that is part of the path', () => {
    expect(urlIn('https://example.com/file.pdf', undefined)).toBe('https://example.com/file.pdf');
  });
});
