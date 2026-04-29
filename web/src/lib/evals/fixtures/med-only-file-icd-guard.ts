/**
 * Synthetic fixture — medication-only file uploaded with "zober len medikáciu"
 * directive. The file lists only chronic medications for hypertension,
 * diabetes, and depression. The transcript describes a routine cardiology
 * check-up with NO acute complaint.
 *
 * Key testing purpose:
 *   Phase 4 passage routing: medication-category passages from the file
 *   MUST NOT leak into the ICD suggester. Without routing, the ICD
 *   suggester would see "Metformin 1000 mg" and hallucinate E11 (T2DM),
 *   or "Sertralin 50 mg" and hallucinate F32 (depression).
 *
 *   The transcript mentions ONLY hypertension — that's the only diagnosis
 *   the ICD suggester should pick up.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pán Novák, vitajte na kontrole. Ďakujem. Tak povedzte, ako sa máte, ako vám je. No celkom dobre, nič špeciálne, len tá kontrola, čo sme dohodli. Lieky beriete pravidelne? Áno, všetky tak, ako ste povedali. Tlak si meriete doma? Áno, meral som, väčšinou okolo stoštyridsať na osemdesiat, raz bolo stopäťdesiat na deväťdesiat, to bolo po káve. Dobre, to je celkom v poriadku. Nejaké bolesti na hrudníku, dýchavičnosť? Nie, nič také. Závraty? Nie. Dobre, pozerám kartu, máte šesťdesiat rokov, liečite sa na hypertenziu. Áno, už desať rokov. Fajčíte? Nie, nikdy som nefajčil. Alkohol? Tak občas pivo. V rodine niečo so srdcom? Otec mal infarkt v sedemdesiatke. Dobre. Žijete s manželkou? Áno. Pracujete ešte? Áno, som inžinier v automobilke. Alergiu nemáte? Nie. Operácie? Koleno, meniskus, pred piatimi rokmi. Dobre, popočúvam si vás. Dýchanie čisté, srdce pravidelné, bez šelestov. Nohy neotekajú? Nie. Dobre, pán Novák, všetko vyzerá stabilne.`;

const MEDICATION_FILE = `Chronická medikácia pacienta - prepis z ambulantnej karty:

Ramipril 5 mg 1-0-0
Amlodipin 5 mg 0-0-1
Atorvastatin 20 mg 0-0-1
Metformin 1000 mg 1-0-1
Sertralin 50 mg 1-0-0
Trombex 75 mg 1-0-0
Pantoprazol 20 mg 1-0-0`;

export const medOnlyFileIcdGuard: EvalFixture = {
  id: "med-only-file-icd-guard",
  description:
    "60M routine check-up + medication-only file — ICD must not hallucinate from drug names",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [
      {
        name: "chronicka-medikacia.txt",
        text: MEDICATION_FILE,
      },
    ],
  },
  expectations: [
    // ── ICD: only hypertension is stated in transcript ──────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension explicitly stated in transcript — 10 years",
    },

    // ── ICD invention guards — drugs must NOT become diagnoses ──────
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason:
        "Metformin in file does NOT mean T2DM is diagnosed — no diabetes mentioned in transcript",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E10",
      reason: "No diabetes of any type mentioned",
    },
    {
      kind: "icd-not-in-zaver",
      code: "F32",
      reason:
        "Sertralin in file does NOT mean depression is diagnosed — never mentioned in transcript",
    },
    {
      kind: "icd-not-in-zaver",
      code: "F33",
      reason: "No recurrent depression mentioned",
    },

    // ── LA: all meds from file must appear ──────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Ramipril",
      reason: "Ramipril 5 mg from medication file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Metformin",
      reason: "Metformin 1000 mg from medication file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Sertralin",
      reason: "Sertralin 50 mg from medication file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Atorvastatin",
      reason: "Atorvastatin 20 mg from medication file",
    },

    // ── OA: transcript mentions only hypertension + meniscus ────────
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Hypertension explicitly stated in transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "menisk",
      reason: "Meniscus surgery mentioned in transcript",
      caseSensitive: false,
    },

    // ── RA: father's MI ─────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "otec",
      reason: "Father had MI at 70 — transcript",
      caseSensitive: false,
    },

    // ── AA: patient denies ──────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "Patient denies allergies",
      caseSensitive: false,
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Warfarin not in source — common hallucination",
    },
  ],
};
