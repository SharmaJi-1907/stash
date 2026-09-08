# 05 — Roadmap

**Product:** Stash
**Depends on:** `01-PRD.md`, `02-TRD.md`, `03-ARCHITECTURE.md`, `04-DESIGN-SYSTEM.md`

---

## Shape of the plan

Six phases. **P0 through P2 are the product.** Everything after is improvement on a thing
that already works and is already in daily use.

The most likely way this project fails is not a technical problem — it is building P3, P4
and P5 before P2 has ever been used for real (`01-PRD.md` R8). Ship P2. Use it for two
weeks. Then decide what P3 should actually contain.

| Phase | Delivers | Estimate |
|-------|----------|----------|
| P0 | Foundation — deploys, database, auth | 1 session |
| P1 | Capture and enrich — Worker API, extension | 2–3 sessions |
| P2 | **The app — PWA, share target, shelf, sync** | 3–4 sessions |
| — | **Usable here. Stop and use it.** | 2 weeks |
| P3 | Organise — categories, classifier, search | 1–2 sessions |
| P4 | Decide — lifecycle, staleness, digest | 1–2 sessions |
| P5 | Later — price tracking and beyond | deferred |

A "session" is a focused block of a few hours.

---

## P0 — Foundation

**Goal.** A deployed Worker answering a health check, backed by a real database, behind
real auth. Nothing user-visible. This phase exists so that every later phase deploys to
something that already works.

### Tasks

1. Monorepo scaffold per `03-ARCHITECTURE.md` §10, npm workspaces
2. `shared/types.ts` — `Item`, `Category`, `Tag`, API request and response shapes
3. Cloudflare account; create D1 database, R2 bucket, KV namespace for rate limiting
4. `worker/wrangler.toml` with all three bindings
5. Migration `0001_init.sql` — full schema from `02-TRD.md` §4, including indexes
6. Hono app skeleton, `GET /health` unauthenticated
7. Auth middleware — bearer token, **constant-time comparison**
8. Rate limit middleware — KV sliding window, 60 writes/min, 600 reads/min
9. Generate `DEVICE_TOKEN`, store via `wrangler secret put`
10. Deploy to `workers.dev`

### Done when

- `GET /health` returns 200 from the public URL
- Any authenticated route returns 401 without a token and passes with one
- `wrangler d1 execute --command "SELECT name FROM sqlite_master"` lists all seven tables
- Rate limiting demonstrably triggers under a burst

### Watch for

Constant-time comparison is not optional and is easy to skip. A plain `===` on a secret
leaks it byte by byte through response timing. Use `crypto.subtle.timingSafeEqual` or an
explicit XOR-accumulate loop over the full length of both strings.

---

## P1 — Capture and enrich

**Goal.** A URL can be saved from a desktop browser and comes back with a real title,
image, price and category. No app yet — verified with `curl` and the extension popup.

### Tasks

**Worker**

1. `lib/canonicalise.ts` — `03-ARCHITECTURE.md` §4.1, with unit tests
2. `lib/ssrf.ts` — the full guard from `02-TRD.md` §6, with unit tests
3. `POST /v1/items` — validate, canonicalise, dedupe on `url_hash`, insert, return 201
   immediately
4. `lib/enrich.ts` — the ladder, run inside `ctx.waitUntil()`
5. `lib/extractors/jsonld.ts` — including `@graph`, array-vs-object `offers`, and a
   try/catch around every parse
6. `lib/extractors/opengraph.ts` — `HTMLRewriter`, one pass, abort at `</head>`
7. `lib/extractors/oembed.ts` — YouTube first
8. `lib/extractors/bare.ts` — `<title>` plus first meaningful image
9. `lib/price.ts` — `03-ARCHITECTURE.md` §4.4 including the sanity check, with unit tests
10. `lib/images.ts` — fetch, verify content type, 2 MB cap, stream to R2
11. `GET /img/:key` — serve from R2 with immutable cache headers
12. `GET /v1/items`, `GET /v1/items/:id`, `PATCH`, `DELETE` (soft)
13. `POST /v1/items/:id/enrich` — force re-run

**Extension**

14. MV3 manifest, Chrome and Firefox compatible
15. `background.ts` — context menus for page, link and image; `Ctrl+Shift+S` command
16. `content.ts` — Tier 0 scrape: JSON-LD `Product` first, then visible-price heuristics
17. Options page — API base and device token entry, stored in `chrome.storage.local`
18. Popup — confirmation with editable title and note

### Done when

- The twenty-link fixture set (`02-TRD.md` §10) reaches **80% or better** at `rich` or
  `partial`
- Saving from Amazon India via the extension captures the correct price
- Saving the same URL twice creates one row and returns `duplicate: true`
- An SSRF attempt against `http://169.254.169.254/` and `http://localhost:8080/` is
  rejected
- A page that times out still produces a saved item marked `failed`
- Images appear under `/img/:key` and are served from R2

### Watch for

**Do not buffer the HTML and regex it.** It will pass tests on small pages and blow the
10 ms CPU limit on a real Amazon page. `HTMLRewriter`, streaming, abort at `</head>`.

**Build the fixture set before the extractors, not after.** It is the only way to know
whether the ladder is working, and writing it afterwards biases it toward whatever was
built.

---

## P2 — The app

**Goal.** The product exists. Save from an Android share sheet, see the shelf on both
phone and desktop, works offline.

### Tasks

**Do task 1 first and alone.**

1. **Verify the Android share target.** Minimal PWA: manifest with `share_target`, a
   `/share` route that displays whatever it receives. Install on the real phone. Share a
   YouTube link. Confirm Stash appears in the sheet and receives the URL.
   - `action` must be an **absolute** URL
   - `method: "POST"`, `enctype: "multipart/form-data"`
   - after every manifest change, **fully uninstall and reinstall** the PWA
   - this is `01-PRD.md` R3, the highest-risk assumption in the system

2. Vite + React + TypeScript scaffold, deployed to Cloudflare Pages
3. `styles/tokens.css` — every token from `04-DESIGN-SYSTEM.md` §3, §4, §5
4. Self-hosted IBM Plex Sans WOFF2, weights 400/500/600
5. Dexie schema mirroring the server, plus an `outbox` table
6. Typed API client from `shared/types.ts`
7. Service worker: cache shell, intercept the share POST, write to IndexedDB
8. `Capture.tsx` — the screen from `04-DESIGN-SYSTEM.md` §7.3. **Save enabled from the
   first frame.**
9. `Shelf.tsx` — Stack view, card per §7.1, virtualised beyond 100 items
10. Board view and the persisted toggle
11. `ItemDetail.tsx`
12. Sync: delta pull on open, focus, and every 5 minutes
13. Outbox flush with exponential backoff, surviving restart
14. Background Sync registration
15. The assembly animation — §7.4, the one orchestrated moment
16. Light theme, `data-theme` on `<html>`, following `prefers-color-scheme` by default
17. Settings: token entry, theme, export

### Done when

- Sharing a link from YouTube on Android puts it on the shelf in **under 5 seconds**
- The same item appears on the desktop within 30 seconds of focusing that window
- In airplane mode, five saves succeed; on reconnect all five sync unprompted
- 300 items render in under 1 second and scroll at 60 fps on the actual phone
- The PWA installs on Windows and Linux and opens in its own window
- Both themes pass contrast checks
- Keyboard navigation reaches every action
- Gzipped bundle is under 200 KB

### Watch for

**Task 1 gates the phase.** If the share target cannot be made to work, the plan changes
before anything is built on top of it — the fallback is a Trusted Web Activity wrapper,
which still avoids the Play Store but adds an Android build step.

**The save must never block on the network.** Local write, render, then push. If the UI
ever spins waiting for the server, the five-second budget is gone and so is the product's
core promise.

---

## Stop here. Use it.

**Two weeks of real daily use before writing any more code.**

Save whatever comes up, from wherever it comes up. Then look at:

- Which sites failed to enrich, specifically
- Whether items are being found again, or whether the shelf is already being ignored
- Whether the categories that seemed obvious are the ones actually needed
- Whether the read-to-write ratio is above zero at all

P3 and P4 as written below are a good guess. Two weeks of use will produce a better one.
Overwrite these lists with what is actually learned.

---

## P3 — Organise

**Goal.** Three hundred items stay navigable.

### Tasks

1. Seed the six default categories; category CRUD; `Other` protected from deletion
2. `lib/classify.ts` — the rule ladder from `03-ARCHITECTURE.md` §5
3. Built-in domain map and keyword dictionary
4. `classify_rules` learning on user correction, with `weight` increment
5. One-tap category change on the card
6. Tags: add, autocomplete from existing, remove
7. Search across title, note, tags and site — local, debounced 150 ms
8. Filter chips per `04-DESIGN-SYSTEM.md` §7.5; filters combine; one-tap clear
9. Sort options: newest, oldest, price, category, recently touched
10. Empty states per §7.6

### Done when

- After 20 saves and at most 5 corrections, new items from seen domains classify correctly
- Search returns in under 100 ms with 500 items
- Filters combine and clear correctly
- Every empty state carries the action it names

---

## P4 — Decide

**Goal.** The shelf gets shorter. This is the phase that determines whether the product
survives its first year.

### Tasks

1. Status lifecycle: `open` → `shortlist` → `bought` / `dropped`
2. Swipe gestures per `04-DESIGN-SYSTEM.md` §7.2, with a 6-second undo toast
3. Keyboard and button equivalents in the detail view
4. Bought and dropped leave the shelf, stay filterable and restorable
5. Age treatment per §6 — the left rule, the opacity taper, the inline prompt
6. `POST /items/:id/review` and the "still want this?" tap
7. Daily cron: retry failed enrichments, purge tombstones older than 90 days
8. Weekly digest via web push — one notification, VAPID keys generated locally
9. Shelf health indicator against a soft target
10. Local metrics instrumentation for M1–M6 (`01-PRD.md` §8). No third-party analytics.

### Done when

- One gesture marks an item bought, and it is reversible for 6 seconds
- Items past 30 days carry the stale rule and the prompt
- The weekly digest fires once and leads to at least one decision
- M2 and M3 are computable from local data

### Watch for

This phase is where the temptation to nag is strongest. Resist it. One notification a week,
no badge counts, no per-item reminders. Pressure produces avoidance, and an avoided shelf
is a dead one — `04-DESIGN-SYSTEM.md` §6.

---

## P5 — Later

Deferred. Listed so they are not re-invented, and ordered by likely value.

**Price tracking.** The schema already accumulates `price_snapshots` from P1 onward, so
this phase starts with history rather than an empty table. Needs: a cron that re-enriches
tracked items once daily at a jittered time, a drop threshold, and a push notification.
Scope it to items the user explicitly marks as tracked — never the whole shelf, which
would burn quota and attract bot detection.

**Better classification.** If the rule-based classifier proves inadequate after real use,
a small local model or an embedding-based nearest-neighbour over past corrections. Only
if the simple version measurably fails.

**Full-text search.** SQLite FTS5 on D1, if the shelf exceeds a few thousand items and
`LIKE` becomes slow. Unlikely.

**Multi-user.** `02-TRD.md` §9.1 keeps the door open. Opening it means a users table, real
auth, per-user isolation on every query, and a privacy policy. A different project.

**Shared lists.** Only if there is a real reason. Every competing product leads with this
and it is not the problem being solved.

**iOS.** The PWA runs there; the share integration is weaker. Only if the device changes.

---

## Ordering rules

Six, in priority order. When a decision about sequencing is unclear, apply these.

1. **Every phase ships something deployed.** No phase ends with code that has not run in
   production.
2. **P0–P2 in order, no skipping.** They build on each other.
3. **Risky assumptions get tested first inside their phase.** Share target before the app.
   Enrichment ladder before the UI that displays it.
4. **The fixture set is written before the code it measures.**
5. **Design tokens land before components.** Retrofitting a token system onto built
   components is slow and produces drift.
6. **Two weeks of real use between P2 and P3.** Not negotiable. It is the only step here
   that generates new information rather than consuming existing plans.
