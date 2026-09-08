# 02 — Technical Requirements

**Product:** Stash
**Version:** 1.0
**Depends on:** `01-PRD.md`

---

## 1. Constraints

These are hard. Every technical decision below is downstream of them.

| # | Constraint | Consequence |
|---|-----------|-------------|
| C1 | Zero rupees per month, permanently | Free tiers only. No credit card on file. No domain purchase. No Play Store listing (₹2,000 one-time). |
| C2 | Android, Windows, Linux | Rules out anything iOS/macOS-only in the toolchain. |
| C3 | Single user | No auth provider, no session management, no user table. |
| C4 | Must work on every site | No per-retailer integration as a precondition. |
| C5 | Must survive bad networks | Offline-first client. |
| C6 | Maintained by one person, part-time | Minimum number of moving parts. Fewer vendors beats better vendors. |

C6 deserves emphasis. A stack spread across four free tiers is four dashboards, four
outage surfaces, four sets of quota emails. One vendor is worth accepting a slightly worse
component for.

---

## 2. Stack decision

### 2.1 Selected

Everything on **Cloudflare**. One account, one config file, one deploy command.

| Layer | Service | Free tier (verified 2026) |
|-------|---------|---------------------------|
| API | Workers | 100,000 requests/day · 10 ms CPU per invocation · 50 subrequests |
| Database | D1 (SQLite) | 5 GB storage · 5M row reads/day · 100K row writes/day |
| Object storage | R2 | 10 GB stored · 1M Class A ops/mo · 10M Class B ops/mo · **zero egress cost** |
| Static hosting | Pages | Unlimited static requests · 500 builds/month |
| Scheduled jobs | Cron Triggers | Included with Workers |
| Domain | `*.pages.dev` / `*.workers.dev` | Free subdomain |

Framework on the Worker: **Hono**. Small, Workers-native, correct TypeScript types, no
build weight.

### 2.2 Headroom check

One person, generous estimate of thirty saves and twenty shelf opens per day:

| Resource | Daily use | Daily quota | Utilisation |
|----------|-----------|-------------|-------------|
| Worker requests | ~800 | 100,000 | 0.8% |
| D1 row writes | ~200 | 100,000 | 0.2% |
| D1 row reads | ~8,000 | 5,000,000 | 0.16% |
| R2 storage | +6 MB | 10 GB total | 30 months to fill |
| Pages builds | ~2 | 500/month | negligible |

Every meter sits under one percent. The stack does not need to be revisited unless the
product changes shape entirely.

### 2.3 Alternatives considered and rejected

**Supabase.** Rejected on two counts. Free projects pause after seven days of inactivity
and must be manually restored — for a tool used intermittently, this is the difference
between working and not. And the 5 GB egress cap is the wrong shape for an image-heavy
app; R2's zero-egress model fits far better. Supabase would otherwise have been a strong
choice.

**Vercel + Neon.** Two vendors, two dashboards, violating C6. Neon's scale-to-zero adds
cold-start latency on the exact path that must be fast.

**Firebase.** Requires billing enabled for anything beyond the smallest footprint. Fails C1
on principle even where it would not fail on price.

**Self-hosted on a home machine.** Genuinely free, but requires the machine to be always
on, plus dynamic DNS, plus TLS certificate management, plus a tunnel. Fails C6 badly for
a personal tool. It is however the correct escape hatch if Cloudflare's terms ever change,
and the architecture stays portable to it — see §9.2.

**Native Android app.** Play Store listing costs money. Side-loading works but means manual
APK distribution and no update channel. The PWA path gets the share sheet integration
without either problem.

---

## 3. Clients

### 3.1 Android — PWA with Web Share Target

**Decision.** No native app. A Progressive Web App, installed from Chrome, registers as an
Android share target through the Web Share Target API. It appears in the system share
sheet alongside native apps.

**Why this works.** When Chrome installs a PWA on Android it generates a WebAPK — a real
Android package signed by Google's servers. That package carries the intent filters
declared by `share_target` in the web manifest. The result is a genuine share-sheet entry
with no Play Store involvement and no developer fee.

**Manifest requirement:**

```json
{
  "name": "Stash",
  "short_name": "Stash",
  "start_url": "/",
  "display": "standalone",
  "share_target": {
    "action": "https://stash.pages.dev/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [
        { "name": "image", "accept": ["image/*"] }
      ]
    }
  }
}
```

**Three known traps. All three have bitten other projects.**

1. **`action` must be an absolute URL.** A relative path installs cleanly, reports success,
   and silently never appears in the share sheet. This is the single most common cause of
   "the manifest looks right but nothing happens".
2. **Android caches the manifest aggressively.** After any `share_target` change the PWA
   must be fully uninstalled and reinstalled. Reloading does nothing.
3. **`method: POST` with `multipart/form-data` is required** to receive shared *files*.
   A GET share target can only receive text and URLs. Since F4.3 requires accepting shared
   screenshots, POST is mandatory. The POST is intercepted by the service worker, not by
   the server.

**Verify this in P2 before building anything on top of it.** It is the highest-risk
assumption in the system (`01-PRD.md` R3).

**Desktop.** The same PWA installs on Windows and Linux from Chrome or Edge, giving a
standalone window and an app launcher entry. No separate desktop build.

### 3.2 Desktop — browser extension, Manifest V3

Separate from the PWA. Its job is capture, not browsing.

| Surface | Behaviour |
|---------|-----------|
| Toolbar button | Saves the current tab |
| Context menu | On page, link, image, and selection |
| Keyboard | `Ctrl+Shift+S` |
| Popup | Confirmation with editable title, note, category |

**The important property:** a content script reads the live DOM of the page the user is
actually looking at, while logged in. This defeats bot walls, cookie walls, and
region-gating that a server-side fetch cannot get past. On Amazon and Flipkart it produces
a correct price where a server fetch produces a CAPTCHA page.

So the extension is the *high-fidelity* capture path and the server fetch is the
*fallback*, not the reverse.

**Portability.** Manifest V3 with `browser_specific_settings` runs on Chrome, Edge, Brave
and Firefox from one codebase. No web store submission — both browsers load unpacked
extensions in developer mode, which is sufficient for a single user and costs nothing.

### 3.3 Web app

React 19 + Vite + TypeScript. Local store is IndexedDB via Dexie. State via Zustand or
React Context — no heavier state library is warranted at this size.

**No UI component library.** The design system in `04-DESIGN-SYSTEM.md` is specific and
short; shadcn/ui or MUI would be fought against more than used. Plain CSS with custom
properties, one stylesheet of tokens.

---

## 4. Data model

SQLite dialect, D1. All timestamps are epoch milliseconds stored as `INTEGER`.

```sql
-- Items: the core table.
CREATE TABLE items (
  id              TEXT PRIMARY KEY,          -- uuid v4, generated client-side
  url             TEXT NOT NULL,             -- as the user gave it
  canonical_url   TEXT NOT NULL,             -- normalised, see 03-ARCHITECTURE §4.1
  url_hash        TEXT NOT NULL,             -- sha256 of canonical_url, for dedupe
  title           TEXT,
  description     TEXT,
  note            TEXT,                      -- user's own words
  image_key       TEXT,                      -- R2 object key
  image_url       TEXT,                      -- original URL, fallback only
  image_width     INTEGER,
  image_height    INTEGER,
  price_amount    INTEGER,                   -- minor units. 249900 = ₹2,499.00
  price_currency  TEXT,                      -- ISO 4217
  site            TEXT,                      -- registrable domain, e.g. amazon.in
  site_name       TEXT,                      -- human name, e.g. Amazon
  source          TEXT NOT NULL,             -- extension | share | paste | manual
  category_id     TEXT REFERENCES categories(id),
  status          TEXT NOT NULL DEFAULT 'open',  -- open|shortlist|bought|dropped
  priority        INTEGER NOT NULL DEFAULT 0,    -- 0 none, 1 maybe, 2 want
  enrichment      TEXT NOT NULL DEFAULT 'pending', -- pending|rich|partial|manual|failed
  enrich_attempts INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  reviewed_at     INTEGER,                   -- last time user said "still want this"
  decided_at      INTEGER,                   -- when status became bought or dropped
  deleted_at      INTEGER                    -- soft delete tombstone
);

CREATE UNIQUE INDEX idx_items_url_hash  ON items(url_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_updated          ON items(updated_at);
CREATE INDEX idx_items_status_created   ON items(status, created_at DESC);
CREATE INDEX idx_items_category         ON items(category_id);


CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,   -- 1 = cannot be deleted
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);


CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE item_tags (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);


-- Classifier memory. Written when the user corrects a category.
CREATE TABLE classify_rules (
  id           TEXT PRIMARY KEY,
  match_type   TEXT NOT NULL,   -- domain | keyword
  match_value  TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  weight       INTEGER NOT NULL DEFAULT 1,   -- increments on repeat correction
  created_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_rules_match ON classify_rules(match_type, match_value);


-- Written on every enrichment. Not read by v1 UI. Reserved for v2 price tracking.
CREATE TABLE price_snapshots (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

CREATE INDEX idx_snapshots_item ON price_snapshots(item_id, captured_at DESC);


-- Single-row settings blob.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### 4.1 Notes on the model

**Prices are integers in minor units.** Never floats. `₹2,499.00` is `249900` with currency
`INR`. Floating-point currency is a bug waiting for a rainy day.

**Soft deletes only.** `deleted_at` is a tombstone. Sync needs tombstones to propagate
deletions; hard deletes would resurrect items on the next pull from a stale client.

**IDs are generated client-side** as UUID v4. This lets an offline client create an item,
render it immediately, and push it later without an ID reconciliation step.

**`reviewed_at` is separate from `updated_at`.** Editing a note should not reset an item's
staleness clock. Only an explicit "still want this" does.

**`price_snapshots` is written but never read in v1.** Deliberate. It costs one row per
enrichment and means the deferred price-tracking feature arrives with history rather than
starting empty.

**Search in v1 uses `LIKE` with lowercase comparison**, not FTS5. At the scale of one
person's shelf — hundreds, not millions — `LIKE` is fast enough and one less thing to
maintain. FTS5 is available on D1 if the shelf ever exceeds a few thousand items.

---

## 5. API contract

Base: `https://stash-api.<subdomain>.workers.dev/v1`
All requests carry `Authorization: Bearer <DEVICE_TOKEN>`.
All bodies and responses are JSON. All timestamps are epoch milliseconds.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness. No auth. |
| `POST` | `/items` | Create. Requires `url` or `manual: true` with `title`. |
| `GET` | `/items` | List. Query: `status`, `category`, `tag`, `q`, `since`, `limit`, `cursor`. |
| `GET` | `/items/:id` | Single item. |
| `PATCH` | `/items/:id` | Partial update. |
| `DELETE` | `/items/:id` | Soft delete. |
| `POST` | `/items/:id/enrich` | Force re-fetch of metadata. |
| `POST` | `/items/:id/review` | Set `reviewed_at = now`. Resets staleness. |
| `GET` | `/sync` | Delta. Query: `since`. Returns changed items, categories, tags, tombstones. |
| `GET` | `/categories` | List. |
| `POST` | `/categories` | Create. |
| `PATCH` | `/categories/:id` | Rename, reorder, re-icon. |
| `POST` | `/uploads/image` | Multipart. Returns `{ key }`. Used for manual screenshots. |
| `GET` | `/img/:key` | Serve from R2. Immutable cache headers. No auth. |
| `GET` | `/export` | Full JSON dump. |

### 5.1 Create item

```http
POST /v1/items
Authorization: Bearer <token>
Content-Type: application/json

{
  "id": "b3f1...",              // client-generated uuid
  "url": "https://www.amazon.in/dp/B0XXXX?ref=sr_1_3",
  "note": "for the desk",
  "source": "extension",
  "scraped": {                   // optional, extension only
    "title": "Keychron K2 Pro",
    "image": "https://m.media-amazon.com/images/I/71xxx.jpg",
    "priceAmount": 899900,
    "priceCurrency": "INR"
  }
}
```

**Response is immediate — `201` — and does not wait for enrichment.**

```json
{
  "id": "b3f1...",
  "url": "https://www.amazon.in/dp/B0XXXX?ref=sr_1_3",
  "canonicalUrl": "https://www.amazon.in/dp/B0XXXX",
  "title": "Keychron K2 Pro",
  "enrichment": "pending",
  "createdAt": 1757000000000,
  "duplicate": false
}
```

If `scraped` was supplied the item is created with `enrichment: "rich"` straight away.
Otherwise enrichment runs in `ctx.waitUntil()` after the response is sent, and the client
picks up the result on its next sync.

**Duplicate:** if `url_hash` already exists and is not deleted, respond `200` with the
existing item and `"duplicate": true`. Do not create a second row, and do not error.

### 5.2 Delta sync

```http
GET /v1/sync?since=1757000000000
```

```json
{
  "now": 1757003600000,
  "items":      [ /* items with updated_at > since, including tombstones */ ],
  "categories": [ /* ditto */ ],
  "tags":       [ /* ditto */ ],
  "hasMore": false
}
```

Client stores `now` as its next `since`. Tombstones are items with a non-null `deletedAt`;
the client removes them locally.

`hasMore` is set when the response was truncated at the page limit. The client then calls
again with `since` set to the highest `updatedAt` it received.

### 5.3 Errors

```json
{ "error": { "code": "INVALID_URL", "message": "Not a fetchable http(s) URL" } }
```

| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Bad or missing token |
| `INVALID_URL` | 400 | Not http(s), or blocked by SSRF rules |
| `NOT_FOUND` | 404 | No such item |
| `RATE_LIMITED` | 429 | Per-token limit exceeded |
| `PAYLOAD_TOO_LARGE` | 413 | Upload over 5 MB |
| `INTERNAL` | 500 | Anything else |

**Enrichment failure is never an API error.** It sets `enrichment: "failed"` on the item
and returns success. The save is the contract; the metadata is best-effort.

---

## 6. Security

Single user does not mean no security. The Worker is on the public internet.

**Authentication.** One long random token (32 bytes, base64url) held in a Worker secret.
Compared in constant time — a naive `===` on a secret is a timing oracle. Stored on the
client in `chrome.storage.local` for the extension and IndexedDB for the PWA. Rotation is
a single `wrangler secret put`.

**SSRF protection — mandatory.** The Worker fetches arbitrary user-supplied URLs. Without
guards this is an open proxy into private networks. Before any outbound fetch:

- scheme must be `http` or `https`
- reject hostnames resolving to loopback, link-local (`169.254.0.0/16`), or RFC1918 ranges
- reject `.local`, `.internal`, and bare hostnames without a dot
- reject cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`)
- cap redirects at 3, and re-run every check on each hop
- cap response body at 2 MB and abandon after 8 seconds

**Rate limiting.** Per-token, sliding window in Workers KV or Durable Objects: 60 writes
per minute, 600 reads per minute. This protects the free tier from a runaway client loop
far more than from an attacker.

**Content Security Policy** on the PWA. No inline scripts, no `unsafe-eval`. Images come
from `self` and the R2 proxy only — never from arbitrary remote hosts, which is a second
reason to copy images into R2 rather than hotlink.

**Input handling.** Length caps on every text field (title 500, note 2000, tag 50). Reject
oversized payloads at the edge. Never interpolate user text into SQL — D1 prepared
statements only.

**No secrets in the extension bundle.** The token is entered by the user at install time
and stored in extension storage. It is not compiled in.

---

## 7. Performance budgets

| Operation | Budget | Notes |
|-----------|--------|-------|
| Share tap → save confirmed | < 5 s p90 | The headline metric. Enrichment is not on this path. |
| API response, non-enriching | < 200 ms p95 | |
| Worker CPU per request | < 10 ms | Hard platform limit on the free tier. Time spent awaiting `fetch` does not count against it — only actual compute does. This is why streaming HTML parsing fits and buffering-plus-regex does not. |
| Shelf first render, 300 items | < 1 s | From local store, not network |
| Search keystroke → results | < 100 ms | Local |
| PWA bundle, gzipped | < 200 KB | |
| Scroll | 60 fps on mid-range Android | Virtualised list beyond 100 items |

**On the 10 ms CPU limit.** It is the tightest constraint in the system and the reason for
two specific choices: HTML is parsed with Cloudflare's streaming `HTMLRewriter` rather than
buffered and regexed, and images are stored at original size rather than resized on the
Worker. Both are covered in `03-ARCHITECTURE.md`.

---

## 8. Environment and configuration

```
Worker secrets (wrangler secret put)
  DEVICE_TOKEN          32-byte base64url random string

Worker bindings (wrangler.toml)
  DB                    D1 database
  BUCKET                R2 bucket
  RL                    KV namespace, rate limiting

Web app (.env)
  VITE_API_BASE         https://stash-api.<sub>.workers.dev/v1

Extension (entered by user at install, stored in chrome.storage.local)
  apiBase
  deviceToken
```

Nothing else. No third-party API keys, because there are no third-party APIs.

---

## 9. Forward compatibility

Two things are worth spending a little effort on now.

### 9.1 If it ever becomes multi-user

`01-PRD.md` says this is not a v1 concern, and it is not. But two cheap decisions keep the
door open:

- Every table carries `created_at` / `updated_at`, so a `user_id` column can be added and
  backfilled to a single value without a rewrite.
- Auth is a bearer token checked in one middleware function. Swapping that function for a
  JWT verifier touches one file.

Do not build a users table. Do not add a `user_id` column now. Just do not architect
against it.

### 9.2 If Cloudflare's terms change

The escape route is real and should stay real:

- The database is plain SQLite. `wrangler d1 export` produces a file that runs anywhere.
- The Worker is Hono, which runs on Node, Bun and Deno with a different adapter.
- R2 is S3-compatible, so any S3-compatible store is a drop-in.
- The PWA is static files.

Migrating to a self-hosted box is roughly a weekend, not a rewrite. This is worth the small
discipline of not using Cloudflare-proprietary features beyond `HTMLRewriter` — and that
one has a Node equivalent in `node-html-parser` or Bun's built-in `HTMLRewriter`.

---

## 10. Testing requirements

**The twenty-link fixture set.** A fixed file of twenty real URLs covering Amazon India,
Flipkart, Myntra, Ajio, a Shopify store, a WooCommerce store, a WordPress blog, a YouTube
video, a GitHub repository, a SaaS pricing page, a news article, a Reddit post, an
Instagram permalink, and several long-tail sites. Enrichment is measured against this set
and must clear 80% (`01-PRD.md` F2 acceptance). Re-run it whenever the enrichment ladder is
touched.

**Unit tests** for URL canonicalisation, the SSRF guard, the classifier, and price parsing.
These four are where subtle bugs hide and where regressions are silent.

**Integration tests** against a local D1 via `wrangler dev --local`, covering the full item
lifecycle and the sync delta.

**Manual checklist per phase** in `05-ROADMAP.md`. The share-target verification in P2 is
manual by necessity — it cannot be tested without a real Android device.
