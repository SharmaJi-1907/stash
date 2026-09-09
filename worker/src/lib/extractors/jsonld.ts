/**
 * Tier 1 — JSON-LD Product.
 *
 * Spec: 03-ARCHITECTURE.md §4.2
 *
 * The highest-quality server-side source, because search engines require it, so
 * every commerce platform emits it. It is also the messiest: the same field
 * appears as a string, an array, an object or an @graph depending on who
 * generated it, and malformed JSON-LD in the wild is common enough that a parse
 * failure must never take the whole enrichment down with it.
 */

import { parsePrice } from '../price';
import type { Extracted } from './types';

type Json = Record<string, unknown>;

/** `image` may be a string, an array, or an ImageObject. Any of them. */
function firstImage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) { for (const v of value) { const r = firstImage(v); if (r) return r; } return undefined; }
  if (value && typeof value === 'object') {
    const url = (value as Json).url ?? (value as Json).contentUrl;
    if (typeof url === 'string') return url;
  }
  return undefined;
}

/** Collect every offer reachable from a value: object, array, or AggregateOffer. */
function allOffers(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 5 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const v of value) allOffers(v, out, depth + 1); return out; }

  const offer = value as Json;
  if (offer.price !== undefined || offer.lowPrice !== undefined) out.push(offer);
  if (offer.offers !== undefined) allOffers(offer.offers, out, depth + 1);
  return out;
}

/**
 * Find the offer to quote.
 *
 * A ProductGroup carries no `offers` of its own — Shopify puts them on each
 * entry of `hasVariant`, one per size or colour. Measured on keychron.com: a
 * ProductGroup with 29 variants, each with its own Offer, and nothing at the
 * top level. Ignoring hasVariant leaves every Shopify product priceless.
 *
 * Where several offers exist, the cheapest is quoted. That is what a shelf entry
 * should say — the price at which this thing can be had — and it is the number a
 * "from ₹X" listing shows.
 */
function firstOffer(product: Json): Json | undefined {
  const offers = allOffers(product.offers);
  if (product.hasVariant) allOffers(product.hasVariant, offers);
  if (offers.length === 0) return undefined;

  let best: Json | undefined;
  let bestAmount = Infinity;
  for (const offer of offers) {
    const parsed = parsePrice(
      (offer.price ?? offer.lowPrice) as string | number | null,
      typeof offer.priceCurrency === 'string' ? offer.priceCurrency : null,
    );
    if (parsed && parsed.amount < bestAmount) { bestAmount = parsed.amount; best = offer; }
  }
  return best ?? offers[0];
}

const typeOf = (node: Json): string[] => {
  const t = node['@type'];
  return (Array.isArray(t) ? t : [t]).filter((v): v is string => typeof v === 'string');
};

/** Walk @graph and nested arrays looking for a Product-ish node. */
function findProduct(node: unknown, depth = 0): Json | null {
  if (depth > 6 || !node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const child of node) { const r = findProduct(child, depth + 1); if (r) return r; }
    return null;
  }

  const obj = node as Json;
  const types = typeOf(obj);
  if (types.some((t) => /^(Product|ProductGroup|IndividualProduct|Book|Vehicle|SoftwareApplication)$/i.test(t))) {
    return obj;
  }

  if (obj['@graph']) return findProduct(obj['@graph'], depth + 1);
  if (obj.mainEntity) return findProduct(obj.mainEntity, depth + 1);
  return null;
}

export function fromJsonLd(blocks: string[]): Extracted | null {
  for (const raw of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON-LD is common. Skip this block, keep the ladder going.
      continue;
    }

    const product = findProduct(parsed);
    if (!product) continue;

    const name = typeof product.name === 'string' ? product.name.trim() : '';
    if (!name) continue;

    const offer = firstOffer(product);
    const price = offer
      ? parsePrice(
          (offer.price ?? offer.lowPrice) as string | number | null,
          typeof offer.priceCurrency === 'string' ? offer.priceCurrency : null,
        )
      : null;

    const description = typeof product.description === 'string' ? product.description.trim() : undefined;
    const brand = product.brand && typeof product.brand === 'object'
      ? (product.brand as Json).name : product.brand;

    return {
      title: name,
      description: description || undefined,
      // A ProductGroup has no image of its own; its variants do.
      image: firstImage(product.image) ?? firstImage(product.hasVariant),
      price: price ?? undefined,
      siteName: typeof brand === 'string' ? brand : undefined,
      // A price is what separates rich from partial. Spec: 03-ARCHITECTURE.md §4.2
      tier: 'jsonld',
      quality: price ? 'rich' : 'partial',
    };
  }
  return null;
}
