# Stash extension (MV3)

The **high-fidelity capture path**. A content script reads the live DOM of the page the
user is actually looking at, while logged in — which defeats bot walls, cookie walls and
region-gating that a server-side fetch cannot get past. The server fetch is the universal
fallback, not the reverse (`03-ARCHITECTURE.md` §3).

No build step, no web store submission. One codebase for Chrome, Edge, Brave and Firefox
via `browser_specific_settings`.

## Load it

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → this folder
- **Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`

## Configure

The API base and device token are entered by hand on the options page and stored in
`chrome.storage.local`. **No secrets in the bundle** (`02-TRD.md` §6).

## Capture surfaces

| Surface | Behaviour |
|---------|-----------|
| Toolbar button | Saves the current tab |
| Context menu | Page, link, image, selection |
| `Ctrl+Shift+S` | Saves the current tab |
| Popup | Confirmation with editable title, note, category |

Built in **P1**, tasks 14–18 (`05-ROADMAP.md`).

Note: `manifest.json` points at `src/*.js`. The `.ts` sources here are compiled or
authored to plain JS at build time — decide which in P1 and keep it a single step.
