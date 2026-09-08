# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Stash** — a private, single-user, cross-platform save-for-later shelf for products found
anywhere on the internet. Android via an installed PWA registered as a share target,
desktop via an MV3 browser extension, a Cloudflare Worker in the middle. Zero rupees per
month is a hard constraint, not a preference.

## The specification is authoritative

`docs/` contains a complete, approved specification written before any code. It is not
background reading — it is the source of truth. Read in order:

| # | File | Settles |
|---|------|---------|
| 1 | `docs/README.md` | Shape of the system |
| 2 | `docs/01-PRD.md` | Users, jobs, scope, acceptance criteria, success metrics |
| 3 | `docs/02-TRD.md` | Stack, constraints, data model, API contract, security, quotas |
| 4 | `docs/03-ARCHITECTURE.md` | Flows, extraction ladder, sync, failure modes |
| 5 | `docs/04-DESIGN-SYSTEM.md` | Tokens, type, components, interaction, voice |
| 6 | `docs/05-ROADMAP.md` | Phases P0–P5 and definition of done per phase |
| 7 | `docs/06-AGENT-BUILD-GUIDE.md` | **The operating manual — read before writing code** |
| 8 | `docs/07-RESEARCH.md` | Why each decision was made, and what was rejected |

`docs/06-AGENT-BUILD-GUIDE.md` §1 carries twelve standing rules that override local
judgement. Its §7 lists the situations where you must stop and ask rather than guess.

**When the docs and your instinct disagree, follow the docs and say so.** If something in
them is genuinely wrong or impossible, stop and flag it with the section reference — do
not silently do something else. This has already happened twice; see "Deviations" below.

## Commands

```bash
nvm use                       # Node 22 — required, see .nvmrc
npm install

npm run dev:worker            # wrangler dev --local, serves :8787
npm run migrate:local         # apply D1 migrations to the local database
npm run migrate:remote        # apply them to production
npm run deploy:worker         # wrangler deploy

npm run typecheck             # all workspaces
npm test                      # all workspaces
npm run check:secrets         # run before every commit and push

# a single Worker test file
npm test --workspace worker -- test/<name>.test.ts
npm run test:fixtures         # the twenty-link enrichment set (P1 onward)
```

The extension has no build step: load `extension/` unpacked in Chrome or Firefox.
Web dependencies are deliberately not installed until P2 — see `web/README.md`.

## Architecture

Three capture surfaces, one local store, one Worker, two storage services.

```
Android share sheet ─┐
Browser extension ───┼─→ IndexedDB (local, authoritative for the UI)
Paste in app ────────┘        │  outbox queue, bearer token
                              ▼
                       Worker (Hono)  ──→ D1 (SQLite)
                       auth → rate limit → routes
                       enrichment in ctx.waitUntil()
```

Two properties define the whole system and most bugs will be violations of one of them:

**A save never blocks on the network.** Client generates a UUID, writes to IndexedDB,
renders the card, *then* pushes. The five-second capture budget covers only the local
write. If the UI ever waits on a server response before confirming a save, the product's
central promise is broken.

**Enrichment failure is not an API error.** `POST /v1/items` returns 201 immediately;
metadata extraction runs afterwards in `ctx.waitUntil()` and its failure sets
`enrichment: "failed"` on the row. The save is the contract; metadata is best-effort.
`ERROR_CODES` in `shared/types.ts` deliberately has no entry for it.

Everything else follows: soft deletes only (sync needs tombstones), client-generated UUIDs
(offline creation must render before it can push), integer minor units for money, and
`reviewed_at` kept separate from `updated_at` so editing a note does not reset an item's
staleness clock.

**The extension is the high-fidelity path, not the fallback.** Its content script reads the
live DOM of a page the user is already logged into, which defeats bot walls a server-side
fetch cannot get past. When it supplies `scraped` data the server skips its extraction
ladder entirely. See `docs/03-ARCHITECTURE.md` §3.

## Layout

```
docs/        the specification — authoritative
shared/      types.ts: the one definition of Item, Category and every API shape
worker/      Cloudflare Worker (Hono) — API, enrichment, sync, image proxy
web/         PWA (React + Vite) — share target, shelf, offline store.  P2.
extension/   MV3 browser extension — desktop capture.  P1.
prototype/   throwaway visual skeleton, wired to nothing, not authoritative
scripts/     check-secrets.sh
```

`shared/types.ts` is imported by all three clients and is the only place an `Item` shape
is declared. It stays environment-free — no DOM, no Workers globals — which is why
`BlobLike` is declared structurally there rather than using a runtime's own `Blob`.
Wire format is camelCase; the D1 tables are snake_case, and the mapping lives in
`worker/src/db/schema.ts` and nowhere else.

## Current state

P0 is nearly done. Everything below is built, deployed nowhere yet, and verified locally.

| Phase | Delivers | State |
|-------|----------|-------|
| P0 | Foundation — deploy, database, auth | schema, `/health`, auth, rate limit **done**; deploy blocked |
| P1 | Capture and enrich — Worker API, extension | not started |
| P2 | The app — PWA, share target, shelf, sync | not started |
| — | *Stop. Two weeks of real use before P3.* | — |
| P3–P5 | Organise, decide, price tracking | not started |

Everything under `worker/src/routes/`, `worker/src/lib/`, `web/src/` and `extension/src/`
is a stub carrying a header comment with its spec reference and phase. They are a map, not
code.

**Deploy is blocked on a decision, not on work.** D1 exists in production
(`494af926-6f76-4794-82f9-998ed1080e63`, APAC) with all seven tables applied. R2 requires
enabling through the Cloudflare dashboard, which asks for a card — in direct conflict with
`docs/02-TRD.md` C1 ("no credit card on file"). The user chose to add the card; until the
bucket exists, `wrangler deploy` will fail on the R2 binding.

## Deviations from the documents

Both deliberate, both flagged to the user before being made. Do not "fix" them back.

**No KV namespace.** `docs/02-TRD.md` §6 and §8 put the rate-limit counter in KV. A counter
writes on every request; KV allows 1,000 writes/day against ~800 expected requests/day, so
the limiter would consume 80% of a quota it exists to protect — and a runaway loop, the
exact failure it is built for, would exhaust KV in minutes and switch the limiter off. The
counter lives in isolate memory. Full reasoning at the top of
`worker/src/middleware/rateLimit.ts`. This also keeps the Worker free of Cloudflare-only
APIs, which `docs/02-TRD.md` §9.2 asks for.

**`worker/src/env.ts`, not `env.d.ts`.** `Env` is imported by every route and middleware,
so it is a normal module rather than an ambient declaration.

## Two places where correctness is subtle

**Token comparison** (`worker/src/middleware/auth.ts`). `===` on a secret is a timing
oracle. Both values are SHA-256'd first so the comparison is always over 32 bytes —
`crypto.subtle.timingSafeEqual` throws on length mismatch, and reacting to that would leak
the secret's length. Verified with tokens from 1 to 10,000 characters, plus emoji and
Devanagari: all return 401, never 500.

**Anything touching money.** Prices are integers in minor units — `₹2,499.00` is `249900`.
TypeScript cannot catch a float here, so the guard has to be the runtime sanity check in
`worker/src/lib/price.ts` (P1): reject below 100 or above 100,000,000 minor units and store
null. A visibly missing price is fine; a confidently wrong one is worse than nothing.

## Known local-dev quirk — not a bug in this Worker

`wrangler dev` runs a proxy in front of the Worker. A **POST with no request body**, sent
over a keep-alive connection idle for a few seconds, makes that proxy drop the connection
and return 500 ("Error inside ProxyWorker ... Network connection lost"). Isolated: GET is
clean, POST *with* a body is clean, rapid POSTs are clean, bodyless POST fails every other
request. It does not occur in production, where no dev proxy exists.

`POST /items/:id/enrich` and `POST /items/:id/review` take no body, so this will resurface
in P1 and P4. Send `{}` when testing them by hand. Do not change the Worker for it.
Details in `worker/README.md`.

## Secrets

Every credential lives in `.credentials.local.md` at the repo root — gitignored, read by
nothing in the codebase, a written record so nothing has to be remembered. The device
token is never written into source, config or a build; it is typed by hand in four places:
`worker/.dev.vars`, `wrangler secret put DEVICE_TOKEN`, the extension's options page, and
the app's settings screen.

`npm run check:secrets` scans exactly the files git would send — not the whole disk — for
the token value, hardcoded secret assignments, private keys and cloud credentials, and
confirms the secret files are still ignored. It has been tested against deliberately
planted leaks. Run it before every commit and push.

## Working agreement with this user

The user directs and decides; they do not read code. This shapes how work is done here:

- **One small thing per turn.** Explain what is about to be built in plain language, ask
  before doing it, build one piece, verify it including edge cases, then explain what was
  built and why. Never chain several build steps into one response.
- **Ask before anything that changes the project's shape** — not only code edits. Creating
  or configuring a repo, installing dependencies, moving or deleting files, creating cloud
  resources, deploying. "It is obviously part of setup" is not a reason to skip the ask.
- **Show real output, not claims.** Run the thing, paste what it printed, and say plainly
  what was *not* covered. A test that cannot fail proves nothing — `check-secrets.sh` was
  validated by planting leaks and watching it catch them.
- The user writes in Hinglish and replies are written in Hinglish.

## Git workflow

One branch per phase, named `P<n>/<two-or-three-word-description>`, with several small
commits inside it. The phase branch merges into `main` only when the phase is complete, so
`main` always holds working, finished phases.

`.gitignore` is committed first, before anything else — a secret committed once stays in
history forever, and deleting the file later does not remove it.

Commit messages carry no `Co-Authored-By` trailer, by the user's instruction.
