# 03 — Architecture

**Product:** Stash
**Depends on:** `01-PRD.md`, `02-TRD.md`

---

## 1. Components

```
┌─────────────────────────────────────────────────────────────────┐
│ CAPTURE SURFACES                                                │
├──────────────────────┬──────────────────────┬───────────────────┤
│ Android share sheet  │ Browser extension    │ Paste in app      │
│ → PWA /share         │ → content script     │ → URL field       │
│   (service worker    │   reads live DOM     │                   │
│    intercepts POST)  │                      │                   │
└──────────┬───────────┴──────────┬───────────┴─────────┬─────────┘
           │                      │                     │
           └──────────────────────┼─────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │ LOCAL STORE (IndexedDB)    │
                    │ write first, always        │
                    │ outbox queue for pushes    │
                    └─────────────┬──────────────┘
                                  │  bearer token
                    ┌─────────────▼──────────────┐
                    │ WORKER  (Hono)             │
                    │  ├ auth middleware         │
                    │  ├ rate limit              │
                    │  ├ items CRUD              │
                    │  ├ sync delta              │
                    │  ├ enrichment (waitUntil)  │
                    │  ├ classifier              │
                    │  └ image proxy             │
                    └────┬──────────────┬────────┘
                         │              │
                  ┌──────▼─────┐  ┌─────▼──────┐
                  │ D1 SQLite  │  │ R2 objects │
                  └────────────┘  └────────────┘
```

Three capture surfaces, one local store, one Worker, two storage services. That is the
whole system.

---

## 2. The save path

This is the critical flow. Everything else is secondary.

```
User taps share
      │
      ▼
[1] Client generates uuid, writes item locally      ← under 50 ms
      │                                                the UI updates here
      ▼
[2] Card appears on shelf, marked "saving"          ← user is already done
      │
      ▼
[3] POST /v1/items  (fire and forget from the user's view)
      │
      ├─ network down? → outbox queue, retry later, card stays
      │
      ▼
[4] Worker validates, canonicalises, dedupes, inserts, returns 201
      │
      ▼
[5] ctx.waitUntil(enrich(item))   ← response already sent
      │
      ├─ fetch page (SSRF-guarded, 8 s cap, 2 MB cap)
      ├─ run extraction ladder (§4.2)
      ├─ fetch og:image → store to R2
      ├─ classify into a category
      ├─ write price snapshot if a price was found
      └─ UPDATE items SET ... , enrichment = 'rich' | 'partial' | 'failed'
      │
      ▼
[6] Client's next sync pulls the enriched row; the card fills in
```

**The user's experience ends at step 2.** Steps 3 through 6 are invisible. This is what
makes the five-second budget achievable — the budget covers only steps 1 and 2, and those
are local.

**When the extension supplies `scraped` data**, steps 5's ladder is skipped entirely. The
item is `rich` on arrival and only the image copy runs. This is the fast, high-quality
path.

---

## 3. Why the extension beats the server

Worth stating plainly, because it inverts the usual assumption.

| | Server-side fetch | Extension content script |
|---|---|---|
| Sees | What a bot sees | What the user sees |
| Logged in | No | Yes |
| Region | Cloudflare edge, wherever that is | The user's actual location |
| JavaScript-rendered prices | Missed | Present |
| Bot walls, CAPTCHAs | Blocked | Not triggered |
| Availability | Everywhere | Desktop browsers only |

On Amazon India, a server-side fetch frequently returns an interstitial rather than a
product page. The extension, running in a tab where the user is already logged in, reads
the real price out of the DOM.

**So the design is:** extension where available, server fetch as the universal fallback,
manual entry as the guaranteed floor. Every URL lands somewhere on that ladder.

---

## 4. Metadata extraction

### 4.1 URL canonicalisation

Runs before anything else. Two URLs that point at the same product must produce the same
`url_hash`, or dedupe fails and the shelf fills with near-duplicates.

Steps, in order:

1. Lowercase scheme and host. Strip `www.`
2. Remove tracking parameters: `utm_*`, `fbclid`, `gclid`, `ref`, `ref_`, `_encoding`,
   `psc`, `pd_rd_*`, `pf_rd_*`, `th`, `linkCode`, `tag`, `ascsubtag`, `igshid`, `si`,
   `feature`, `spm`, `affid`, `srsltid`
3. Sort remaining query parameters alphabetically
4. Strip the fragment, unless it is a hashbang route (`#!`)
5. Remove a trailing slash on non-root paths
6. Apply per-domain shorteners where the canonical form is known and stable:
   - `amazon.*` → keep only `/dp/<ASIN>`
   - `flipkart.com` → keep path plus `pid` parameter
   - `youtube.com/watch?v=X` and `youtu.be/X` → normalise to one form
   - `myntra.com` → keep the numeric product ID segment
7. `url_hash = sha256(canonical_url)`

Step 6 is the only site-specific logic in the system, and it is an optimisation — an
unrecognised domain falls through steps 1–5 and still works.

**Expand shortened links first.** `bit.ly`, `amzn.to`, `fkrt.it`, `t.co` and similar are
resolved by following redirects (max 3, SSRF-checked at every hop) before canonicalisation.

### 4.2 The extraction ladder

Attempted in order. Stop at the first tier that yields a title.

**Tier 0 — Extension scrape (desktop only)**
Content script reads the live DOM. Looks for `application/ld+json` blocks containing a
`Product` schema, then falls through to visible-price heuristics. Sends the result with the
create request. Sets `enrichment: rich`.

**Tier 1 — JSON-LD `Product` schema**
The highest-quality server-side source. Most commerce platforms — Shopify, WooCommerce,
Magento, and every major Indian marketplace — emit it for SEO.

```json
{
  "@type": "Product",
  "name": "Keychron K2 Pro",
  "image": ["https://.../71xxx.jpg"],
  "offers": { "@type": "Offer", "price": "8999.00", "priceCurrency": "INR" }
}
```

Handle the awkward real-world shapes: `@graph` arrays, `image` as either a string or an
array, `offers` as either an object or an array, and `price` as either a string or a
number. Sets `enrichment: rich` when a price is present.

**Tier 2 — Open Graph tags**
Nearly universal. `og:title`, `og:image`, `og:description`, `og:site_name`,
`product:price:amount`, `product:price:currency`. Sets `rich` with a price, `partial`
without.

**Tier 3 — Twitter Card tags**
`twitter:title`, `twitter:image`, `twitter:description`. Used only for fields Tier 2 did
not fill. Sets `partial`.

**Tier 4 — oEmbed**
For providers that publish an oEmbed endpoint. YouTube's is unauthenticated and reliable:
`https://www.youtube.com/oembed?url=<url>&format=json`. Sets `partial`.

**Tier 5 — Bare HTML**
`<title>`, `<meta name="description">`, and the first `<img>` larger than 200×200 that is
not obviously a logo or a tracking pixel. Sets `partial`.

**Tier 6 — Failed**
Nothing usable. Title falls back to the domain name. Sets `enrichment: failed`. The item
still exists, is still on the shelf, and offers the manual capture form.

### 4.3 Parsing implementation

**Use `HTMLRewriter`, not regex, not a DOM parser.**

`HTMLRewriter` is Cloudflare's streaming parser. It processes bytes as they arrive from
the origin and never builds a tree. Three consequences that all matter under the 10 ms CPU
budget (`02-TRD.md` §7):

- CPU cost is a fraction of buffering plus parsing
- memory stays flat regardless of page size
- parsing can abort as soon as `</head>` is reached, since every tag of interest lives in
  the head

```js
let meta = {};
const rewriter = new HTMLRewriter()
  .on('meta[property^="og:"]', {
    element(el) {
      const k = el.getAttribute('property')?.slice(3);
      const v = el.getAttribute('content');
      if (k && v) meta[k] = v;
    }
  })
  .on('meta[name^="twitter:"]', { element(el) { /* fallback fill */ } })
  .on('script[type="application/ld+json"]', {
    text(chunk) { /* accumulate, parse at chunk.lastInTextNode */ }
  })
  .on('title', { text(chunk) { /* accumulate */ } });

await rewriter.transform(response).arrayBuffer();
```

Note that JSON-LD arrives as multiple text chunks. Accumulate into a buffer and only
`JSON.parse` when `chunk.lastInTextNode` is true. Wrap that parse in try/catch — malformed
JSON-LD in the wild is common and must not fail the whole enrichment.

### 4.4 Price parsing

Prices in the wild are hostile. `₹8,999.00`, `Rs. 8999`, `8,999`, `INR 8999.00`,
`8999.00 ₹`, and `₹8.999,00` in some locales.

Rules:

1. Detect currency from an explicit `priceCurrency` field first, then from a symbol
   (`₹` → INR, `$` → USD, `£` → GBP, `€` → EUR), then default to INR
2. Strip currency symbols, currency codes, and whitespace
3. Determine the decimal separator: if both `.` and `,` appear, the rightmost one is the
   decimal separator; if only one appears and it is followed by exactly two digits at the
   end of the string, it is the decimal separator; otherwise it is a thousands separator
4. Convert to minor units as an integer
5. Sanity check: reject anything above 100,000,000 minor units or below 100. A parse that
   yields ₹0.01 or ₹10,00,00,000 is a parse failure, not a real price. Discard it and leave
   the field null rather than storing a wrong number.

Rule 5 matters. A visibly missing price is fine; a confidently wrong price is worse than
nothing.

### 4.5 Image handling

**Copy to R2, never hotlink.** Three reasons: source CDNs expire URLs, many block
cross-origin referers, and the PWA's Content Security Policy would otherwise have to allow
images from anywhere.

Flow: fetch the image URL → check `Content-Type` is `image/*` → check size is under 2 MB →
stream into R2 under key `img/<item_id>/<sha256(url).slice(0,16)>` → store the key on the
item.

**No resizing on the Worker.** Image processing would blow the 10 ms CPU budget. Instead,
originals are stored as-is and served with `Cache-Control: public, max-age=31536000,
immutable`. Display size is controlled by `<img>` `width`/`height` attributes plus
`loading="lazy"`. At one person's scale this trades a little bandwidth for a lot of
simplicity, and R2 egress is free.

If the image is over 2 MB or the fetch fails, store `image_url` as the original and mark
the item `partial`.

---

## 5. Categorisation

Rule-based. No LLM, no external call, no cost, no latency.

```
classify(item):
  1. classify_rules WHERE match_type='domain' AND match_value = item.site
       → hit? return that category            (user-taught rules win)

  2. built-in domain map
       amazon.in|flipkart.com|croma.com  → needs step 3, too broad
       myntra.com|ajio.com|nykaafashion  → Clothing
       github.com|npmjs.com|producthunt  → Software & Tools
       ikea.com|pepperfry.com|urbanladder→ Home
       goodreads.com|kindle              → Books
       → hit? return

  3. classify_rules WHERE match_type='keyword' AND title CONTAINS match_value
       ORDER BY weight DESC
       → hit? return                          (user-taught rules win again)

  4. built-in keyword dictionary, matched against lowercased title
       Gadgets  : headphone earbuds laptop keyboard mouse monitor charger
                  ssd router camera watch speaker tablet phone gpu
       Home     : chair table lamp shelf sofa mattress curtain rug desk
                  cookware storage organiser
       Clothing : shirt jeans shoes jacket kurta saree sneaker dress
                  hoodie watch-strap
       Software : app tool saas licence subscription plugin theme course
                  api template
       Books    : book novel edition paperback hardcover author
       → best match by count? return

  5. return Other
```

**Learning.** When the user corrects a category, upsert a `classify_rules` row: a
`domain` rule for the item's site, and a `keyword` rule for the most distinctive noun in
the title. On repeat corrections, increment `weight`. Since steps 1 and 3 are checked
before the built-in maps, user corrections always override defaults.

The classifier is deliberately simple. It will be wrong sometimes. Correction is one tap
and the system remembers — that is a better trade than an expensive classifier that is
wrong in less predictable ways.

---

## 6. Sync

### 6.1 Model

Server authoritative. Clients hold a full local replica. Deltas by timestamp.

```
Client                                   Worker
  │                                        │
  │  GET /v1/sync?since=<lastSyncAt>       │
  ├───────────────────────────────────────►│
  │                                        │ SELECT * FROM items
  │                                        │ WHERE updated_at > ?
  │                                        │ ORDER BY updated_at
  │                                        │ LIMIT 500
  │  { now, items[], categories[], ... }   │
  │◄───────────────────────────────────────┤
  │                                        │
  │  upsert into IndexedDB                 │
  │  remove rows with deletedAt            │
  │  lastSyncAt = now                      │
  │  if hasMore → repeat                   │
```

**Push** is per-item, from the outbox queue. Each queued mutation retries with exponential
backoff (1 s, 2 s, 4 s, 8 s, 30 s, then every 5 minutes) and survives app restarts.

**Conflicts** resolve last-write-wins on `updated_at`. For a single user with a shelf of
saved links this is correct in every realistic case. Do not build CRDTs.

### 6.2 Triggers

On app open, on window focus, after any local write, and every five minutes while
foregrounded. Not on a background timer when the app is closed — that would burn quota for
no benefit.

### 6.3 First sync

`since=0` returns everything, paginated at 500. For a shelf under a few thousand items this
is a handful of round trips.

---

## 7. Offline

**Local write is the source of truth for the UI.** The network is a background concern.

- Every mutation writes to IndexedDB first and updates the UI immediately
- The mutation is also appended to an outbox
- A background flush drains the outbox whenever connectivity allows
- The service worker registers a Background Sync event so the flush can run even after the
  app is closed, on browsers that support it
- Items with unflushed mutations render with a subtle syncing indicator

**The share target must work offline.** A user shares a link on a train with no signal; the
service worker intercepts the POST, writes to IndexedDB, and shows success. The item syncs
later. If this does not work, the product has failed its core promise.

---

## 8. Failure modes

Every one of these has a defined behaviour. None of them shows the user an error for a
save.

| Failure | Behaviour |
|---------|-----------|
| Network down at save | Local write, outbox queue, card shows syncing. No error. |
| Worker returns 5xx | Same as above — retry with backoff |
| Enrichment times out (8 s) | Item stays, `enrichment: failed`, retry available in the detail view |
| Page is bot-walled | Falls to Tier 6, offers manual capture form |
| Image fetch fails | Keep `image_url` as fallback, mark `partial` |
| Image over 2 MB | Skip R2 copy, keep original URL, mark `partial` |
| Duplicate URL saved | Return the existing item with `duplicate: true`, surface it, offer to bump |
| Malformed JSON-LD | Caught, ladder continues to Tier 2 |
| Price parses to an absurd value | Discarded. Null is better than wrong. |
| D1 write fails | 500 to client → client retries from outbox |
| R2 write fails | Item saved without an image, marked `partial` |
| Token invalid | 401. Client shows a token re-entry screen, does not discard local data. |
| Rate limited | 429. Client backs off, keeps queue. |

The pattern throughout: **degrade, never block.** The save is the promise. Metadata,
images, and categories are all improvements on top of a promise that has already been kept.

---

## 9. Scheduled work

One cron trigger, daily.

```
0 3 * * *   (03:00 UTC)
  ├─ retry items where enrichment='failed' AND enrich_attempts < 3
  ├─ purge soft-deleted items older than 90 days, and their R2 objects
  └─ recompute shelf health counters into settings
```

The weekly digest (F11.3) is a second trigger, Sunday, delivered as a web push
notification. Push requires VAPID keys, which are generated locally and cost nothing.

---

## 10. Repository layout

A monorepo. One place, three deployables.

```
stash/
├── README.md
├── docs/                        ← these documents
├── package.json                 ← workspaces
│
├── worker/
│   ├── wrangler.toml
│   ├── migrations/
│   │   └── 0001_init.sql
│   └── src/
│       ├── index.ts             ← Hono app, route mounting
│       ├── middleware/
│       │   ├── auth.ts          ← constant-time token check
│       │   └── rateLimit.ts
│       ├── routes/
│       │   ├── items.ts
│       │   ├── sync.ts
│       │   ├── categories.ts
│       │   ├── uploads.ts
│       │   └── images.ts
│       ├── lib/
│       │   ├── canonicalise.ts  ← §4.1
│       │   ├── ssrf.ts          ← guard, 02-TRD §6
│       │   ├── enrich.ts        ← the ladder, §4.2
│       │   ├── extractors/
│       │   │   ├── jsonld.ts
│       │   │   ├── opengraph.ts
│       │   │   ├── oembed.ts
│       │   │   └── bare.ts
│       │   ├── price.ts         ← §4.4
│       │   ├── classify.ts      ← §5
│       │   └── images.ts        ← §4.5
│       └── db/
│           ├── schema.ts
│           └── queries.ts
│
├── web/
│   ├── vite.config.ts
│   ├── public/
│   │   ├── manifest.webmanifest ← share_target lives here
│   │   └── icons/
│   └── src/
│       ├── main.tsx
│       ├── sw.ts                ← service worker, share POST handler
│       ├── db/                  ← Dexie schema, outbox
│       ├── api/                 ← typed client
│       ├── sync/                ← delta pull, outbox flush
│       ├── styles/
│       │   └── tokens.css       ← 04-DESIGN-SYSTEM
│       ├── components/
│       └── screens/
│           ├── Shelf.tsx
│           ├── ItemDetail.tsx
│           ├── Capture.tsx      ← /share lands here
│           └── Settings.tsx
│
├── extension/
│   ├── manifest.json            ← MV3
│   └── src/
│       ├── background.ts        ← context menus, commands
│       ├── content.ts           ← DOM scrape, Tier 0
│       └── popup/
│
└── shared/
    └── types.ts                 ← Item, Category, API shapes — imported by all three
```

`shared/types.ts` is not optional. Three clients drifting on the shape of an `Item` is the
most likely source of silent bugs in a system like this.
