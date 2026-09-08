# 06 — Agent Build Guide

**Read this first if you are an AI coding agent assigned to build Stash.**

This document is the operating manual. The other documents are the specification. You
should not need any instruction beyond what is in this folder.

---

## 0. Orientation

**What you are building.** Stash — a private, cross-platform save-for-later shelf for
products found anywhere on the internet. Android via PWA, desktop via browser extension,
a Cloudflare Worker in the middle. One user. Free tier only.

**Read before writing any code:**

| Order | Document | Why |
|-------|----------|-----|
| 1 | `README.md` | Shape of the system |
| 2 | `01-PRD.md` | What it must do and why |
| 3 | `02-TRD.md` | Stack, schema, API contract, security |
| 4 | `03-ARCHITECTURE.md` | Flows and algorithms |
| 5 | `04-DESIGN-SYSTEM.md` | Every visual and interaction value |
| 6 | `05-ROADMAP.md` | Phase order and definition of done |

**Then:** start at P0 in `05-ROADMAP.md` and work in order.

---

## 1. Standing rules

Twelve. These override any local judgement about what would be nicer.

1. **Follow the phase order.** P0 → P1 → P2, no skipping, no working ahead. Each phase
   ends deployed and verified.

2. **A save must never block on the network.** Local write, render, then push. If you ever
   write code where the UI waits for a server response before confirming a save, you have
   broken the product's central promise. This is the rule to remember if you remember one.

3. **Enrichment failure is not an API error.** It sets a field on the item and returns
   success. The save is the contract; metadata is best-effort.

4. **Use `HTMLRewriter`, streaming, aborting at `</head>`.** Never buffer HTML and regex
   it. The 10 ms CPU limit is real and buffering a large product page will exceed it.

5. **No hard-coded colours, sizes, or spacings in components.** Everything comes from
   `tokens.css`. If a needed value is not a token, question the need first, then add a
   token.

6. **No UI component library.** No shadcn, no MUI, no Chakra, no Tailwind. Plain CSS with
   custom properties. `04-DESIGN-SYSTEM.md` is short and specific enough to implement
   directly, and a library would be overridden more than used.

7. **Prices are integers in minor units.** Never a float. `₹2,499.00` is `249900`.

8. **Soft deletes only.** Sync needs tombstones. A hard delete resurrects the row on the
   next pull from a stale client.

9. **Client generates UUIDs.** So an offline client can create, render, and push later
   without ID reconciliation.

10. **Types live in `shared/types.ts`** and are imported by the Worker, the web app and the
    extension. Never redeclare an `Item` shape locally.

11. **Write the test fixture before the code it measures.** Specifically, the twenty-link
    set before the extractors.

12. **When docs and your instinct disagree, follow the docs and say so.** If something in
    these documents is genuinely wrong or impossible, stop and flag it with the specific
    section reference rather than silently doing something else.

---

## 2. Setup

### 2.1 Prerequisites

```bash
node --version    # 20 or higher
npm --version     # 10 or higher
npm install -g wrangler
wrangler login
```

A free Cloudflare account. No credit card required for Workers, D1, R2 or Pages at these
volumes.

### 2.2 Provision

```bash
wrangler d1 create stash-db
wrangler r2 bucket create stash-images
wrangler kv namespace create RL
```

Each command prints an ID. Put them into `worker/wrangler.toml`.

### 2.3 wrangler.toml

```toml
name = "stash-api"
main = "src/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "stash-db"
database_id = "<from step 2.2>"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "stash-images"

[[kv_namespaces]]
binding = "RL"
id = "<from step 2.2>"

[triggers]
crons = ["0 3 * * *"]
```

### 2.4 Secret

```bash
# generate
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='

# store
wrangler secret put DEVICE_TOKEN
```

Save the token somewhere retrievable — it is entered by hand into the extension options
page and the PWA settings screen.

### 2.5 Migrate and deploy

```bash
wrangler d1 migrations apply stash-db --remote
wrangler deploy
curl https://stash-api.<sub>.workers.dev/health   # expect 200
```

---

## 3. Commands

```bash
# Worker
cd worker
npm run dev                                        # wrangler dev --local
npm run deploy                                     # wrangler deploy
wrangler d1 migrations apply stash-db --local      # local schema
wrangler d1 migrations apply stash-db --remote     # production schema
wrangler tail                                      # live logs

# Web
cd web
npm run dev
npm run build
npx wrangler pages deploy dist --project-name stash

# Extension — no build step for the MV3 bundle
# Chrome:  chrome://extensions → Developer mode → Load unpacked → extension/
# Firefox: about:debugging → This Firefox → Load Temporary Add-on → manifest.json

# Tests
npm test
npm run test:fixtures                              # the twenty-link set
```

---

## 4. Getting these four right

Four pieces of this system are where subtle, silent bugs live. Everything else is ordinary
CRUD.

### 4.1 URL canonicalisation

Spec: `03-ARCHITECTURE.md` §4.1. Get this wrong and dedupe fails, filling the shelf with
near-identical rows that all look correct individually.

Unit tests must cover, at minimum:

```
https://www.amazon.in/dp/B0ABC?ref=sr_1_3&th=1  →  https://amazon.in/dp/B0ABC
https://amazon.in/Some-Product-Name/dp/B0ABC/   →  https://amazon.in/dp/B0ABC
https://youtu.be/xyz                            →  https://youtube.com/watch?v=xyz
https://youtube.com/watch?v=xyz&t=42&si=abc     →  https://youtube.com/watch?v=xyz
https://flipkart.com/p/itm123?pid=XYZ&lid=99    →  https://flipkart.com/p/itm123?pid=XYZ
https://example.com/page/?utm_source=x#section  →  https://example.com/page
```

Shortened links (`bit.ly`, `amzn.to`, `fkrt.it`, `t.co`) are expanded by following
redirects — maximum 3 hops, SSRF-checked at every hop — before canonicalisation runs.

### 4.2 The SSRF guard

Spec: `02-TRD.md` §6. Without this the Worker is an open proxy into private networks.

Must reject:

```
http://localhost:8080/
http://127.0.0.1/
http://[::1]/
http://169.254.169.254/latest/meta-data/     ← AWS metadata
http://metadata.google.internal/
http://10.0.0.1/  http://192.168.1.1/  http://172.16.0.1/
file:///etc/passwd
ftp://example.com/
http://internal/                              ← bare hostname, no dot
http://something.local/
```

**Re-check on every redirect hop.** A URL that passes the initial check can redirect to
`127.0.0.1`. Checking only the first URL is the classic way this guard is defeated.

### 4.3 Price parsing

Spec: `03-ARCHITECTURE.md` §4.4. Get this wrong and the shelf shows confidently incorrect
numbers, which is worse than showing none.

```
"₹8,999.00"      → { amount: 899900, currency: "INR" }
"Rs. 8999"       → { amount: 899900, currency: "INR" }
"8,999"          → { amount: 899900, currency: "INR" }
"INR 8999.00"    → { amount: 899900, currency: "INR" }
"$129.99"        → { amount:  12999, currency: "USD" }
"1.299,00 €"     → { amount: 129900, currency: "EUR" }
"Free"           → null
"₹0.01"          → null   ← below the sanity floor
"₹99,99,99,999"  → null   ← above the sanity ceiling
```

**The sanity check is required, not optional.** Any result below 100 minor units or above
100,000,000 minor units is a parse failure. Return null. Null renders as no price, which
is honest; a wrong number is not.

### 4.4 The Android share target

Spec: `02-TRD.md` §3.1. This is the highest-risk assumption in the system
(`01-PRD.md` R3), and it is verified as the first task of P2, alone, before anything is
built on top of it.

```json
{
  "share_target": {
    "action": "https://stash.pages.dev/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url",
      "files": [{ "name": "image", "accept": ["image/*"] }]
    }
  }
}
```

Three failure modes, all of which present identically as "installs fine, never appears in
the share sheet":

1. **`action` is a relative path.** It must be absolute. This is the most common cause.
2. **The manifest changed and the PWA was not reinstalled.** Android caches aggressively.
   Uninstall completely, then reinstall. Reloading does nothing.
3. **`method: GET` was used.** GET cannot receive files, which F4.3 requires. POST is
   mandatory, and the POST is handled by the service worker rather than reaching the
   server.

The service worker handles it roughly like this:

```js
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith((async () => {
      const form = await event.request.formData();
      const shared = {
        title: form.get('title') || '',
        text:  form.get('text')  || '',
        url:   form.get('url')   || '',
        image: form.get('image') || null,
      };
      await stashSharedPayload(shared);           // write to IndexedDB
      return Response.redirect('/share?pending=1', 303);
    })());
  }
});
```

Note that Android often puts the URL inside `text` rather than `url`, depending on the
sharing app. Extract a URL from whichever field contains one.

---

## 5. Definition of done, per phase

Copy from `05-ROADMAP.md`. A phase is not complete until every box is checked **on real
devices**, not in a simulator.

**P0** — health check live · auth rejects and accepts correctly · all seven tables exist ·
rate limiting triggers under burst

**P1** — fixture set at 80%+ · Amazon India price correct via extension · duplicate save
returns the existing item · SSRF attempts rejected · timeout produces a `failed` item, not
an error · images serve from R2

**P2** — share from Android in under 5 s · cross-device within 30 s · five offline saves
sync on reconnect · 300 items render under 1 s at 60 fps on the actual phone · installs on
Windows and Linux · both themes pass contrast · full keyboard navigation · bundle under
200 KB gzipped

**P3** — classifier correct after 20 saves and ≤5 corrections · search under 100 ms at 500
items · filters combine and clear · empty states carry their actions

**P4** — one gesture to decide, reversible for 6 s · stale treatment at 30 days · weekly
digest fires once · M2 and M3 computable locally

---

## 6. Common mistakes

Each of these is a real failure mode for this specific system, not general advice.

| Mistake | Consequence | Correct approach |
|---------|-------------|------------------|
| Awaiting the server before confirming a save | The 5-second budget is gone; the core promise breaks | Local write → render → background push |
| Buffering HTML and using regex | Exceeds 10 ms CPU on real product pages | `HTMLRewriter`, streaming, abort at `</head>` |
| Returning an error when enrichment fails | User loses the item they wanted to save | Save succeeds, item marked `failed`, retry offered |
| Storing prices as floats | Rounding errors in currency | Integer minor units |
| Hard deleting rows | Deleted items reappear from stale clients | `deleted_at` tombstone |
| Hotlinking images | Broken images as CDNs expire URLs and block referers | Copy into R2 at save time |
| Resizing images on the Worker | Blows the CPU budget | Store originals, control size with `<img>` attributes and lazy loading |
| Server-generated IDs | Offline creation cannot render before sync | Client-generated UUID v4 |
| Adding a UI component library | Fought against more than used; ships unused bytes | Plain CSS and the token file |
| One radius for every element | Reads as a template; loses the role signal | Per-role radii, `04-DESIGN-SYSTEM.md` §5.2 |
| Colour-coding categories | Competes with product images, which carry the colour | Category is text |
| Building a shelf out of `<div>`s | Inaccessible | `<ul>` / `<li>` / `<article>` |
| Skipping the age treatment as "polish" | The shelf becomes landfill; the product fails | `04-DESIGN-SYSTEM.md` §6 is core |
| Adding entrance animations on scroll | Reads as generated; costs frames | One orchestrated moment only, §7.4 |
| Checking SSRF only on the first URL | Guard defeated by a redirect | Re-check every hop |
| Naive `===` on the auth token | Timing oracle leaks the secret | Constant-time comparison |
| Building P3–P5 before using P2 | The most likely way this project dies | Ship P2, use it two weeks, then plan |

---

## 7. When to stop and ask

Do not guess on these. Stop, state the situation, and ask.

- **The share target cannot be made to work after exhausting §4.4.** The fallback is a
  Trusted Web Activity wrapper, which changes the plan and needs a decision.
- **A required free tier changed its terms.** `02-TRD.md` §9.2 documents the escape route
  but taking it is a decision, not an implementation detail.
- **The fixture set will not clear 80%.** Report which specific sites fail and why. Do not
  quietly add per-site scrapers to inflate the number — that path has no end, and
  `01-PRD.md` principle 3 rules it out.
- **A document contradicts another document.** Quote both sections. Do not pick one.
- **Something specified here appears genuinely impossible.** Say what and why, with the
  section reference.

Otherwise: follow the documents, work the phases in order, and ship P0 through P2 before
building anything else.

---

## 8. Quick reference

```
Worker base   https://stash-api.<sub>.workers.dev/v1
Web app       https://stash.pages.dev
Auth          Authorization: Bearer <DEVICE_TOKEN>
Timestamps    epoch milliseconds, INTEGER
Prices        minor units, INTEGER      ₹2,499.00 → 249900
IDs           UUID v4, client-generated
Deletes       soft, via deleted_at
Sync          GET /v1/sync?since=<ms>
CPU limit     10 ms per Worker invocation
Enrich cap    8 s timeout, 2 MB body, 3 redirects
Image cap     2 MB, no resizing
Rate limit    60 writes/min, 600 reads/min, per token
Fonts         IBM Plex Sans, self-hosted, weights 400/500/600
Bundle target under 200 KB gzipped
```
