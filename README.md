# Stash

A private, cross-platform save-for-later shelf for products you find anywhere on the
internet. One user. Free tier only. Android (PWA), Windows and Linux (PWA + extension).

**The specification lives in [`docs/`](docs/). Read it before writing code.**

| Order | Document | Settles |
|-------|----------|---------|
| 1 | [`docs/README.md`](docs/README.md) | Shape of the system |
| 2 | [`docs/01-PRD.md`](docs/01-PRD.md) | Users, jobs, scope, acceptance criteria |
| 3 | [`docs/02-TRD.md`](docs/02-TRD.md) | Stack, schema, API contract, security |
| 4 | [`docs/03-ARCHITECTURE.md`](docs/03-ARCHITECTURE.md) | Flows, extraction ladder, sync |
| 5 | [`docs/04-DESIGN-SYSTEM.md`](docs/04-DESIGN-SYSTEM.md) | Tokens, type, components, voice |
| 6 | [`docs/05-ROADMAP.md`](docs/05-ROADMAP.md) | Phases P0–P5, definition of done |
| 7 | [`docs/06-AGENT-BUILD-GUIDE.md`](docs/06-AGENT-BUILD-GUIDE.md) | Standing rules, setup, commands |
| 8 | [`docs/07-RESEARCH.md`](docs/07-RESEARCH.md) | Why each decision was made |
| — | [`docs/stash_issue.md`](docs/stash_issue.md) | **Not spec.** Open P2 issues, and what is already ruled not-an-issue |

---

## Layout

```
stash/
├── docs/          specification — the source of truth
├── shared/        Item, Category, Tag and API types. Imported by all three clients.
├── worker/        Cloudflare Worker (Hono) — API, enrichment, sync, image proxy
├── web/           PWA — React 19 + Vite. Share target, shelf, offline store, sync.
├── extension/     Browser extension (MV3) — high-fidelity desktop capture
└── prototype/     Throwaway visual skeleton. Not wired to anything.
```

---

## Getting started

```bash
node --version          # 22 — see .nvmrc, run `nvm use`
npm install -g wrangler
wrangler login
npm install             # installs all workspaces
```

P0 to P2 are already built and deployed, so a fresh clone needs the Cloudflare resources
pointed at it rather than created: the D1 id and R2 bucket are in `wrangler.toml`, and the
device token is set with `wrangler secret put DEVICE_TOKEN`. Setup commands are in
[`docs/06-AGENT-BUILD-GUIDE.md`](docs/06-AGENT-BUILD-GUIDE.md) §2; the next phase to build
is **P3** in [`docs/05-ROADMAP.md`](docs/05-ROADMAP.md) — and the roadmap gates it on two
weeks of real use first, which it calls not negotiable.

## Commands

```bash
npm run dev:worker       # wrangler dev --local
npm run dev:web          # vite
npm run migrate:local    # apply D1 migrations locally
npm run migrate:remote   # apply D1 migrations to production
npm run deploy:worker    # wrangler deploy
npm run deploy:web       # wrangler pages deploy
npm test                 # unit + integration
npm run test:fixtures    # the twenty-link enrichment set
npm run check:secrets    # fails if anything committable contains a secret
npm run check:contrast   # all twenty colour pairs, both themes, plus ink order
npm run r2               # R2 usage: stored bytes, % of the 10 GB, what is left
```

`npm run r2` is not optional housekeeping. R2 is the only meter on this project with a
payment card behind it, so its usage is reported every time the bucket is touched rather
than left to a Cloudflare email.

## Secrets

Every credential lives in `.credentials.local.md` at the repo root. It is gitignored, and
nothing in the codebase reads it — it is a written record so nothing has to be remembered.

The device token is never written into source, config, or a build. It is typed in by hand
in four places: `worker/.dev.vars` for local runs, `wrangler secret put DEVICE_TOKEN` for
production, the extension's options page, and the app's settings screen.

Run `npm run check:secrets` before every commit and push. It scans exactly the files git
would send — not the whole disk — for the token value, hardcoded secret assignments,
private keys and cloud credentials, and confirms the secret files are still ignored.

Extension has no build step — load `extension/` unpacked in Chrome or Firefox.

---

## Build status

| Phase | Delivers | Status |
|-------|----------|--------|
| — | Repo scaffold | **done** |
| P0 | Foundation — deploy, database, auth | **done**, live |
| P1 | Capture and enrich — Worker API, extension | **done**, live |
| P2 | The app — PWA, share target, shelf, sync | **done**, live |
| — | *Stop. Two weeks of real use.* | — |
| P3 | Organise — categories, classifier, search | not started |
| P4 | Decide — lifecycle, staleness, digest | not started |
| P5 | Later — price tracking | deferred |

Live at `https://stash-1ju.pages.dev` (app) and
`https://stash-api.sharmaabhinav1907.workers.dev` (API). Both are public URLs reachable
from any network; the shelf itself is per-device until the token is entered in settings.

458 tests pass, typecheck is clean across four workspaces, and all twenty colour pairs
clear their contrast floor in both themes.

P2 is functional, not finished. The open interface work is listed in
[`docs/stash_issue.md`](docs/stash_issue.md), which is the one file in `docs/` that is not
specification — 00–07 were written before any code and do not change.

## The two rules that matter most

1. **A save never blocks on the network.** Local write → render → background push.
2. **Enrichment failure is not an API error.** The save is the contract; metadata is
   best-effort.

Full standing rules: [`docs/06-AGENT-BUILD-GUIDE.md`](docs/06-AGENT-BUILD-GUIDE.md) §1.
