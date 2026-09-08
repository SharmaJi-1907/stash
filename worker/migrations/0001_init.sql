-- 0001_init.sql — Stash initial schema
--
-- Source of truth: docs/02-TRD.md §4. This file is a verbatim copy of the schema
-- declared there; do not edit it here without changing the document first.
--
-- Conventions (docs/02-TRD.md §4.1):
--   · All timestamps are epoch milliseconds stored as INTEGER.
--   · Prices are integers in minor units. 249900 = INR 2,499.00. Never a float.
--   · Deletes are soft. deleted_at is a tombstone; sync needs it to propagate
--     deletions, and a hard delete would resurrect the row from a stale client.
--   · IDs are UUID v4 generated client-side, so an offline client can create and
--     render an item before it is able to push it.
--
-- Default categories are NOT seeded here. That is P3 task 1 (docs/05-ROADMAP.md).
--
-- Apply with:
--   npm run migrate:local     (wrangler d1 migrations apply stash-db --local)
--   npm run migrate:remote    (wrangler d1 migrations apply stash-db --remote)

-- Items: the core table.
CREATE TABLE items (
  id              TEXT PRIMARY KEY,          -- uuid v4, generated client-side
  url             TEXT NOT NULL,             -- as the user gave it
  canonical_url   TEXT NOT NULL,             -- normalised, see 03-ARCHITECTURE §4.1
  url_hash        TEXT NOT NULL,             -- sha256 of canonical_url, for dedupe
  title           TEXT,
  description     TEXT,
  note            TEXT,                      -- user's own words
  image_key       TEXT,                      -- R2 object key
  image_url       TEXT,                      -- original URL, fallback only
  image_width     INTEGER,
  image_height    INTEGER,
  price_amount    INTEGER,                   -- minor units. 249900 = ₹2,499.00
  price_currency  TEXT,                      -- ISO 4217
  site            TEXT,                      -- registrable domain, e.g. amazon.in
  site_name       TEXT,                      -- human name, e.g. Amazon
  source          TEXT NOT NULL,             -- extension | share | paste | manual
  category_id     TEXT REFERENCES categories(id),
  status          TEXT NOT NULL DEFAULT 'open',  -- open|shortlist|bought|dropped
  priority        INTEGER NOT NULL DEFAULT 0,    -- 0 none, 1 maybe, 2 want
  enrichment      TEXT NOT NULL DEFAULT 'pending', -- pending|rich|partial|manual|failed
  enrich_attempts INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  reviewed_at     INTEGER,                   -- last time user said "still want this"
  decided_at      INTEGER,                   -- when status became bought or dropped
  deleted_at      INTEGER                    -- soft delete tombstone
);

CREATE UNIQUE INDEX idx_items_url_hash  ON items(url_hash) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_updated          ON items(updated_at);
CREATE INDEX idx_items_status_created   ON items(status, created_at DESC);
CREATE INDEX idx_items_category         ON items(category_id);


CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,   -- 1 = cannot be deleted
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);


CREATE TABLE tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE item_tags (
  item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);


-- Classifier memory. Written when the user corrects a category.
CREATE TABLE classify_rules (
  id           TEXT PRIMARY KEY,
  match_type   TEXT NOT NULL,   -- domain | keyword
  match_value  TEXT NOT NULL,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  weight       INTEGER NOT NULL DEFAULT 1,   -- increments on repeat correction
  created_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_rules_match ON classify_rules(match_type, match_value);


-- Written on every enrichment. Not read by v1 UI. Reserved for v2 price tracking.
CREATE TABLE price_snapshots (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

CREATE INDEX idx_snapshots_item ON price_snapshots(item_id, captured_at DESC);


-- Single-row settings blob.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
