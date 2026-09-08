# Stash

A personal, cross-platform save-for-later shelf for products you find anywhere on the internet.

Save from any website or app in one action. Everything lands in one place, sorted into
categories, searchable, and synced across Android, Windows and Linux. Runs entirely on
free-tier infrastructure. Single user.

---

## What problem this solves

You are scrolling — YouTube, Instagram, WhatsApp, a blog, a marketplace — and you see
something you want. Not now. Later, or when it gets cheaper. Today that item either:

- gets a screenshot that disappears into a camera roll,
- gets saved into whichever platform's wishlist you happen to be in, splitting your intent
  across six accounts you never revisit, or
- gets forgotten within the minute.

Stash gives you one shelf that you own, reachable from wherever you were scrolling, in
under five seconds.

---

## Documents

Read in this order. Each one assumes the ones above it.

| # | File | What it settles |
|---|------|-----------------|
| 1 | [`01-PRD.md`](01-PRD.md) | Users, jobs, scope, features, acceptance criteria, success metrics |
| 2 | [`02-TRD.md`](02-TRD.md) | Stack choice, constraints, data model, API contract, security, quotas |
| 3 | [`03-ARCHITECTURE.md`](03-ARCHITECTURE.md) | Components, request flows, enrichment ladder, sync, failure modes |
| 4 | [`04-DESIGN-SYSTEM.md`](04-DESIGN-SYSTEM.md) | Design direction, tokens, type, components, interaction, copy |
| 5 | [`05-ROADMAP.md`](05-ROADMAP.md) | Phases P0–P5, task breakdown, definition of done per phase |
| 6 | [`06-AGENT-BUILD-GUIDE.md`](06-AGENT-BUILD-GUIDE.md) | Executable instructions for an AI coding agent |
| 7 | [`07-RESEARCH.md`](07-RESEARCH.md) | Competitive landscape, platform research, decisions and rejected options |

---

## Shape of the system

```
  Android phone                    Desktop (Windows / Linux)
  ┌────────────────┐               ┌──────────────────────────┐
  │ any app        │               │ Chrome / Firefox         │
  │  → Share sheet │               │  → Toolbar button        │
  │  → "Stash"     │               │  → Right-click menu      │
  └───────┬────────┘               │  → Ctrl+Shift+S          │
          │                        └───────────┬──────────────┘
          │                                    │
  ┌───────▼────────┐               ┌───────────▼──────────────┐
  │ Stash PWA      │               │ Stash Extension (MV3)    │
  │ installed,     │               │ reads live page DOM,     │
  │ offline queue  │               │ high-fidelity capture    │
  └───────┬────────┘               └───────────┬──────────────┘
          │                                    │
          └──────────────┬─────────────────────┘
                         │  HTTPS + bearer token
              ┌──────────▼───────────┐
              │  Cloudflare Worker   │  API + metadata enrichment
              └──────┬────────┬──────┘
                     │        │
              ┌──────▼──┐  ┌──▼─────┐
              │   D1    │  │   R2   │
              │ SQLite  │  │ images │
              └─────────┘  └────────┘
```

---

## Stack, and why

| Layer | Choice | Free-tier headroom |
|-------|--------|--------------------|
| API | Cloudflare Workers | 100,000 req/day, 10 ms CPU per request |
| Database | Cloudflare D1 (SQLite) | 5 GB, 5M row reads/day, 100K row writes/day |
| Images | Cloudflare R2 | 10 GB stored, zero egress charge |
| Web app hosting | Cloudflare Pages | Unlimited static requests, 500 builds/month |
| Android app | PWA + Web Share Target | No Play Store, no developer fee |
| Desktop capture | Browser extension (MV3) | Free on Chrome; Firefox free |

One vendor, one account, one `wrangler deploy`. No credit card. No domain purchase —
the app lives on a free `*.pages.dev` subdomain.

Realistic usage for one person: roughly 30 saves a day is 30 writes and a few hundred
reads. That is under one percent of every quota above. Full arithmetic is in
[`02-TRD.md`](02-TRD.md).

---

## Explicitly out of scope for v1

These are good ideas that are deliberately deferred. Do not build them.

- **Price tracking and drop alerts.** Cut from v1 by decision. Adds scheduled scraping,
  bot-detection handling, and a notification pipeline — all of which can arrive later
  without changing the data model. The schema reserves room for it (see `02-TRD.md`).
- **Multi-user, accounts, login screens.** One user, one token.
- **Sharing lists, gifting, group features.** Every competing product optimises for this;
  Stash is a private tool.
- **iOS.** The PWA will run on iOS but the share sheet integration is weaker there.
  Not a target platform.
- **Native Android app.** The PWA covers it.
- **Any recommendation feed, discovery, or trending section.** This tool exists to close
  loops, not open new ones.

---

## Success, stated plainly

Three months after daily use:

- Saving takes under five seconds from seeing the thing to it being on the shelf.
- At least one in five saved items reaches a decision — bought or dropped — rather than
  sitting untouched.
- Nothing that was saved is unfindable.
- The shelf is opened on purpose, not only written to.

The fourth one is the real test. Read-to-write ratio is the health metric that separates
a tool from a landfill. Full metric definitions in [`01-PRD.md`](01-PRD.md).
