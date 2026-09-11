# Stash PWA

The app. React 19 + Vite, deployed to Cloudflare Pages at `https://stash-1ju.pages.dev`.

`stash.pages.dev` was already taken, so Cloudflare appended the suffix. The manifest's
share-target `action` is an absolute URL and **must** match the deployed origin exactly —
this is the one place where the project name leaks into code.

## Commands

```bash
npm run dev     --workspace web    # Vite on :5173
npm run build   --workspace web    # tsc --noEmit, then vite build
npm run test    --workspace web    # Vitest in Node
npm run deploy  --workspace web    # wrangler pages deploy dist --project-name stash
```

Tests run in Node, not a browser. IndexedDB comes from `fake-indexeddb`, loaded in
`test/setup.ts`, which is why the store can be tested without a headless Chrome.

**Vitest must stay on `^4`, not 5.** `@cloudflare/vitest-pool-workers` peer-requires v4,
and installing v5 does not error at install time — it breaks the Worker tests instead,
some distance from the change that caused it.

## How it is put together

```
src/
├── db/         IndexedDB via Dexie — authoritative for the UI
├── sync/       outbox.ts pushes, pull.ts pulls
├── api/        the one place that knows the base URL and attaches the token
├── screens/    Shelf, Capture, ItemDetail, Settings
├── components/ ItemCard, TokenProof
├── lib/        format.ts — money, ages, hosts
├── router.ts   a hash router, ~50 lines, because five routes do not need a library
└── theme.ts    system / dark / light, persisted
public/
├── sw.js       plain JS, not built — see below
├── manifest.webmanifest
├── _redirects  the SPA fallback, and a comment about the loop it replaced
└── fonts/      nine self-hosted woff2
```

### A save never blocks on the network

The client generates the UUID, writes to IndexedDB, renders the card, and only then queues
the push. The five-second capture budget in `docs/01-PRD.md` covers the local write alone.
Offline this is the whole save and it looks no different.

If a screen ever awaits a server response before confirming a save, the product's central
promise is broken — that is the thing to check first in any change here.

### The shelf only holds undecided things

`listLocal` filters bought and dropped out of the main shelf. They are kept, reachable
under "bought & dropped", and restorable by setting the status back.

This is `docs/01-PRD.md` F7.3 and it is load-bearing rather than cosmetic. It was missed
at first and the shelf kept everything, which defeats principle 2 and walks straight into
R1 — the risk the PRD calls fatal. Decided items reappearing on the main shelf is a
regression, not a preference.

### sw.js is not built

The service worker catches the Android share `POST` to `/share`, writes the payload into
its own IndexedDB store and answers `303` so a refresh cannot re-post and save twice.

It stays as plain JavaScript on purpose. A service worker a bundler has to produce is one
a build change can silently break, and this file is the single point of failure for the
entire Android path.

`SHARE-TARGET.md` in this folder records what was measured on the real phone, including
the two things that are not in any guide: the URL arrives in `text` and not `url`, and a
`_redirects` rule for `/share` collides with Pages' own clean-URL redirect into an endless
`308`. Read it before touching the manifest or `_redirects`.

`share-target-check/` is the throwaway probe that established all of that. It is wired to
nothing and kept only for its README.

## Build budget

200 KB gzipped, from `docs/02-TRD.md` §7. Currently **118 KB**.

Two decisions defend it: sourcemaps are `hidden`, so a map is written for local stack
traces but no `sourceMappingURL` ships; and React is a separate chunk, so an app update
does not re-download the framework.

`fonts.css` currently asks for the same variable font under three URLs and costs about
150 KB of duplicate downloads. See `docs/stash_issue.md` B2 — the files being identical
is a symptom, not the bug.

## Open work

`docs/stash_issue.md`. Seven of the nine open items are in this workspace.
