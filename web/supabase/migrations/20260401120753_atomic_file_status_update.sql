-- Atomic function to update a specific file's extraction status and text
-- This prevents race conditions by using PostgreSQL's JSONB operators
-- instead of read-modify-write pattern

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
  
  -- Update metadata in one atomic operation
  UPDATE visits
  SET metadata = jsonb_set(v_metadata, '{files}', v_updated_files)
  WHERE id = p_visit_id;
  
  -- Return updated metadata
  RETURN jsonb_set(v_metadata, '{files}', v_updated_files);
END;
$$;
