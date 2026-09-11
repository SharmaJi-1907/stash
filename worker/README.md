# Stash Worker

Cloudflare Worker (Hono) — API, enrichment, sync, image proxy.
Spec: `docs/02-TRD.md` §5, `docs/03-ARCHITECTURE.md`.

## Run locally

```bash
nvm use                 # Node 22, per .nvmrc
npm run dev             # wrangler dev --local, on :8787
npm run migrate:local   # apply migrations to the local D1
```

`.dev.vars` holds `DEVICE_TOKEN` for local runs. It is gitignored and must never be
committed. Generate one with:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

## Routes

    GET  /health                     no auth
    POST /v1/items                   create — returns 201 before enrichment runs
    GET  /v1/items                   list
    GET  /v1/items/:id               one
    PATCH/DELETE /v1/items/:id       edit, soft delete
    GET  /v1/sync?since=<ms>         everything changed since a cursor
    POST /v1/uploads                 an image the client already holds
    GET  /v1/export                  the whole shelf as one file
    GET  /img/:key                   image proxy

`/v1/*` is behind auth, then the rate limiter. `cors` is mounted above **both**, on the
whole app.

**That ordering is load-bearing.** The app is served from pages.dev and the API from
workers.dev, so every write is preceded by an `OPTIONS` request that carries no
`Authorization` header. Run through auth it earns a 401, the browser never sends the real
request, and the symptom is the settings screen reporting the token as wrong. Moving
`cors` below auth will break the app in a way that looks like a credentials problem.

CORS is not in `docs/02-TRD.md` at all. It was added because the app could not reach the
API without it.

## Sync, and why the cursor is the server's clock

`GET /v1/sync` returns rows whose `updated_at` is newer than `since`, tombstones included
— a client that never learns about a deletion shows the row forever, which is the entire
reason deletes are soft here. `since=0` is a full download and is what a fresh install
does.

The cursor is the server's timestamp, not the client's. A phone with a wrong clock would
otherwise skip a window of changes and never know.

## Uploads are capped on bytes read, not on Content-Length

A header is a claim. A streamed body can exceed it, so a cap that trusts the claim is not
a cap — proved by sending a body larger than the length it declares and watching it
rejected. Below `MIN_IMAGE_BYTES` the upload is refused as well: a 43-byte tracking beacon
is a valid PNG, and storing it spends an R2 object to display nothing.

## Three deviations from the documents, all deliberate

**No KV namespace.** `02-TRD.md` §6 and §8 put the rate-limit counter in KV. A counter
is written on every request; KV allows 1,000 writes/day (`07-RESEARCH.md` §2.1) against
~800 expected requests/day (`02-TRD.md` §2.2), so the limiter would eat 80% of a quota it
exists to protect — and a runaway loop, the exact failure it is built for, would exhaust
KV within minutes and switch the limiter off. The counter lives in isolate memory instead.
Full reasoning at the top of `src/middleware/rateLimit.ts`. This also keeps the Worker
free of Cloudflare-specific APIs, which `02-TRD.md` §9.2 asks for.

**`src/env.ts`, not `env.d.ts`.** A `.d.ts` file is for declarations that are not imported.
`Env` is imported by every route and middleware, so it is a normal module.

**`canonicalise` moved to `shared/`.** `02-TRD.md` §10 puts URL canonicalisation here. The
client needs it too — the app dedupes before it has a network, and a duplicate only the
server can see arrives after the card is already on the shelf. Two copies would be two
things to get wrong, and a URL that hashes differently on each side defeats the dedupe
entirely. `src/routes/items.ts` imports it from `shared/`.

**Measured, not assumed:** in production the effective write ceiling was 120, not 60 —
Cloudflare served the burst from two isolates and each allowed its own budget. So the real
limit is 60 x (isolates in play). This is accepted rather than overlooked: the job is to
bound a runaway loop's D1 and R2 work, and the platform's own hard stop is 100,000
requests/day. If exactness ever matters the fix is the native rate-limiting binding or a
Durable Object — both exact, both Cloudflare-only.

## Known local-dev quirk — not a bug in this Worker

`wrangler dev` runs a proxy in front of the Worker. A **POST with no request body at all**,
sent over a keep-alive connection that has been idle a few seconds, makes that proxy drop
the connection and return **500** with:

```
Error inside ProxyWorker (the affected request failed; the dev server continues):
POST http://127.0.0.1:8787/... (failed after 1 attempt): Network connection lost.
```

Reproduced deliberately, 5-second gaps between requests:

| Request | Result |
|---|---|
| `GET` anything | clean, no failures |
| `POST` **with** a body | clean, no failures |
| `POST` with **no** body | 404, 500, 404, 500, … every other one |
| Rapid `POST`s, no idle gap | clean, no failures |

So the trigger is a bodyless POST on an idle connection, not the route, not auth, and not
the 429 path. Nothing in the Worker is involved — the error is generated by the dev proxy
before or after the Worker runs.

**Why this matters in P1 and P4:** `POST /items/:id/enrich` and `POST /items/:id/review`
take no body, so they will hit this while being tested locally. Send `{}` as the body when
testing them by hand, or expect the occasional spurious 500 that does not appear in
production, where no dev proxy exists. Do not "fix" the Worker for this.

## A known audit finding, left in place deliberately

`npm audit` reports 4 high-severity advisories, all the same one:

```
sharp <0.35.4 — vulnerabilities in libheif (GHSA-g89c-p67h-r497, GHSA-2jg2-4ch7-h545)
node_modules/sharp
  via miniflare -> @cloudflare/vitest-pool-workers, wrangler
```

**It does not reach production.** `sharp` is a native image library that miniflare
uses to emulate Cloudflare's image resizing locally. The Worker's only runtime
dependency is `hono`; nothing else is bundled or deployed. The advisory is in
libheif's HEIF decoding, and nothing here decodes a HEIF image — images are
streamed into R2 as bytes and never processed (`03-ARCHITECTURE.md` §4.5).

**The offered fix makes things worse.** `npm audit fix --force` downgrades
`@cloudflare/vitest-pool-workers` to 0.8.30, which predates the Vitest 4 API this
project's test setup is built on. Trading a working test suite for a dev-only
advisory that cannot be triggered is the wrong way round.

Re-check when Cloudflare ships a miniflare release carrying `sharp` ≥ 0.35.4.
