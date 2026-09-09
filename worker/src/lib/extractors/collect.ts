/**
 * One streaming pass over the HTML, collecting every raw signal the ladder
 * might want. The tiers in 03-ARCHITECTURE.md §4.2 then interpret what was
 * collected without touching the page again.
 *
 * Spec: 03-ARCHITECTURE.md §4.3
 *
 * Why one pass and not one per tier: the 10 ms CPU limit is the tightest
 * constraint in the system (02-TRD.md §7). Parsing the same bytes four times
 * would cost four times as much, and HTMLRewriter is a stream — there is no
 * second chance at bytes that have gone past.
 *
 * Why HTMLRewriter and not a regex over a buffered body: buffering a real
 * product page costs both the memory and the CPU that the limit is there to
 * protect. This is 06-AGENT-BUILD-GUIDE.md §1.4, and it is not optional.
 */

export interface Collected {
  /** Raw text of every application/ld+json block, unparsed. */
  jsonLd: string[];
  /** og:* content, keyed without the prefix — `title`, `image`, `site_name`. */
  og: Record<string, string>;
  /** twitter:* content, keyed without the prefix. */
  twitter: Record<string, string>;
  /** <title> text. */
  title: string;
  /** <meta name="description">. */
  description: string;
  /** Candidate <img> sources, in document order, filtered for obvious junk. */
  images: string[];
  /** True when parsing stopped at the byte budget rather than the end. */
  truncated: boolean;
}

/** Thrown internally to stop the stream once the budget is spent. */
class StopParsing extends Error {}

/**
 * Data URIs, spacers and tracking beacons are never a product photo.
 *
 * This is a first filter only. It cannot catch everything — amazon.com serves a
 * 43-byte beacon from `fls-na.amazon.com/1/batch/1/OP/...`, a URL with no
 * tell-tale word in it at all. The guard that actually holds is MIN_IMAGE_BYTES
 * in images.ts, which judges the bytes rather than the name.
 */
function plausibleImage(src: string): boolean {
  if (!src || src.startsWith('data:')) return false;
  if (/(sprite|spacer|pixel|blank|1x1|logo|icon|avatar|placeholder|beacon|\/batch\/|fls-)/i.test(src)) {
    return false;
  }
  return /^https?:\/\//i.test(src) || src.startsWith('//') || src.startsWith('/');
}

/**
 * Collect signals from an HTML response.
 *
 * `budgetBytes` bounds the work. Setting it low makes this cheap and misses
 * anything late in the document; the caller decides. See ENRICH_PARSE_BUDGET
 * in enrich.ts for the measurement behind the default.
 */
export async function collect(response: Response, budgetBytes: number): Promise<Collected> {
  const out: Collected = {
    jsonLd: [], og: {}, twitter: {}, title: '', description: '', images: [], truncated: false,
  };

  let seen = 0;
  let ldBuffer = '';

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const property = el.getAttribute('property')?.toLowerCase();
        const name = el.getAttribute('name')?.toLowerCase();
        const content = el.getAttribute('content');
        if (!content) return;

        if (property?.startsWith('og:')) {
          const key = property.slice(3);
          out.og[key] ??= content;
        } else if (property?.startsWith('product:')) {
          out.og[property] ??= content;
        } else if (name?.startsWith('twitter:')) {
          out.twitter[name.slice(8)] ??= content;
        } else if (name === 'description') {
          out.description ||= content;
        }
      },
    })
    .on('title', {
      text(chunk) { out.title += chunk.text; },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        // JSON-LD arrives as several text chunks. Accumulate and only hand the
        // whole block over when the node ends. Spec: 03-ARCHITECTURE.md §4.3
        ldBuffer += chunk.text;
        if (chunk.lastInTextNode) {
          if (ldBuffer.trim()) out.jsonLd.push(ldBuffer);
          ldBuffer = '';
        }
      },
    })
    .on('img', {
      element(el) {
        if (out.images.length >= 12) return;
        const src = el.getAttribute('src') ?? el.getAttribute('data-src') ?? '';
        if (plausibleImage(src)) out.images.push(src);
      },
    })
    .on('link[rel="image_src"]', {
      element(el) {
        const href = el.getAttribute('href');
        if (href && plausibleImage(href)) out.images.unshift(href);
      },
    });

  const transformed = rewriter.transform(response);
  const reader = transformed.body?.getReader();
  if (!reader) return out;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value.byteLength;
      if (seen >= budgetBytes) { out.truncated = true; throw new StopParsing(); }
    }
  } catch (e) {
    if (!(e instanceof StopParsing)) {
      // A malformed document must not lose the signals already collected.
      out.truncated = true;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  out.title = out.title.trim().replace(/\s+/g, ' ');
  return out;
}
