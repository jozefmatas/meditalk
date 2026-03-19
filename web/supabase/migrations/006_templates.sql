-- Templates table: stores template definitions (system + user-created)
CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  specialties text[] NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  is_system boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_templates_user ON templates (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_templates_system ON templates (is_system) WHERE is_system = true;

-- RLS
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- Anyone can read system templates + their own custom templates
CREATE POLICY "read_templates" ON templates FOR SELECT
  USING (is_system = true OR user_id = auth.uid());

-- Users can insert their own templates
CREATE POLICY "insert_own_templates" ON templates FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_system = false);

-- Users can update their own templates (not system ones)
CREATE POLICY "update_own_templates" ON templates FOR UPDATE
  USING (user_id = auth.uid() AND is_system = false);

-- Users can delete their own templates (not system ones)
CREATE POLICY "delete_own_templates" ON templates FOR DELETE
  USING (user_id = auth.uid() AND is_system = false);


-- Template insights table: per-user learning data for any template
CREATE TABLE template_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  example_notes jsonb NOT NULL DEFAULT '[]',
  style_guide text,
  edit_diffs jsonb NOT NULL DEFAULT '[]',
  preference_summary text,
  usage_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, template_id)
);

-- Index for fast lookup
CREATE INDEX idx_template_insights_user_template ON template_insights (user_id, template_id);

-- RLS
ALTER TABLE template_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_insights_select" ON template_insights FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "own_insights_insert" ON template_insights FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own_insights_update" ON template_insights FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "own_insights_delete" ON template_insights FOR DELETE
  USING (user_id = auth.uid());


-- Seed system templates
-- Basic SOAP
INSERT INTO templates (id, name, description, specialties, sections, is_system, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'basic-soap',
  'basic-soap',
  ARRAY['general_practice'],
  '[
    {"id": "subjective", "labelKey": "subjective"},
    {"id": "objective", "labelKey": "objective"},
    {"id": "assessment", "labelKey": "assessment"},
    {"id": "plan", "labelKey": "plan"}
  ]'::jsonb,
  true,
  1
);

-- Comprehensive Medical Exam
INSERT INTO templates (id, name, description, specialties, sections, is_system, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'comprehensive-medical-exam',
  'comprehensive-medical-exam',
  ARRAY['general_practice', 'internal_medicine'],
  '[
    {"id": "reason_for_contact", "labelKey": "reason_for_contact"},
    {"id": "past_history", "labelKey": "past_history"},
    {"id": "assistive_devices", "labelKey": "assistive_devices"},
    {"id": "family_history", "labelKey": "family_history"},
    {"id": "allergies", "labelKey": "allergies"},
    {"id": "current_medications", "labelKey": "current_medications"},
    {"id": "social_history", "labelKey": "social_history", "subsections": [
      {"id": "tobacco", "labelKey": "tobacco"},
      {"id": "alcohol", "labelKey": "alcohol"},
      {"id": "controlled_substances", "labelKey": "controlled_substances"},
      {"id": "physical_activity", "labelKey": "physical_activity"},
      {"id": "diet", "labelKey": "diet"}
    ]},
    {"id": "history_present_illness", "labelKey": "history_present_illness"},
    {"id": "physical_exam", "labelKey": "physical_exam", "subsections": [
      {"id": "general_condition", "labelKey": "general_condition"},
      {"id": "body_temp", "labelKey": "body_temp"},
      {"id": "height", "labelKey": "height"},
      {"id": "weight", "labelKey": "weight"},
      {"id": "bmi", "labelKey": "bmi"},
      {"id": "skin", "labelKey": "skin"},
      {"id": "eyes", "labelKey": "eyes"},
      {"id": "ears", "labelKey": "ears"},
      {"id": "nose", "labelKey": "nose"},
      {"id": "mouth_throat", "labelKey": "mouth_throat"},
      {"id": "lymph_nodes", "labelKey": "lymph_nodes"},
      {"id": "thyroid", "labelKey": "thyroid"},
      {"id": "breast_exam", "labelKey": "breast_exam"},
      {"id": "heart", "labelKey": "heart"},
      {"id": "pulse", "labelKey": "pulse"},
      {"id": "blood_pressure", "labelKey": "blood_pressure"},
      {"id": "peripheral_pulses", "labelKey": "peripheral_pulses"},
      {"id": "ecg", "labelKey": "ecg"},
      {"id": "lungs", "labelKey": "lungs"},
      {"id": "respiratory_rate", "labelKey": "respiratory_rate"},
      {"id": "spo2", "labelKey": "spo2"},
      {"id": "abdomen", "labelKey": "abdomen"},
      {"id": "rectal_exam", "labelKey": "rectal_exam"},
      {"id": "gynaecology", "labelKey": "gynaecology"},
      {"id": "penis_scrotum", "labelKey": "penis_scrotum"},
      {"id": "neurological", "labelKey": "neurological"},
      {"id": "mental_state_exam", "labelKey": "mental_state_exam"},
      {"id": "suicide_risk_assessment", "labelKey": "suicide_risk_assessment"},
      {"id": "neck", "labelKey": "neck"},
      {"id": "back", "labelKey": "back"},
      {"id": "shoulders", "labelKey": "shoulders"},
      {"id": "elbows", "labelKey": "elbows"},
      {"id": "hands", "labelKey": "hands"},
      {"id": "hips", "labelKey": "hips"},
      {"id": "knees", "labelKey": "knees"},
      {"id": "feet", "labelKey": "feet"}
    ]},
    {"id": "lab", "labelKey": "lab"},
    {"id": "radiology", "labelKey": "radiology"},
    {"id": "other_exam_findings", "labelKey": "other_exam_findings"},
    {"id": "assessment", "labelKey": "assessment"},
    {"id": "action_and_plan", "labelKey": "action_and_plan"}
  ]'::jsonb,
  true,
  0
);
