-- Fix OA/LA section contexts across all templates:
-- OA (past medical history) must explicitly exclude medications.
-- LA (current medications) must explicitly call out OA as a forbidden location.
--
-- Root cause: Opus placed medications in OA because the context didn't forbid it.

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

-- ── OA (Past medical history) — add explicit medication exclusion ──

-- 1. Comprehensive Medical Exam (top-level section idx 1)
SELECT _set_section_context('t_UjVsxUoQxc', 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 2. Focused Cardiology (parent 0, sub 1)
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 3. Comprehensive Cardiology (parent 0, sub 1)
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 4. Focused Internal Medicine (parent 0, sub 1)
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 5. Comprehensive Internal Medicine (parent 0, sub 1)
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 6. Focused Neurology (parent 0, sub 1)
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- 7. Comprehensive Neurology (parent 0, sub 1)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 1,
  'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions. NEVER include medications or drug names here — all medications belong ONLY in LA (Lieková anamnéza / Current medications).');

-- ── LA (Current medications) — explicitly call out OA as forbidden ──

-- 1. Comprehensive Medical Exam (top-level section idx 5)
SELECT _set_section_context('t_UjVsxUoQxc', 5,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 2. Focused Cardiology (parent 0, sub 6)
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 6,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 3. Comprehensive Cardiology (parent 0, sub 6)
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 6,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 4. Focused Internal Medicine (parent 0, sub 6)
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 6,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 5. Comprehensive Internal Medicine (parent 0, sub 6)
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 6,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 6. Focused Neurology (parent 0, sub 4)
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 4,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- 7. Comprehensive Neurology (parent 0, sub 5)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 5,
  'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in OA (past medical history), HPI, or any other section.');

-- ── Clean up helper functions ──

DROP FUNCTION _set_section_context(TEXT, INT, TEXT);
DROP FUNCTION _set_subsection_context(TEXT, INT, INT, TEXT);
