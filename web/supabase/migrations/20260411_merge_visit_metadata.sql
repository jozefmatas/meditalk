-- Atomic metadata merge RPC
--
-- All metadata writers previously used a non-atomic read-modify-write pattern
-- (fetch metadata → shallow merge in JS → write back). Concurrent writers
-- (doctor notes auto-save, recording session, transcript, generation save,
-- file extraction) could clobber each other and lose data.
--
-- This function does the same shallow merge atomically in one SQL statement
-- using the JSONB || operator. Keys explicitly set to JSON null are deleted
-- (used by generate/regenerate to strip transient keys like
-- generation_pending and recording_session after completion).

CREATE OR REPLACE FUNCTION merge_visit_metadata(
  p_visit_id UUID,
  p_partial  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_current JSONB;
  v_merged  JSONB;
  v_null_keys TEXT[];
BEGIN
  -- Read current metadata
  SELECT metadata INTO v_current
  FROM visits
  WHERE id = p_visit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found: %', p_visit_id;
  END IF;

  -- Shallow merge: p_partial keys overwrite v_current keys
  v_merged := COALESCE(v_current, '{}'::jsonb) || p_partial;

  -- Collect keys that were explicitly set to JSON null
  SELECT ARRAY_AGG(key) INTO v_null_keys
  FROM jsonb_each(p_partial)
  WHERE value = 'null'::jsonb;

  -- Delete null-valued keys from the merged result
  IF v_null_keys IS NOT NULL THEN
    v_merged := v_merged - v_null_keys;
  END IF;

  -- Write back atomically
  UPDATE visits
  SET metadata = v_merged
  WHERE id = p_visit_id;

  RETURN v_merged;
END;
$$;

-- Also update the extraction status RPC to track when extraction started
-- (needed for stuck-extraction recovery: if extraction_started_at is older
-- than 5 minutes and status is still "extracting", it's stuck).

CREATE OR REPLACE FUNCTION update_file_extraction_status(
  p_visit_id UUID,
  p_file_id TEXT,
  p_status TEXT,
  p_extracted_text TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_metadata JSONB;
  v_files JSONB;
  v_updated_files JSONB;
  v_file_index INT;
BEGIN
  -- Get current metadata
  SELECT metadata INTO v_metadata
  FROM visits
  WHERE id = p_visit_id;

  IF v_metadata IS NULL THEN
    RAISE EXCEPTION 'Visit not found: %', p_visit_id;
  END IF;

  -- Get files array
  v_files := COALESCE(v_metadata->'files', '[]'::jsonb);

  -- Find the file index
  SELECT idx - 1 INTO v_file_index
  FROM jsonb_array_elements(v_files) WITH ORDINALITY arr(elem, idx)
  WHERE elem->>'id' = p_file_id;

  IF v_file_index IS NULL THEN
    RAISE EXCEPTION 'File not found: %', p_file_id;
  END IF;

  -- Update the specific file atomically
  v_updated_files := jsonb_set(
    v_files,
    ARRAY[v_file_index::text, 'extraction_status'],
    to_jsonb(p_status)
  );

  -- Update extracted_text if provided
  IF p_extracted_text IS NOT NULL THEN
    v_updated_files := jsonb_set(
      v_updated_files,
      ARRAY[v_file_index::text, 'extracted_text'],
      to_jsonb(p_extracted_text)
    );
  END IF;

  -- Set extraction_started_at when starting extraction
  IF p_status = 'extracting' THEN
    v_updated_files := jsonb_set(
      v_updated_files,
      ARRAY[v_file_index::text, 'extraction_started_at'],
      to_jsonb(now()::text)
    );
  END IF;

  -- Set extracted_at timestamp on completion or failure
  IF p_status IN ('completed', 'failed') THEN
    v_updated_files := jsonb_set(
      v_updated_files,
      ARRAY[v_file_index::text, 'extracted_at'],
      to_jsonb(now()::text)
    );
  END IF;

  -- Update metadata in one atomic operation
  UPDATE visits
  SET metadata = jsonb_set(v_metadata, '{files}', v_updated_files)
  WHERE id = p_visit_id;

  -- Return updated metadata
  RETURN jsonb_set(v_metadata, '{files}', v_updated_files);
END;
$$;
