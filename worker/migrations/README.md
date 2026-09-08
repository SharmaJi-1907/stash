D1 migrations, applied with `wrangler d1 migrations apply stash-db --local|--remote`.

`0001_init.sql` is **P0 task 5**: the full schema from `02-TRD.md` §4 — seven tables
(`items`, `categories`, `tags`, `item_tags`, `classify_rules`, `price_snapshots`,
`settings`) plus every index listed there.
