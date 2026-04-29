/**
 * Fixture — two files from different dates with partially conflicting
 * information. Tests how the pipeline resolves conflicts.
 *
 * Scenario: Patient transferred from regional hospital (older report,
 * 3 days ago) to CINRE (today's admission). The old report has stale
 * vitals and an older medication list. The transcript from today has
 * updated vitals and a current medication update.
 *
 * Key testing purposes:
 *   1. Today's transcript vitals (TK 148/92) should appear, not the
 *      3-day-old file vitals (TK 165/95).
 *   2. Medication additions from transcript (Brilique added today)
 *      must appear alongside the file's chronic meds.
 *   3. Diagnoses from both sources should be merged correctly.
 *   4. More specific/recent clinical info takes precedence.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pán Krajčí. Zdravím. Tak vidím, že ste k nám boli preložený z Trnavy. Áno, tri dni som tam bol. Áno, čítam ich správu. Povedzte mi, ako to bolo. V pondelok ma začalo bolieť na hrudníku, taká tlakavá bolesť, vyžarovalo do ľavej ruky. Trvalo to asi pol hodiny, potom prešlo po Nitráte. V Trnave vás prijali na JIS-ku. Áno. A troponíny boli pozitívne. Áno, vraveli, že sú zvýšené. Dnes sa cítite ako? Lepšie, bez bolestí. Dýchavičnosť? Trochu pri chôdzi. Dobre. Lieky, čo vám dávali v Trnave. Anopyrin sto, Brilique deväťdesiat ráno večer, to mi pridali v Trnave. Predtým som bral Ramipril päť ráno, Bisoprolol päť ráno, Atoris štyriadsať večer. Ešte niečo? Inzulín, Lantus osemnásť jednotiek večer a Metformin tisíc ráno večer. Cukrovku máte ako dlho? Pätnásť rokov. Fajčíte? Nie, skončil som pred piatimi rokmi. Alkohol? Nie. V rodine? Brat mal infarkt v päťdesiatke. Žijete? S manželkou. Na dôchodku, bol som učiteľ. Alergiu? Na Jód, mal som reakciu pri CT. Operácie? Apendektómia a hernia. Dobre. Tlak dnes stoštyridsaťosem na deväťdesiatdva. Pulz sedemdesiatšesť. Popočúvam vás. Dýchanie čisté. Srdce pravidelné, bez šelestov. Nohy trochu opuchnuté.`;

const TRNAVA_REPORT = `Lekárska prepúšťacia správa — NsP Trnava, JIS
Dátum prijatia: 21.04.2026
Dátum prepustenia: 24.04.2026

Dg: I21.4 Akútny subendokardiálny infarkt myokardu
    I10 Artériová hypertenzia
    E11.6 DM 2.typu s inými špecifikovanými komplikáciami
    E78.0 Hypercholesterolémia

OA: ICHS - NSTEMI (21.04.2026). AH. DM 2. typu na inzulíne + PAD 15 rokov. Hypercholesterolémia. St.p. AE, st.p. inguinálnej herniotómii.

Obj. pri prepustení:
TK: 165/95 mmHg, SF: 82/min, SR
Výška: 175 cm, Hmotnosť: 88 kg, BMI: 28.7
Cor: akcia prav., ozvy ohr., bez šelestov.
Pľúca: vezikulárne dýchanie bilat., bez VDF.
DK: diskrétne edémy predkolení bilat.

EKG: SR, SF 82/min, ST depresie V4-V6.

ECHO: EF ĽK 45%, hypokinéza laterálnej steny. MiR I-II.st.

Lab: TnT 856 ng/l → 342 ng/l (klesajúca dynamika)

Terapia pri prepustení:
Anopyrin 100 mg 0-1-0
Brilique 90 mg 1-0-1
Ramipril 5 mg 1-0-0
Bisoprolol 5 mg 1-0-0
Atoris 40 mg 0-0-1
Lantus 18 j. 0-0-1
Metformin 1000 mg 1-0-1
Furosemid 40 mg 1-0-0

Odporúčanie: Preklad na CINRE BA za účelom koronarografie a prípadnej PCI.`;

const OLDER_AMBULANCE_NOTE = `Ambulantná kardiologická kontrola — MUDr. Pavlíková
Dátum: 15.03.2026

Dg: I10 Artériová hypertenzia
    E11.6 DM 2. typu
    E78.0 Hypercholesterolémia

Terapia:
Ramipril 5 mg 1-0-0
Bisoprolol 5 mg 1-0-0
Atoris 40 mg 0-0-1
Lantus 18 j. 0-0-1
Metformin 1000 mg 1-0-1

TK: 142/88 mmHg, SF: 74/min
EKG: SR, bez ST zmien.
ECHO: EF ĽK 58%, bez regionálnych porúch kinetiky.

Záver: Kompenzovaná AH. DM 2. typu stabilný. Pokračovať v terapii. Kontrola o 6 mesiacov.`;

export const conflictingSources: EvalFixture = {
  id: "conflicting-sources",
  description:
    "68M NSTEMI Trnava → CINRE, old ambulance note + discharge + today's transcript — resolve conflicts",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [
      { name: "trnava-prepustacia.txt", text: TRNAVA_REPORT },
      { name: "ambulantna-kontrola-march.txt", text: OLDER_AMBULANCE_NOTE },
    ],
  },
  expectations: [
    // ── ICD: NSTEMI is the primary acute dx ─────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I21.4",
      reason: "NSTEMI from Trnava report — primary acute diagnosis",
    },
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension from all sources",
    },

    // ── ICD: DM should appear ───────────────────────────────────────
    {
      kind: "icd-in-zaver",
      code: "E11",
      reason: "DM 2. typu from multiple sources — 15 years",
    },

    // ── LA: acute + chronic meds merged ─────────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Brilique",
      reason: "Brilique added in Trnava + confirmed in transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Anopyrin",
      reason: "Anopyrin from Trnava therapy",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Ramipril",
      reason: "Ramipril 5 mg — chronic + confirmed",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Lantus",
      reason: "Insulin Lantus 18 j. from all sources",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Metformin",
      reason: "Metformin 1000 mg from all sources",
      caseSensitive: false,
    },

    // ── OA: merged comorbidities ────────────────────────────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "NSTEMI",
      reason: "Acute NSTEMI from Trnava report",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "diabet",
      reason: "DM 2. typu — 15 years from transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Hypertension from all sources",
      caseSensitive: false,
    },

    // ── AA: iodine allergy from transcript ──────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "Jód",
      reason: "Iodine allergy with CT reaction — transcript",
      caseSensitive: false,
    },

    // ── RA: brother's MI ────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "brat",
      reason: "Brother had MI at 50 — transcript",
      caseSensitive: false,
    },

    // ── Ab: ex-smoker ───────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "Ab",
      value: "fajč",
      reason: "Ex-smoker (quit 5 years ago) from transcript",
      caseSensitive: false,
    },

    // ── ECHO values from Trnava (most recent) ──────────────────────
    {
      kind: "contains",
      value: "45",
      reason: "EF 45% from Trnava ECHO (more recent than March 58%)",
    },

    // ── Invention guards ────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Not in any source",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48",
      reason: "No AF in any source — SR everywhere",
    },
  ],
};
