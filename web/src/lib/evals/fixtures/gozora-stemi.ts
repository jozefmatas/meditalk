/**
 * Gozora — M, long-term smoker + hypertonic, transferred by ZZS to
 * CINRE mid-procedure for primary PCI on a high-lateral STEMI.
 *
 * Source: CINRE cardiologist's admission dictation (transcript) + ZZS
 * on-scene report (structured form with vitals table + administered
 * drugs + EKG reading).
 *
 * Key testing purposes:
 *   1. Transcript-voiced clinical assessment ("na EKG to vyzerá na
 *      stemy laterálnej steny ľavej komory") MUST anchor the primary
 *      dx to I21.2 (lateral), NOT I21.0 (anterior).
 *   2. LA section must include BOTH home meds (Tamurox, Co-Prenessa)
 *      AND ambulance-administered drugs (Anopyrin 200 mg p.o. 14:13,
 *      Brilique 180 mg p.o. 14:13, Heparin 8000 UI i.v. 14:17,
 *      Sufentanil 5 μg i.v. 14:39).
 *   3. TO must be a concise narrative — no raw vitals tables, no EKG
 *      readings, no administered-drug times (those live in Krvný tlak /
 *      EKG / LA sections).
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Práve idem k centrálnemu príjmu v nemocnici. Konzultovali nás o jednej, respektíve o štvrť na tri a posádkou záchrannej služby. O jednej pacient začal mať ťažkosti v zmysle stenokardii. Už predtým pozvolna nejaké intermitentné pobolievanie od rána a na EKG to vyzerá na stemy laterálnej steny ľavej komory. Pacient hypertonik, fajčiar. Predtým, ako išiel na prevoz, bol stabilizovaný. Práve prišla sanitka, pacienta idem prebrať.
Dobrý deň. Či pôjdeme rovno na sálu, pán Solak Gozora, hej? Áno. Všetko čo, čo sme hovorili. Ešte spýtam na tie ťažkosti. Prvýkrát, pán Gozora, v živote takéto ťažkosti? Áno, prvýkrát. Prvýkrát. Tuto pôjdeme, tak toto, toto, toto. Od rána teda pobolievania, potom od jednej ty-také typické bolesti, tvrdé, vyžarovanie. Ááá, takých vlád som nemal. A kam, do ruky to išlo? Prvé vlaky tu na prsia. Na prsia. Potom naposledy aj tady do ľavej ruky. Takže ste fajčiar. Koľko fajčíte? Pätnásť. Dlho to bolo asi, že? Dlho to bolo. Alkohol? Alkohol. Pri príležitosti. Dobre, nejaká choroba teraz v poslednej dobe, nejaký infarkt alebo posledný týždeň alebo? No mal som jako v auguste minulý rok úraz na rebrá. Úraz na rebrá. Všetko dobre. Mal som zlomenej dve rebrá. Nejaká diagnóza okrem hypertenzie, nejaká závažná alebo operácia? Nie. Pôjdeme, hej? Nič také. Dobre. Doma žijete s manželkou? Áno. Pracujete ako, pozriem, bezpečnostná služba? Áno. V rodine otec, mama, najbližší vaši príbuzní. Nikto niečo zasahoval s srdcom? Infarkt, mozgová príhoda, cukrovka? Otec zomrel v šesťdesiatom ôsmom. Infarkt mozgovú mŕtvicu. Mozgovú. No, ale- Pravá? To ľavú, túto ľavú. Alergiu nemáte na nič? Nemám. Hlavou pôjdeme dolu, dobre? Ešte stále bolí? Ešte stále bolí? Nebolí, je v samý uhlí. Už celú hodinu. Dostal Sufentu. Sufentu. Takže áno, Feri, veľmi rýchle, tých osemtisíc, čo sme sa dohodli. Áno, áno. Výborne. Ja si ho ešte vypočúvam.`;

const ZZS_REPORT = `*Anamnéza (OA, LA, AA, TO/E):** OA: Pacient sa lieči na hypertenziu,fajčiar., **LA:** Tamurox, Co-prenessa, **AA:** sine, **TO:** Pacient(ka) sa pri príchode posádky ZZS nachádza v dome, sedí na stoličke, pri plnom jasnom vedomí, orientovaný(á), komunikuje, spolupracuje, pacient(ka) udáva, že od rana nepríjemný pocit na hrudi, od 13:00 tlaková bolesť na hrudi s vyžarovaním do ĽHK, inak dýcha sa mu dobre, vedomie nestracal, nevracal. 14:15 konzult. CINRE BA MUDr Michalek s odporúčaním transportu na ich pracovisko.

| VF | 14:02 | 14:31 | 14:58 | 15:12 |
|---|---|---|---|---|
| TK Torr | 150/80 | 145/80 | 145/80 | 143/80 |
| SF min | 68 | 67 | 68 | 78 |
| DF min | 16 | 16 | 16 | 16 |
| O₂SAT % | 92 | 98 | 98 | 98 |
| Glykémia mmol/l | 11.1 | | | |
| TT °C | 36.4 | | | |
| GCS | 15 | 15 | 15 | 15 |
| Bolesť | 5/10 | 7/10 | 5/10 | 5/10 |

A: Priechodné, Aspirácia neprítomná, Obštrukcia neprítomná.
B: Eupnoe, Auskultačný nález fyziologický vpravo; fyziologický vľavo. Výkony: Inhal. O₂ 2 l/min.
EKG 12-zvodové, SR SF 68/min., ST elev. aVL, I, depr. ST III, aVF, V1
C: Centr. pulz pravidelný, plný. Perif. pulz pravidelný, plný. Farba pokožky ružová. Kapilárny návrat pod 2 sekundy. Auskultačný nález srdca: akcia pravidelná, ozvy ohraničené.
Trauma: Sine.
D: Veľkosť zreníc P:2 Ľ:2, fotoreakcia prítomná, plávajúce bulby prítomné, okulocefalický reflex prítomný, korneálny reflex prítomný. Neurologický nález v norme.
Odovzdaný/kde: CINRE BA.

| Terapia: | | Čas | Diagnóza: |
|---|---|---|---|
| ANOPYRIN 100 mg | 200.0 mg - P.OS | 14:13 | I21.9 - Akú |
| Brilique 90 mg filmom obalené tablety | 180.0 mg - P.OS | 14:13 | |
| Chlorid sodný B. Braun 0,9 % infúzny roztok | 10.0 ml - I.V. | 14:10 | |
| HEPARIN LÉČIVA | 8000.0 UI - I.V. | 14:17 | |
| Sufentanil Chiesi 5 μg/ml | 5.0 μg - I.V. | 14:39 | |`;

export const gozoraStemi: EvalFixture = {
  id: "gozora-stemi",
  description:
    "M STEMI laterálnej steny, ZZS transport to CINRE for primary PCI",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [{ name: "zzs-report.txt", text: ZZS_REPORT }],
  },
  expectations: [
    // ── Primary dx: LATERAL STEMI per clinician's spoken assessment ──
    {
      kind: "icd-in-zaver",
      code: "I21.2",
      reason:
        "Clinician said 'stemy laterálnej steny ľavej komory' + EKG ST elev aVL, I → I21.2 (lateral)",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I21.0",
      reason:
        "ANTERIOR STEMI code must NOT appear — anatomy contradicts clinician's 'laterálnej steny' call and EKG (aVL/I are lateral leads)",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I21.4",
      reason:
        "NSTEMI code must NOT appear — EKG shows ST elevation (STEMI, not NSTEMI)",
    },

    // ── Hypertension from transcript + ZZS report ────────────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Patient is hypertonik (transcript + ZZS OA)",
    },

    // ── Tobacco use disorder — 15 cig/day long-term ──────────────────
    {
      kind: "icd-in-zaver",
      code: "F17.2",
      reason: "Long-term smoker 15 cigarettes/day (transcript) — F17.2",
    },

    // ── Invention guards ─────────────────────────────────────────────
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason:
        "Glycemia 11.1 is a lab finding, not a diagnosis — must not become E11 (T2DM)",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E10",
      reason: "No diabetes — T1DM phantom guard",
    },
    {
      kind: "not-contains",
      value: "Warfarin",
      reason: "Warfarin is not in the source — common hallucination",
    },

    // ── OA from transcript + ZZS ──────────────────────────────────────
    {
      // Model uses the Slovak medical abbreviation "AH" (arteriálna
      // hypertenzia); either "AH" or "hypertenz…" is acceptable.
      kind: "section-contains",
      section: "OA",
      value: "AH",
      reason: "Hypertension (as 'AH' abbreviation or spelled out) documented",
      caseSensitive: true,
    },

    // ── RA: father died of stroke ────────────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "otec",
      reason: "Father's death (stroke, 1968) per transcript",
      caseSensitive: false,
    },

    // ── SA + PA ─────────────────────────────────────────────────────
    {
      kind: "section-contains",
      section: "SA",
      value: "manžel",
      reason: "Lives with wife per transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "PA",
      value: "bezpečn",
      reason: "Security service job per transcript",
      caseSensitive: false,
    },

    // ── AA: patient denies ───────────────────────────────────────────
    {
      // Model may phrase the denial as "sine", "neguje", "nemá",
      // "bez alergií" — any negation of allergies is acceptable.
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "Patient denies allergies (transcript + ZZS 'AA: sine')",
      caseSensitive: false,
    },

    // ── Ab: smoking + occasional alcohol ─────────────────────────────
    {
      kind: "section-contains",
      section: "Ab",
      value: "fajč",
      reason: "Smoker — 15 cig/day, long-term",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "Ab",
      value: "príležitost",
      reason: "Alcohol 'pri príležitosti' per transcript",
      caseSensitive: false,
    },

    // ── LA: chronic home meds ────────────────────────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Tamurox",
      reason: "Home med Tamurox from ZZS",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Co-Prenessa",
      reason: "Home med Co-Prenessa from ZZS",
      caseSensitive: false,
    },

    // ── LA: acute-administered drugs (after LA contract expansion) ──
    {
      kind: "section-contains",
      section: "LA",
      value: "Anopyrin",
      reason: "Anopyrin 200 mg p.o. 14:13 administered on-scene",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Brilique",
      reason: "Brilique 180 mg p.o. 14:13 administered on-scene",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Heparin",
      reason: "Heparin 8000 UI i.v. 14:17 administered on-scene",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Sufentanil",
      reason: "Sufentanil 5 μg i.v. 14:39 administered on-scene",
      caseSensitive: false,
    },

    // ── TO: concise narrative — must include admission reason ───────
    {
      kind: "section-contains",
      section: "TO",
      value: "hrud",
      reason: "Chest pain narrative in TO",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "TO",
      value: "CINRE",
      reason: "Transfer to CINRE must be mentioned in TO",
      caseSensitive: false,
    },

    // ── EKG section: readings belong here, NOT in TO ─────────────────
    {
      kind: "section-contains",
      section: "EKG",
      value: "ST",
      reason: "EKG section should capture ST findings from ZZS reading",
      caseSensitive: false,
    },
  ],
};
