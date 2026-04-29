/**
 * Fixture — patient with SPECIFIC vitals in source. Tests that the
 * pipeline does not invent vital values that aren't present, and that
 * stated vitals survive intact.
 *
 * Key testing purposes:
 *   1. Vital values from source appear with correct numbers.
 *   2. No phantom vitals are invented (e.g., SpO2 when not measured).
 *   3. The ungrounded-vital critic catches invented values.
 *   4. EKG findings go to the EKG section.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pán Štefánik, vitajte. Ďakujem. Tak povedzte, čo vás priviedlo. Prišiel som na kontrolu, lebo mi doktorka merala tlak a bol vysoký. Aký bol? Stoosemdesiat na stodvadsať vravela. A odvtedy? Doma si meriam, väčšinou okolo stošesťdesiat na sto. Ešte stále vysoký. Áno. Bolesti na hrudníku? Nie. Dýchavičnosť? Tak trochu pri chôdzi do kopca. A čo lieky, beriete niečo? Áno, Ramipril desať miligramov ráno a Amlodipin desať miligramov večer. Ešte niečo? Atorvastatin štyridsať miligramov večer. Fajčíte? Áno, desať cigariet denne. Alkohol? Nie. V rodine? Otec mal mozgovú príhodu. Žijete? S manželkou a synom. Pracujete? Áno, som murár. Alergiu? Nie. Operácie? Apendektómiu v mladosti. Dobre. Zmeriam vám tlak. Sto šesťdesiatdva na deväťdesiatosem. Pulz sedemdesiatštyri. Popočúvam vás. Dýchanie čisté, srdce pravidelné, systolický šelest nad aortou dvojka zo šiestich. Nohy bez opuchov.`;

export const inventedVitalGuard: EvalFixture = {
  id: "invented-vital-guard",
  description:
    "55M hypertension control — specific vitals must match source, no phantom values",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
  },
  expectations: [
    // ── Vitals from transcript ──────────────────────────────────────
    {
      kind: "contains",
      value: "162",
      reason: "Systolic BP 162 stated in transcript",
    },
    {
      kind: "contains",
      value: "98",
      reason: "Diastolic BP 98 stated in transcript",
    },
    {
      kind: "contains",
      value: "74",
      reason: "Heart rate 74/min stated in transcript",
    },

    // ── Phantom vital guards ────────────────────────────────────────
    {
      kind: "not-contains",
      value: "SpO2",
      reason: "O2 saturation was NEVER measured — must not appear",
      caseSensitive: false,
    },
    {
      kind: "not-contains",
      value: "saturácia",
      reason: "O2 saturation was NEVER measured — must not appear",
      caseSensitive: false,
    },
    {
      kind: "not-contains",
      value: "BMI",
      reason:
        "Height/weight not mentioned → BMI cannot be calculated, must not appear",
    },

    // ── ICD codes ───────────────────────────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension — BP 162/98, on Ramipril + Amlodipin",
    },

    // ── OA ──────────────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Hypertension from transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "apendektómi",
      reason: "Appendectomy in youth from transcript",
      caseSensitive: false,
    },

    // ── LA: medications ─────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Ramipril",
      reason: "Ramipril 10 mg from transcript",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Amlodipin",
      reason: "Amlodipin 10 mg from transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Atorvastatin",
      reason: "Atorvastatin 40 mg from transcript",
      caseSensitive: false,
    },

    // ── Ab: smoker ──────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "Ab",
      value: "fajč",
      reason: "10 cigarettes/day from transcript",
      caseSensitive: false,
    },

    // ── RA ──────────────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "otec",
      reason: "Father had stroke — transcript",
      caseSensitive: false,
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Not in source",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "No diabetes in source",
    },
  ],
};
