-- Add English context fields to ALL sections and subsections across all 8 templates.
-- Contexts are consumed by Claude (the LLM), not shown to users — English is more
-- token-efficient and language-agnostic. Existing Slovak contexts on focused templates
-- are translated to English for consistency.
--
-- Context is the strongest output-quality lever: it gets injected as
-- "SECTION-SPECIFIC GUIDANCE (ALWAYS FOLLOW THIS)" in the system prompt.

-- ── Helper functions ──

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

-- ============================================================
-- 1. Comprehensive Medical Exam (t_UjVsxUoQxc)
--    14 top-level + 5 social subsections + 36 physical exam subsections
-- ============================================================

-- Top-level sections (indices 0-13)
SELECT _set_section_context('t_UjVsxUoQxc', 0, 'Reason for contact. Brief description of the main reason for the visit. NEVER include detailed disease course here — that belongs in HPI.');
SELECT _set_section_context('t_UjVsxUoQxc', 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_section_context('t_UjVsxUoQxc', 2, 'Assistive devices. Glasses, hearing aid, cane, corset, orthoses, prostheses, and other devices.');
SELECT _set_section_context('t_UjVsxUoQxc', 3, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_section_context('t_UjVsxUoQxc', 4, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_section_context('t_UjVsxUoQxc', 5, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_section_context('t_UjVsxUoQxc', 6, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_section_context('t_UjVsxUoQxc', 7, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');
-- 8 = Fyzikálne vyšetrenie (parent with subsections, no context on parent)
SELECT _set_section_context('t_UjVsxUoQxc', 9, 'Laboratory. Lab test results with values and units. Report ONLY results, NEVER interpretation.');
SELECT _set_section_context('t_UjVsxUoQxc', 10, 'Radiology. Imaging findings — X-ray, CT, MRI, ultrasound. Report findings, NEVER clinical interpretation.');
SELECT _set_section_context('t_UjVsxUoQxc', 11, 'Other examination findings. Results of other investigations — spirometry, audiometry, etc.');
SELECT _set_section_context('t_UjVsxUoQxc', 12, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_UjVsxUoQxc', 13, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- Sociálna anamnéza subsections (parent idx 6, subs 0-4)
SELECT _set_subsection_context('t_UjVsxUoQxc', 6, 0, 'Tobacco use. Type, amount, duration, pack-years. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 6, 1, 'Alcohol use. Frequency, amount, type. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 6, 2, 'Controlled substances. Illicit drugs, medication misuse. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 6, 3, 'Physical activity. Type and frequency of exercise.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 6, 4, 'Diet. Eating habits, dietary restrictions, special diets.');

-- Fyzikálne vyšetrenie subsections (parent idx 8, subs 0-35)
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 0, 'General condition. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 1, 'Body temperature. Value in °C, measurement site.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 2, 'Height. Value in cm.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 3, 'Weight. Value in kg.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 4, 'Body Mass Index. BMI value, classification if applicable.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 5, 'Skin. Color, turgor, efflorescences, scars, trophic changes.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 6, 'Eyes. Eyeballs, conjunctivae, pupils, light reaction, vision.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 7, 'Ears. Ear canals, tympanic membranes, hearing.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 8, 'Nose. Patency, mucosa, septal deviation.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 9, 'Mouth and throat. Mucous membranes, tonsils, pharynx, teeth, tongue.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 10, 'Lymph nodes. Location, size, tenderness, mobility.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 11, 'Thyroid. Size, nodules, consistency, mobility on swallowing.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 12, 'Breast examination. Symmetry, masses, discharge, axillary nodes.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 13, 'Heart. Auscultation — heart sounds, murmurs, rhythm. Apex beat, palpation.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 14, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 15, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 16, 'Peripheral pulses. Presence, symmetry — femoral, popliteal, pedal.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 17, 'ECG. Rhythm, rate, axis, P-wave, PR, QRS, ST-T changes, ECG conclusion.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 18, 'Lungs. Auscultation — breath sounds, adventitious sounds, percussion, fremitus.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 19, 'Respiratory rate. Rate per minute.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 20, 'Oxygen saturation. SpO2 percentage, on room air or supplemental O2.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 21, 'Abdomen. Inspection, palpation, percussion, auscultation, Murphy, McBurney, peritoneal signs.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 22, 'Rectal examination. Sphincter tone, ampulla, prostate, stool.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 23, 'Gynaecology. Gynaecological findings — inspection, palpation, cytology.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 24, 'Penis and scrotum. Inspection, palpation, hydrocele, varicocele.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 25, 'Neurological. Screening neuro exam — consciousness, orientation, motor, sensory, reflexes, meningeal signs.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 26, 'Mental state examination. Mood, affect, thought, perception, orientation, memory, attention, insight.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 27, 'Suicide risk assessment. Suicidal ideation, plans, risk factors, protective factors.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 28, 'Neck. Cervical spine, carotid arteries, JVP, lymph nodes, mobility.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 29, 'Back. Spinal alignment, scoliosis, percussion, mobility, Lasegue test.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 30, 'Shoulders. Range of motion, tenderness, impingement, atrophy.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 31, 'Elbows. Range of motion, epicondylitis, findings.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 32, 'Hands. Small joints, grip, deformities, Heberden and Bouchard nodes.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 33, 'Hips. Range of motion, Trendelenburg, Patrick test.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 34, 'Knees. Range of motion, stability, effusion, meniscal tests, crepitus.');
SELECT _set_subsection_context('t_UjVsxUoQxc', 8, 35, 'Feet. Arch, toes, hallux valgus, peripheral pulses, trophics.');

-- ============================================================
-- 2. Basic SOAP Note (t_X2cOl91J5A)
--    4 top-level sections
-- ============================================================

SELECT _set_section_context('t_X2cOl91J5A', 0, 'Subjective. History — reason for visit, symptoms, disease course, family/personal/social/medication/allergy history, substance use. ALL history data goes ONLY here.');
SELECT _set_section_context('t_X2cOl91J5A', 1, 'Objective. Objective findings — vital signs, physical examination, lab results, imaging. NEVER include history data here.');
SELECT _set_section_context('t_X2cOl91J5A', 2, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_X2cOl91J5A', 3, 'Plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 3. Focused Cardiology (t_KZPRXwjQye)
--    9 history subs (translate SK→EN) + 7 objective subs + 2 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0) — translate existing Slovak to English
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 3, 'Epidemiological history. Travel, infection contacts, tick bites, vaccinations.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 4, 'Occupational history. Employment, work environment, occupational exposures. NEVER include smoking, alcohol, or social history here.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 5, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 6, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 7, 'Substance use. Smoking, alcohol, drugs. ALL substance use goes ONLY here, NEVER in occupational or social history.');
SELECT _set_subsection_context('t_KZPRXwjQye', 0, 8, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Objektívne vyšetrenie subsections (parent idx 1, subs 0-6)
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 0, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 1, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 2, 'Height. Value in cm.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 3, 'Weight. Value in kg.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 4, 'Body Mass Index. BMI value, classification if applicable.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 5, 'General examination. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_KZPRXwjQye', 1, 6, 'ECG. Rhythm, rate, axis, P-wave, PR, QRS, ST-T changes, ECG conclusion.');

-- Top-level sections
SELECT _set_section_context('t_KZPRXwjQye', 2, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_KZPRXwjQye', 3, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 4. Comprehensive Cardiology (t_PuUApaFmlk)
--    11 history subs + 18 objective subs + 2 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0, subs 0-10)
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 3, 'Epidemiological history. Travel, infection contacts, tick bites, vaccinations.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 4, 'Occupational history. Employment, work environment, occupational exposures. NEVER include smoking, alcohol, or social history here.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 5, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 6, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 7, 'Tobacco use. Type, amount, duration, pack-years. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 8, 'Alcohol use. Frequency, amount, type. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 9, 'Reason for contact. Brief description of the main reason for the visit. NEVER include detailed disease course here — that belongs in HPI.');
SELECT _set_subsection_context('t_PuUApaFmlk', 0, 10, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Objektívne vyšetrenie subsections (parent idx 1, subs 0-17)
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 0, 'General condition. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 1, 'Body temperature. Value in °C, measurement site.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 2, 'Skin. Color, turgor, efflorescences, scars, trophic changes.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 3, 'Eyes. Eyeballs, conjunctivae, pupils, light reaction, vision.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 4, 'Heart. Auscultation — heart sounds, murmurs, rhythm. Apex beat, palpation.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 5, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 6, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 7, 'Peripheral pulses. Presence, symmetry — femoral, popliteal, pedal.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 8, 'ECG. Rhythm, rate, axis, P-wave, PR, QRS, ST-T changes, ECG conclusion.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 9, 'Lungs. Auscultation — breath sounds, adventitious sounds, percussion, fremitus.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 10, 'Respiratory rate. Rate per minute.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 11, 'Oxygen saturation. SpO2 percentage, on room air or supplemental O2.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 12, 'Gynaecology. Gynaecological findings — inspection, palpation, cytology.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 13, 'Neurological. Screening neuro exam — consciousness, orientation, motor, sensory, reflexes, meningeal signs.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 14, 'Mental state examination. Mood, affect, thought, perception, orientation, memory, attention, insight.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 15, 'Laboratory. Lab test results with values and units. Report ONLY results, NEVER interpretation.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 16, 'Radiology. Imaging findings — X-ray, CT, MRI, ultrasound. Report findings, NEVER clinical interpretation.');
SELECT _set_subsection_context('t_PuUApaFmlk', 1, 17, 'Other examination findings. Results of other investigations — spirometry, audiometry, etc.');

-- Top-level sections
SELECT _set_section_context('t_PuUApaFmlk', 2, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_PuUApaFmlk', 3, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 5. Focused Internal Medicine (t_W3gidbL2Bf)
--    9 history subs (translate SK→EN) + 13 objective subs + 3 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0) — translate existing Slovak to English
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 3, 'Epidemiological history. Travel, infection contacts, tick bites, vaccinations.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 4, 'Occupational history. Employment, work environment, occupational exposures. NEVER include smoking, alcohol, or social history here.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 5, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 6, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 7, 'Substance use. Smoking, alcohol, drugs. ALL substance use goes ONLY here, NEVER in occupational or social history.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 0, 8, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Objektívne vyšetrenie subsections (parent idx 1, subs 0-12)
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 0, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 1, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 2, 'Height. Value in cm.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 3, 'Weight. Value in kg.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 4, 'Body Mass Index. BMI value, classification if applicable.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 5, 'General condition. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 6, 'Skin. Color, turgor, efflorescences, scars, trophic changes.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 7, 'Lymph nodes. Location, size, tenderness, mobility.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 8, 'Thyroid. Size, nodules, consistency, mobility on swallowing.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 9, 'Heart. Auscultation — heart sounds, murmurs, rhythm. Apex beat, palpation.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 10, 'Lungs. Auscultation — breath sounds, adventitious sounds, percussion, fremitus.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 11, 'Abdomen. Inspection, palpation, percussion, auscultation, Murphy, McBurney, peritoneal signs.');
SELECT _set_subsection_context('t_W3gidbL2Bf', 1, 12, 'Lower extremities. Edema, varicose veins, trophic changes, peripheral pulses, mobility.');

-- Top-level sections
SELECT _set_section_context('t_W3gidbL2Bf', 2, 'Laboratory. Lab test results with values and units. Report ONLY results, NEVER interpretation.');
SELECT _set_section_context('t_W3gidbL2Bf', 3, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_W3gidbL2Bf', 4, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 6. Comprehensive Internal Medicine (t_w6csi2WwuZ)
--    11 history subs + 21 objective subs + 5 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0, subs 0-10)
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 3, 'Epidemiological history. Travel, infection contacts, tick bites, vaccinations.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 4, 'Occupational history. Employment, work environment, occupational exposures. NEVER include smoking, alcohol, or social history here.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 5, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 6, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 7, 'Tobacco use. Type, amount, duration, pack-years. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 8, 'Alcohol use. Frequency, amount, type. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 9, 'Reason for contact. Brief description of the main reason for the visit. NEVER include detailed disease course here — that belongs in HPI.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 0, 10, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Objektívne vyšetrenie subsections (parent idx 1, subs 0-20)
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 0, 'General condition. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 1, 'Body temperature. Value in °C, measurement site.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 2, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 3, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 4, 'Respiratory rate. Rate per minute.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 5, 'Oxygen saturation. SpO2 percentage, on room air or supplemental O2.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 6, 'Height. Value in cm.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 7, 'Weight. Value in kg.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 8, 'Body Mass Index. BMI value, classification if applicable.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 9, 'Skin. Color, turgor, efflorescences, scars, trophic changes.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 10, 'Eyes. Eyeballs, conjunctivae, pupils, light reaction, vision.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 11, 'Lymph nodes. Location, size, tenderness, mobility.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 12, 'Thyroid. Size, nodules, consistency, mobility on swallowing.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 13, 'Heart. Auscultation — heart sounds, murmurs, rhythm. Apex beat, palpation.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 14, 'Lungs. Auscultation — breath sounds, adventitious sounds, percussion, fremitus.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 15, 'Abdomen. Inspection, palpation, percussion, auscultation, Murphy, McBurney, peritoneal signs.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 16, 'Liver and spleen. Size, consistency, tenderness, hepato/splenomegaly.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 17, 'Kidneys. Costovertebral angle tenderness, palpation, tenderness.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 18, 'Lower extremities. Edema, varicose veins, trophic changes, peripheral pulses, mobility.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 19, 'Neurological. Screening neuro exam — consciousness, orientation, motor, sensory, reflexes, meningeal signs.');
SELECT _set_subsection_context('t_w6csi2WwuZ', 1, 20, 'Mental state. Mood, affect, thought, perception, orientation, memory.');

-- Top-level sections
SELECT _set_section_context('t_w6csi2WwuZ', 2, 'Laboratory. Lab test results with values and units. Report ONLY results, NEVER interpretation.');
SELECT _set_section_context('t_w6csi2WwuZ', 3, 'Radiology. Imaging findings — X-ray, CT, MRI, ultrasound. Report findings, NEVER clinical interpretation.');
SELECT _set_section_context('t_w6csi2WwuZ', 4, 'Other examination findings. Results of other investigations — spirometry, audiometry, etc.');
SELECT _set_section_context('t_w6csi2WwuZ', 5, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_w6csi2WwuZ', 6, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 7. Focused Neurology (t_QaV-XP28Qf)
--    7 history subs (translate SK→EN) + 9 neuro subs + 2 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0) — translate existing Slovak to English
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 3, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 4, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 5, 'Substance use. Smoking, alcohol, drugs. ALL substance use goes ONLY here, NEVER in occupational or social history.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 0, 6, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Neurologické vyšetrenie subsections (parent idx 1, subs 0-8)
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 0, 'Consciousness and orientation. GCS, orientation to person, place, time, situation.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 1, 'Speech. Dysarthria, aphasia — motor, sensory, global. Fluency, repetition, naming.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 2, 'Cranial nerves. Findings on CN I–XII, visual fields, eye movements, facial expression, tongue.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 3, 'Motor function. Muscle strength by muscle groups, Mingazzini test, pareses, plegias.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 4, 'Sensory function. Superficial and deep sensation, proprioception, deficit localization.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 5, 'Reflexes. Deep tendon reflexes, symmetry, intensity, pathological reflexes.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 6, 'Coordination / Cerebellar function. Finger-nose, heel-shin, dysdiadochokinesia, Romberg.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 7, 'Gait and balance. Gait pattern, stability, tandem gait, Romberg.');
SELECT _set_subsection_context('t_QaV-XP28Qf', 1, 8, 'Meningeal signs. Neck stiffness, Brudzinski, Kernig.');

-- Top-level sections
SELECT _set_section_context('t_QaV-XP28Qf', 2, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_QaV-XP28Qf', 3, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ============================================================
-- 8. Comprehensive Neurology (t_ZpL3_fMVC2)
--    10 history subs + 5 objective subs + 14 neuro subs + 5 top-level
-- ============================================================

-- Anamnézy subsections (parent idx 0, subs 0-9)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 0, 'Family history. Diseases of parents, siblings, grandparents. NEVER include the patient''s own diseases here.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 1, 'Past medical history. Previous diseases, surgeries, hospitalizations, chronic conditions.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 2, 'Social history. Marital status, housing, social support. NEVER include substance use or occupational history here.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 3, 'Occupational history. Employment, work environment, occupational exposures. NEVER include smoking, alcohol, or social history here.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 4, 'Allergies. Drug, food, and environmental allergies.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 5, 'Current medications. ALL current medications with dosing. List medications ONLY here, NEVER in HPI or other sections.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 6, 'Tobacco use. Type, amount, duration, pack-years. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 7, 'Alcohol use. Frequency, amount, type. NEVER include in occupational or social history sections.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 8, 'Reason for contact. Brief description of the main reason for the visit. NEVER include detailed disease course here — that belongs in HPI.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 0, 9, 'History of present illness. Course of current disease — onset, symptoms, timeline. NEVER include medication lists, substance use, or chronic history here.');

-- Objektívne vyšetrenie subsections (parent idx 1, subs 0-4)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 1, 0, 'General condition. Consciousness, habitus, nutrition, hydration, complexion, patient cooperation.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 1, 1, 'Blood pressure. Systolic/diastolic in mmHg, position, side of measurement.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 1, 2, 'Pulse. Rate per minute, rhythm, volume, regularity.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 1, 3, 'Heart. Auscultation — heart sounds, murmurs, rhythm. Apex beat, palpation.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 1, 4, 'Lungs. Auscultation — breath sounds, adventitious sounds, percussion, fremitus.');

-- Neurologické vyšetrenie subsections (parent idx 2, subs 0-13)
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 0, 'Consciousness and orientation. GCS, orientation to person, place, time, situation.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 1, 'Speech and language. Dysarthria, aphasia — motor, sensory, global. Fluency, repetition, naming.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 2, 'Cranial nerves. Findings on CN I–XII, visual fields, eye movements, facial expression, tongue.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 3, 'Upper limb motor function. Muscle strength by muscle groups, Mingazzini test, pareses, plegias.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 4, 'Lower limb motor function. Muscle strength by muscle groups, Mingazzini test, pareses, plegias.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 5, 'Muscle tone. Hypertonia, hypotonia, rigidity, spasticity, cogwheel phenomenon.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 6, 'Sensory function. Superficial and deep sensation, proprioception, deficit localization.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 7, 'Reflexes. Deep tendon reflexes, symmetry, intensity, pathological reflexes.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 8, 'Pyramidal signs. Babinski, Chaddock, Oppenheim, Gordon — presence and side.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 9, 'Extrapyramidal signs. Tremor, rigidity, bradykinesia, dystonia, chorea.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 10, 'Cerebellar function. Finger-nose, heel-shin, dysdiadochokinesia, Romberg.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 11, 'Gait and balance. Gait pattern, stability, tandem gait, Romberg.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 12, 'Meningeal signs. Neck stiffness, Brudzinski, Kernig.');
SELECT _set_subsection_context('t_ZpL3_fMVC2', 2, 13, 'Mental state examination. Mood, affect, thought, perception, orientation, memory, attention, insight.');

-- Top-level sections
SELECT _set_section_context('t_ZpL3_fMVC2', 3, 'Laboratory. Lab test results with values and units. Report ONLY results, NEVER interpretation.');
SELECT _set_section_context('t_ZpL3_fMVC2', 4, 'Radiology and imaging. Imaging findings — X-ray, CT, MRI, ultrasound.');
SELECT _set_section_context('t_ZpL3_fMVC2', 5, 'Electrophysiology. EMG, EEG, evoked potentials — findings and conclusion.');
SELECT _set_section_context('t_ZpL3_fMVC2', 6, 'Assessment/Conclusion. ICD-10 diagnoses and clinical conclusion. Include ONLY diagnoses and ICD codes, NO narrative text or examination summary.');
SELECT _set_section_context('t_ZpL3_fMVC2', 7, 'Action and plan. Therapeutic plan, further investigations, recommendations, follow-up date, sick leave.');

-- ── Clean up helper functions ──

DROP FUNCTION _set_section_context(TEXT, INT, TEXT);
DROP FUNCTION _set_subsection_context(TEXT, INT, INT, TEXT);
