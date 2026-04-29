/**
 * Synthetic fixture — patient with specific brand-name medications in both
 * transcript and file. Tests that the drug normalizer preserves original
 * brand names from the source rather than genericizing them.
 *
 * Key testing purposes:
 *   1. Brand names from source must be preserved exactly (Concor, not
 *      "bisoprolol"; Torvacard, not "atorvastatin").
 *   2. Drug normalizer must not "correct" a valid brand to a different
 *      brand of the same active ingredient.
 *   3. Doses and frequencies from source must survive intact.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pani Kováčová. Ďakujem. Tak povedzte, čo vás priviedlo. No, prišla som na kontrolu, dostala som pozvánku. Ste naša dlhoročná pacientka, pozerám. Áno. Lieky beriete pravidelne? Áno, všetko beriem tak, ako ste napísali. Pripomeniem, Concor päť miligramov ráno, potom Torvacard dvadsať miligramov večer, Prestarium päť miligramov ráno a Xarelto dvadsať miligramov s jedlom. Áno, všetko beriem. A ten Novalgin keď bolí chrbtica? Novalgin beriem podľa potreby, asi dvakrát do týždňa. Dobre. Tlak doma aký máte? Tak stotridsať na osemdesiat väčšinou. Pulz? Okolo šesťdesiat. Nejaké nové ťažkosti? Nie, cítim sa dobre. Dýchavičnosť? Nie. Bolesti na hrudníku? Nie. Závraty? Nie. Dobre. Fajčíte? Nie. Alkohol? Nie. V rodine infarkt? Mama mala infarkt v sedemdesiatpäťke. Žijete? S dcérou. Pracujete? Nie, som na dôchodku, bola som predavačka. Alergiu? Na Penicilin, mala som vyrážku. Operácie? Žlčník pred desiatimi rokmi. Dobre, popočúvam. Dýchanie čisté, srdce pravidelné. Nohy neotekajú? Nie.`;

const AMBULANCE_CARD = `Ambulantná karta - kontrola kardiológ
Dátum: 15.04.2026

Dg: I10 Artériová hypertenzia
    I48.0 Paroxyzmálna fibrilácia predsiení
    E78.0 Hypercholesterolémia

Terapia:
Concor 5 mg 1-0-0
Prestarium 5 mg 1-0-0
Torvacard 20 mg 0-0-1
Xarelto 20 mg 1-0-0 (s jedlom)
Novalgin 500 mg p.p.

TK: 132/78 mmHg, SF: 62/min, SR
Obj: cor akcia prav., ozvy ohr., bez šel.
Pľúca vezikulárne dýchanie bilat., bez VDF.
DK bez edémov.`;

export const brandNamePreservation: EvalFixture = {
  id: "brand-name-preservation",
  description:
    "68F routine cardiology check — brand names (Concor, Torvacard, Xarelto) must be preserved",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [{ name: "ambulantna-karta.txt", text: AMBULANCE_CARD }],
  },
  expectations: [
    // ── LA: exact brand names from source ───────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Concor",
      reason: "Concor (bisoprolol) — brand name in both transcript and file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Torvacard",
      reason:
        "Torvacard (atorvastatin) — brand name in both transcript and file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Xarelto",
      reason: "Xarelto (rivaroxaban) — brand name in both transcript and file",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Prestarium",
      reason: "Prestarium (perindopril) — brand name in source",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Novalgin",
      reason: "Novalgin (metamizol) — brand name in transcript",
    },

    // ── LA: must NOT genericize ─────────────────────────────────────
    {
      kind: "section-not-contains",
      section: "LA",
      value: "bisoprolol",
      reason: "Source says 'Concor' — must not be genericized to 'bisoprolol'",
      caseSensitive: false,
    },
    {
      kind: "section-not-contains",
      section: "LA",
      value: "rivaroxaban",
      reason:
        "Source says 'Xarelto' — must not be genericized to 'rivaroxaban'",
      caseSensitive: false,
    },

    // ── ICD codes from file diagnoses ───────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension explicitly diagnosed in file",
    },
    {
      kind: "icd-in-zaver",
      code: "I48.0",
      reason: "Paroxysmal AF explicitly diagnosed in file",
    },

    // ── OA: diagnoses from file ─────────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Arterial hypertension from file and transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "fibrilácia",
      reason: "Paroxysmal AF from ambulance card",
      caseSensitive: false,
    },

    // ── AA: Penicillin allergy from transcript ──────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "Penicil",
      reason: "Penicillin allergy with rash — transcript",
      caseSensitive: false,
    },

    // ── RA: mother's MI ─────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "matka",
      reason: "Mother had MI at 75 — transcript",
      caseSensitive: false,
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Patient is on Xarelto, not Warfarin — common substitution",
    },
    {
      kind: "not-contains",
      value: "Metformin",
      reason: "No diabetes — no Metformin",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "No diabetes in source",
    },
  ],
};
