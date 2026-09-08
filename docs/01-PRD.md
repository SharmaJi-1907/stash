# 01 — Product Requirements

**Product:** Stash
**Version:** 1.0
**Status:** Approved for build
**Owner:** Single user / builder

---

## 1. Problem

### 1.1 The situation

A person spends several hours a day inside feeds — YouTube, Instagram, WhatsApp
forwards, Reddit, blogs, marketplaces. Product discovery is now incidental. You are not
shopping; you are scrolling, and a thing appears that you want.

The wanting is real but the buying is not immediate. Reasons vary: no money right now,
waiting for a sale, not sure yet, need to compare, it is for a room you have not moved
into. The gap between *seeing* and *buying* can be days or a year.

### 1.2 Where it breaks

Nothing holds that gap. Specifically:

**Capture is expensive.** Saving a thing costs four or five taps: leave the feed, open a
notes app or a browser, paste, add context, come back. At that cost, most items are never
saved. The ones that are get screenshotted instead, which is one tap but produces a
context-free image in a camera roll of four thousand images.

**Storage is fragmented.** Amazon's wishlist holds Amazon items. Flipkart's holds
Flipkart's. Instagram saves hold posts, not products. A thing seen on a blog has no
home at all. Intent is scattered across six systems, none of which you control, none of
which talk to each other.

**Retrieval fails.** Even when something is saved, it cannot be found later. There is no
category, no tag, no note about *why* it was saved. Six months on, a saved link is an
unreadable artefact.

**Nothing closes.** Saved items have no lifecycle. They are never marked bought, never
marked dropped. The list only grows. Eventually it is ignored entirely, which retroactively
makes every save worthless.

### 1.3 Root cause

Three, in order of severity:

1. **The wishlist belongs to the platform, not the person.** Every existing solution is
   built to keep you inside one storefront. A person's wants are not organised by retailer.
2. **Capture friction exceeds the strength of a passing impulse.** If saving costs more
   than about five seconds, the impulse loses.
3. **Saving is treated as the end state.** Products are built around the save event and
   nothing after it, so lists decay into landfill.

Stash addresses all three, and treats the third as the hardest.

---

## 2. Users

One. The builder.

| Attribute | Value |
|-----------|-------|
| Devices | Android phone (primary), Windows desktop, Linux desktop |
| Browsers | Chrome and Firefox on desktop; Chrome on Android |
| Where discovery happens | YouTube, Instagram, WhatsApp, web browsing, marketplaces |
| Categories of interest | Gadgets, software and tools, home goods, clothing, books |
| Technical ability | High — comfortable installing a PWA, side-loading an extension, pasting a token |
| Budget | Zero. Hard constraint, not a preference. |
| Peak usage context | One-handed, phone, evening, mid-scroll |

**Design consequence of that last row:** the primary interaction surface is a thumb on a
phone in low light. Everything else is secondary.

**Future:** the product may be opened to others later. This should not shape v1 features,
but it does shape two technical decisions — see `02-TRD.md` §9.

---

## 3. Jobs to be done

Ranked. Higher ranks win when they conflict.

**J1 — Capture without leaving the moment.**
> When I see something I want mid-scroll, I want it on my shelf in one action, so that I
> do not lose the thing or the thread I was reading.

**J2 — Find it again on demand.**
> When I am ready to buy, I want to reach the exact item without re-searching the web,
> so that a decision I already made is not made again.

**J3 — See everything I am considering, in one view.**
> When I have money to spend, I want to compare what I am holding, so that I spend it on
> the thing I want most.

**J4 — Close the loop.**
> When I buy it or stop wanting it, I want it off the shelf, so that the shelf keeps
> meaning something.

**J5 — Remember why.**
> When I look at an item six months later, I want to know what I liked about it, so it is
> not just an anonymous link.

---

## 4. Product principles

Six. When a decision is unclear, apply these in order.

1. **Capture beats correctness.** An item saved with a bad title is infinitely better than
   an item not saved. Never block a save on missing metadata, a network failure, or a
   parse error. Enrich afterwards, in the background, silently.

2. **The shelf must stay finite.** Every feature is judged on whether it helps items
   *leave*. Anything that only helps items arrive makes the product worse.

3. **Any site, no exceptions.** There is no "supported retailers" list. A generic path
   handles everything; site-specific rules are optimisations layered on top, never
   preconditions.

4. **Yours, offline, exportable.** The data is a plain SQLite database and a JSON export.
   No lock-in, including no lock-in to Stash.

5. **It is a tool, not a store.** No recommendations, no trending, no discovery, no ads,
   no infinite anything. The product's job ends when your decision is made.

6. **Quiet by default.** One notification a week, at most, and it is a digest. The product
   never competes for attention with the feeds it is meant to rescue you from.

---

## 5. Scope

### 5.1 In scope for v1

| ID | Capability |
|----|-----------|
| F1 | Save any URL from any site or app |
| F2 | Automatic metadata extraction — title, image, price, site, description |
| F3 | Automatic categorisation, with one-tap correction that the system learns from |
| F4 | Manual capture fallback for app-only content (Instagram, WhatsApp) |
| F5 | Unified shelf, sorted and filtered |
| F6 | Search across title, note, tag, and site |
| F7 | Item lifecycle: open → shortlist → bought / dropped |
| F8 | Notes and tags per item |
| F9 | Cross-device sync |
| F10 | Offline capture with deferred sync |
| F11 | Stale-item surfacing and a weekly digest |
| F12 | Full JSON export |

### 5.2 Out of scope for v1

| Excluded | Reason |
|----------|--------|
| Price tracking, price history, drop alerts | Deferred by decision. Schema keeps room; see §5.3 |
| Accounts, login, multi-user | One user |
| Sharing, gifting, collaborative lists | Not the problem being solved |
| Native Android app, Play Store listing | PWA covers it, and the listing costs money |
| iOS as a supported target | Not a device the user has |
| Browser-history-based auto-suggestions | Creepy, and low value |
| Any feed, discovery, or recommendation surface | Violates principle 5 |
| Image editing, cropping, annotation | Not the job |

### 5.3 Deferred, with reserved space

Price tracking is the most likely v2 feature. The v1 schema therefore includes
`price_amount`, `price_currency`, and a `price_snapshots` table that is written on every
enrichment but never read by v1 UI. This costs nothing now and means v2 arrives with
history already accumulated rather than starting from zero. See `02-TRD.md` §4.

---

## 6. Functional requirements

### F1 — Save any URL

**F1.1 Android share sheet.** Stash appears in the Android share sheet for `text/plain`
and `image/*`. Sharing a link from any app opens Stash's capture screen with the URL
already populated.

**F1.2 Desktop extension.** A toolbar button, a right-click context menu entry on links,
images and pages, and a keyboard shortcut (`Ctrl+Shift+S`) each save the current page.

**F1.3 Paste.** A single input in the app accepts a pasted URL. Handles messy input:
shared text with a URL buried in it, tracking parameters, shortened links.

**F1.4 Save must never fail.** If the network is down, the item is written locally and
queued. If enrichment fails, the item is saved with the raw URL as its title and marked
for retry. The user always sees a success state.

**F1.5 Duplicate handling.** Saving a URL already on the shelf does not create a second
row. It surfaces the existing item and offers to bump it to the top. Comparison is on
canonicalised URL — see `03-ARCHITECTURE.md` §4.1.

**Acceptance:** From a YouTube video description on Android, a link is on the shelf in
under five seconds, measured from the first tap on the share icon.

---

### F2 — Metadata extraction

**F2.1 Fields.** Title, description, image, price with currency, site name, canonical URL.

**F2.2 Ladder.** Extraction attempts these in order, stopping at the first that yields a
title: page DOM (extension only), JSON-LD `Product` schema, Open Graph tags, Twitter Card
tags, oEmbed, `<title>` plus first meaningful image. Full specification in
`03-ARCHITECTURE.md` §4.

**F2.3 Quality flag.** Every item carries an `enrichment` value of `rich`, `partial`,
`manual`, or `failed`. `partial` and `failed` items are visually distinguishable and
individually re-enrichable.

**F2.4 Image durability.** Images are copied to the user's own object storage at save
time. Hotlinking is not acceptable — source CDNs expire URLs and block cross-origin
referers. If the image is over 2 MB or fetch fails, fall back to the original URL and
mark the item `partial`.

**F2.5 Timeout.** Enrichment abandons after 8 seconds and marks the item `failed`. It does
not block the save.

**Acceptance:** Across a test set of twenty links spanning Amazon India, Flipkart, Myntra,
a Shopify store, a WordPress blog, a YouTube video, a GitHub repository and a news article,
at least sixteen produce a usable title and image without manual intervention.

---

### F3 — Categorisation

**F3.1 Default categories.** Gadgets, Home, Clothing, Software & Tools, Books, Other.
All renameable; new ones creatable; `Other` is not deletable.

**F3.2 Automatic assignment.** Every item is assigned a category at save time by a
rule-based classifier: domain mapping first, then keyword matching against the title, then
`Other`. No external API, no cost, no latency.

**F3.3 Correction and learning.** Changing an item's category is one tap. Doing so writes
a rule to a local override table keyed on domain and matched keyword, so the same pattern
classifies correctly next time.

**F3.4 Non-physical items.** Software, tools, courses and subscriptions are first-class.
`Software & Tools` is a default category, not an afterthought — a saved GitHub repository
or SaaS pricing page must not look broken.

**Acceptance:** After twenty saves and at most five corrections, the classifier places new
items from previously-seen domains correctly.

---

### F4 — Manual fallback

**F4.1 Trigger.** When a URL cannot be enriched — bot wall, login wall, app-only content,
a bare `instagram.com/reel/…` link — the app presents a manual capture form rather than
an error.

**F4.2 Form.** Title (required), optional screenshot, optional note, optional price,
category. The screenshot uploads to object storage and becomes the item's image.

**F4.3 Screenshot share.** Sharing an image (not a link) to Stash from Android opens this
form with the image already attached. This is the path for WhatsApp forwards and
Instagram screenshots, where no useful URL exists at all.

**Acceptance:** An Instagram reel screenshot becomes a titled, categorised, findable item
in under fifteen seconds.

---

### F5 — The shelf

**F5.1 Two views.** *Stack* — a single-column list optimised for deciding. *Board* — a
two-column image grid optimised for visual recall. The toggle persists.

**F5.2 Default sort.** Newest first. Alternatives: oldest first, price, category, and
recently touched.

**F5.3 Filters.** By category, by status, by enrichment quality, by age bracket, by tag.
Filters combine. The active filter set is always visible and clearable in one tap.

**F5.4 Item detail.** Full image, title, description, price, source domain, saved date, age
in days, note, tags, category, status, and an "Open original" action.

**F5.5 Age is visible.** Every item shows how long it has been on the shelf. This is not
decoration — see §7.

**Acceptance:** With three hundred items on the shelf, initial render is under one second
and scrolling holds 60 fps on a mid-range Android phone.

---

### F6 — Search

**F6.1 One field.** Searches title, note, tags, and domain simultaneously. No search mode
selector, no advanced syntax.

**F6.2 Live.** Results update as you type, debounced at 150 ms.

**F6.3 Local first.** Search runs against the local store, so it works offline and returns
instantly.

**Acceptance:** Typing three characters returns matching results in under 100 ms with
five hundred items indexed.

---

### F7 — Lifecycle

**F7.1 States.** `open` (default), `shortlist` (actively considering), `bought`, `dropped`.

**F7.2 Gestures.** Swipe right marks bought. Swipe left drops. Both show an undo toast
for six seconds. This is the primary path — buttons exist in the detail view as a
secondary path.

**F7.3 Bought and dropped items leave the main shelf** but are retained, filterable, and
restorable. Nothing is hard-deleted without an explicit destructive confirmation.

**F7.4 Decision timestamp.** `decided_at` is recorded, enabling the metrics in §8.

**Acceptance:** Marking an item bought takes exactly one gesture and is reversible.

---

### F8 — Notes and tags

**F8.1 Note.** One free-text field per item. Prompted at capture but always skippable.

**F8.2 Tags.** Multiple per item. Autocomplete from existing tags. Tags are for
cross-cutting concerns that categories cannot express — `diwali-gift`, `for-desk-setup`,
`under-2k`.

**Acceptance:** A note added at capture time appears in search results for that note's text.

---

### F9 — Sync

**F9.1 Model.** Server is authoritative. Clients pull deltas since their last sync
timestamp and push individual changes. Conflicts resolve last-write-wins on `updated_at`.

**F9.2 Trigger.** On app open, on foreground, after any local write, and every five minutes
while the app is open.

**F9.3 Deletions propagate** via tombstones, not row removal.

**Acceptance:** An item saved on the phone appears on the desktop within thirty seconds of
the desktop app being focused.

---

### F10 — Offline

**F10.1 Local write first.** Every save writes to local storage before any network call.

**F10.2 Queue.** Failed pushes queue and retry with exponential backoff. The queue survives
app restarts.

**F10.3 Visible state.** Pending items appear on the shelf immediately, marked as syncing.
The user is never shown an error for a save that will eventually succeed.

**Acceptance:** In airplane mode, five items can be saved; on reconnect all five sync
without user action.

---

### F11 — Keeping the shelf finite

This is the feature set that separates Stash from a bookmark folder. Treat it as core, not
polish.

**F11.1 Age surfacing.** Items past thirty days are visually marked stale in the shelf.
Not hidden, not nagged — just legible at a glance.

**F11.2 Decide prompt.** Opening a stale item shows a single inline question: still want
this? Two answers — yes, which resets its clock, or drop.

**F11.3 Weekly digest.** Once a week, one notification: how many items are open, how many
went stale, and one specific item to decide on. One notification. Not a stream.

**F11.4 Shelf health.** A small persistent indicator showing open item count against a
soft target the user sets. Informational, never blocking.

**Acceptance:** A user who ignores the shelf for six weeks, on returning, is shown a
digest that leads to at least one decision.

---

### F12 — Export

**F12.1 Format.** JSON containing every item, category, tag and relation.

**F12.2 Images.** Export includes image URLs; a separate archive download bundles the
actual files.

**F12.3 No lock-in.** The database is SQLite and can be dumped directly.

**Acceptance:** A full export can be re-imported into a fresh instance producing an
identical shelf.

---

## 7. The design position

Recorded here because it constrains features, not only visuals. Full treatment in
`04-DESIGN-SYSTEM.md`.

Every competing product looks like a storefront: a grid of product cards, prices in red,
buy buttons. That visual language puts the user in shopping mode, which encourages saving
more and deciding less — the exact failure this product exists to fix.

Stash instead looks like a **workbench**. Items are cards you are holding and evaluating,
not products on display. Three consequences that reach into the requirements:

- **The default view is a list, not a grid.** A grid invites browsing; a list invites
  processing. The grid exists as a secondary view for visual recall only.
- **Age is a first-class field.** The most important hidden fact about a saved item is how
  long it has been waiting. It appears on every card.
- **The interface contributes no colour.** Product images are the only saturated thing on
  screen. This is functional — an image-dense list with a colourful chrome is unreadable —
  and it means the shelf reads as *your things*, not as an app's branding.

---

## 8. Success metrics

| # | Metric | Definition | Target at 3 months |
|---|--------|-----------|--------------------|
| M1 | Capture time | Seconds from share-sheet tap to confirmed save | Under 5 s, p90 |
| M2 | Decision rate | `(bought + dropped) ÷ total saved`, rolling 90 days | Above 20% |
| M3 | Read-to-write ratio | Shelf opens ÷ items saved, weekly | Above 0.5 |
| M4 | Enrichment success | Items reaching `rich` or `partial` without manual input | Above 80% |
| M5 | Stale share | Open items older than 60 days ÷ all open items | Below 30% |
| M6 | Retrieval success | Searches that end in an item being opened | Above 70% |
| M7 | Cost | Rupees per month | Zero |

**M3 is the one that matters.** M1, M4 and M6 measure whether the tool works. M2, M3 and
M5 measure whether it is *used*. A product scoring perfectly on the first group and poorly
on the second has failed — it is a well-engineered landfill.

Instrument these locally. No third-party analytics, no telemetry leaving the device.

---

## 9. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|-----------|
| R1 | Shelf becomes write-only landfill | High | Fatal | F11 in its entirety; M3 tracked from day one |
| R2 | Marketplaces bot-block server-side fetch | High | Medium | Extension reads live DOM; manual fallback always available |
| R3 | Android share target does not register | Medium | High | Known Chrome caching issue — requires absolute action URL in manifest and a full PWA reinstall after manifest changes. Verified in P2 before anything is built on top |
| R4 | Free-tier limits change or tighten | Low | Medium | Usage sits under 1% of every quota; data is exportable SQLite; the whole system is portable |
| R5 | Metadata extraction fails on the sites actually used | Medium | High | Four-step ladder plus manual fallback; measured against a fixed twenty-link test set |
| R6 | Auth token leaks | Low | High | Bearer token, constant-time comparison, per-token rate limit, one-command rotation |
| R7 | Image storage grows past free tier | Low | Low | 10 GB is roughly 50,000 images at 200 KB; 2 MB per-image cap; oldest-image pruning available if ever needed |
| R8 | Over-building — v1 never ships | Medium | High | Phases P0–P2 are the shippable core; everything after is optional. See `05-ROADMAP.md` |

R1 and R8 are the two that actually kill this project. R2 through R7 are engineering
problems with known answers.

---

## 10. Open questions

| # | Question | Needed by | Default if unanswered |
|---|----------|----------|----------------------|
| Q1 | Soft target for open-item count in F11.4 | P4 | 50 |
| Q2 | Stale threshold — is 30 days right? | P4 | 30 days, user-adjustable |
| Q3 | Weekly digest delivery day and time | P4 | Sunday, 10:00 local |
| Q4 | Does the shelf need a monetary total per category? | P3 | No |

None of these block P0 through P2. Build with the defaults.
