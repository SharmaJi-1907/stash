import { describe, it, expect } from 'vitest';
import { ageInDays, formatAge, formatPrice, staleness, imageUrl } from '../src/lib/format';
import { saveSettings } from '../src/api/client';

const DAY = 86_400_000;

describe('the age treatment', () => {
  /**
   * 04-DESIGN-SYSTEM.md §6 calls this "the strongest idea in this design, and
   * the one most likely to be dropped during implementation." These tests are
   * the thing that notices if it is.
   */
  const cases: [number, string][] = [
    [0, 'fresh'], [7, 'fresh'],
    [8, 'settling'], [29, 'settling'],
    [30, 'stale'], [59, 'stale'],
    [60, 'overdue'], [365, 'overdue'],
  ];
  for (const [days, expected] of cases) {
    it(`${days} days is ${expected}`, () => expect(staleness(days)).toBe(expected));
  }

  it('the rule starts at exactly 30 days, not 29', () => {
    expect(staleness(29)).toBe('settling');
    expect(staleness(30)).toBe('stale');
  });

  it('the age turns to signal at exactly 60 days', () => {
    expect(staleness(59)).toBe('stale');
    expect(staleness(60)).toBe('overdue');
  });
});

describe('counting the days', () => {
  const now = Date.now();

  it('counts from when it was saved', () => {
    expect(ageInDays({ createdAt: now - 47 * DAY, reviewedAt: null }, now)).toBe(47);
  });

  it('counts from the last review instead, once there is one', () => {
    // "Still want this" resets the clock. That is the entire interaction (§6).
    expect(ageInDays({ createdAt: now - 90 * DAY, reviewedAt: now - 2 * DAY }, now)).toBe(2);
  });

  it('a fresh save is zero, not one', () => {
    expect(ageInDays({ createdAt: now, reviewedAt: null }, now)).toBe(0);
  });

  it('a clock that has gone backwards does not produce a negative age', () => {
    expect(ageInDays({ createdAt: now + 5 * DAY, reviewedAt: null }, now)).toBe(0);
  });

  it('is written short, because the metadata line has no room', () => {
    expect(formatAge(47)).toBe('47d');
    expect(formatAge(0)).toBe('0d');
  });
});

describe('prices, from integer minor units', () => {
  it('rupees, with Indian grouping', () => {
    // The price was written 1,23,456 on the page it came from.
    expect(formatPrice(12345600, 'INR')).toBe('₹1,23,456.00');
    expect(formatPrice(899900, 'INR')).toBe('₹8,999.00');
  });

  it('dollars', () => expect(formatPrice(12999, 'USD')).toBe('$129.99'));
  it('euros', () => expect(formatPrice(129900, 'EUR')).toBe('€1,299.00'));

  it('yen has no minor unit — 5000 stored is ¥5,000, not ¥50.00', () => {
    expect(formatPrice(5000, 'JPY')).toBe('¥5,000');
  });

  it('an unknown currency still shows the number rather than nothing', () => {
    expect(formatPrice(100000, 'CHF')).toContain('1,000.00');
  });

  it('no price shows a dash, never a zero', () => {
    // A shelf full of "₹0.00" is a shelf full of confidently wrong numbers,
    // which is the one thing the price rules exist to prevent.
    expect(formatPrice(null, 'INR')).toBe('—');
    expect(formatPrice(899900, null)).toBe('—');
    expect(formatPrice(null, null)).toBe('—');
  });
});

describe('where an image comes from', () => {
  it('a stored image is served from the Worker, outside /v1', () => {
    saveSettings({ apiBase: 'https://api.test/v1', deviceToken: 't' });
    expect(imageUrl({ imageKey: 'img/abc/def', imageUrl: null }))
      .toBe('https://api.test/img/abc/def');
  });

  it('falls back to the remote URL when nothing was copied', () => {
    saveSettings({ apiBase: 'https://api.test/v1', deviceToken: 't' });
    expect(imageUrl({ imageKey: null, imageUrl: 'https://cdn.example/p.jpg' }))
      .toBe('https://cdn.example/p.jpg');
  });

  it('no image at all is null, not a broken src', () => {
    expect(imageUrl({ imageKey: null, imageUrl: null })).toBeNull();
  });

  it('before the app is configured, a stored key falls back rather than 404ing', () => {
    localStorage.clear();
    expect(imageUrl({ imageKey: 'img/a/b', imageUrl: 'https://cdn.example/p.jpg' }))
      .toBe('https://cdn.example/p.jpg');
  });
});
