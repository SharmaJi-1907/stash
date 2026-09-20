/**
 * Tier 0 — read the live page.
 *
 * Spec: 03-ARCHITECTURE.md §3, §4.2 Tier 0 · 02-TRD.md §3.2
 *
 * This is the whole reason the extension exists. It runs inside a tab the user
 * is already looking at, logged in, in their own region, after JavaScript has
 * run. Measured 2026-09-09 against a plain server fetch:
 *
 *   amazon.com   200, title "Amazon.com", no metadata   (bot wall)
 *   flipkart.com page titled "Flipkart reCAPTCHA"       (bot wall)
 *   ajio.com     403 Access Denied                      (refused)
 *
 * None of those prices can be reached from a server. All three are ordinary
 * page text here.
 *
 * No price parsing happens in this file. The raw string goes to the server,
 * which owns the one tested parser — a second implementation here would be a
 * second thing to get wrong, and a wrong price is worse than none.
 */

/** Selectors that hold a price on the sites this is aimed at, most specific first. */
const PRICE_SELECTORS = [
  // Amazon. Several of these coexist and which one is present varies by
  // product type, locale and whatever experiment the page is in.
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_mobile_feature_div .a-price .a-offscreen',
  '.apexPriceToPay .a-offscreen',
  '.priceToPay .a-offscreen',
  '.reinventPricePriceToPayMargin .a-offscreen',
  '#tp_price_block_total_price_ww .a-offscreen',
  '#twister-plus-price-data-price',
  '#price_inside_buybox',
  '#newBuyBoxPrice',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#priceblock_saleprice',
  '.a-price .a-offscreen',
  // Flipkart
  'div._30jeq3._16Jk6d',
  'div._30jeq3',
  // Myntra
  '.pdp-price strong',
  '.pdp-price',
  // Ajio
  '.prod-sp',
  '.price-value',
  // Shopify and the generic web
  '[itemprop="price"]',
  '.price__current .money',
  '.product__price .money',
  '.price .money',
  '[data-price]',
  '.product-price',
  '.price',
];

/** Regions that hold something other than this product's price. */
const NOT_THE_PRODUCT = [
  '[cel_widget_id*="sponsored" i]', '[data-component-type*="sp_" i]',
  '.a-carousel', '[data-a-carousel-options]', '#similarities_feature_div',
  '#sims-consolidated-2_feature_div', '#HLCXComparisonWidget_feature_div',
  '#rhf', '#navFooter', 'footer', 'nav', 'header',
];

/**
 * Markers for an amount that is not what the thing costs now.
 *
 * Amazon writes the M.R.P. with the same .a-price .a-offscreen markup as the
 * real price and distinguishes it only by `a-text-price` and a strike. Measured
 * on amazon.in 2026-09-10: a drill kit at -40% ₹3,499 with M.R.P. ₹5,799 was
 * read as ₹5,799 — a price that is both wrong and higher than the truth, which
 * is the worst direction for it to be wrong in.
 */
const STRUCK_THROUGH = [
  '.a-text-price', '[data-a-strike="true"]', '.a-price[data-a-strike]',
  's', 'del', 'strike', '.priceBlockStrikePriceString', '.a-text-strike',
];

function insideAnotherProduct(el) {
  return NOT_THE_PRODUCT.some((sel) => el.closest(sel));
}

/**
 * True when this amount is a was-price rather than an is-price.
 *
 * The strike often sits on an ancestor rather than the element holding the text —
 * .a-offscreen is visually hidden, so its own computed style says nothing — which
 * is why this walks up a few levels as well as checking the class markers.
 */
function isWasPrice(el) {
  if (STRUCK_THROUGH.some((sel) => el.closest(sel))) return true;
  for (let node = el, hops = 0; node && hops < 4; node = node.parentElement, hops++) {
    const style = getComputedStyle(node);
    if (style.textDecorationLine.includes('line-through')) return true;
  }
  return false;
}

function textOf(el) {
  if (!el) return '';
  const attr = el.getAttribute?.('content') ?? el.getAttribute?.('data-price');
  return String(attr ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
}

/** Looks like a price if it carries a currency mark or a plausible number. */
function looksLikePrice(text) {
  if (!text || text.length > 40) return false;
  if (!/\d/.test(text)) return false;
  return /[₹$£€¥]|(\b(INR|USD|GBP|EUR|Rs)\b)/i.test(text) || /^\s*[\d.,]+\s*$/.test(text);
}

/**
 * Last resort: look for price-shaped text in the page's main region.
 *
 * Deliberately timid, and the reason is a real failure. On an amazon.com page
 * with no featured offer — the product could not be shipped to the user's
 * address, so the page showed only variant options at $209.99, $249.99 and
 * $399.99 — an earlier version of this returned $114.99, a number belonging to
 * some other product entirely on the same page. The item then looked complete
 * and carried a price that was simply wrong.
 *
 * 03-ARCHITECTURE.md §4.4 rule 5 is explicit that a confidently wrong price is
 * worse than none, so this now declines whenever it is not sure:
 *
 *   · regions holding other products — sponsored strips, carousels, "similar
 *     items", the footer — are skipped entirely
 *   · if the candidates disagree, it returns nothing. Several different amounts
 *     in the main region means the page has several prices and this has no way
 *     to know which one is the product's.
 *
 * Declining is the right answer more often than it looks. This only runs when
 * every selector has already failed, which on a real product page means the
 * page is not laid out the way a product page usually is.
 */
function scanForPrice() {
  const root = document.querySelector('#dp, #centerCol, main, [role="main"]') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = new Set();
  let seen = 0;

  while (walker.nextNode() && seen < 4000 && found.size < 4) {
    seen++;
    const text = (walker.currentNode.textContent || '').trim();
    if (text.length > 24 || !/[₹$£€¥]/.test(text) || !/\d/.test(text)) continue;

    const parent = walker.currentNode.parentElement;
    if (!parent || insideAnotherProduct(parent)) continue;

    if (isWasPrice(parent)) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    if (looksLikePrice(text)) found.add(text.replace(/\s+/g, ''));
  }

  // One unambiguous answer, or none at all.
  return found.size === 1 ? [...found][0] : '';
}

function visiblePrice() {
  for (const selector of PRICE_SELECTORS) {
    for (const el of document.querySelectorAll(selector)) {
      // These two guards used to live only in the generic fallback, and both
      // failures that reached a real shelf came through here instead: a
      // sponsored product's $114.99 on a page whose own product had no offer,
      // and an M.R.P. of ₹5,799 on an item selling at ₹3,499. A selector hit is
      // not more trustworthy than a scan hit — it is just faster.
      if (insideAnotherProduct(el)) continue;
      if (isWasPrice(el)) continue;

      // .a-offscreen is deliberately hidden from sight but carries Amazon's real
      // price text, so the visibility check does not apply to it.
      const style = getComputedStyle(el);
      const offscreen = el.classList.contains('a-offscreen');
      if (!offscreen && (style.display === 'none' || style.visibility === 'hidden')) continue;

      const text = textOf(el);
      if (looksLikePrice(text)) return text;
    }
  }
  return scanForPrice();
}

/** Tier 1, but read from the rendered DOM rather than fetched HTML. */
function fromJsonLd() {
  const blocks = document.querySelectorAll('script[type="application/ld+json"]');
  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block.textContent || '');
    } catch {
      continue;   // malformed JSON-LD is common and must not stop the scrape
    }

    const found = findProduct(data);
    if (found?.name) return found;
  }
  return null;
}

function findProduct(node, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const r = findProduct(child, depth + 1); if (r) return r; }
    return null;
  }
  const types = [].concat(node['@type'] ?? []);
  if (types.some((t) => /^(Product|ProductGroup|IndividualProduct|Book|SoftwareApplication)$/i.test(String(t)))) {
    return node;
  }
  if (node['@graph']) return findProduct(node['@graph'], depth + 1);
  if (node.mainEntity) return findProduct(node.mainEntity, depth + 1);
  return null;
}

function firstImage(value, depth = 0) {
  if (depth > 4) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) { for (const v of value) { const r = firstImage(v, depth + 1); if (r) return r; } return ''; }
  if (value && typeof value === 'object') return String(value.url ?? value.contentUrl ?? '');
  return '';
}

function meta(selector) {
  return document.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
}

/** The largest image on the page that is plausibly the product. */
function largestImage() {
  let best = '';
  let bestArea = 0;
  for (const img of document.images) {
    const area = (img.naturalWidth || img.width) * (img.naturalHeight || img.height);
    if (area < 200 * 200) continue;
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) continue;
    if (/(sprite|spacer|pixel|blank|1x1|logo|icon|avatar|beacon|\/batch\/|fls-)/i.test(src)) continue;
    if (area > bestArea) { bestArea = area; best = src; }
  }
  return best;
}

/**
 * Everything worth sending. Missing fields are simply absent — the server's
 * ladder fills what it can, and an item saves either way.
 */
function scrape() {
  const product = fromJsonLd();
  const offer = product && [].concat(product.offers ?? product.hasVariant ?? []).flatMap(
    (o) => (o && typeof o === 'object' ? [o.offers ?? o] : []),
  ).flat().find((o) => o && (o.price !== undefined || o.lowPrice !== undefined));

  // B1 — Shopify writes og:price:amount, not product:price:amount. Check both
  // spellings, preferring product: when a page emits both.
  const priceText =
    (offer && String(offer.price ?? offer.lowPrice)) ||
    meta('meta[property="product:price:amount"]') ||
    meta('meta[property="og:price:amount"]') ||
    visiblePrice();

  const currency =
    (offer && typeof offer.priceCurrency === 'string' ? offer.priceCurrency : '') ||
    meta('meta[property="product:price:currency"]') ||
    meta('meta[property="og:price:currency"]') ||
    '';

  const scraped = {
    title: (product?.name || meta('meta[property="og:title"]') || document.title || '').trim().slice(0, 500),
    description: (product?.description || meta('meta[property="og:description"]') || '').trim().slice(0, 2000),
    image: firstImage(product?.image) || firstImage(product?.hasVariant) ||
           meta('meta[property="og:image"]') || largestImage(),
    priceText: priceText || undefined,
    priceCurrency: currency || undefined,
    siteName: meta('meta[property="og:site_name"]') || undefined,
  };

  for (const key of Object.keys(scraped)) if (!scraped[key]) delete scraped[key];
  return scraped;
}

/**
 * What the scrape saw, for the popup to show.
 *
 * A price that silently fails to appear is the hardest kind of bug to report:
 * the item looks fine and only the number is missing. This makes the failure
 * visible at the moment it happens, on the page where it happened.
 */
function diagnose() {
  const product = fromJsonLd();
  return {
    jsonLd: Boolean(product),
    ogTitle: Boolean(meta('meta[property="og:title"]')),
    ogPrice: Boolean(meta('meta[property="product:price:amount"]')),
    selectorHit: PRICE_SELECTORS.find((sel) => {
      const el = document.querySelector(sel);
      return el && looksLikePrice(textOf(el));
    }) || null,
    scanHit: Boolean(scanForPrice()),
    scanDeclined: !scanForPrice() && /[₹$£€¥]\s*[\d,]/.test(document.body.innerText || ''),
  };
}

// This file is both declared in the manifest and injected on demand by
// ensureScraper(). Injecting twice would register two listeners and answer every
// message twice, so the second run stops here.
const marker = /** @type {{ __stashScraperLoaded?: boolean }} */ (
  /** @type {unknown} */ (window)
);
if (!marker.__stashScraperLoaded) {
  marker.__stashScraperLoaded = true;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'stash:scrape') return false;
  try {
    sendResponse({ ok: true, scraped: scrape(), diagnostics: diagnose(), url: location.href });
  } catch (e) {
    // A scrape that throws must not stop the save. The server ladder and the
    // manual form are both still available. 01-PRD.md principle 1.
    sendResponse({ ok: false, error: String(e), url: location.href });
  }
  return true;
});

}
