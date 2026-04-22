/**
 * Kovačiková — 82 y.o. F presenting with atypical chest pain, elevated
 * troponin, known paroxysmal AF on Eliquis. Source is a transcript +
 * CPO ambulance OCR from Ružinov hospital, 14.04.2026.
 *
 * This is our canonical eval fixture — every prompt change, every
 * model swap, every retrieval experiment runs against these
 * assertions before being declared a win.
 *
 * Assertions are chosen for ZERO AMBIGUITY — each one is either
 * demonstrably in the source (must appear) or demonstrably absent
 * from the source (must NOT appear, catches invention). They are NOT
 * stylistic preferences. If a prompt change breaks one of these,
 * something real has regressed.
 */
import type { EvalFixture } from "../types";

const TRANSCRIPT = `Dobrý deň, pani Kovačiková, zdravím vás. Ďakujem. Si tu takto. No, idem sa vás popýtať nejaké veci. Videl som správu o doktorke Kilkovej, potom z Ružinova, potom o doktorke Kilkovej. Ale idem sa spýtať vás, jak to celé bolo, jak, jak, popíšte mi tie vaše ťažkosti. Ja som prvé-- prvýkrát som sa zobudila a vtedy som naraz zacítila tuná presne takto nad srdiečkom také pálenie, také akési doslova pálenie. To bolo kedy? To bolo, hm, moment, pondelok, v nedeľu, z nedele na pondelok. Z nedele na pondelok. Dobre. No a celý deň sa to opakovalo tak, tak občas ja neviem. Že zabolelo, prešlo, zabolelo, prešlo. Áno, ale ani by som nepovedala, že zabolelo. Len také pálenie som cítila. No a toto bolo tak asi ešte, ešte večer, keď som išla spať na utorok, tak ešte som to mala a potom už celú noc som to nemala. Tak som ale poviem pravdu, že nejak tak trošku som ako, lenže ja trpím veľmi aj na chrbticu, viete bolesti, tak, tak som išla k pani doktorke, aby teda, že čo, čo mi je a teda vyšetrila a zistila, že sú tam vyššie tie markery, čo, jak sa to volá. Troponín. No tak potom mi povedala, že aby som prišla o jednej, že znova, znova mi urobia ešte krv, ale volala mi domov za hodinu, že aby som prišla znova, lebo že teda ešte raz to chcú urobiť. No tak mi to urobi-- jaj nie, potom mi to tuším neurobili, ale ma poslala- Do Ružinova, nemocnica, na centrálny príjem. Áno, áno. No tak tam mi to urobili. Tam mi povedali, že je to zvýšené a, ale to bolo, ja som tam bola od dvanástej do siedmej. Až o pol siedmej mi povedali, že- To sa bavíme o strede? O utorku, o strede? O, moment, bože. Teraz je piatok. O utorku. Utorku, áno, vtedy ona ma hneď poslala tam. No a, jaj tak, že chceli, chceli znova, aby som tam ešte zostala, že ešte raz mi zoberú, ale som váhala, lebo mám doma manžela s take-takou po-začia-začínajúcou s tým Alhaj-Alzheimerovou. Báli ste, báli ste sa ho nechať samého doma. Presne tak, lebo aj lieky potrebuje. Tak chápem. Ja som si to aj myslel, tak ste potom na druhý deň išli zase k doktorke a ona vám to vybavila na tú noc. Presne. Rozumiem, to dáva celý zmysel. Áno. Tie bolesti. Kedy to prešlo? Či ešte stále to je? Ja som to práveže nemala už v utorok. Včera som to mala aj dvakrát, asi aj ráno a potom mi pani doktorka ešte volala, že mi volá, že mi poslala do lekárne taký striek, čo mám si dať pod jazyk. A včera večer aj ráno trochu, ale tu ešte som nič nemala teda, tak som si dala len svoje lieky a potom podvečer som cítila, ale niečo som, niečo aj tak som robila, že som sa dosť zohýnala a som taká slabá. A ten striek pomohol? Áno, pomohol. Vyzerá, že naozaj nejaká cieva môže byť zúžená na tom srdiečku. Na to ste u nás, aby sme to pozreli. Áno. Robíme to cez pravú ruku, cez tepnu. Áno, dobre. Tým tenkým drôtikom v lokálnej anestéze. A keď sa niečo zúžené nájde, potvrdí, nepotvrdí sa infarkt, uvidíme. Dobre. Hneď to aj opravíme, ak sa bude dať. Jáj, ďakujem. Nie vždy sa to dá, ale väčšinou áno. Keď sa nedá, tak sú iné možnosti. To by sme si povedali. Teraz potrebujem vedieť vaše choroby, nejaké diagnózy. Čo máte? No, začnem štítnou žľazou. Potom- A so štítnou žľazou je čo? Eh, mala som vyoperovanú jednu časť, lebo, no mala som taký malý struma alebo jako to, začia-začalo mi to. No tak mi tam mi to vyoperovali, myslím na tejto strane, už neviem. Potom mám teda s tým srdiečkom, že mám arytmie. Eh, čo ešte beriem? Prestans beriem. Fibriláciu? Áno, fibrilácia, to začína a potom až tak, až tak do tej arytmie to prejde. A tú stromu, keď vyoperovali, tak teraz ste bez štítnej žľazy či iba bez časti? Eh, bola som bez časti, ale teraz už nedávno mi povedali, chodím na kontroly, že už je nes-ne-nefunkčná. Takže beriete nejaký Euthyrox? Áno, Euthyrox beriem už veľa rokov. A v akej dávke? Ko-koľko mikrogramov? Stodvanásť teraz. Stodvanásť každý deň ráno. Áno. Dobre a potom ste hovorili, že tá fibrilácia, tá fibrilácia totiž tak, keď ste boli u doktorky, tam nebola, ale teraz u nás je, keď ste- Hovorila. Teraz je. Či ona sa to strieda, ono sa to strieda. Áno. A na riedenie krvi máte čo pri tej fibrilácii? Eliquis. Päť miligramov? Áno. Ráno, večer. Áno. Dobre. A kedy ste naposledy užila? No, včera ráno už, moment, vče-včera večer ešte nie. Včera večer už nie. Už nie. Čiže posledný Eliquis bol včera ráno. Včera ráno, tak. Dobre. A potom ste spomínali, že vysoký tlak sa liečite. Nejaký Prestans. Prestans mám aj Betaloc mám, lebo mávam dosť rýchle- Aj viete dávky, že koľkatku toho Betalocu a Prestansu? Dvadsiatka. Dvadsaťpäťka býva. Tak dvadsaťpäťka. Jedna ráno? Áno. Dobre a ten Prestans tiež- Prestans beriem päť, päť ku- Päť, päť a jedna ráno. Jedna ráno. Áno. Dobre. No a bože, čo ešte? No moc toho je. Eh, no ten, ten Tunol pazberiem kvôli, kvôli tomu. Kvôli žalúdku, hej? Áno, lebo nie stále, ale- Podľa potreby. Občas mávam. Býva taká kyselina, hej? Áno, také, také trošku pálenie žalúdka. No, čo ešte beriem? Bože, jaj, ten Paretic beriem na také upokojenie, lebo viete aj s manželom aj včera to bolo, tak už tiež beriem na také upokojenie.Myslím, že už nič. A od bolesti ešte beriem, ale to je- Na chrbticu. To máte s chrbticou. Dobre. Nejaké závažné operácie voľajaké? Tá štítná žľaza, slepé črevo a teraz som mala v lete, ehm, bože, výškrab, lebo ma- mala som tam myóm. V maternici. Áno, tak to mi vyberali. A teraz posledne v decembri som mala dvakrát operované oko, tuná vidíte. Mala som tam nejaký nález. Nález na oku, dobre. V rodine, u vás otec, mamina, najbližší príbuzní, niečo so srdcom, cukrovka, mozgová príhoda. Mal niekto niečo? Infarkt? No otecko mi zomrel nie, otecko mi zomrel nejak, že mal zlyhané ľadviny. Mal zlyhanie obličiek. Áno, lebo teda. A maminka? Maminka tá žila do osemdesiatštyri a brala nejaké, myslím, že len jedny lieky brala kvôli- Takže relatívne zdravá bola, ale na srdiečko sa niečo liečila. No brata mám. Mala som teda ten zas, no taký, popíjal a tak. Jasné. Vy cigarety, alkohol. Nie, tak alkohol naozaj len príležitostne. A cigarety vôbec? Nie, vôbec. Chorá ste teraz nejaké dva tri týždne? Neboli nejaká viróza, vírus niečo? Nie, nebola, len tak pokašľávam, ale ja to mám stále, že a hlavne v zime ma to tak ide a potom na jar, keď sú už peľ a také. A doma teda žijete s manželom, o ktorého sa začínate starať viac menej. Áno, presne tak. Ste na dôchodku asi. Áno. A čo ste robili, keď ste robili ešte? Účtovníctvo. Účtovníctvo. Sedavé zamestnanie. V obchodnom dome Prior tridsať rokov. Neviem, prečo ma to napadlo povedať. Dobre, to je, to je z týchto vecí všetko. Sadnite na chvíľku, ja si vás popočúvam. Áno. Alergiu nemáte na nič? No som zabudla povedať ja sestričke, že na peľ, na, na roztoče. Či na lieky nie? Nie. Kontrastné látky. Nie, na tie mukolytiká, len to, čo som za-, a nejaké Candibene niečo, čo som brala do pošvy, keď som mala nejaké- No to bola alergia, hej? Áno. Čiže na Candibene a na mukolytiká. Áno, prsty a pery mi opuchli pri týchto dvoch veciach. Dobre. Hlboko dýchať. Dobre, dýchanie čisté, fajn, ešte srdiečko. Kľudne teraz potichučky dýchaj. To vyzerá tiež fajn. No- nohy neopuchajú? Tak keď viac chodím, či doma, či vonku, ale ináč nie. Takéto žilky sú tu. No to mám. Aj trochu kŕčové, že? Už začali. Viete, jak som už, jak, jak som začala byť na dôchodku, tak, tak začala som mať aj kŕčové. Takže si ich len mažem. Brúško nebolí? No tak nie, to- Alebo čosi tak. Väčšinou je v pohode. Dobre, šelesty sme tam nepočuli na srdci. A spravím vám ešte asi predtým, ako pôjdete na ten výkon ešte echo srdca, lebo toho nikto nerobil, echo srdca. Áno, pred rokom niekedy v júni mi robili. Pred rokom? A kto robil? Doktor Kokva, si myslím. A čo povedal? Bolo tam niečo? Nie, nechal mi aj lieky, aj myslím, že nič. Dobre. Asi to pozriem, aby sme mali čerstvé, dobre? Ďakujem. Ďakujem ja zatiaľ. A-`;

const OCR = `UNIVERZITNÁ NEMOCNICA BRATISLAVA, Pažítková 4, 821 01 Bratislava
Nemocnica Ružinov, Ružinovská 6, 826 06 Bratislava
CPO -ambulancie

Priezvisko, meno : Kovačiková Helena Č. poi.: 445926151
Bydlisko: Exnárova 3121/3, 821 03 Bratislava-Ružinov,Te Dát. nar.: 26.09.1944
Kód poi.: 2500

Zapisal:Filková Marta MUDr. 14.04.26 18:40
Diagnózy:
R074 Bolesť v hrudníku, bližšie neurčen
Pacientka s poistením, prišla sama, vyšetrovaná od 16:08, ESI 3
TO: Dva dni má pálenie nad srdcom vľavo, od včera, v noci sa na to zobudila. Bola dušná. Dnes 14.4. volala
internistke, vyšetrila ju- urobila laboratórne vyšetrenie krvi (NT proBNP 801 ng/l, TnT 22,5 ng/l), EKG: AV blok
1.stupha + SVES, bez akútnej koronárnej lézie, RTG hrudníka: pľ. parenchým bez čerstvých ložiskových zmien,
diskrétny starecký emfyzém pľúc. Pacientka bola internistkou odoslaná na CPO so záverom bolestí na hrudi k
diff dg možná IAP, tč bez ťažkostí. Pacientka pri vyšetrení bez vertiga, nauzey, vracania, diplopie, tinitu,
stenokardii, palpitácií, ťažkostí s dýchaním, bolesti brucha, hnačiek, dyzurických ťažkostí. Iné ťažkosti neudáva.

OA: st.p . strumektomii na terapii, hypertenzia III.st, hyperurikemia, myom uteru, ICHS nebolestivá forma,
kompenzovaná, parox. fibrilácie predsiení,, stp oper. verzii na SR/medik/tc SR, AV blok 1.stupňa, stredne
závažná Mi regurgitácia, stp operácii katarakty vpravoopak.,stp STE parc., fokus vs stomatol. zub, intermit
mikroskopická hematúria, sy spánkového apnoe, vertigo, monoklonálna gamapatia typu IgG kappa vs MGUS,
vsadením nadobličky, artralgie vs pri artróze, stp HSK a kyretáži
LA: Rytmonorm 1-0-1, Nolpaza 1-0-0, Prestance 1-0-0, Euthyrox 1-0-0, Paretin 1-0-0, Eliquis, Betaloc ZOK 1-0-0,
Zaldiar 1-0-1
AA: prach, peľ, mukosolvan, candibene
Abúzy: nefajčí, alkohol nepije, drogy neguje

Obj: TK ĽHK 165/75 mmHg PHK 155/77 HR:51 /min/reg Sat O2: 97 % TT 36,8 st.C
Pri vedomí, orientovaná GCS 15, cirkulačne stabilizovaná, hydratácia primeraná, koža bez ikteru a cyanózy,
periférne prekrvenie v norme. Hlava nebolestivá, zrenice izokorické, foto +/+, bez nystagmu, sliznice vlhké, jazyk
nepovlečený, plaží v strednej rovine, šija neoponuje. Hrudník: dýchanie vezikulárne bilat., bez VDF. cor AP. ozvy
ohraničené. Abdomen mäkké, priehmatné, palpačne nebolestivé, bez hmatnej rezistencie, Bl-, Ro-, Mu-, Pl-, bez
známok peritoneálneho dráždenia, peristaltika auskultačne prítomná, tapott. bilat. negat. DK bilat. bez edémov,
pulzácie hmatám do periferie, lýtka palpačne nebolestivé, Homans negatívny, bez známok HŽT alebo akútnej
ischémie
HKK a DKK svalova sila zachovaná bilat.
EKG: AP, RS, f: 56 /min, PQ 0,28, QRS do 0,08, ST v izočiare, T negat V1-V3 Z: bez známok akútnych ischem
zmien, bez závažnej arytmie, AV blok 1. stupňa

Lab. vyš.:
Biochémia sérum: S-hscTnT: 29,00, S_Myoglo: 39,35, Koagulácia a iné: FBG: 4,54, D-Dimer: 0,28, Quick-INR:
1,23, APTTrati: 1,16,

Zobrazovacie vyšetrenia:
RTG hrudníka (14.4.2026, MUDr. Osifová Otília): Záver: pľ. parenchým bez čerstvých ložiskových zmien,
diskrétny starecký emfyzém pľúc. 14.4. skonzultované s pneumológom hunrjeis hily inak negat., identické ako
11/2025

Záver: Bolesti na hrudníku difdg., t.č. nemožno vylúčiť IAP, difdg. NSTEMI

Pacientka odmietla opakovaný odber krvi na sledovanie dynamiky troponínu, pozitívna dynamika KŠE, t.č.
nemožno vylúčiť prebiehajúci AKS, svoj demitus podpiera podpisom negatívneho reverzu nižšie.`;

export const kovacikovaChestPain: EvalFixture = {
  id: "kovacikova-chest-pain",
  description: "82F atypical chest pain, elevated troponin, known paroxysmal AF",
  templateId: "t_KZPRXwjQye", // Targeted Cardiology Examination
  language: "sk",
  source: {
    transcript: TRANSCRIPT,
    files: [{ name: "ruzinov-cpo-report.txt", text: OCR }],
  },
  expectations: [
    // ── LA: every medication documented in the OCR must appear ────────
    {
      kind: "section-contains",
      section: "LA",
      value: "Rytmonorm",
      reason: "Rytmonorm 1-0-1 is in the OCR medication list",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Nolpaza",
      reason: "Nolpaza is in the OCR medication list",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Euthyrox",
      reason: "Euthyrox is in both the OCR and transcript",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Eliquis",
      reason: "Eliquis is in both the OCR and transcript",
    },
    {
      kind: "section-contains",
      section: "LA",
      value: "Betaloc",
      reason: "Betaloc ZOK is in both the OCR and transcript",
    },

    // ── LA: invention guard ──────────────────────────────────────────
    {
      kind: "section-not-contains",
      section: "LA",
      value: "Warfarin",
      reason: "Warfarin is not in the source — common anticoagulant hallucination risk",
    },
    {
      kind: "section-not-contains",
      section: "LA",
      value: "Metformin",
      reason: "Metformin is not in the source — cardiology anchor bias risk",
    },

    // ── Záver: subtype and anatomy specificity the suggester must get right ──
    {
      kind: "icd-in-zaver",
      code: "I48.0",
      reason: "Paroxysmal AF per OCR 'parox. fibrilácie predsiení' — must be I48.0, NOT I48.1 (persistent)",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I48.1",
      reason: "Persistent AF code must not appear — source says paroxysmal",
    },
    {
      kind: "icd-in-zaver",
      code: "I44.0",
      reason: "AV block 1st degree per OCR + EKG — must be I44.0",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I44.1",
      reason: "AV block 2nd degree code must not appear — source is explicit '1. stupňa'",
    },
    {
      kind: "icd-in-zaver",
      code: "I34.0",
      reason: "Mitral regurgitation per OCR 'stredne závažná Mi regurgitácia' — NOT aortic I35.x",
    },
    {
      kind: "icd-not-in-zaver",
      code: "I35.1",
      reason: "Aortic insufficiency code must not appear — source says MITRAL",
    },
    {
      kind: "icd-in-zaver",
      code: "I10",
      reason: "Hypertension III. st per OCR — must map to I10",
    },
    {
      kind: "icd-in-zaver",
      code: "E89.0",
      reason: "Post-surgical hypothyroidism per 'st.p. strumektomii na terapii' + Euthyrox",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E03.2",
      reason: "Drug-induced hypothyroidism must not appear — etiology is post-surgical",
    },
    {
      kind: "icd-in-zaver",
      code: "D47.2",
      reason: "MGUS per OCR 'monoklonálna gamapatia typu IgG kappa vs MGUS'",
    },

    // ── Postup a plán: no medications leaking ────────────────────────
    {
      kind: "section-not-contains",
      section: "Postup a plán",
      value: "Eliquis",
      reason: "Medications belong only in LA — plan should describe clinical intent, not drug names",
    },
    {
      kind: "section-not-contains",
      section: "Postup a plán",
      value: "Rytmonorm",
      reason: "Medications belong only in LA",
    },

    // ── Objektívny nález: vitals present ─────────────────────────────
    {
      kind: "contains",
      value: "165/75",
      reason: "Left arm BP 165/75 mmHg documented",
    },
    {
      kind: "contains",
      value: "155/77",
      reason: "Right arm BP 155/77 mmHg documented",
    },
    {
      kind: "contains",
      value: "51",
      reason: "Heart rate 51/min documented",
    },
    // ── Invention guards on vitals ───────────────────────────────────
    {
      kind: "not-contains",
      value: "180/100",
      reason: "Fabricated BP reading that was never in the source",
    },

    // ── Allergies: every one in source must surface ──────────────────
    {
      kind: "section-contains",
      section: "AA",
      value: "Candibene",
      reason: "Candibene allergy is explicit in source",
    },
    {
      kind: "section-contains",
      section: "AA",
      value: "peľ",
      reason: "Pollen allergy is explicit in source",
    },

    // ── Never invent a diabetes diagnosis ────────────────────────────
    {
      kind: "icd-not-in-zaver",
      code: "E11",
      reason: "Type 2 diabetes is not in the source; must never appear",
    },
    {
      kind: "icd-not-in-zaver",
      code: "E10",
      reason: "Type 1 diabetes is not in the source; must never appear",
    },
  ],
};
