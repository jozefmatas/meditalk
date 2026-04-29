/**
 * Fixture — discharge letter with medication list, diagnosis list,
 * and exam findings all in one document. Tests that section routing
 * keeps content in the right sections.
 *
 * Key testing purposes:
 *   1. Medication text stays in LA, does NOT appear in TO or OA.
 *   2. Diagnosis text stays in OA/Záver, does NOT appear in LA.
 *   3. Vitals text stays in vitals sections, does NOT clutter TO.
 *   4. Exam findings (auscultation) stay in objective sections.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pani Hrušková. Zdravím. Tak vy ste k nám boli odoslaná z interny v Petržalke. Áno. Čo sa stalo? No oni ma vyšetrovali pre búšenie srdca a zistili, že mám fibriláciu. Fibriláciu predsiení? Áno, to vraveli. A kedy to začalo? Asi pred týždňom som začala cítiť, že mi srdce bije rýchlo a nepravidelne. Bolesti na hrudníku? Nie. Dýchavičnosť? Trochu. Mdloby? Nie. Máte nejaké choroby? Štítnu žľazu, bola som operovaná, beriem Euthyrox stodvadsaťpäť. Potom vysoký tlak, na to beriem Perindopril osem. A cholesterol, Rosuvastatin dvadsať. To je všetko? Áno. Fajčíte? Nie. Alkohol? Nie. Rodina? Mama mala fibriláciu tiež. Žijete? Sama, som vdova. Pracujete? Nie, dôchodkyňa, bývala kaderníčka. Alergiu? Nie. Operácie? Tá štítna žľaza a cisársky rez. Dobre. Tlak stošesťdesiat na deväťdesiatpäť. Pulz stodesať, nepravidelný. Popočúvam. Dýchanie čisté. Srdce nepravidelné, rýchle, bez šelestov. Nohy bez opuchov.`;

const PETRZALKA_REPORT = `Interné oddelenie NsP Petržalka
Prepúšťacia správa

Dg:
I48.0 Paroxyzmálna fibrilácia predsiení — novodiagnostikovaná
I10 Artériová hypertenzia
E03.9 Hypotyreóza, bližšie neurčená (st.p. strumektómii)
E78.0 Čistá hypercholesterolémia

Terajšie ochorenie:
72-ročná pacientka prijatá pre palpitácie trvajúce 5 dní. Na EKG
zistená fibrilácia predsiení s rýchlou komorovou odpoveďou, SF 128/min.
Po i.v. Cordarone konverzia na SR.

Obj. nález:
TK: 158/92 mmHg, SF: 110/min, FP
Výška: 162 cm, Hmotnosť: 68 kg, BMI: 25.9
Cor: akcia nepravidelná, ozvy ohraničené, systolický šelest 1/6 nad mitrálou.
Pľúca: dýchanie vezikulárne bilat., bez VDF.
DK: bez edémov.

EKG pri prepustení: SR, SF 78/min, normálna os, QTc 440 ms.

ECHO: EF ĽK 58%, ĽP 44 mm (dilatovaná), MiR I.st., TiR I.st.

Terapia pri prepustení:
Perindopril 8 mg 1-0-0
Euthyrox 125 μg 1-0-0
Rosuvastatin 20 mg 0-0-1
Eliquis 5 mg 1-0-1
Cordarone 200 mg 1-0-0 (na 3 mesiace, potom kontrola)
Concor 2,5 mg 1-0-0

Odporúčanie: Kontrola na CINRE, zvážiť abláciu.`;

export const crossSectionLeakGuard: EvalFixture = {
  id: "cross-section-leak-guard",
  description:
    "72F new-onset parox. AF — medications must stay in LA, diagnoses in OA, not leak",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [{ name: "petrzalka-prepustacia.txt", text: PETRZALKA_REPORT }],
  },
  expectations: [
    // ── LA: all meds from file + transcript ─────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Perindopril",
      reason: "Perindopril 8 mg from both sources",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Euthyrox",
      reason: "Euthyrox 125 μg from both sources",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Rosuvastatin",
      reason: "Rosuvastatin 20 mg from both sources",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Eliquis",
      reason: "Eliquis 5 mg from file (new anticoagulation for AF)",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Cordarone",
      reason: "Cordarone 200 mg from file (antiarrhythmic)",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Concor",
      reason: "Concor 2.5 mg from file (rate control)",
    },

    // ── TO: should NOT contain medication lists ─────────────────────
    {
      kind: "section-not-contains",
      section: "TO",
      value: "Rosuvastatin",
      reason: "Medication name must not leak into TO narrative",
    },
    {
      kind: "section-not-contains",
      section: "TO",
      value: "Euthyrox",
      reason: "Medication name must not leak into TO narrative",
    },

    // ── OA: diagnoses from file ─────────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "fibrilácia",
      reason: "Paroxysmal AF — primary new diagnosis",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Hypertension from both sources",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "strumektómi",
      reason: "Post-strumectomy from both sources",
      caseSensitive: false,
    },

    // ── ICD codes ───────────────────────────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I48.0",
      reason: "Paroxysmal AF — primary diagnosis in file",
    },
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension from all sources",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48.1",
      reason: "Persistent AF must NOT appear — file says paroxysmal",
    },

    // ── RA: mother's AF ─────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "matka",
      reason: "Mother had AF — transcript",
      caseSensitive: false,
    },

    // ── AA: denies ──────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "Patient denies allergies — transcript",
      caseSensitive: false,
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Patient is on Eliquis, not Warfarin",
    },
    {
      kind: "not-contains",
      value: "Metformin",
      reason: "No diabetes in source",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "No diabetes in source",
    },
  ],
};
