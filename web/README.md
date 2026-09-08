# Stash PWA

Not built yet. This is **P2** in `docs/05-ROADMAP.md`.

## Dependencies are deliberately not installed

They were removed to keep the working tree small while P0 and P1 are built. Nothing here
imports them yet, so nothing is broken by their absence.

When P2 starts, run exactly this from the repo root:

```bash
npm install --workspace web \
  react@^19.0.0 react-dom@^19.0.0 dexie@^4.0.0 zustand@^5.0.0

npm install --workspace web --save-dev \
  vite@^6.0.0 @vitejs/plugin-react@^4.3.0 \
  @types/react@^19.0.0 @types/react-dom@^19.0.0 \
  vitest@^4.1.0 wrangler@^4.129.0 typescript@^5.9.0
```

Then restore the `dev`, `build`, `preview`, `deploy` and `test` scripts in
`web/package.json` — the commands are already written in the root `README.md`.

**Note on vitest:** it must be `^4.1.0`, not 5. `@cloudflare/vitest-pool-workers` peer-
requires v4. Installing v5 will not error immediately but will break the Worker tests.

## What already exists here

- `index.html`, `vite.config.ts` — entry points, ready
- `public/manifest.webmanifest` — the share target. Read `public/SHARE-TARGET.md`
  before touching it. It is the highest-risk piece in the system.
- `src/` — stub files carrying their spec references
