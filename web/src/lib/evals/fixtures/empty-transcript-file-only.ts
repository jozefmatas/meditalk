/**
 * Edge case fixture — NO transcript at all, only a scanned discharge
 * letter (file). Tests that the pipeline produces a valid note from
 * file content alone.
 *
 * Key testing purposes:
 *   1. Pipeline does not crash when transcript is empty/missing.
 *   2. Sections are populated from file content.
 *   3. ICD codes are derived from the file's diagnostic summary.
 *   4. Medications from the file appear in LA.
 */
import type { EvalFixture } from "../types";

const DISCHARGE_LETTER = `Lekárska prepúšťacia správa
Pacient: HORVÁTH Ján, nar. 1958, RČ: 580315/1234

Dg:
I25.1 Aterosklerotická choroba srdca
I10 Artériová hypertenzia
E78.0 Čistá hypercholesterolémia
E11.9 Diabetes mellitus 2. typu bez komplikácií

OA: St.p. PCI RIA so stentom (DES) 03/2025. ICHS, AH III.st., DM 2.typu na PAD, hypercholesterolémia. St.p. cholecystektómii 2018.

RA: Otec ICHS, zomrel na IM v 62r. Matka DM 2.typu.

SA: Žije s manželkou. Dôchodca, bývalý vodič autobusu.

AA: Neguje.

Abúzy: Ex-fajčiar (skončil 2020, predtým 20 cig/deň 30 rokov). Alkohol príležitostne.

TO: Pacient prijatý na plánovanú kontrolnú koronarografiu 6 mesiacov po PCI RIA. Bez stenokardie v pokoji ani pri námahe. Bez dýchavičnosti. NYHA I.

Obj. nález:
TK: 135/82 mmHg, SF: 72/min, SR
Výška: 178 cm, Hmotnosť: 92 kg, BMI: 29.0
Cor: akcia pravidelná, ozvy ohraničené, bez šelestov.
Pľúca: dýchanie vezikulárne bilaterálne, bez VDF.
Abdomen: mäkké, nebolestivé, bez rezistencie.
DK: bez edémov, pulzácie hmatné do periférie.

EKG: SR, SF 72/min, normálna os, bez ST zmien.

ECHO: EF ĽK 55%, bez regionálnych porúch kinetiky. Mitrálna regurgitácia I.st. Aortálna chlopňa trojcípa, bez stenózy.

Terapia pri prepustení:
Anopyrin 100 mg 0-1-0
Brilique 90 mg 1-0-1
Atoris 80 mg 0-0-1
Ramipril 5 mg 1-0-0
Bisoprolol 2,5 mg 1-0-0
Metformin 1000 mg 1-0-1
Trulicity 1,5 mg 1x týždenne s.c.

Odporúčania:
Kontrola u kardiológa o 4 týždne. Pokračovať v DAPT minimálne 12 mesiacov. Diéta, pohyb, kontrola glykémie.`;

export const emptyTranscriptFileOnly: EvalFixture = {
  id: "empty-transcript-file-only",
  description:
    "66M post-PCI check — file only, no transcript, pipeline must produce valid note",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: "",
    files: [{ name: "prepustacia-sprava.txt", text: DISCHARGE_LETTER }],
  },
  expectations: [
    // ── ICD from file diagnoses ─────────────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I25.1",
      reason: "Atherosclerotic heart disease explicitly in Dg section",
    },
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension explicitly in Dg section",
    },

    // ── OA: comorbidities from file ─────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "PCI",
      reason: "Post-PCI RIA with DES stent — file OA",
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "cholecystektómi",
      reason: "Post-cholecystectomy 2018 — file OA",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "diabet",
      reason: "DM 2. typu from file",
      caseSensitive: false,
    },

    // ── LA: medications from file ───────────────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Anopyrin",
      reason: "Anopyrin 100 mg from file therapy",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Brilique",
      reason: "Brilique 90 mg from file therapy",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Atoris",
      reason: "Atoris 80 mg from file therapy",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Ramipril",
      reason: "Ramipril 5 mg from file therapy",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Metformin",
      reason: "Metformin 1000 mg from file therapy",
      caseSensitive: false,
    },

    // ── RA: family history from file ────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "otec",
      reason: "Father ICHS, died of MI at 62 — from file",
      caseSensitive: false,
    },

    // ── Vitals from file ────────────────────────────────────────────
    {
      kind: "contains",
      value: "178",
      reason: "Height 178 cm from file",
    },
    {
      kind: "contains",
      value: "92",
      reason: "Weight 92 kg from file",
    },

    // ── AA: patient denies ──────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "File states AA: Neguje",
      caseSensitive: false,
    },

    // ── Invention guard ─────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Patient is on Anopyrin + Brilique, not Warfarin",
    },
  ],
};
