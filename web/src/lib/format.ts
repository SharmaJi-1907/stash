/**
 * Turning stored values into the things a card shows.
 *
 * Spec: 04-DESIGN-SYSTEM.md §6, §7.1 · 02-TRD.md §4.1
 */

import { loadSettings } from '../api/client';
import type { Item } from '../../../shared/types';

/** Currencies with no minor unit — ¥500 is 500 stored, not 50000. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);

const SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', GBP: '£', EUR: '€', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$',
};

/**
 * A price for display, from integer minor units.
 *
 * Returns an em dash rather than a zero when there is no price. A shelf full of
 * "₹0.00" would be a shelf full of confidently wrong numbers, which is the one
 * thing 03-ARCHITECTURE.md §4.4 rule 5 exists to avoid.
 */
export function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null) return '—';

  const digits = ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
  const major = amount / 10 ** digits;
  const symbol = SYMBOL[currency.toUpperCase()] ?? `${currency} `;

  // Indian grouping for rupees — 1,23,456 rather than 123,456 — because that is
  // how the price was written on the page it came from.
  const locale = currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
  return symbol + major.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Whole days an item has been on the shelf. */
export function ageInDays(item: Pick<Item, 'createdAt' | 'reviewedAt'>, now = Date.now()): number {
  // reviewedAt is what "still want this" resets, and it is separate from
  // updatedAt so that editing a note does not make an old item look fresh
  // (02-TRD.md §4.1).
  const from = item.reviewedAt ?? item.createdAt;
  return Math.max(0, Math.floor((now - from) / 86_400_000));
}

export type Staleness = 'fresh' | 'settling' | 'stale' | 'overdue';

/**
 * How old is too old.
 *
 * Spec: 04-DESIGN-SYSTEM.md §6 — 0–7 and 8–29 days carry nothing, 30–59 gets the
 * left rule and a faded image, 60+ puts the age itself in signal.
 */
export function staleness(days: number): Staleness {
  if (days >= 60) return 'overdue';
  if (days >= 30) return 'stale';
  if (days >= 8) return 'settling';
  return 'fresh';
}

/** `4d`, `47d`. Never "47 days ago" — the metadata line has no room for it. */
export function formatAge(days: number): string {
  return `${days}d`;
}

/**
 * Where a stored image is served from.
 *
 * The R2 key already begins with `img/` and the Worker serves it at the root,
 * outside `/v1`, because an <img> tag cannot send an Authorization header.
 */
export function imageUrl(item: Pick<Item, 'imageKey' | 'imageUrl'>): string | null {
  if (item.imageKey) {
    const { apiBase } = loadSettings();
    if (!apiBase) return item.imageUrl;
    return `${apiBase.replace(/\/v1$/, '')}/${item.imageKey}`;
  }
  // The remote URL is a fallback only, for an image that could not be copied.
  return item.imageUrl;
}
