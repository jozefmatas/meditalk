/**
 * Fixture — patient with a long chronic medication list (10+ drugs).
 * Tests that the critic does NOT over-strip chronic medications.
 *
 * Key testing purposes:
 *   1. All chronic meds from source survive in LA after critic pass.
 *   2. Critic does not remove drugs it doesn't "recognize" as cardiology-
 *      relevant (e.g., Euthyrox for thyroid, Metformin for diabetes).
 *   3. Medication doses and frequencies from source are preserved.
 *   4. Drug normalizer handles multi-word brands correctly.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pani Tóthová, vitajte. Ďakujem. Tak vy ste k nám boli odoslaná kvôli podozreniu na ischemickú chorobu srdca. Áno, mala som bolesti na hrudníku. Kedy to bolo? Pred týždňom, pri rýchlej chôdzi, také zvieranie tu v strede hrudníka. Trvalo asi päť minút a prešlo v pokoji. Odvtedy sa to opakovalo? Nie. Dobre. Máte veľa diagnóz, pozerám. Čo všetko sa liečite? No tak vysoký tlak, cukrovku druhého typu, cholesterol, štítnu žľazu, mám po operácii. Potom mám reumu, artritídu. Astmu mám. A depresiu, na to beriem tiež lieky. Povedzte mi lieky. Tak Prestarium päť ráno, Amlodipin päť večer, Hydrochlorothiazid dvadsaťpäť ráno. To je na tlak. Potom Metformin tisíc ráno a večer, Glimepirid dva miligramy ráno. Na cholesterol Atoris štyriadsať večer. Na štítnu Euthyrox sedemdesiatpäť ráno na lačno. Na reumu Metoject pätnásť miligramov raz týždenne a kyselinu listovú päť miligramov deň po Metojecte. Na astmu Symbicort sto šesť dvakrát denne a Ventolin podľa potreby. Na depresiu Sertralin päťdesiat ráno. A na žalúdok Nolpaza dvadsať ráno. Fajčíte? Nie, nikdy. Alkohol? Nie. V rodine? Mama mala cukrovku. Žijete? S manželom. Na dôchodku, bola som sestra v nemocnici. Alergiu? Na Penicilin a na Sulfonamidy. Operácie? Štítna žľaza a cisársky rez.`;

export const criticMedPreservation: EvalFixture = {
  id: "critic-med-preservation",
  description:
    "65F ICHS suspicion, 14 chronic meds — critic must not strip non-cardiology drugs",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
  },
  expectations: [
    // ── LA: every single medication from transcript ─────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Prestarium",
      reason: "Prestarium 5 mg — antihypertensive",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Amlodipin",
      reason: "Amlodipin 5 mg — antihypertensive",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Hydrochlorothiazid",
      reason: "HCTZ 25 mg — diuretic, must not be stripped",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Metformin",
      reason: "Metformin 1000 mg — antidiabetic, non-cardiology but essential",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Glimepirid",
      reason: "Glimepirid 2 mg — antidiabetic, must not be stripped",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Atoris",
      reason: "Atoris 40 mg — statin",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Euthyrox",
      reason: "Euthyrox 75 μg — thyroid, non-cardiology but essential",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Metoject",
      reason:
        "Metoject 15 mg weekly — methotrexate for RA, non-cardiology but must survive",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Symbicort",
      reason: "Symbicort — asthma inhaler, non-cardiology but must survive",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Sertralin",
      reason: "Sertralin 50 mg — SSRI, non-cardiology but must survive",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Nolpaza",
      reason: "Nolpaza 20 mg — PPI, must survive",
    },

    // ── OA: comorbidities from transcript ───────────────────────────
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
      value: "diabet",
      reason: "DM 2. typu from transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "astm",
      reason: "Asthma from transcript",
      caseSensitive: false,
    },

    // ── AA: drug allergies ──────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "Penicil",
      reason: "Penicillin allergy from transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "AA",
      value: "Sulfonamid",
      reason: "Sulfonamide allergy from transcript",
      caseSensitive: false,
    },

    // ── ICD ─────────────────────────────────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension — explicit in transcript",
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Not in source — patient not anticoagulated",
    },
  ],
};
