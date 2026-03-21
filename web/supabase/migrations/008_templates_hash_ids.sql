-- Migrate template IDs from slugs to nanoid hashes.
-- Also updates visit metadata references.

-- 1. Update visit metadata template_id references
UPDATE visits SET metadata = jsonb_set(metadata, '{template_id}', '"t_UjVsxUoQxc"')
  WHERE metadata->>'template_id' = 'comprehensive-medical-exam';

UPDATE visits SET metadata = jsonb_set(metadata, '{template_id}', '"t_X2cOl91J5A"')
  WHERE metadata->>'template_id' = 'basic-soap';

UPDATE visits SET metadata = jsonb_set(metadata, '{template_id}', '"t_KZPRXwjQye"')
  WHERE metadata->>'template_id' = 'focused-cardiology-exam';

UPDATE visits SET metadata = jsonb_set(metadata, '{template_id}', '"t_PuUApaFmlk"')
  WHERE metadata->>'template_id' = 'comprehensive-cardiology-exam';

-- 2. Delete old templates and re-insert with hash IDs
DELETE FROM templates;
