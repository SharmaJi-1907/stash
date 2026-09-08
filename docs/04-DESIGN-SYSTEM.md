# 04 — Design System

**Product:** Stash
**Depends on:** `01-PRD.md` §7

This document is binding. Colour, type, spacing and motion values here are the values to
implement. Where it explains reasoning, that is so the reasoning can be extended to cases
not covered — not so it can be re-litigated.

---

## 1. The brief

**Subject.** A private shelf for things one person wants but has not bought.

**Audience.** One person. Technical. Uses it one-handed, on a phone, in the evening,
mid-scroll, in low light. Secondary use on a desktop while browsing.

**Primary job.** Hold an item, and help a decision get made about it.

That last sentence is the whole brief. The product's job is not to display products. It is
to move items from *undecided* to *decided*. Every design choice below serves that.

---

## 2. Design direction

### 2.1 What to design against

Every wishlist product on the market looks like a storefront. Two-column product grid,
white background, price in red, a buy button on each card, a discovery feed somewhere.

That is a considered choice by those products — they earn affiliate revenue, so they want
you in shopping mode, saving more and browsing longer. It is the wrong choice here. Stash
earns nothing from a save. It succeeds when the shelf gets shorter.

Designing this like a storefront would import the exact behaviour the product exists to
fix.

### 2.2 The direction

**A workbench at night, not a shop window.**

Items are things you are holding and examining, not merchandise on display. The room is
cool and dim. There is one warm pool of lamplight, and the thing you are deciding about is
under it.

Three commitments follow:

**The interface contributes no colour.** Surfaces are desaturated blue-greys. Text is a
warm off-white. Product images supply every saturated pixel on screen. This is not
restraint for its own sake — a dense list of product photographs against a coloured chrome
is genuinely harder to read, and a neutral frame makes the shelf read as *your things*
rather than as an app's branding.

**A list, not a grid.** A grid is a browsing instrument; it presents everything as equally
available and invites more looking. A list is a processing instrument; it presents one
thing at a time in the reading position. Default view is a single column. The grid exists,
but as a secondary view for visual recall — "the lamp, I'd know it if I saw it."

**Age is drawn, not written.** The most important hidden fact about a saved item is how
long it has been waiting. It is the strongest available signal that a decision is overdue.
So it gets a structural treatment, not a caption — see §6.

### 2.3 Checked against generic defaults

Reviewed against the patterns that appear in machine-generated interfaces regardless of
subject:

- *Cream background with a high-contrast serif and a terracotta accent* — not used. The
  palette is cool and dark, and there is no serif.
- *Near-black with one acid accent* — adjacent, and adjusted away from. The base is
  distinctly blue (`#101620`), not tinted black, and the accent is a warm brass rather than
  an acid green or vermilion. More importantly the accent is functionally scoped: it marks
  decisions only, and never appears as decoration.
- *The SaaS card kit* — not used. Radii vary by element role rather than being uniform.
  There are no drop shadows anywhere; elevation is expressed by surface lightness, which is
  how it works in a dark interface anyway. No gradient washes.
- *Template chrome* — no all-caps eyebrow labels, no middle-dot meta strings, no `→`
  appended to buttons, no monospace for small labels.
- *Broadsheet layout* — not used.

The one deliberate risk is going dark-first. It is justified by the primary usage context
(evening, in bed, one-handed) rather than by taste, and a light theme ships alongside for
daylight use.

---

## 3. Colour

Two themes. Dark is default; light is a full peer, not an afterthought.

### 3.1 Dark

```css
:root {
  /* Surfaces — cool, desaturated, blue rather than grey */
  --bg:            #101620;   /* page */
  --surface:       #161E2B;   /* card */
  --surface-raised:#1E2836;   /* input, sheet, menu */
  --surface-lit:   #26313F;   /* the item under the lamp: hover, focus, selection */
  --line:          #2B3746;   /* hairline */
  --line-strong:   #3A4859;   /* divider that must be seen */

  /* Text — warm off-white against cool surfaces */
  --text:          #E9EBF0;
  --text-dim:      #97A3B6;
  --text-faint:    #626F82;

  /* Signal — brass. Decisions and overdue items only. Never decoration. */
  --signal:        #E8B84B;
  --signal-dim:    #8A6E2A;

  /* Settled — muted teal. Bought and confirmed states. */
  --settled:       #5DA096;

  /* Destructive — desaturated, because dropping is routine, not alarming */
  --drop:          #C4736B;
}
```

### 3.2 Light

```css
[data-theme="light"] {
  --bg:            #F2F3F6;
  --surface:       #FFFFFF;
  --surface-raised:#FFFFFF;
  --surface-lit:   #E8EBF1;
  --line:          #DDE1E8;
  --line-strong:   #C3CAD6;

  --text:          #161C26;
  --text-dim:      #5C6879;
  --text-faint:    #8C97A6;

  --signal:        #A67908;
  --signal-dim:    #D9C089;
  --settled:       #3D7A70;
  --drop:          #A8483F;
}
```

### 3.3 Rules

1. **`--signal` has exactly three uses.** The stale marker on an overdue card, the primary
   action in a decision moment, and the price-drop indicator when that feature arrives.
   Nowhere else. If it appears on more than about one in eight cards, its meaning has been
   diluted and something is wrong.
2. **No shadows.** Elevation is surface lightness. `--surface` sits on `--bg`;
   `--surface-raised` sits on `--surface`. In a dark interface a shadow is invisible
   anyway, and in the light theme a hairline reads more cleanly.
3. **No gradients.** Anywhere.
4. **Status is never colour alone.** Every state carries a shape, a position, or a word
   alongside its colour. Required for accessibility and it also survives greyscale
   screenshots.
5. **Product images are the only saturated thing on screen.** Do not add coloured category
   chips, coloured tags, or coloured badges. Category and tag are text.

---

## 4. Type

### 4.1 Family

**IBM Plex Sans** throughout. **IBM Plex Sans Condensed** for dense metadata rows where
horizontal space is genuinely short.

This is a content-driven choice, not an aesthetic one. Product titles scraped from Indian
sites frequently contain Devanagari. IBM Plex is one of the few high-quality open families
with a real Devanagari cut that shares its Latin's proportions and weight axis, so a mixed
title renders in one voice instead of two. Secondly, Plex's slightly mechanical letterforms
— the flat-topped `a`, the squared terminals — suit a tool rather than a shop, which is
exactly the register this product needs.

Self-host the WOFF2 files. Do not use Google Fonts: an external font request on the
critical path is latency the five-second budget cannot spare, and self-hosting keeps the
Content Security Policy tight.

```css
--font: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-condensed: "IBM Plex Sans Condensed", var(--font);
```

Weights loaded: 400, 500, 600. Three, not six — every additional weight is bytes on the
critical path.

### 4.2 Scale

Base 16px. Ratio approximately 1.2 — a minor third, tight enough to keep a dense list
coherent while still separating levels clearly.

| Token | Size | Line height | Weight | Used for |
|-------|------|-------------|--------|----------|
| `--t-display` | 28px | 1.15 | 600 | Screen titles only |
| `--t-lg` | 20px | 1.3 | 600 | Item title in detail view |
| `--t-md` | 16px | 1.45 | 500 | Item title in the shelf. The workhorse. |
| `--t-base` | 15px | 1.55 | 400 | Body, notes, descriptions |
| `--t-sm` | 13px | 1.4 | 400 | Metadata: site, age, category |
| `--t-xs` | 12px | 1.35 | 500 | Counts, badge numerals |

Letter-spacing: `-0.011em` on `--t-display` and `--t-lg`. Zero elsewhere. Never positive —
tracked-out type is a tell.

Measure caps at 68 characters for body text.

### 4.3 Rules

1. Sentence case everywhere. No all-caps, including on labels and buttons.
2. Never emphasise one word inside a heading with colour, italic, or weight.
3. Product titles clamp at two lines with an ellipsis. Never three — it destroys the
   rhythm of the list and two lines is enough to identify anything.
4. No label above a field where the placeholder or the surrounding context already says
   what it is.
5. Numerals: use tabular figures in any column where numbers stack, so prices align.
   `font-variant-numeric: tabular-nums`.

---

## 5. Layout and space

### 5.1 Spacing scale

4px base. Six steps. Resist adding a seventh.

```css
--s1: 4px;   --s2: 8px;   --s3: 12px;
--s4: 16px;  --s5: 24px;  --s6: 40px;
```

### 5.2 Radii, by role

Radius encodes what a thing *is*. Uniform radius across every element is the flattest
possible signal and reads as a template.

```css
--r-card:  10px;  /* items — the objects on the shelf */
--r-input:  6px;  /* fields and controls — mechanical, tighter */
--r-sheet: 16px;  /* bottom sheets — soft, they come from the edge */
--r-pill: 999px;  /* filter chips only */
```

Images inside cards get `--r-card` minus the card's padding, so the inner curve stays
concentric with the outer.

### 5.3 Shelf layout — Stack view

The default. One column. Card is a 88px square image on the left, text on the right.

```
┌───────────────────────────────────────────────┐
│ ┌────────┐  Keychron K2 Pro 75% mechanical    │
│ │        │  keyboard, brown switches           │
│ │  IMG   │                                     │
│ │        │  ₹8,999   amazon.in                 │
│ └────────┘  Gadgets · 4d                       │
└───────────────────────────────────────────────┘

┌───────────────────────────────────────────────┐
│▌┌────────┐  Wooden monitor riser with drawer  │
│▌│        │                                     │
│▌│  IMG   │                                     │
│▌│        │  ₹1,450   pepperfry.com             │
│▌└────────┘  Home · 47d · still want this?      │
└───────────────────────────────────────────────┘
   ▲
   └── stale rule, --signal, 3px. Second card is overdue.
```

Why 88px: large enough to recognise a product photograph at arm's length, small enough
that roughly seven cards fit a phone screen. Seven is about the number a person can hold
in working memory while comparing — the list stays processable rather than becoming an
endless feed.

Card height is fixed at 112px regardless of title length. A uniform rhythm is what makes a
long list scannable; ragged heights force the eye to re-find the left edge on every row.

### 5.4 Shelf layout — Board view

Secondary. Two columns, image-dominant, minimal text. For "I'd know it if I saw it."

```
┌───────────┐ ┌───────────┐
│           │ │           │
│    IMG    │ │    IMG    │
│           │ │           │
├───────────┤ ├───────────┤
│ Keychron  │ │ Riser     │
│ ₹8,999    │ │ ₹1,450    │
└───────────┘ └───────────┘
```

The toggle sits in the top bar and persists across sessions.

### 5.5 Alignment

Left-aligned throughout. Prices right-align within their own column in Stack view so they
form a scannable edge. Nothing is centred except empty states, which are centred because
there is nothing to align to.

---

## 6. Age as a structural device

The strongest idea in this design, and the one most likely to be dropped during
implementation. Do not drop it.

The bare fact that an item is 47 days old is more decision-relevant than its price, its
category, or its source. Nothing else on the card tells you a decision is overdue.

**Treatment:**

| Age | Rule | Image | Meta line |
|-----|------|-------|-----------|
| 0–7 days | none | full opacity | `Gadgets · 4d` |
| 8–29 days | none | full opacity | `Gadgets · 21d` |
| 30–59 days | 3px `--signal` on the card's left edge | 88% opacity | `Home · 47d · still want this?` |
| 60+ days | 3px `--signal`, plus the age in `--signal` | 75% opacity | `Home · 94d · still want this?` |

The left rule is the device. It appears on no other element in the product, so its meaning
is unambiguous the moment it is seen twice. The opacity taper is the second signal — stale
items literally fade, which reads as receding without hiding.

Tapping "still want this?" is one tap and resets `reviewed_at`. That is the entire
interaction. No modal, no form.

**What not to do:** do not sort stale items to the top, do not hide them, do not badge a
count on the app icon, do not send a notification per item. The point is legibility, not
pressure. Nagging produces avoidance, and an avoided shelf is a dead shelf.

---

## 7. Components

### 7.1 Item card (Stack)

```
Height          112px, fixed
Padding         --s3 (12px)
Background      --surface
Radius          --r-card
Separator       1px --line, between cards
Image           88×88, --r-card minus 2px, object-fit: cover
Gap             --s3 between image and text
Title           --t-md, --text, 2-line clamp
Price           --t-sm, --text, tabular-nums, right-aligned
Site            --t-sm, --text-dim
Meta            --t-sm, --text-faint (--signal for the age when 60d+)
Stale rule      3px --signal, full card height, left edge, 30d+
Press           background → --surface-lit, 90ms
```

No shadow. No hover lift. No border except the separator hairline.

### 7.2 Swipe actions

The primary path for closing a decision. Buttons in the detail view are the secondary path.

```
Swipe right →  Bought      --settled background, check mark
Swipe left  ←  Drop        --drop background, cross mark

Threshold      35% of card width
Feedback       icon and colour reveal progressively as the card moves
Commit         card collapses vertically over 180ms, list closes the gap
Undo           toast, 6 seconds, single "Undo" action
Haptic         light impact at threshold crossing, on supporting devices
```

Six seconds for undo, not three. A person who swipes by accident on a phone needs time to
notice, read, and act.

### 7.3 Capture screen

Reached from the share sheet, the extension popup, or paste. This screen must be
extraordinarily fast and forgiving.

```
┌─────────────────────────────────────┐
│  ← Save                             │
│                                     │
│  ┌────────┐  Fetching…              │  ← skeleton, then fills in
│  │ ░░░░░░ │                         │
│  └────────┘  amazon.in              │
│                                     │
│  Add a note                         │  ← autofocused, always skippable
│  ┌─────────────────────────────────┐│
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  Gadgets  ▾                         │  ← pre-filled by the classifier
│                                     │
│  ┌─────────────────────────────────┐│
│  │           Save                  ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**The save button is enabled from the first frame.** It never waits for enrichment.
Pressing it while the title still reads "Fetching…" saves the item and lets the metadata
land afterwards. This is the single most important behaviour in the product — see
`01-PRD.md` principle 1.

### 7.4 The one orchestrated moment

Spend the product's entire motion budget here.

When a save is confirmed, the card assembles in place: the frame draws first, the title
slides in from the metadata that is already known, then the image cross-fades in when it
resolves, then the price settles last. Roughly 400ms end to end.

This is worth doing because it does a job beyond delight — it makes the enrichment pipeline
visible. The user watches the item become complete and therefore trusts that the
background work happened. A static card that silently changes later is unsettling; a card
that assembles is legible.

Everything else in the product uses motion only to answer a direct action: sheets slide,
swipes track the finger, the collapse on commit. **No entrance animations on scroll. No
hover transitions on cards. No page transitions.** Those are the default and they read as
generated.

`prefers-reduced-motion: reduce` disables the assembly sequence — the card simply appears
complete — and shortens every other transition to 0ms.

### 7.5 Filter chips

```
Height     32px
Padding    0 --s3
Radius     --r-pill
Idle       --surface-raised, --text-dim, 1px --line
Active     --surface-lit, --text, 1px --line-strong
```

Active filters are never colour-coded by category. Colour belongs to the images.

### 7.6 Empty states

Three, each written as a direction rather than a mood.

| Screen | Copy |
|--------|------|
| Nothing saved | **Nothing on the shelf yet.** Share a link here from any app, or paste one below. |
| Search, no results | **No matches for that.** Try the site name, or a word from your note. |
| Filtered to nothing | **Nothing open in Gadgets.** Clear the filter to see everything. |

Each carries the action it names. The empty state is an instruction, not an apology.

---

## 8. Voice

**Plain, second person, present tense.** The interface is a tool the user is operating, not
a service addressing them.

| Not this | This |
|----------|------|
| Item successfully added to your collection! | Saved |
| Oops! Something went wrong 😔 | Couldn't reach that page. Saved the link — add a title yourself. |
| Are you sure you want to delete this item? | Delete permanently? This can't be undone. |
| Your wishlist is empty | Nothing on the shelf yet |
| Submit | Save |
| Manage your saved product entries | Your shelf |

**Rules:**

1. A button names its outcome. "Save" produces "Saved". "Drop" produces "Dropped". The verb
   never changes between the control and its confirmation.
2. Errors say what happened and what to do. They do not apologise and they do not blame.
3. No exclamation marks. No emoji.
4. No system vocabulary in user-facing text. Nobody has an "enrichment status" — they have
   an item that "couldn't load".
5. Count words carefully: "1 item", not "1 items"; "47d", not "47 days ago" in a metadata
   line where space is the constraint.

---

## 9. Accessibility floor

Not optional, not a later phase.

- Contrast: 4.5:1 for body text, 3:1 for large text and interface boundaries, in **both**
  themes. Verify `--text-faint` against `--surface` specifically — it is the value most
  likely to fail.
- Touch targets 44×44 minimum. The card is 112px tall, so it passes; check the chips and
  icon buttons.
- Visible keyboard focus everywhere: 2px `--signal` outline with a 2px offset. Never
  `outline: none` without a replacement.
- Every swipe action has a keyboard and button equivalent in the detail view. Gesture-only
  functionality is not acceptable.
- `prefers-reduced-motion` honoured as described in §7.4.
- Images carry alt text from the product title. Decorative images carry `alt=""`.
- The shelf is a `<ul>` of `<li>`. Cards are `<article>`. Do not build a list out of
  `<div>`s with click handlers.

---

## 10. Implementation notes

**Tokens live in one file**, `web/src/styles/tokens.css`, as custom properties. Every
component reads from them. No hard-coded hex values anywhere in component code — if a
value is needed that is not a token, the correct move is to question the need, then add a
token.

**No UI component library.** This system is short and specific; shadcn/ui or MUI would be
overridden more than used, and would ship bytes for components that are never rendered.
Plain CSS, one token file, hand-built components.

**Theme switching** is a `data-theme` attribute on `<html>`, defaulting to
`prefers-color-scheme` with a user override in settings, persisted locally.

**Virtualise the shelf beyond 100 items.** Fixed card height makes this straightforward and
is a second reason for the fixed height in §7.1.

**Before considering any screen finished**, remove one thing from it. If nothing can be
removed without loss, the screen is done.
