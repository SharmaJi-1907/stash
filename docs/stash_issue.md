# P2 issues

Everything open against `P2/pwa-and-shelf`, as of 2026-09-10.

The branch is committed and pushed. All 458 tests pass, typecheck is clean and
contrast is 20/20 — so nothing here is caught by the checks that exist. Every
item below is either a thing the tests do not look at, or a thing only a person
looking at the screen can see.

Each entry says how it was found, because that changes how much to trust it:

| Mark | Meaning |
|---|---|
| **verified** | reproduced in the code or measured against a live page |
| **reported** | the user saw it; not yet reproduced here |

---

## Backend

### B1 — Shopify stores lose their price · verified

Shopify writes the price as `og:price:amount`. Both readers look only for
`product:price:amount`, so the number is on the page, parsed, and thrown away.

    worker/src/lib/extractors/opengraph.ts:24
    extension/src/content.js:257

Measured 2026-09-10 on `quartzcomponents.com`:

    <meta property="og:price:amount"   content="138.00">
    <meta property="og:price:currency" content="INR">

Both missed. Indian hobby-electronics stores are heavily Shopify, so this is
not an edge case for this particular user.

Fix: read both spellings, prefer `product:` when both exist.
Cost: two lines and a test in each place.

### B2 — the same font file is downloaded three times · verified

`plex-400-latin.woff2`, `plex-500-latin.woff2` and `plex-600-latin.woff2` are
byte-identical. So are the three `-latin-ext` files.

    b2c9031d9fd6493ccda94908cdba4abd  plex-400-latin.woff2
    b2c9031d9fd6493ccda94908cdba4abd  plex-500-latin.woff2
    b2c9031d9fd6493ccda94908cdba4abd  plex-600-latin.woff2

Nothing renders wrong — the file is a **variable** font, confirmed by decoding
its woff2 table directory and finding `fvar`, `HVAR`, `MVAR`, `STAT`. One file
genuinely covers 400 to 700. The waste is that `fonts.css` asks for it under
three different URLs, so the browser fetches three copies.

    2 x 45,712 + 2 x 30,964 = 153,352 bytes downloaded for nothing

Against a 200 KB budget (`02-TRD.md` §7) that is most of the budget spent on
duplicates. On a phone on mobile data it is the slowest part of first paint.

The nine Devanagari files are correct — those are static faces and all three
weights differ.

Fix: one `@font-face` per subset with `font-weight: 400 700`, delete four
files, update the preload in `index.html`.

---

## UI

The backend is broadly working. This is where the remaining work is.

### U1 — it does not feel like an application · reported

The user's words: the UI feels dull and unfinished, not like something built.

This is the parent of most of what follows rather than a separate defect, and
it is the one that actually matters — `01-PRD.md` principle 3 asks for a shelf
that is pleasant enough to open in the evening. A shelf nobody wants to open
fails whether or not every function works.

Needs to be broken into concrete changes before anything is built. Do that
first, with the user, screen by screen.

### U2 — nothing is highlighted · reported

No colour or emphasis marks what can be acted on, so every element reads at
the same weight and the eye has nowhere to land.

`04-DESIGN-SYSTEM.md` gives `--signal` for exactly this and the token exists in
`tokens.css`. It is barely used.

### U3 — "bought & dropped" is a text link, not a tab · verified

    web/src/screens/Shelf.tsx:196
    web/src/screens/Shelf.css:48    // padding: 0; underline; no box

It renders as a small underlined word on a line. It is one of only two views
in the whole app and it looks like a footnote.

Should be a real two-way control — the shelf and the archive as peers, with
the current one visibly selected.

### U4 — the visual design is bad · reported

Held separately from U1 because it is about the built result, not the concept.
Needs specifics from the user: which screen, and what is wrong with it.

### U5 — "system" theme always renders dark · verified

    grep -c "prefers-color-scheme" web/src/styles/tokens.css  ->  0

`tokens.css` defines dark on `:root` and light only under `[data-theme="light"]`.
Choosing **system** removes the attribute, which lands back on `:root` — dark.
So a phone set to light shows the app in dark and the setting appears broken.

Worse, the code believes otherwise: `theme.ts` `resolvedTheme()` reads
`prefers-color-scheme` and reports light, while the CSS never applies it. Two
parts of the app disagree about what the user is looking at.

`04-DESIGN-SYSTEM.md` §10 asks for system default with an override, and calls
light "a full peer, not an afterthought". Right now it is an afterthought.

Fix: add a `@media (prefers-color-scheme: light)` block carrying the light
tokens, guarded so an explicit `[data-theme="dark"]` still wins.
`check-contrast.mjs` already proves both palettes, so this is safe to change.

### U6 — an image cannot be added or replaced · verified

    web/src/screens/ItemDetail.tsx    // renders an image, offers no way to set one

`POST /v1/uploads` exists and is tested — it was built in this same branch — and
no screen calls it. So when enrichment finds no image, or finds the wrong one,
there is no way to fix it by hand.

This is the recovery path for U7 and for every bot-walled site, which is most
of the ones that matter here.

### U7 — the saved image is not the product photo · reported

The image that comes back is often the site's share image or a generic banner
rather than the product.

Expected in part: `og:image` is what a site wants shown on WhatsApp, which is
not always the product. The extension's `largestImage()` should do better,
since it reads the rendered page.

Needs a concrete example — a URL, what was saved, and what should have been
saved — before anything is changed. Guessing at image selection is how the
wrong price got saved twice in P1.

---

## Order to fix

1. **U5** — small, verified, and the app is currently lying about it
2. **B1** — two lines, and it is the difference between a price and no price
3. **B2** — deletes files and speeds up first paint
4. **U3** — small and visible
5. **U6** — needs a screen, and unblocks U7
6. **U1, U2, U4** — the real work; break down with the user first
7. **U7** — after U6, with a real example in hand

---

## Not issues, recorded so they are not re-raised

**Extension shows no shelf.** By design — `02-TRD.md` §3.2: "its job is capture,
not browsing."

**A new device shows an empty shelf.** By design. The shelf lives in that
browser's IndexedDB; it fills once the token is entered and sync runs.

**Server-side enrichment gets no price from flipkart, ajio, myntra, robu.in.**
Measured, and the reason the extension exists. Those sites refuse Cloudflare
datacentre addresses. `robu.in` and `thinkrobotics.in` both answer 403 with a
Cloudflare challenge; the extension reads them fine because the browser has
already passed it.
