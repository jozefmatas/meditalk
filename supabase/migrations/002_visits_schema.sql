-- MediTalk Phase 4: Visits Schema
-- Extends transcripts table with visit-specific fields

-- 1) Rename transcripts to visits
ALTER TABLE public.transcripts RENAME TO visits;

-- 2) Add visit-specific columns
ALTER TABLE public.visits
  ADD COLUMN visit_date timestamptz DEFAULT now(),
  ADD COLUMN patient_name text,
  ADD COLUMN patient_id text,
  ADD COLUMN visit_type text DEFAULT 'consultation',
  ADD COLUMN status text DEFAULT 'draft',
  ADD COLUMN soap_note text,
  ADD COLUMN patient_letter text,
  ADD COLUMN metadata jsonb DEFAULT '{}';

-- 3) Update transcript_chunks foreign key reference name for clarity
-- Note: The actual FK still works, just renaming for semantic clarity
ALTER TABLE public.transcript_chunks RENAME COLUMN transcript_id TO visit_id;

-- 4) Add indexes for common queries
CREATE INDEX idx_visits_user_date ON public.visits(user_id, visit_date DESC);
CREATE INDEX idx_visits_status ON public.visits(user_id, status);
CREATE INDEX idx_visits_patient ON public.visits(user_id, patient_name);

-- 5) Update RLS policies names (optional, for clarity)
-- Drop old policies
DROP POLICY IF EXISTS "Users can select own transcripts" ON public.visits;
DROP POLICY IF EXISTS "Users can insert own transcripts" ON public.visits;
DROP POLICY IF EXISTS "Users can update own transcripts" ON public.visits;
DROP POLICY IF EXISTS "Users can delete own transcripts" ON public.visits;

-- Recreate with new names
CREATE POLICY "Users can select own visits"
  ON public.visits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own visits"
  ON public.visits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own visits"
  ON public.visits FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own visits"
  ON public.visits FOR DELETE
  USING (auth.uid() = user_id);

-- 6) Update chunk policies (reference visit_id now)
DROP POLICY IF EXISTS "Users can select own transcript chunks" ON public.transcript_chunks;
DROP POLICY IF EXISTS "Users can insert own transcript chunks" ON public.transcript_chunks;
DROP POLICY IF EXISTS "Users can delete own transcript chunks" ON public.transcript_chunks;

CREATE POLICY "Users can select own visit chunks"
  ON public.transcript_chunks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = transcript_chunks.visit_id
        AND v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own visit chunks"
  ON public.transcript_chunks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = transcript_chunks.visit_id
        AND v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own visit chunks"
  ON public.transcript_chunks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.visits v
      WHERE v.id = transcript_chunks.visit_id
        AND v.user_id = auth.uid()
    )
  );

-- 7) Update match_chunks function to use visit_id
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector(1536),
  match_count int DEFAULT 10,
  p_visit_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  visit_id uuid,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tc.id,
    tc.visit_id,
    tc.chunk_index,
    tc.content,
    1 - (tc.embedding <=> query_embedding) AS similarity
  FROM public.transcript_chunks tc
  INNER JOIN public.visits v ON v.id = tc.visit_id
  WHERE
    v.user_id = auth.uid()
    AND (p_visit_id IS NULL OR tc.visit_id = p_visit_id)
  ORDER BY tc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
