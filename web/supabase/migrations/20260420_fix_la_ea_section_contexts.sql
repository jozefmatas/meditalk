-- Fix LA and EA section contexts across all templates:
-- LA: explicitly include medications administered during the encounter
--     (emergency meds like Heparin, Aspirin were being omitted by Opus).
-- EA: explicitly exclude allergies (they belong in AA) and TO content.
--
-- Root cause: LA said "current medications" → Opus interpreted as chronic only.
-- EA had no exclusion guidance → Opus put allergies there instead of AA.

-- ── Helper functions (recreated — dropped at the end of this migration) ──

CREATE OR REPLACE FUNCTION _set_section_context(
  _template_id TEXT, _section_idx INT, _context TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE templates
  SET sections = jsonb_set(sections, ARRAY[_section_idx::TEXT, 'context'], to_jsonb(_context))
  WHERE id = _template_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _set_subsection_context(
  _template_id TEXT, _parent_idx INT, _sub_idx INT, _context TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE templates
  SET sections = jsonb_set(sections, ARRAY[_parent_idx::TEXT, 'subsections', _sub_idx::TEXT, 'context'], to_jsonb(_context))
  WHERE id = _template_id;
END;
$$ LANGUAGE plpgsql;

-- ── LA — include administered/emergency medications ──

-- 1. Comprehensive Medical Exam (top-level section idx 5)
SELECT _set_section_context('t_UjVsxUoQxc', 5,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 2. Focused Cardiology (parent 0, sub 6)
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 6,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 3. Comprehensive Cardiology (parent 0, sub 6)
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 6,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 4. Focused Internal Medicine (parent 0, sub 6)
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 6,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 5. Comprehensive Internal Medicine (parent 0, sub 6)
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 6,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 6. Focused Neurology (parent 0, sub 4)
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 4,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- 7. Comprehensive Neurology (parent 0, sub 5)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 5,
  'ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED). List ALL medications ONLY here, NEVER in OA, HPI, or any other section.');

-- ── EA — explicitly exclude allergies ──

-- The subsection indices for EA vary by template. EA is typically sub 3.

-- 2. Focused Cardiology (parent 0, sub 3)
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 3,
  'Epidemiological history ONLY: travel, contact with infections, tick bites, vaccinations. NEVER include allergies here — all allergies belong ONLY in AA (Alergie / Allergies).');

-- 3. Comprehensive Cardiology (parent 0, sub 3)
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 3,
  'Epidemiological history ONLY: travel, contact with infections, tick bites, vaccinations. NEVER include allergies here — all allergies belong ONLY in AA (Alergie / Allergies).');

-- 4. Focused Internal Medicine (parent 0, sub 3)
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 3,
  'Epidemiological history ONLY: travel, contact with infections, tick bites, vaccinations. NEVER include allergies here — all allergies belong ONLY in AA (Alergie / Allergies).');

-- 5. Comprehensive Internal Medicine (parent 0, sub 3)
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 3,
  'Epidemiological history ONLY: travel, contact with infections, tick bites, vaccinations. NEVER include allergies here — all allergies belong ONLY in AA (Alergie / Allergies).');

-- NOTE: Focused Neurology and Comprehensive Neurology have NO EA section.
-- Focused Neuro sub 3 = AA (Allergies), Comp. Neuro sub 3 = PA (Occupational).

-- Comprehensive Medical Exam has EA as a top-level section (idx 3)
SELECT _set_section_context('t_UjVsxUoQxc', 3,
  'Epidemiological history ONLY: travel, contact with infections, tick bites, vaccinations. NEVER include allergies here — all allergies belong ONLY in AA (Alergie / Allergies).');

-- ── Clean up helper functions ──

DROP FUNCTION _set_section_context(TEXT, INT, TEXT);
DROP FUNCTION _set_subsection_context(TEXT, INT, INT, TEXT);
