/**
 * URL canonicalisation and the dedupe hash.
 *
 * Spec: 03-ARCHITECTURE.md §4.1 · test cases in 06-AGENT-BUILD-GUIDE.md §4.1
 *
 * Two URLs pointing at the same product must produce the same `url_hash`, or
 * dedupe fails and the shelf fills with near-identical rows that each look
 * correct on their own. That is the whole job of this file.
 *
 * Steps 1–5 are generic and run on every URL. Step 6 is the only site-specific
 * logic in the system and is an optimisation: an unrecognised domain falls
 * through it and still canonicalises correctly.
 */

/**
 * Tracking parameters, stripped everywhere. From 03-ARCHITECTURE.md §4.1 step 2,
 * plus `utm_*` and `pd_rd_*` / `pf_rd_*` handled as prefixes below.
 */
const DROP_PARAMS = new Set([
  'fbclid', 'gclid', 'ref', 'ref_', '_encoding', 'psc', 'th',
  'linkcode', 'tag', 'ascsubtag', 'igshid', 'si', 'feature',
  'spm', 'affid', 'srsltid',
]);

const DROP_PREFIXES = ['utm_', 'pd_rd_', 'pf_rd_'];

/** Hosts whose only job is to redirect. Expanded before canonicalisation. */
export const SHORTENER_HOSTS = new Set([
  'bit.ly', 'amzn.to', 'fkrt.it', 't.co', 'tinyurl.com', 'goo.gl',
  'buff.ly', 'ow.ly', 'rb.gy', 'cutt.ly', 'dub.sh', 'shorturl.at',
]);

export function isShortener(url: URL): boolean {
  return SHORTENER_HOSTS.has(url.hostname.replace(/^www\./, ''));
}

function stripTrackingParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (DROP_PARAMS.has(k) || DROP_PREFIXES.some((p) => k.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }
}

/** Sort remaining parameters so ?a=1&b=2 and ?b=2&a=1 hash identically. */
function sortParams(url: URL): void {
  const entries = [...url.searchParams.entries()].sort(([a], [b]) =>
    a === b ? 0 : a < b ? -1 : 1,
  );
  const sorted = new URLSearchParams();
  for (const [k, v] of entries) sorted.append(k, v);
  url.search = sorted.toString();
}

/**
 * Step 6 — per-domain shortening, where the canonical form is known and stable.
 * Returns true if the URL was rewritten.
 */
function applyDomainRules(url: URL): void {
  const host = url.hostname;

  // amazon.* → keep only /dp/<ASIN>. The slug before /dp/ is decorative and
  // varies by locale, referrer and A/B test.
  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
    // Length is not constrained. Real ASINs are ten characters, but
    // 06-AGENT-BUILD-GUIDE.md §4.1's own cases use shorter ids, and a stricter
    // pattern silently leaves those URLs uncanonicalised — which is a dedupe
    // failure that looks like nothing at all.
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]+)/)?.[1];
    if (asin) {
      url.pathname = `/dp/${asin.toUpperCase()}`;
      url.search = '';
    }
    return;
  }

  // flipkart.com → path plus pid. Everything else (lid, marketplace, srno) is
  // session noise.
  if (/(^|\.)flipkart\.com$/.test(host)) {
    const pid = url.searchParams.get('pid');
    url.search = '';
    if (pid) url.searchParams.set('pid', pid);
    return;
  }

  // youtu.be/X and youtube.com/watch?v=X are the same video. Normalise to one.
  if (/(^|\.)youtu\.be$/.test(host)) {
    const id = url.pathname.slice(1).split('/')[0];
    if (id) {
      url.hostname = 'youtube.com';
      url.pathname = '/watch';
      url.search = '';
      url.searchParams.set('v', id);
    }
    return;
  }
  if (/(^|\.)youtube\.com$/.test(host) && url.pathname === '/watch') {
    const v = url.searchParams.get('v');
    url.search = '';
    if (v) url.searchParams.set('v', v);
    return;
  }

  // myntra.com → the numeric product id segment identifies the product; the
  // words around it are SEO.
  if (/(^|\.)myntra\.com$/.test(host)) {
    const id = url.pathname.match(/\/(\d{4,})(?:\/|$)/)?.[1];
    if (id) {
      url.pathname = `/${id}/buy`;
      url.search = '';
    }
    return;
  }
}

/**
 * Normalise a URL to its canonical form.
 * Throws on anything that is not an http(s) URL — the caller turns that into
 * INVALID_URL (02-TRD.md §5.3).
 */
export function canonicalise(input: string): string {
  const url = new URL(input.trim());

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Not an http(s) URL');
  }

  // 1. Lowercase scheme and host, strip www.
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.username = '';
  url.password = '';
  url.port = '';

  // 2 + 3. Drop tracking, then sort what remains.
  stripTrackingParams(url);
  sortParams(url);

  // 4. Drop the fragment unless it is a hashbang route, which is part of the
  //    address rather than a position within the page.
  if (!url.hash.startsWith('#!')) url.hash = '';

  // 5. Drop a trailing slash on non-root paths.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  // 6. Site-specific shortening, an optimisation on top of the above.
  applyDomainRules(url);

  // URL.toString() reinstates a bare '?' when search is empty on some inputs.
  return url.toString().replace(/\?$/, '');
}

/** sha256 of the canonical URL, hex. The dedupe key. Spec: 02-TRD.md §4 */
export async function urlHash(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
