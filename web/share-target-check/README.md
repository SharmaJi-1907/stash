# Share-target check

**P2 task 1**, and the phase does not start until it passes. `docs/01-PRD.md` R3 calls this
the highest-risk assumption in the system: three documented failure modes that all present
identically — the PWA installs cleanly and simply never appears in Android's share sheet.

Deployed at <https://stash-1ju.pages.dev> (`stash.pages.dev` was taken; Cloudflare added
the suffix).

## No `_redirects` file, on purpose

There was one, mapping `/share` to `/share.html` with status 200. It produced this:

```
GET  /share  ->  308, location: /share      an endless redirect to itself
POST /share  ->  405
```

Cloudflare Pages already serves `share.html` at `/share` and redirects the `.html` form
back to the clean one. The rule fought that and the two cancelled into a loop — on the
exact path the share target posts to. Left in, it would have looked like "the share target
does not work" on a phone, with nothing to point at.

## The POST never reaches the network

Android posts multipart form data to `/share`. Static hosting answers POST with 405, and
that is fine: the service worker intercepts it first, writes what arrived to IndexedDB, and
answers with a 303 to `/share` so the app opens showing it. `sw.js` calls `skipWaiting()`
and `clients.claim()` so it is in control from the first visit rather than the second.

That is the same mechanism the real app will use, which is the point of checking it here.

## Result — 2026-09-10, passed

Installed from Chrome on the user's Android phone; shared a video from YouTube.

| Field | What arrived |
|---|---|
| `url` | **empty** |
| `text` | the URL |
| `title` | the video's title, correct |
| `image` | absent — a video share carries no file, as expected |
| URL found | yes, extracted from `text` |

**The `url` field was empty and the URL came in `text`.** `docs/06-AGENT-BUILD-GUIDE.md`
§4.4 warns this happens "depending on the sharing app"; on this phone, sharing from
YouTube, it is not occasional — it is what happens. An implementation that reads
`form.get('url')` and stops would receive nothing at all and look like a broken share
target.

So the real app must take the URL from whichever field carries one, and `url` is not the
one to trust first.

## What it proves

- Stash appears in the Android share sheet at all
- The share arrives with its fields intact
- Which field carries the URL — Android puts it in `text` rather than `url` depending on
  the sharing app (`docs/06-AGENT-BUILD-GUIDE.md` §4.4), and the page reports both
- Whether a shared image arrives, with its name, type and size

The home page also reads the manifest and says whether the share action is an absolute URL
on this origin, because a relative one is the most common cause of silent failure and there
is no reason to discover that on a phone.

## After it passes

This folder is throwaway. The real app deploys to the same Pages project, so the origin —
and therefore the manifest's absolute action URL — stays valid.
