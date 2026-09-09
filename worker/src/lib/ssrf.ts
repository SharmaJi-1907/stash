/**
 * SSRF guard for outbound fetches.
 *
 * Spec: 02-TRD.md §6 · cases in 06-AGENT-BUILD-GUIDE.md §4.2
 *
 * The Worker fetches URLs the user supplies. Without this it is an open proxy:
 * anyone who can reach the API can make the Worker request private addresses on
 * its behalf and read the answer back out of the saved item's title.
 *
 * Two rules carry most of the weight:
 *
 *   Every redirect hop is re-checked. A URL that passes on the way in can
 *   redirect to 127.0.0.1, and checking only the first URL is the standard way
 *   this defence is defeated.
 *
 *   Addresses are compared numerically, never by string. `http://2130706433/`,
 *   `http://0x7f000001/` and `http://[::ffff:127.0.0.1]/` are all loopback
 *   written differently. The URL parser folds the first two to 127.0.0.1 on its
 *   own; it does NOT do the same for the IPv6-mapped form, which it rewrites to
 *   `[::ffff:7f00:1]` — the hex spelling that the first version of this file let
 *   straight through. Both are handled below.
 *
 * ── Known limit, stated rather than hidden ──────────────────────────────────
 *
 * This does not resolve DNS. Workers has no resolver API, so a hostname that
 * *resolves* to a private address — the `localtest.me` family, or an attacker's
 * own domain with an A record of 127.0.0.1 — passes the hostname checks here.
 * What blocks those in production is the platform: a Worker at Cloudflare's edge
 * has no route to RFC1918 space or to the caller's LAN, so the fetch fails
 * regardless. The checks below are the layer that does not depend on that being
 * true, and they are what makes `wrangler dev` on a laptop — which *can* reach
 * localhost — safe to run.
 */

/** 02-TRD.md §6: cap redirects at 3, body at 2 MB, abandon after 8 seconds. */
export const MAX_REDIRECTS = 3;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;

export class BlockedUrlError extends Error {
  constructor(readonly reason: string, readonly url: string) {
    super(`Blocked: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

/** Hostnames that are never fetchable, whatever they resolve to. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Suffixes that only ever name something inside a private network. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa', '.lan', '.intranet'];

/**
 * Decode the numeric host forms a URL parser leaves alone.
 * Returns four octets, or null if the host is not an IPv4 address in any form.
 */
function toIPv4(host: string): [number, number, number, number] | null {
  // Dotted quad, the normal case.
  const dotted = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const parts = dotted.slice(1).map(Number) as [number, number, number, number];
    return parts.every((n) => n <= 255) ? parts : null;
  }

  // Bare integer, hex, or octal — 2130706433, 0x7f000001, 017700000001.
  //
  // In practice the WHATWG URL parser already folds all of these to 127.0.0.1
  // before assertFetchable sees them, so this branch does not fire on that path.
  // It is kept because it is the guard that does not depend on that behaviour:
  // a hostname arriving from anywhere other than `new URL` — a future caller, a
  // Location header parsed by hand — would otherwise skip the check entirely.
  // Verified 2026-09-09: 2130706433, 0x7f000001, 017700000001, 127.1,
  // 0177.0.0.1 and 0x7f.0x0.0x0.0x1 all parse to hostname 127.0.0.1.
  let n: number | null = null;
  if (/^\d+$/.test(host)) n = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16);
  else if (/^0[0-7]+$/.test(host)) n = parseInt(host, 8);
  if (n === null || !Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;

  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/** Ranges that must never be fetched. */
function privateIPv4Reason(ip: [number, number, number, number]): string | null {
  const [a, b] = ip;
  if (a === 0) return 'unspecified address';
  if (a === 10) return 'private network (10/8)';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local — includes the cloud metadata endpoint';
  if (a === 172 && b >= 16 && b <= 31) return 'private network (172.16/12)';
  if (a === 192 && b === 168) return 'private network (192.168/16)';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT (100.64/10)';
  if (a === 192 && b === 0) return 'IETF protocol assignment (192.0.0/24)';
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking range (198.18/15)';
  if (a >= 224) return 'multicast or reserved';
  return null;
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups, or null if it is not one.
 * Handles `::` compression and the trailing-dotted-quad form.
 */
function expandIPv6(raw: string): number[] | null {
  let text = raw.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0]!;
  if (!text.includes(':')) return null;

  // A trailing IPv4 quad — ::ffff:127.0.0.1 — becomes two hex groups. Most URL
  // parsers do this for us, but the raw form still reaches here from redirects.
  const quad = text.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (quad) {
    const v4 = toIPv4(quad[1]!);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = text.slice(0, -quad[1]!.length) + `${hi}:${lo}`;
  }

  const [head, tail, extra] = text.split('::');
  if (extra !== undefined) return null;

  const parse = (part: string | undefined) =>
    part ? part.split(':').filter((g) => g !== '').map((g) => parseInt(g, 16)) : [];

  const left = parse(head);
  const right = parse(tail);
  if ([...left, ...right].some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;

  if (tail === undefined) return left.length === 8 ? left : null;

  const gap = 8 - left.length - right.length;
  if (gap < 0) return null;
  return [...left, ...Array<number>(gap).fill(0), ...right];
}

function privateIPv6Reason(host: string): string | null {
  const g = expandIPv6(host);
  if (!g) return null;

  const allZeroThrough = (n: number) => g.slice(0, n).every((x) => x === 0);

  if (allZeroThrough(7) && g[7] === 1) return 'IPv6 loopback (::1)';
  if (g.every((x) => x === 0)) return 'unspecified address (::)';

  // IPv4-mapped ::ffff:0:0/96 and IPv4-compatible ::/96. The URL parser rewrites
  // ::ffff:127.0.0.1 to ::ffff:7f00:1, so this has to work on the hex form —
  // matching the dotted spelling alone lets the mapped loopback straight through.
  const mapped = allZeroThrough(5) && (g[5] === 0xffff || g[5] === 0);
  if (mapped) {
    const v4: [number, number, number, number] = [
      (g[6]! >> 8) & 255, g[6]! & 255, (g[7]! >> 8) & 255, g[7]! & 255,
    ];
    const reason = privateIPv4Reason(v4);
    if (reason) return `IPv4-mapped ${reason}`;
  }

  if ((g[0]! & 0xfe00) === 0xfc00) return 'IPv6 unique local (fc00::/7)';
  if ((g[0]! & 0xffc0) === 0xfe80) return 'IPv6 link-local (fe80::/10)';
  if ((g[0]! & 0xff00) === 0xff00) return 'IPv6 multicast (ff00::/8)';
  return null;
}

/**
 * Throw unless this URL is safe to fetch. Returns the parsed URL so callers do
 * not parse twice.
 */
export function assertFetchable(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(String(input).trim());
  } catch {
    throw new BlockedUrlError('not a URL', String(input));
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`scheme ${url.protocol} is not fetchable`, url.href);
  }

  // Credentials in a URL are a redirect-laundering trick and are never needed here.
  if (url.username || url.password) {
    throw new BlockedUrlError('URL carries credentials', url.href);
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(host)) {
    throw new BlockedUrlError(`${host} is not a public host`, url.href);
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new BlockedUrlError(`${suffix} names a private network`, url.href);
    }
  }

  const v6 = privateIPv6Reason(host);
  if (v6) throw new BlockedUrlError(v6, url.href);

  const v4 = toIPv4(host);
  if (v4) {
    const reason = privateIPv4Reason(v4);
    if (reason) throw new BlockedUrlError(reason, url.href);
  }

  // A hostname with no dot is a LAN name — `http://internal/`, `http://router/`.
  // Anything on the public internet has a registrable suffix.
  if (!v4 && !host.includes('.') && !host.includes(':')) {
    throw new BlockedUrlError('bare hostname with no domain', url.href);
  }

  return url;
}

export interface SafeFetchResult {
  response: Response;
  /** The URL actually fetched, after redirects. Use this for canonicalisation. */
  finalUrl: string;
}

/**
 * Fetch with the guard applied to every hop, a hard timeout, and no automatic
 * redirect following — automatic following would skip the per-hop check.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  { maxRedirects = MAX_REDIRECTS, timeoutMs = FETCH_TIMEOUT_MS } = {},
): Promise<SafeFetchResult> {
  let url = assertFetchable(input);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(url, { ...init, redirect: 'manual', signal });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');
    if (!isRedirect || !location) return { response, finalUrl: url.href };

    if (hop === maxRedirects) {
      throw new BlockedUrlError(`more than ${maxRedirects} redirects`, url.href);
    }

    // Re-parse relative to the current URL, then re-run every check. This is the
    // line that stops a public URL redirecting into the private network.
    url = assertFetchable(new URL(location, url));
  }

  throw new BlockedUrlError('redirect loop', String(input));
}

/**
 * Read at most MAX_BODY_BYTES of a response as text, then stop.
 * A Content-Length header is trusted only to reject early; a missing or lying
 * one is caught by counting bytes as they arrive.
 */
export async function readCappedText(
  response: Response,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BlockedUrlError(`body declares ${declared} bytes, over the cap`, response.url);
  }

  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(decoder.decode(value.slice(0, value.byteLength - (total - maxBytes))));
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return chunks.join('');
}
