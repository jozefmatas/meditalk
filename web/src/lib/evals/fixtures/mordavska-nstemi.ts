/**
 * Mordavská — 82 y.o. F, subacute NSTEMI transferred from Malacky to
 * CINRE 21.04.2026 for invasive cardiology dg/th.
 *
 * Source: full Malacky discharge letter (supportive doc) + CINRE
 * admission interview transcript. Gold note is the cardiologist's
 * hand-written admission sheet.
 *
 * Assertions are derived from the doctor's corrected note — each is
 * demonstrably in the raw source AND in the gold note. Invention
 * guards cover known failure modes (phantom drugs, phantom diagnoses).
 *
 * The Malacky discharge letter carries most chronic-comorbidity content;
 * the transcript adds today's admission narrative + EA (shingles 2
 * weeks prior) + family history.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň pani , zdravím vás. No, ako sa máte? Tak vcelku dobre, len režím už štvrtý deň. Takže- Ja som sa dočítal, že od sedemnásteho do dvadsiateho prvého, vlastne až dodneska ku dňu prekladu ste boli hospitalizovaná v Malckách- Áno, áno. -a oni tam písali také ťažkosti, že sa vám hlavne začalo horšie dýchať. Áno. A potom, že aj bolesti boli na hrudníku. Áno, áno. Povedzte niečo k tomu, aké to bolo. No poviem vám, že zrazu tu mi tak-taká tupá bolesť bola a nedalo mi nadýchnuť. Tu v strede hrudníka tupá bolesť a nedalo sa nadýchnuť. To bolo toho sedemnásteho? Áno. Hej, hej. A tak ste išli rovno do nemocnice. No vidíte, ja som už predtým asi tri dni bola u mojej obvoďačky- Áno. -a tam každý deň na krv brala. Potom ma doktorka Elišerová srciake na- Na echo? -na echo. Áno, no a ona vravela, že nezdá sa jej nejako, ale potom ráno znova v piatok ma zobrala na krv a zrazu desať minút pred dvanástou, že aby som bola hore v nemocnici, že ma prijmú, lebo že treba to ešte vyšetriť. No ale oni si ma tam hneď nechali. Áno, potom urobili nejaké odbery krvi a- Áno, áno. -posúdili, že bude najlepšie, keď vás aj my vyšetríme. Hej, hej. My vyšetrujeme, volá sa to selektívna koronarografia. Robíme to cez pravú túto radiálnu tepnu, čiže tuto v lokálnej anestéze. Áno. Tam zavedieme drôtik až k srdiečku. Hej. Tam dáme kontrastnú látku a na röntgene uvidíme, či niektorá z tých ciev- Áno, áno. -ktoré vyživujú srdcový sval nie je upchatá. Hej, hej. Či ťažkosti nie sú z toho. Áno. Ak áno, tak teoreticky ste mohli aj menší infarkt prekonať alebo také predštádium infarktu. Áno. Uvidíme. No na to ste u nás. Áno. Chcem sa spýtať, vy máte nejaké choroby, ktoré, ktoré sa liečite alebo nejaké vážne operácie? Niečo? Nie. Kedysi prsúch a slepé črevo, to sú všetky moje. A nejaké diagnózy, ja neviem vysoký tlak alebo? Tak dáva mi Prestarium pani doktorka. Mám ten tlak zvýšený, ale ja žijem s jednou obličkou, ale tá oblička je nefunkčná jedna skrátka. A prečo vám tú jednu brali? Nie, nie, mne nebrali, to ja vraj tam mám od narodenia. Či od narodenia je funkčná iba jedna. Rozumiem. Áno, presne tak. Hej. Čiže tam si musíme dávať trošku aj pozor s-s kontrastnou látkou u vás, lebo tá zaťažuje obličky. Áno. Dobre. A v rodine otec, mamina, najbližší vaši príbuzní. Mozgová príhoda, infarkt, cukrovka, nejaké náhle úmrtia. Ocinko, ocinko mal mozgovú príhodu. Áno. Zomrel. On bol silný fajčiar od pätnástich a maminka mala problémy so srdiečkom už potom v neskoršom veku, dožila sa osemdesiat sedem. Cukrovku nemal nikto? Nemal. No otec takú stareckú vlastne už potom viem, že áno. Dobre. Vy ste fajčiar či nefajčiar? Nie. Nikdy ste nefajčili? Nie. Alkohol? Tak príležitostne. Dobre. Žijete doma sama? Sama. Hej. Pozerám, že dôchodkyňa. A čo ste učili, že učiteľka ste boli? No slovenči, slovenský jazyk a nemecký jazyk. Slovenský jazyk, nemecký. V Malckách? Áno. Tak tam na nejakom gymnáziu? No aj na základke, aj na gymnáziu. Aj na gymnáziu. Áno, potom už ako dôchodkyňa ešte aj v Stúpave pár rokov. Však ja som do sedemdesiatosem rokov robila. Jáj. Mám osemdesiat dva. Máte už čo-to odrobené teda. No hej. Dobre. A okrem toho Prestaria nejaké iné lieky? No viete čo ešte od ortopéda, keď mi pichne ten Suplasin raz za pol roka. A to máte čo vás bolia kolená alebo? Koleno ľavé. No už ho mám opotrebované. Alergiu na niečo? Myslím, že nie. Chorá ste teraz neboli posledný týždeň, no. No mala som, mala som pásový opar. Kedy? Počkajte, dva týždne dozadu. Dva týždne dozadu. A koľko to trvalo? Ešte, ešte, ešte sú tam znaky tu, tuto na stehne. Vidíte to? Či keď navihnete gatky. Áno. Hej. A tam mi pani doktorka nejaký liek predpisovala. Nepamätám si, čo to je. A to pomohlo, hej? No tak asi áno. A to bolo pred dvoma týždňami. Áno, áno. A dva týždne už to beriete ako keby vyliečené. To, hej, po siedmich dňoch som s tým prestala, lebo však to bolo na sedem dní. Áno. Áno, lebo ja som si myslela, že či to nie je dôsledok toho pásového oparu. Viete, že- Niekedy on môže vyprovokovať také, že aj zápal srdca. Áno, hej. Podobné ťažkosti. Uvidíme. Áno, áno. Však toto vyšetrenie nám povie minimálne to, že či to je- Áno, áno. -infarktového typu alebo nie. A keď nie, tak potom budeme uvažovať ďalej. Jedna z možností by bola aj táto. Hej. Dobre, sadkajte na chvíľku, popočúvam si vás. Už ste v minulosti mali pásový opar niekedy? Raz na chrbáte, ale to som len tak asi sedem bodiek mala. Dobre a ešte otázka. Hovoríte o tom pichaní, ale oni tam píšu aj, že sa vám horšie dýchalo. Aj sa vám horšie dýchalo? Áno, áno. Ale už teraz sa dýcha dobre. No takto, však nič nerobím, ale poviem vám, že- Že pri námahe sa zadýchate. Áno. Dobre. A tie ťažkosti v zmysle to dýchanie to prešlo potom v nemocnici. Áno, áno. Dobre. Trošku výš nohy. Ja som vlastne s tým ťažko- Kľudne zhlboka dýchať. Dobre, teraz kľudne dýchať, potíčkučky, dýchanie čisté. Dobre, ešte mačky, ešte. Neopuchajú nohy? Nie. Tak do nejakej hodinky si vás zoberieme dole na sálu a tam kolega intervenčný kardiológ to vyšetrí, to, čo sme sa dohodli, a potom si povieme čo ďalej. Dobre. Ďakujem zatiaľ. Ďakujem aj ja.`;

const DISCHARGE_LETTER = `# Lekárska prepúšťacia správa
aktivita v bigeminickej väzbe RBBB ... EKG: ASP, RS, SF 70/min., LPHB, polymorfné KES, parc. v bigeminickej väzbe
## Posledná zmena: 17.04.2026 13:07 - Cigánková Gabriela MUDr.
Pľúcny parenchým bez čerstvých ložiskových a infiltratívnych zmien. Cievna kresba primeraná. Hilové tiene nezväčšené. Bránica hladká, klenutá. Uhly voľné.Tieň srdca primeranej veľkosti a tvaru. AS zmeny oblúka Ao. Hor. mediastinum nerozšírené.
## Posledná zmena: 17.04.2026 14:34 - Cigánková Gabriela MUDr.
Truncus pulmonalis a arteriae pulmonales nedilatované, postkontrastne homogénne opacifikované, lumen hodnotiteľných vetví arteriae pulmonales bez výpadku v kontrastnej náplni svedčiacej pre embolizáciu. Aorta nedilat.Srdce je primeranej veľkosti a tvaru, perikard bez známok výpotku.Mediastinum bez patologickej kolekcie, bez mediastinálnej LAP.Pľúcne híly nezväčšené, bez hilárnej LAP. Pľúcny parenchým je primeranej transparencie, bez jednoznačných ložiskových zmien. Obojstranne bez fluidothoraxu.
Záver: Bez embolizácie do aa. pulmonales.
Bez patol. zmien pľ. parenchýmu.
## ECHO KG 16.4.2026 predhospitalizačne MUDr. Elischerová - priložené
Operácie:
DRG výkony:
39000.0 - Počítačová analýza obrazu s 3D hodnotením 1x
33010.x - CT kontrastné, ostatné 1x
Liečba:
Medikácia
Anopyrin 100 mg, Arixtra 2,5 mg/0,5 ml injekčný roztok, naplnená injekčná striekačka, Atoridor 80 mg, Egilok 25 mg, PRESTARIUM A 5 mg, Trombex 75 mg filmom obalené tablety
Epikríza:
82 ročná pacientka s nekomplikovanou hypertenziou prijatá na JIS s podozrením na možný subakutny nonSTE AKS s progresívnym SZpEF (dľa ECHO KG predhospitalizačne). Zaliečená v zmysle aktuálne platných guidelines. Kontinálne monitorovaná s takmer kontinuálnou komorovou monomorfnou extrasystolickou aktivitou v bigeminickej/trigeminickej väzbe s pretrvávajúcou pozitivitou srdcových troponínov. CT AG vylúčená embolizácia do AP ako príčina progresie dušnosti a pozitivity srdcových markerov. Oslovené kardiocentrum CINRE a po dohovore s MUDr. Kostelným pacientka 21.4.2026 preložená na vyššie uvedené pracovisko za účelom kardioinvazívnej diagnostiky a liečby.
Diagnostický záver:
Non STE AKS (subakutny v.s.)
KES LOWN 3b s frekventnou bigeminickou monomorfnou aktivitou
SZpEF novodiagnostikované B št. ESC
Arteriová hypertenzia
Nadváha
Hyperglykémia nalačno
CKD- chr. TIN (chr. kardiorenalny sy ?) G3a
Divertikulóza sigmy
Stp. GERD
Tlač: 21.04.2026 07:34 Strana: 3 / 4
---
# Lekárska prepúšťacia správa
Pacient: MORDAVSKÁ Eva Mgr., Malé Nám 26, 901 01 Malacky, RČ.: 445412702, ZP: 2400
Stp. AE
Stp. pravostrannej inguinálnej herniotómii
I5013 (Z) - Zlyhávanie ľavej komory, s ťažkosťami pri malom zaťažení
Odporúčania:
Naša posledná terapia :
* Arixtra 2.5 mg sc a 24h. (15:00)
* Egilok 25mg 1/2-0-1/2, PrestariumA5mg 1/2-0-1/2, ANP 100 mg 0-1-0, Trombex 75mg 1-0-0, Atoris 80 mg 1-0-0

Hmotnosť: 75 kg Výška: 164 cm BMI: 27,9
echokg: LVEDD 52 LVESD 39 dobrá systolická f. ĽK bez regionálnych porúch kinetiky, EF 60%
porucha diastolickej f. I. typ..LAVI 25 ml/m2..E/A 0,47..E 51 cm/s..ésept/lat. 5..7
cm/s..E/é 8,2..LVMI 113 g/m2
IVS 12 septum sigmoideum, LP 43, PK 30, asc. Ao. 38, AP 23
AoCH je trojcípa, prolaps p.c. MiCH hrúbka 2,5 mm MiR I.st. TiR I.st. TR Vmax 2.43 m/s
TR maxPG 34 mmHg
PVpeakV 0,82 m/s PVAccT 133 msec.
perikard bpn.
Záver: dobrá systolická f. ĽK EF 60%
porucha diastolickej f. I. typ
LAVI v norme
prolaps p.c. MiCH, MiR I.st.
bez pľúcnej hypertenzie
Dg: R060 TO: 14.04.2026 Výkony: 5A21030;`;

export const mordavskaNstemi: EvalFixture = {
  id: "mordavska-nstemi",
  description:
    "82F subacute NSTEMI transferred Malacky → CINRE, prior shingles",
  templateId: "t_KZPRXwjQye",
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [{ name: "malacky-discharge-letter.txt", text: DISCHARGE_LETTER }],
  },
  expectations: [
    // ── RA: family history from transcript ─────────────────────────────
    {
      kind: "section-contains",
      section: "RA",
      value: "otec",
      reason: "Father mentioned in transcript (stroke, heavy smoker)",
    },
    {
      kind: "section-contains",
      section: "RA",
      value: "matka",
      reason: "Mother mentioned in transcript (cardiac issues, lived to 87)",
      caseSensitive: false,
    },

    // ── OA: chronic comorbidities from discharge letter ──────────────
    {
      kind: "section-contains",
      section: "OA",
      value: "hypertenzia",
      reason: "Arterial hypertension documented",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "oblička",
      reason: "Afunkčná ľavá oblička is a critical comorbidity (CIN risk)",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "divertikulóza",
      reason: "Divertikulóza sigmy in discharge letter",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "GERD",
      reason: "Stp. GERD in discharge letter",
    },
    {
      kind: "section-contains",
      section: "OA",
      value: "herni",
      reason: "Stp. pravostr. ingvin. herniotómii — must preserve",
      caseSensitive: false,
    },

    // ── SA + PA + EA: transcript-sourced ─────────────────────────────
    {
      kind: "section-contains",
      section: "SA",
      value: "sama",
      reason: "Patient stated 'sama' (lives alone)",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "EA",
      value: "opar",
      reason: "Shingles 2 weeks ago — transcript-only, critical EA item",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "PA",
      value: "učiteľka",
      reason: "Teacher — mentioned in transcript",
      caseSensitive: false,
    },

    // ── AA: patient denied ───────────────────────────────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "negu",
      reason: "Patient explicitly denied allergies — must preserve negation",
      caseSensitive: false,
    },

    // ── LA: medication list from discharge letter ─────────────────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Arixtra",
      reason: "Arixtra 2.5 mg s.c. á 24h in discharge letter",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Egilok",
      reason: "Egilok 25 mg 1/2-0-1/2 in discharge letter",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Prestarium",
      reason: "Prestarium A 5 mg in discharge letter AND transcript",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Trombex",
      reason: "Trombex 75 mg in discharge letter",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Atori",
      reason: "Atoridor 80 mg / Atoris 80 mg in discharge letter",
      caseSensitive: false,
    },

    // ── Ab: lifestyle from transcript ────────────────────────────────
    {
      kind: "section-contains",
      section: "Ab",
      value: "nefajč",
      reason: "Non-smoker per transcript",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "Ab",
      value: "príležitostne",
      reason: "Alcohol only occasionally per transcript",
      caseSensitive: false,
    },

    // ── TO: admission narrative ──────────────────────────────────────
    {
      // Transcript has the typo "Malckách" (missing first 'a'); either
      // spelling is fine, both start with "Malc".
      kind: "section-contains",
      section: "TO",
      value: "Malc",
      reason: "Malacky prior hospitalization — transfer context",
      caseSensitive: false,
    },
    {
      kind: "section-contains",
      section: "TO",
      value: "bolest",
      reason: "Chest pain narrative must be present",
      caseSensitive: false,
    },

    // ── Objektívne: Výška / Hmotnosť from discharge letter ───────────
    {
      kind: "contains",
      value: "164",
      reason:
        "Výška 164 cm in discharge letter — must surface, not invented differently",
    },
    {
      kind: "contains",
      value: "75",
      reason: "Hmotnosť 75 kg in discharge letter — must surface",
    },

    // ── Invention guards ─────────────────────────────────────────────
    {
      kind: "not-contains",
      value: "Warfarin",
      reason:
        "Warfarin is not in the source — common anticoagulant hallucination",
    },
    {
      kind: "not-contains",
      value: "Metformin",
      reason: "No diabetes; Metformin is a cardiology anchor-bias risk",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "Type 2 diabetes is not in the source — must never appear",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E10",
      reason: "Type 1 diabetes is not in the source — must never appear",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48.0",
      reason:
        "No atrial fibrillation in this patient — paroxysmal AF phantom guard",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48.1",
      reason: "No atrial fibrillation — persistent AF phantom guard",
    },

    // ── Záver ICD codes supportable by source ────────────────────────
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason:
        "Arterial hypertension I10 from 'nekomplikovaná hypertenzia' + Prestarium",
    },
  ],
};
