/**
 * Tier 2 — Open Graph, and Tier 3 — Twitter Card.
 *
 * Spec: 03-ARCHITECTURE.md §4.2
 *
 * Nearly universal, because SEO and social sharing give every commercial page a
 * reason to emit them. Measured across the twenty-link fixture set, 13 of 20
 * URLs carry og:title with no work at all — this tier is what makes "any site,
 * no exceptions" (01-PRD.md principle 3) achievable without per-retailer code.
 *
 * Twitter Card is not a separate rung in practice: it only ever fills fields
 * Open Graph left empty, so the two are resolved together here.
 */

import { parsePrice } from '../price';
import type { Collected } from './collect';
import type { Extracted } from './types';

export function fromOpenGraph(c: Collected): Extracted | null {
  const title = c.og.title || c.twitter.title;
  if (!title?.trim()) return null;

  // B1 — Shopify writes og:price:amount (collect.ts strips the "og:" prefix
  // down to "price:amount"), not product:price:amount. Both spellings appear
  // in the wild; prefer product: when a page emits both.
  const price = parsePrice(
    c.og['product:price:amount'] ?? c.og['price:amount'] ?? null,
    c.og['product:price:currency'] ?? c.og['price:currency'] ?? null,
  );

  const usedTwitterForTitle = !c.og.title && Boolean(c.twitter.title);

  return {
    title: title.trim(),
    description: (c.og.description || c.twitter.description || c.description || '').trim() || undefined,
    image: c.og.image || c.twitter.image || undefined,
    price: price ?? undefined,
    siteName: c.og.site_name?.trim() || undefined,
    tier: usedTwitterForTitle ? 'twitter' : 'opengraph',
    quality: price ? 'rich' : 'partial',
  };
}
