-- Add context fields to all abbreviated sections in focused templates.
-- The April 13 migration (20260413120000) wiped manually-entered context
-- by doing a wholesale SET sections = ... replacement. This migration
-- restores context guidance using a targeted function that preserves
-- all other fields in the JSONB sections array.

-- Helper function: inject "context" into subsection at a given index
-- within the first top-level section's subsections array (index 0 = Anamnézy).
CREATE OR REPLACE FUNCTION _add_subsection_context(
  _template_id TEXT,
  _parent_idx  INT,   -- index of top-level section (0 = Anamnézy)
  _sub_idx     INT,   -- index within subsections array
  _context     TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE templates
  SET sections = jsonb_set(
    sections,
    ARRAY[_parent_idx::TEXT, 'subsections', _sub_idx::TEXT, 'context'],
    to_jsonb(_context)
  )
  WHERE id = _template_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Focused Cardiology (t_KZPRXwjQye)
-- Parent index 0 = Anamnézy, subsections 0-8
-- ============================================================
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 0, 'Rodinná anamnéza (Family history). Ochorenia rodičov, súrodencov, starých rodičov. NIKDY sem neuvádzať vlastné ochorenia pacienta.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 1, 'Osobná anamnéza (Past medical history). Vlastné predchádzajúce ochorenia, operácie, hospitalizácie, chronické choroby.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 2, 'Sociálna anamnéza (Social history). Rodinný stav, bývanie, sociálne zázemie. NIKDY sem neuvádzať abúzy ani pracovnú anamnézu.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 3, 'Epidemiologická anamnéza (Epidemiological history). Cestovanie, kontakt s infekciami, kliešťe, očkovanie.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 4, 'Pracovná anamnéza (Occupational history). Zamestnanie, pracovné prostredie, expozície pri práci. NIKDY sem neuvádzať fajčenie, alkohol ani sociálnu anamnézu.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 5, 'Alergická anamnéza (Allergies). Liekové, potravinové a environmentálne alergie.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 6, 'Lieková anamnéza (Current medications). VŠETKY aktuálne lieky s dávkovaním. Lieky uvádzať IBA sem, NIKDY do TO ani iných sekcií.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 7, 'Abúzy (Substance use). Fajčenie, alkohol, drogy. VŠETKY abúzy uvádzať IBA sem, NIKDY do PA ani SA.');
SELECT _add_subsection_context('t_KZPRXwjQye', 0, 8, 'Terajšie ochorenie (History of present illness). Priebeh aktuálneho ochorenia — začiatok, symptómy, časový priebeh. NIKDY sem neuvádzať zoznam liekov, abúzy ani chronickú anamnézu.');

-- ============================================================
-- Focused Internal Medicine (t_W3gidbL2Bf)
-- Parent index 0 = Anamnézy, subsections 0-8
-- ============================================================
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 0, 'Rodinná anamnéza (Family history). Ochorenia rodičov, súrodencov, starých rodičov. NIKDY sem neuvádzať vlastné ochorenia pacienta.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 1, 'Osobná anamnéza (Past medical history). Vlastné predchádzajúce ochorenia, operácie, hospitalizácie, chronické choroby.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 2, 'Sociálna anamnéza (Social history). Rodinný stav, bývanie, sociálne zázemie. NIKDY sem neuvádzať abúzy ani pracovnú anamnézu.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 3, 'Epidemiologická anamnéza (Epidemiological history). Cestovanie, kontakt s infekciami, kliešťe, očkovanie.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 4, 'Pracovná anamnéza (Occupational history). Zamestnanie, pracovné prostredie, expozície pri práci. NIKDY sem neuvádzať fajčenie, alkohol ani sociálnu anamnézu.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 5, 'Alergická anamnéza (Allergies). Liekové, potravinové a environmentálne alergie.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 6, 'Lieková anamnéza (Current medications). VŠETKY aktuálne lieky s dávkovaním. Lieky uvádzať IBA sem, NIKDY do TO ani iných sekcií.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 7, 'Abúzy (Substance use). Fajčenie, alkohol, drogy. VŠETKY abúzy uvádzať IBA sem, NIKDY do PA ani SA.');
SELECT _add_subsection_context('t_W3gidbL2Bf', 0, 8, 'Terajšie ochorenie (History of present illness). Priebeh aktuálneho ochorenia — začiatok, symptómy, časový priebeh. NIKDY sem neuvádzať zoznam liekov, abúzy ani chronickú anamnézu.');

-- ============================================================
-- Focused Neurology (t_QaV-XP28Qf)
-- Parent index 0 = Anamnézy, subsections 0-6
-- (no EA or PA in this template)
-- ============================================================
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 0, 'Rodinná anamnéza (Family history). Ochorenia rodičov, súrodencov, starých rodičov. NIKDY sem neuvádzať vlastné ochorenia pacienta.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 1, 'Osobná anamnéza (Past medical history). Vlastné predchádzajúce ochorenia, operácie, hospitalizácie, chronické choroby.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 2, 'Sociálna anamnéza (Social history). Rodinný stav, bývanie, sociálne zázemie. NIKDY sem neuvádzať abúzy ani pracovnú anamnézu.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 3, 'Alergická anamnéza (Allergies). Liekové, potravinové a environmentálne alergie.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 4, 'Lieková anamnéza (Current medications). VŠETKY aktuálne lieky s dávkovaním. Lieky uvádzať IBA sem, NIKDY do TO ani iných sekcií.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 5, 'Abúzy (Substance use). Fajčenie, alkohol, drogy. VŠETKY abúzy uvádzať IBA sem, NIKDY do PA ani SA.');
SELECT _add_subsection_context('t_QaV-XP28Qf', 0, 6, 'Terajšie ochorenie (History of present illness). Priebeh aktuálneho ochorenia — začiatok, symptómy, časový priebeh. NIKDY sem neuvádzať zoznam liekov, abúzy ani chronickú anamnézu.');

-- Clean up helper function
DROP FUNCTION _add_subsection_context(TEXT, INT, INT, TEXT);
