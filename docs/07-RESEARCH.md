# 07 — Research

Findings behind the decisions in the other documents. Figures verified against sources
dated 2026; free-tier terms move, so re-check before relying on any specific number.

---

## 1. Competitive landscape

### 1.1 What exists

The universal-wishlist category is crowded. Reviewed: Wishupon, GiftList, Moonsift, Grabbit,
Wishfinity, Giftful, Listery, Giftbuster, Listful, WishApp, Sortd, Laterbuy, GimmeThat,
plus retailer-native wishlists.

### 1.2 What they optimise for

Almost all of them are built around **gifting and sharing**. Registries, group gifting,
anonymous reservations, Secret Santa draws, shareable public boards. That is where the
category's money is — affiliate revenue on gift purchases, which scales with how many
people see a list.

A handful are built around **discovery**. Wishupon ships a trending feed and browsable
public wishlists. Moonsift builds Pinterest-style visual boards. Both are designed to
increase time spent and items saved.

Very few are built around **a person deciding whether to buy something for themselves**,
and none makes that the organising idea.

### 1.3 Consistent weaknesses

**Feature gating.** Wishupon puts notes, unlimited pins and purchase lists behind a paid
tier at around $2/month, and shows ads on Android. Several others gate list count on the
free plan. For a tool used every day by one person, a recurring fee for note-taking is a
poor trade.

**Tracking.** Wishupon's App Store disclosure states it tracks users across other
companies' apps. This is the norm rather than the exception in a category funded by
affiliate revenue.

**Coverage gaps.** Many work only on a list of supported retailers. Amazon discontinued
external-site adding via Amazon Assistant in March 2023, so its wishlist is Amazon-only.
Marketplace and social-content coverage is generally poor.

**Sharing bias in the interface.** Because the products are built for gifting, the primary
actions are share, claim and reserve. A person saving things for themselves navigates
around features they will never use.

**No lifecycle.** Across the category, saving is the terminal action. Items have no
"bought" or "dropped" state, no age surfacing, no review prompt. Lists grow monotonically
and are eventually abandoned. Google Play reviews for several of these apps ask for better
sorting and organisation — the symptom of lists that have grown past usefulness.

### 1.4 What this means for Stash

The gap is real, and it is not a feature gap. It is a **purpose gap**.

Stash is single-user, private, free by construction, works on any URL, and treats the
decision — not the save — as the product's job. The features that follow from that
(`01-PRD.md` F11: age surfacing, review prompts, weekly digest, shelf health) do not exist
anywhere in the category, because in an affiliate-funded product they would reduce revenue.

The second implication is competitive rather than technical: **there is no reason to imitate
this category's interface.** Its storefront visual language is a consequence of its business
model. Copying it would import the behaviour Stash exists to fix. This is the origin of the
design direction in `04-DESIGN-SYSTEM.md` §2.

---

## 2. Free-tier platform research

### 2.1 Cloudflare — selected

Verified as of mid-2026:

| Service | Free tier |
|---------|-----------|
| Workers | 100,000 requests/day · 10 ms CPU per invocation · 50 subrequests · 128 MB memory · 3 MB script |
| D1 | 5 GB storage · 5M row reads/day · 100K row writes/day |
| R2 | 10 GB storage · 1M Class A ops/mo · 10M Class B ops/mo · **zero egress charge** |
| Pages | Unlimited static requests · 500 builds/month |
| KV | 1 GB · 100K reads/day · 1K writes/day |
| Cron Triggers | Included |

**Decisive advantages for this project:**

- **No inactivity pause.** The service is available whether or not it was used yesterday.
- **Zero egress on R2.** For an image-heavy app this is the single most important line.
  Bandwidth is the meter that would otherwise be hit first.
- **One vendor.** One dashboard, one deploy command, one set of quota emails.
- **No credit card.** Genuinely free rather than free-with-a-card-on-file.

**Real constraints:**

- **10 ms CPU per invocation** is the tightest limit in the system. Note that time spent
  awaiting `fetch` does not count — only actual compute. This is precisely why streaming
  HTML parsing fits comfortably and buffer-then-regex does not.
- **1K KV writes/day** is tight. It is why rate-limit counters are the only thing in KV,
  and why item data lives in D1.
- **Exceeding 100K Worker requests/day returns error 1027** until the UTC-midnight reset.
  Nowhere near reachable at one person's usage, but a runaway client loop could reach it,
  which is a second reason for the rate limiter.

### 2.2 Supabase — rejected

| Free tier | Value |
|-----------|-------|
| Database | 500 MB Postgres |
| File storage | 1 GB |
| Egress | 5 GB/month |
| MAU | 50,000 |
| Edge functions | 500K invocations/month |
| Projects | 2 active |

**Rejected on two grounds.**

**The pause.** Free projects with no API requests for seven days are automatically paused
and stay offline until manually restored from the dashboard. Multiple sources identify this
as the limit that catches teams out, ahead of storage or user count. For a personal tool
used intermittently, this is the difference between a working product and one that greets
you with an outage after a quiet week. Keep-alive workarounds exist — a scheduled GitHub
Action, or an uptime monitor — but adding a second service purely to prevent the first from
switching itself off is the wrong shape for a system that has to be maintainable by one
person part-time.

**Egress and storage shape.** 5 GB egress and 1 GB file storage against R2's 10 GB storage
and unmetered egress. For a product whose payload is product photographs, this is not
close.

Also relevant: exceeding a limit triggers a fair-use response where every service returns
402 until the billing period resets, and there are no backups on the free plan.

Supabase would otherwise have been a strong choice — Postgres, real auth, and good tooling.
The pause is what settles it.

### 2.3 Others considered

**Vercel + Neon.** Two vendors, violating the maintenance constraint. Neon's scale-to-zero
introduces cold-start latency on the save path, which is the one path that must be fast.

**Firebase.** Requires billing enabled beyond the smallest footprint.

**Self-hosted.** Free in cash, expensive in attention: an always-on machine, dynamic DNS,
TLS renewal, a tunnel. Correct escape hatch, wrong default. `02-TRD.md` §9.2 keeps the
architecture portable to it.

---

## 3. Android without the Play Store

### 3.1 The finding

A PWA installed from Chrome on Android can register as a **system share target** via the
Web Share Target API. It appears in the share sheet alongside native apps.

The mechanism: when Chrome installs a PWA, it requests a **WebAPK** — a genuine Android
package generated and signed by Google's servers. That package carries the intent filters
declared by the manifest's `share_target` member. The result is a real share-sheet entry
with no Play Store listing and no developer registration fee.

Support is Android (via WebAPK) and ChromeOS. iOS does not support it, which is acceptable
because iOS is not a target platform.

### 3.2 Why this decides the Android question

Without this, the options were a Play Store listing (₹2,000, violating the zero-cost
constraint) or a side-loaded APK (manual distribution, no update channel, an Android build
toolchain to maintain). The PWA path removes both problems and means one codebase serves
Android, Windows and Linux.

### 3.3 Documented failure modes

Collected from implementation reports, because all three present identically — the PWA
installs successfully and simply never appears in the share sheet:

1. **Relative `action` URL.** Must be absolute. Reported as the fix that finally worked
   after following the official documentation produced nothing.
2. **Manifest caching.** Android caches the manifest aggressively. After any `share_target`
   change the PWA must be fully uninstalled and reinstalled; reloading has no effect.
3. **GET instead of POST.** A GET share target receives only text and URLs. Receiving
   shared *files* — needed for the screenshot capture path in `01-PRD.md` F4.3 — requires
   `method: "POST"` with `enctype: "multipart/form-data"`, handled by the service worker.

These three are why verification is the first, isolated task of P2 rather than something
discovered late.

---

## 4. Metadata extraction

### 4.1 HTMLRewriter

Cloudflare's streaming HTML parser. It processes bytes as they arrive from the origin and
never builds a document tree.

Three properties matter here:

- CPU cost is a fraction of buffering plus parsing, which is what makes the 10 ms limit
  workable
- memory stays flat regardless of page size
- parsing can abort as soon as `</head>` is reached, and every tag of interest lives in the
  head

The pattern — `.on('meta[property^="og:"]', …)` with a Twitter Card fallback and a JSON-LD
handler — is well established. Link-preview services have been built on exactly this and
run within the free tier.

One wrinkle: JSON-LD arrives as multiple text chunks. Accumulate and only parse when
`chunk.lastInTextNode` is true, wrapped in try/catch — malformed JSON-LD in the wild is
common and must not fail the whole enrichment.

There is a portability benefit too: Bun ships an API-compatible `HTMLRewriter`, so this
code moves off Cloudflare without a rewrite.

### 4.2 The extraction ladder

Ordered by quality of what each source yields:

1. **Extension DOM scrape** — the live page, logged in, JavaScript executed
2. **JSON-LD `Product`** — structured, includes real price and currency, near-universal on
   commerce platforms because search engines require it
3. **Open Graph** — nearly universal, usually title and image, sometimes price
4. **Twitter Cards** — fallback for whatever OG missed
5. **oEmbed** — for providers that publish an endpoint; YouTube's is unauthenticated and
   reliable
6. **Bare HTML** — `<title>` plus the first meaningful image
7. **Manual** — the guaranteed floor

Tiers 2 and 3 alone cover most of the web, because SEO and social sharing give every
commercial site a reason to emit them. That is what makes the "works on any site" promise
achievable without per-retailer scrapers.

### 4.3 Extension over server

The important asymmetry: a content script sees what the user sees. Logged in, correct
region, JavaScript-rendered prices present, bot walls not triggered.

Server-side fetches against major marketplaces frequently return interstitials rather than
product pages. This inverts the usual architecture — the extension is the high-fidelity
path and the server fetch is the universal fallback, not the other way round.

### 4.4 SSRF

Any service that fetches user-supplied URLs is an SSRF vector. Existing link-preview
Workers treat private-address blocking as a required module rather than an option. The
guard in `02-TRD.md` §6 follows that pattern, with the addition that checks re-run on every
redirect hop — checking only the initial URL is the standard way this defence is defeated.

---

## 5. Decisions this research settled

| # | Decision | Basis |
|---|----------|-------|
| D1 | Cloudflare, everything | No pause · zero egress · single vendor · no card |
| D2 | Supabase rejected | 7-day inactivity pause is disqualifying for a personal tool |
| D3 | PWA, not a native Android app | Web Share Target via WebAPK gives share-sheet integration free |
| D4 | Share target verified first, alone | Three documented silent-failure modes |
| D5 | `HTMLRewriter`, streaming | Only approach that reliably fits 10 ms CPU |
| D6 | Extension is the primary capture path | Sees the logged-in DOM; defeats bot walls |
| D7 | Copy images to R2, never hotlink | Expiring CDN URLs, referer blocking, tighter CSP |
| D8 | No image resizing on the Worker | Would exceed the CPU budget; R2 egress is free anyway |
| D9 | Rule-based classifier, no LLM | Zero cost, zero latency, learns from corrections |
| D10 | Not designed like the competition | Their storefront language follows from affiliate revenue and imports the behaviour this product exists to fix |
| D11 | Lifecycle and age surfacing are core | The whole category's consistent failure is lists that only grow |
| D12 | `LIKE` search, not FTS5, in v1 | Adequate at one person's scale; one less thing to maintain |

---

## 6. Worth re-checking before build

Free tiers move. Verify these before committing:

- Cloudflare Workers request and CPU limits
- D1 storage and row-operation limits
- R2 storage allowance and the zero-egress policy
- Whether Chrome still generates WebAPKs with share-target intent filters on current
  Android
- D1 access-control changes — a PostgREST-style grant change was reported for Supabase in
  2026; confirm nothing analogous applies to D1

None of these is likely to have changed enough to alter the architecture. All are worth
five minutes before writing the first line.
