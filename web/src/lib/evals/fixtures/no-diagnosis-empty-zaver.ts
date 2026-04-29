/**
 * Edge case fixture — healthy young patient with no diagnosis in source.
 * The visit is a pre-operative clearance (pre-op kardiologické vyšetrenie)
 * where the conclusion should state "kardiologicky schopný operácie" or
 * similar — but critically, the ICD suggester should not hallucinate
 * diagnoses where none exist.
 *
 * Key testing purposes:
 *   1. ICD suggester does not invent diagnoses from normal findings.
 *   2. Záver (conclusion) does not contain phantom ICD codes.
 *   3. Normal exam findings go into correct sections (EKG, ECHO).
 *   4. Pipeline handles a source with no pathology gracefully.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pán Bílik, vitajte. Ďakujem. Tak vy ste tu na predoperačné kardiologické vyšetrenie, hej? Áno, idem na operáciu kolena, totálna endoprotéza, a ortopéd ma poslal k vám na predoperačné. Rozumiem. Koľko máte rokov? Tridsaťpäť. Máte nejaké chronické ochorenia? Nie, nič. Lieky beriete? Žiadne. Bolesti na hrudníku? Nikdy. Dýchavičnosť? Nie. Závraty? Nie. Mdloby? Nie. A to koleno, to je po úraze? Áno, roztrhol som si väzy pri futbale a teraz idú robiť plastiku. Rozumiem. Fajčíte? Nie. Alkohol? Tak víkendovo, priemerne. V rodine niečo so srdcom? Nie, všetci zdraví. Alergiu? Nie. Predchádzajúce operácie? Artroskopu kolena pred rokom. Žijete? S priateľkou. Pracujete? Áno, som programátor. Dobre, popočúvam si vás. Dýchanie čisté obojstranne. Srdce pravidelné, ozvy ohraničené, žiadne šelesty. Nohy bez opuchov. Brucho mäkké, nebolestivé. Tlak stotridsať na sedemdesiat, pulz šesťdesiatosem.`;

export const noDiagnosisEmptyZaver: EvalFixture = {
  id: "no-diagnosis-empty-zaver",
  description:
    "35M pre-op clearance, no pathology — ICD must not hallucinate diagnoses",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
  },
  expectations: [
    // ── ICD: no phantom diagnoses ───────────────────────────────────
    {
      kind: "icd-not-in-zaver",
      code: "I10",
      reason: "No hypertension — BP 130/70 is normal, no Htn mentioned",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I25",
      reason: "No coronary artery disease mentioned",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "No diabetes mentioned",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48",
      reason: "No atrial fibrillation — regular rhythm",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I50",
      reason: "No heart failure — healthy 35-year-old",
    },

    // ── OA: should mention the knee ─────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "kolen",
      reason: "Knee injury / artroscopy history from transcript",
      caseSensitive: false,
    },

    // ── AA: denies ──────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "Patient explicitly denies allergies",
      caseSensitive: false,
    },

    // ── LA: should be empty or "0" / "neužíva" ─────────────────────
    {
      kind: "section-not-contains",
      section: "LA",
      value: "Ramipril",
      reason: "Patient takes no medications — Ramipril must not appear",
    },
    {
      kind: "section-not-contains",
      section: "LA",
      value: "Metformin",
      reason: "Patient takes no medications — Metformin must not appear",
    },

    // ── SA + PA from transcript ─────────────────────────────────────
    {
      kind: "section-contains",
      section: "PA",
      value: "programátor",
      reason: "Programmer per transcript",
      caseSensitive: false,
    },

    // ── Ab: no smoking ──────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "Ab",
      value: "nefajč",
      reason: "Non-smoker per transcript",
      caseSensitive: false,
    },

    // ── Global invention guard ──────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "No anticoagulation needed — healthy patient",
    },
    {
      kind: "not-contains",
      value: "Eliquis",
      reason: "No anticoagulation needed — healthy patient",
    },
  ],
};
