# Stash extension (MV3)

The **high-fidelity capture path**. A content script reads the live DOM of the page
the user is looking at, while logged in, in their own region, after JavaScript has run.

This is not a convenience. Measured 2026-09-09, a plain server fetch gets:

| Site | What a server sees |
|---|---|
| amazon.com | 200, title "Amazon.com", no metadata — bot wall |
| flipkart.com | a page titled "Flipkart reCAPTCHA" |
| ajio.com | 403 Access Denied |
| myntra.com | full JSON-LD with a price — the exception |

Those first three prices exist only inside a logged-in browser, which is what this
extension is. See `docs/03-ARCHITECTURE.md` §3.

## Load it

**No build step.** The source is plain JavaScript with JSDoc types, so the folder
loads as-is and `npm run typecheck --workspace extension` still checks it against
`shared/types.ts`.

- **Chrome / Edge / Brave:** `chrome://extensions` → turn on Developer mode →
  **Load unpacked** → choose this `extension/` folder
- **Firefox:** `about:debugging` → This Firefox → **Load Temporary Add-on** →
  choose `manifest.json`

## Set it up

Right-click the extension icon → **Options**, and enter:

| Field | Value |
|---|---|
| API address | `https://stash-api.<your-subdomain>.workers.dev/v1` — ends with `/v1` |
| Device token | the one from `.credentials.local.md` |

**Save and test** does more than save: it calls `GET /items?limit=1` and reports what
came back, so a token typed with a missing character is caught immediately rather
than at the next silent save failure.

Both values live in `chrome.storage.local`. Nothing is compiled into the bundle
(`02-TRD.md` §6).

## Ways to save

| Surface | What it does |
|---|---|
| Toolbar button | Opens the popup — editable title and note, then Save |
| `Ctrl+Shift+S` | Saves the current tab immediately, no popup |
| Right-click a page | Saves that page, with the scrape |
| Right-click a link | Saves that link — no scrape, since the scrape belongs to the page you are on, not the link you clicked |
| Right-click an image | Saves the image URL |

The Save button in the popup is enabled from the first frame and never waits for the
scrape. Pressing it while the title still reads "reading the page…" saves the item and
lets the metadata land afterwards (`01-PRD.md` principle 1).

## How the price gets across

The content script sends the price **as the page displayed it** — `"₹8,999.00"` — and
the Worker parses it. There is deliberately no price parsing in this folder: a second
implementation would be a second thing to get wrong, and a wrong price on the shelf is
worse than no price (`03-ARCHITECTURE.md` §4.4 rule 5).

## What still needs a real browser

Everything in this folder is typechecked, and the seam between it and the Worker — a
scraped payload turning into a stored price — is covered by tests in
`worker/test/items.test.ts`. The parts that cannot be tested without a browser are the
context menus, the keyboard command, and the selectors in `content.js` firing against
a real Amazon or Flipkart page. Those need loading it and trying it.
