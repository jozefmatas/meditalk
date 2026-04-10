-- Migration: Move raw_text column into metadata.transcript
--
-- The transcript was stored as a top-level column (visits.raw_text) while all
-- other encounter source material lives in visits.metadata JSONB. This caused
-- bugs where code reading metadata missed the transcript entirely.
--
-- After this migration, the transcript lives at metadata.transcript and the
-- raw_text column is dropped. All code reads via getTranscript() from
-- lib/encounters/sources.ts.

-- Step 1: Backfill — copy raw_text into metadata.transcript for all visits
-- that have a non-null, non-empty raw_text. Idempotent: skips rows that
-- already have metadata.transcript set (e.g. from new code paths).
UPDATE visits
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{transcript}',
  to_jsonb(raw_text)
)
WHERE raw_text IS NOT NULL
  AND raw_text != ''
  AND (metadata->>'transcript') IS NULL;

-- Step 2: Drop the column. All code now reads from metadata.transcript.
ALTER TABLE visits DROP COLUMN raw_text;
