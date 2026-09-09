-- 0002_image_bytes.sql — record the stored size of each item's image.
--
-- Not in docs/02-TRD.md §4. Added deliberately; the reasoning is in CLAUDE.md
-- under "Deviations from the documents".
--
-- Short version: R2 now has a card attached, so overrunning the free tier has a
-- cost. The shelf-health line (01-PRD.md F11.4) will show storage used, computed
-- by the daily cron (03-ARCHITECTURE.md §9). A single running counter cannot stay
-- correct, because purging a tombstone would not know how much to subtract —
-- so the size is recorded per item and summed. The number is already measured
-- while enforcing the 2 MB cap, so recording it costs nothing.

ALTER TABLE items ADD COLUMN image_bytes INTEGER;
