-- Fix templates table: change id from uuid to text for backward compatibility
-- Existing encounters store template_id as text ("basic-soap") in metadata JSONB.

-- Ensure moddatetime extension is available
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- Drop dependent objects
DROP TRIGGER IF EXISTS templates_updated_at ON templates;
DROP POLICY IF EXISTS "Authenticated users see visible templates" ON templates;
DROP INDEX IF EXISTS idx_templates_visible;

-- Recreate table with text PK (CASCADE drops dependent FKs like template_insights)
DROP TABLE templates CASCADE;

CREATE TABLE templates (
  id text PRIMARY KEY,
  name jsonb NOT NULL DEFAULT '{}',
  description jsonb NOT NULL DEFAULT '{}',
  specialties text[] NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  system_prompt text,
  style_examples jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT true,
  visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  source_template_id text REFERENCES templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_templates_visible ON templates(visible);

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users see visible templates"
  ON templates FOR SELECT TO authenticated
  USING (visible = true);

CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
