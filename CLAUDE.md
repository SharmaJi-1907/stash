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
| — | `docs/stash_issue.md` | **Not spec.** The open P2 issues, and what is already ruled not-an-issue |

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
npm run check:contrast        # all twenty colour pairs, both themes, plus ink order
npm run r2                    # stored bytes, % of the 10 GB, what is left

# a single Worker test file
npm test --workspace worker -- test/<name>.test.ts
npm run test:fixtures         # the twenty-link enrichment set (P1 onward)
```

```bash
npm run dev     --workspace web     # Vite on :5173
npm run build   --workspace web     # tsc --noEmit, then vite build
npm run deploy  --workspace web     # wrangler pages deploy dist --project-name stash
npm test        --workspace web     # Vitest in Node, IndexedDB via fake-indexeddb
```

The extension has no build step: load `extension/` unpacked in Chrome or Firefox.

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

**Measured on the deployed Worker, 2026-09-09: server-side enrichment yields 17/20 usable
titles and images, and 0/20 prices.** Run locally the same set gives 19/20 and one price —
because `wrangler dev` fetches from a home connection while the Worker fetches from a
Cloudflare datacentre address. flipkart.com, ajio.com and myntra.com all refuse the edge;
myntra.com serves a full Product JSON-LD with a price to a home connection and nothing at
all to Cloudflare. So every local enrichment measurement flatters production, and the
extension is not an optimisation — it is the only path to a price.

## Layout

```
docs/        the specification — authoritative
shared/      types.ts and canonicalise.ts — imported by all three clients
worker/      Cloudflare Worker (Hono) — API, enrichment, sync, image proxy
web/         PWA (React + Vite) — share target, shelf, offline store, sync
extension/   MV3 browser extension — desktop capture, no build step
prototype/   throwaway visual skeleton, wired to nothing, not authoritative
scripts/     check-secrets.sh, r2-usage.sh, check-contrast.mjs
```

`shared/types.ts` is imported by all three clients and is the only place an `Item` shape
is declared. It stays environment-free — no DOM, no Workers globals — which is why
`BlobLike` is declared structurally there rather than using a runtime's own `Blob`.
Wire format is camelCase; the D1 tables are snake_case, and the mapping lives in
`worker/src/db/schema.ts` and nowhere else.

## Current state

P0, P1 and P2 are built, deployed, and used against real pages in a real browser.

| Phase | Delivers | State |
|-------|----------|-------|
| P0 | Foundation — deploy, database, auth | **done**, live |
| P1 | Capture and enrich — Worker API, extension | **done**, live |
| P2 | The app — PWA, share target, shelf, sync | **built and live**, open issues below |
| — | *Stop. Two weeks of real use before P3.* | — |
| P3–P5 | Organise, decide, price tracking | not started |

P2 is functional, not finished. `docs/stash_issue.md` holds the nine open items —
two backend, seven interface — with how each was found and which are verified in
code versus reported from the screen. **Read it before starting work on P2.** It is
the only file in `docs/` that is not specification: 00–07 were written before any
code and are authoritative, and that one is a living list that changes as things
are fixed.

Live at `https://stash-api.sharmaabhinav1907.workers.dev`. The web app is at
`https://stash-1ju.pages.dev` — `stash.pages.dev` was taken, so Cloudflare added the
suffix, and the manifest's absolute share-target action must match it exactly. D1 is
`494af926-6f76-4794-82f9-998ed1080e63` (APAC), R2 bucket `stash-images`. A card is on the
Cloudflare account because R2 cannot be enabled without one — a knowing departure from
`docs/02-TRD.md` C1, decided by the user on 2026-09-09 and recorded in
`.credentials.local.md`.

458 tests, all passing — 346 in the Worker, 112 in the app. Typecheck is clean across
four workspaces and `npm run check:contrast` proves 20 of 20 colour pairs. The fixture
set clears its bar: `docs/01-PRD.md` F2 wants 16 of 20 usable and production gives 17.

None of those checks catches anything in `docs/stash_issue.md`. Every open item is
either something the tests do not look at or something only a person looking at the
screen can see, which is worth remembering before trusting a green run as "done".

**`docs/05-ROADMAP.md` P1's last criterion — amazon.in through the extension captures the
correct price — is met.** Verified on real pages, 2026-09-10:

| Page | Saved | Correct |
|---|---|---|
| amazon.in, drill kit at -40% | ₹3,499 | yes, and not the ₹5,799 M.R.P. beside it |
| flipkart.com, gaming laptop | ₹79,990 | yes, from a site whose server response is titled "Flipkart reCAPTCHA" |
| reliancedigital.in, phone | ₹18,499 | yes, with no selector written for that site |
| amazon.com, item with no featured offer | nothing | yes — declining is the right answer there |

The last row matters as much as the others. That page offered an easy $114.99 belonging to
a sponsored product elsewhere on it; saving nothing is correct, and the item is on the
shelf with its title and image and no price.

Two guards in `content.js` earn their place, and both were added after a wrong price
reached a real shelf: `insideAnotherProduct()` skips sponsored strips, carousels and
"similar items", and `isWasPrice()` skips struck-through amounts, which Amazon writes with
exactly the same `.a-price .a-offscreen` markup as the real one.

**Apply both to the selector path, not only the fallback.** That was the actual bug: the
guards lived only in the generic scan, on the assumption that a selector hit is more
trustworthy. It is not — it is only faster. Both wrong prices came through selectors.

All three clients are real now. `web/share-target-check/` is not — it is the throwaway
probe that proved the share target on the phone, kept because its README records what was
measured, and wired to nothing.

**P2 task 1 — the Android share target — passed on 2026-09-10.** `docs/01-PRD.md` R3 calls
it the highest-risk assumption in the system, and `docs/05-ROADMAP.md` gates the phase on
it. A minimal PWA in `web/share-target-check/` was installed on the real phone and a
YouTube video shared to it.

Two things came out of it that the rest of P2 depends on:

**The URL arrives in `text`, not `url`.** The `url` field was empty. The guide warns this
happens "depending on the sharing app"; measured here it is simply what happens. Code that
reads `form.get('url')` and stops receives nothing and looks like a broken share target.
Take the URL from whichever field carries one.

**A fourth silent-failure mode exists, beyond the three the guide lists.** A `_redirects`
rule mapping `/share` to `/share.html` fought Cloudflare Pages' own clean-URL redirect and
the two cancelled into `308 location: /share` — an endless loop on the exact path the share
target posts to, with `POST` answering 405. Pages already serves `share.html` at `/share`;
the rule was removed. On a phone this is indistinguishable from the share target not
working at all.

## What P2 built

Twenty-two commits on `P2/pwa-and-shelf`, pushed. `main` is untouched and still on P1 —
merging is the user's, not yours.

**Worker.** Four things the app cannot work without: `GET /v1/sync` (everything changed
since a cursor, tombstones included), `POST /v1/uploads` (an image the share sheet handed
over, which no URL points at), `GET /v1/export` (the whole shelf as one file — the exit),
and CORS.

**CORS is not in `docs/02-TRD.md` at all and the app cannot reach the API without it.**
The app is served from pages.dev and the API from workers.dev, so every write is preceded
by an `OPTIONS` request carrying no `Authorization` header. Sent through auth it earned a
401, the browser never made the real request, and the settings screen reported the token
as wrong. `cors` is therefore mounted on the whole app *ahead of* `/v1`'s auth. Anything
later that moves it below auth will break the app in a way that reads as a bad token.

**App.** IndexedDB via Dexie is authoritative for the UI; a save writes locally, renders,
then queues. An outbox retries with backoff and refuses to retry a non-429 4xx, because
the server has already refused that shape and sending it again is a loop. A pull runs on
open, on focus and every five minutes, and advances its cursor only after the whole batch
is written.

**`listLocal` enforces `docs/01-PRD.md` F7.3 and this is load-bearing.** Bought and dropped
items leave the main shelf and stay in the database, reachable and restorable. It was
missed at first and the shelf simply kept everything — which defeats principle 2 and walks
straight into R1, the risk the PRD calls fatal. If a change makes decided items visible on
the main shelf again, that is a regression, not a preference.

**Fonts are self-hosted**, nine files, IBM Plex Sans Devanagari declared under the same
family name so Hindi falls through without markup deciding. The three Latin weights are
byte-identical because that file is a *variable* font — see `docs/stash_issue.md` B2 before
"fixing" anything about it.

## Deviations from the documents

Both deliberate, both flagged to the user before being made. Do not "fix" them back.

**No KV namespace.** `docs/02-TRD.md` §6 and §8 put the rate-limit counter in KV. A counter
writes on every request; KV allows 1,000 writes/day against ~800 expected requests/day, so
the limiter would consume 80% of a quota it exists to protect — and a runaway loop, the
exact failure it is built for, would exhaust KV in minutes and switch the limiter off. The
counter lives in isolate memory. Full reasoning at the top of
`worker/src/middleware/rateLimit.ts`. This also keeps the Worker free of Cloudflare-only
APIs, which `docs/02-TRD.md` §9.2 asks for.

**Measured, not assumed:** in production the effective write ceiling was 120, not 60 —
Cloudflare served the burst from two isolates and each allowed its own budget. So the real
limit is 60 x (isolates in play) and can rise under heavier load. Locally it is exactly 60.
This is accepted, not overlooked: the job is to bound a runaway loop's D1 and R2 work, and
the platform's own hard stop is 100,000 requests/day on the free plan. If exactness ever
matters, the fix is the native rate-limiting binding or a Durable Object — both exact, both
Cloudflare-only.

**`image_bytes` on the items table.** Added in `migrations/0002_image_bytes.sql`. Not in
`docs/02-TRD.md` §4. It
carries the stored size of each item's image so the daily cron can total live storage
exactly and subtract correctly when tombstones are purged — a single running counter
cannot, because a purge would not know how much to subtract. The size is already measured
when enforcing the 2 MB cap, so recording it costs nothing.

It feeds a storage line on the shelf-health indicator (`docs/01-PRD.md` F11.4), which the
cron in `docs/03-ARCHITECTURE.md` §9 already recomputes into `settings`:

    Shelf health    47 items open  ·  0.3 GB / 10 GB

The user asked for this because R2 now has a card attached, and Cloudflare's billing alert
arrives as an email that gets lost among daily mail. An indicator in the app is seen every
time the shelf is opened. The column and the byte accounting exist; the shelf-health line
that reads them is P2/P4 work.

**Four colour tokens differ from `docs/04-DESIGN-SYSTEM.md` §3.1**, and the document
asked for it. §4 says its values are binding; §9 says contrast is 4.5:1 for body text and
3:1 for interface boundaries in both themes and is "not optional, not a later phase".
Measured, §3.1's own colours fail §9:

    --text-faint  on --surface   dark 3.28:1   light 2.96:1   needs 4.5
    --line-strong on --surface   dark 1.79:1   light 1.65:1   needs 3.0

§9 even names the first: "Verify --text-faint against --surface specifically — it is the
value most likely to fail." It does. Both are lightened along the same hue until they clear
the floor and no further, in both themes. The palette's character is unchanged; what
changes is that the metadata line is readable — and that line carries the age of every
item, which §6 calls the strongest available signal that a decision is overdue. A design
whose most important field is its least legible one has an ordering problem.

`npm run check:contrast` proves all twenty pairs and fails if anyone puts the old values
back. Verified by putting them back.

**Measured again on the phone, and raised a second time.** 4.53:1 passes §9 and was still
hard to read on the actual device. The whole ink ladder went up and the checker gained an
order invariant, so no later edit can make one token readable by making the one above it
worse. Dark is now 14.03 / 9.01 / 6.01 and light 17.10 / 10.03 / 6.69.

The light theme has a hole in it — `tokens.css` defines light only under
`[data-theme="light"]`, so the "system" setting lands back on `:root` and renders dark on a
light phone, while `theme.ts` reports light. `docs/stash_issue.md` U5.

**`canonicalise` lives in `shared/`, not the Worker.** `docs/02-TRD.md` §10 puts URL
canonicalisation server-side. The client needs it too: the app dedupes a save before it
has a network, and a duplicate only the server can see arrives after the card is already
on the shelf. Two copies would be two things to get wrong, and a URL that hashes
differently on each side defeats the dedupe entirely. So there is one copy, in `shared/`.
`shared/tsconfig.json` gains the DOM lib for `URL` and `crypto.subtle` — DOM-only APIs
remain forbidden there, and there is a comment in the file saying so.

**`worker/src/env.ts`, not `env.d.ts`.** `Env` is imported by every route and middleware,
so it is a normal module rather than an ambient declaration.

**No KV, no Durable Object, and `vitest.config.ts` uses the `cloudflareTest()` plugin.**
`defineWorkersConfig` and a `test.pool` entry are both rejected by
`@cloudflare/vitest-pool-workers` 0.22; the plugin is the current answer. Bindings must be
declared into the global `Cloudflare.Env` for `cloudflare:test` to type them.

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

**A second one, in the extension.** A content script only enters a page when that page
loads, so after the extension is reloaded every already-open tab has none and
`chrome.tabs.sendMessage` fails. The symptom is a popup with an empty title and no price
line — indistinguishable from a page that carries no metadata, which is what made it cost
a debugging round. The popup and background now inject the script on demand and say so
when even that is refused (Chrome's own pages, the Web Store, PDFs).

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
- **Report R2 usage every time R2 is touched** — a test that stores an image, a
  build, a deploy, any manual poke at the bucket. Run `npm run r2` and paste what it
  says: how much is stored, what percentage of the 10 GB that is, and how much is
  left. The user asked for this explicitly and gave the reason: they are not watching
  the Cloudflare dashboard, and R2 is the one meter on this project with a card
  behind it. Cloudflare's own alert is an email that gets lost. Do not wait to be
  asked, and do not report it only when it looks bad.
- The user writes in Hinglish and replies are written in Hinglish.

## Git workflow

**Push and merge are the user's, never yours.** Do not run `git push` or `git merge` — not
even when the user has approved the work being pushed. Give them the exact command to
copy, say what output means success, and stop there.

**Announce every commit before making it.** Say which files go in and what the message
will be, and wait. The user has asked to be told first; a commit is not a routine step
here.

One branch per phase, named `P<n>/<two-or-three-word-description>`, with several small
commits inside it. Each new phase branch is cut from the previous phase branch, not from
`main` — the user asked for this explicitly. `main` is moved to the phase branch once the
phase is complete.

`.gitignore` is committed first, before anything else — a secret committed once stays in
history forever, and deleting the file later does not remove it.

Run `npm run check:secrets` before handing over a push command, and say that it passed.

Commit messages carry no `Co-Authored-By` trailer, by the user's instruction.
