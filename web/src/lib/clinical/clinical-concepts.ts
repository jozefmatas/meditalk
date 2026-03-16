import type { ClinicalConcept } from "./types";

/**
 * Curated catalog of ~200 clinical concepts for concept matching against
 * medical transcripts. Each concept includes multi-language trigger phrases
 * (EN, SK, CS), specialty tags, and ICD-10 category hints.
 *
 * Concepts are distributed across all 15 supported specialties.
 */
export const CLINICAL_CONCEPTS: ClinicalConcept[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // GENERAL PRACTICE / INTERNAL MEDICINE (~30)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "hypertension",
    canonicalName: "Hypertension",
    triggers: {
      en: ["hypertension", "high blood pressure", "elevated BP", "HTN"],
      sk: [
        "hypertenzia",
        "vysoký krvný tlak",
        "vysoký tlak",
        "artériová hypertenzia",
      ],
      cs: [
        "hypertenze",
        "vysoký krevní tlak",
        "vysoký tlak",
        "arteriální hypertenze",
      ],
    },
    specialties: ["general_practice", "internal_medicine", "cardiology"],
    icdHints: ["I10", "I11"],
  },
  {
    id: "type_2_diabetes",
    canonicalName: "Type 2 diabetes mellitus",
    triggers: {
      en: [
        "type 2 diabetes",
        "T2DM",
        "diabetes mellitus type 2",
        "non-insulin dependent diabetes",
      ],
      sk: [
        "diabetes mellitus 2. typu",
        "cukrovka 2. typu",
        "cukrovka druhého typu",
        "DM2",
      ],
      cs: [
        "diabetes mellitus 2. typu",
        "cukrovka 2. typu",
        "cukrovka druhého typu",
        "DM2",
      ],
    },
    specialties: ["general_practice", "internal_medicine", "endocrinology"],
    icdHints: ["E11"],
  },
  {
    id: "hyperlipidemia",
    canonicalName: "Hyperlipidemia",
    triggers: {
      en: [
        "hyperlipidemia",
        "high cholesterol",
        "dyslipidemia",
        "elevated lipids",
      ],
      sk: [
        "hyperlipidémia",
        "vysoký cholesterol",
        "dyslipidémia",
        "zvýšené tuky",
      ],
      cs: [
        "hyperlipidémie",
        "vysoký cholesterol",
        "dyslipidémie",
        "zvýšené tuky",
      ],
    },
    specialties: ["general_practice", "internal_medicine", "cardiology"],
    icdHints: ["E78"],
  },
  {
    id: "upper_respiratory_infection",
    canonicalName: "Upper respiratory infection",
    triggers: {
      en: [
        "upper respiratory infection",
        "URI",
        "common cold",
        "acute nasopharyngitis",
      ],
      sk: [
        "infekcia horných dýchacích ciest",
        "nádcha",
        "prechladnutie",
        "akútna rinofaryngitída",
      ],
      cs: [
        "infekce horních cest dýchacích",
        "rýma",
        "nachlazení",
        "akutní rinofaryngitida",
      ],
    },
    specialties: ["general_practice", "pediatrics"],
    icdHints: ["J06", "J00"],
  },
  {
    id: "urinary_tract_infection",
    canonicalName: "Urinary tract infection",
    triggers: {
      en: ["urinary tract infection", "UTI", "bladder infection", "cystitis"],
      sk: [
        "infekcia močových ciest",
        "zápal močového mechúra",
        "cystitída",
        "močová infekcia",
      ],
      cs: [
        "infekce močových cest",
        "zánět močového měchýře",
        "cystitida",
        "močová infekce",
      ],
    },
    specialties: ["general_practice", "urology"],
    icdHints: ["N39", "N30"],
  },
  {
    id: "anemia",
    canonicalName: "Anemia",
    triggers: {
      en: ["anemia", "low hemoglobin", "iron deficiency anemia", "anaemia"],
      sk: ["anémia", "málokrvnosť", "nízky hemoglobín", "sideropenická anémia"],
      cs: [
        "anémie",
        "chudokrevnost",
        "nízký hemoglobin",
        "sideropenická anémie",
      ],
    },
    specialties: ["general_practice", "internal_medicine"],
    icdHints: ["D50", "D64"],
  },
  {
    id: "obesity",
    canonicalName: "Obesity",
    triggers: {
      en: ["obesity", "morbid obesity", "overweight", "BMI over 30"],
      sk: ["obezita", "morbídna obezita", "nadváha", "nadmerná hmotnosť"],
      cs: ["obezita", "morbidní obezita", "nadváha", "nadměrná hmotnost"],
    },
    specialties: ["general_practice", "internal_medicine", "endocrinology"],
    icdHints: ["E66"],
  },
  {
    id: "chronic_pain",
    canonicalName: "Chronic pain",
    triggers: {
      en: [
        "chronic pain",
        "persistent pain",
        "chronic pain syndrome",
        "long-term pain",
      ],
      sk: [
        "chronická bolesť",
        "pretrvávajúca bolesť",
        "dlhodobá bolesť",
        "syndróm chronickej bolesti",
      ],
      cs: [
        "chronická bolest",
        "přetrvávající bolest",
        "dlouhodobá bolest",
        "syndrom chronické bolesti",
      ],
    },
    specialties: ["general_practice", "neurology"],
    icdHints: ["G89", "R52"],
  },
  {
    id: "gerd",
    canonicalName: "Gastroesophageal reflux disease",
    triggers: {
      en: ["GERD", "acid reflux", "gastroesophageal reflux", "heartburn"],
      sk: [
        "GERD",
        "refluxná choroba",
        "gastroezofageálny reflux",
        "pálenie záhy",
      ],
      cs: [
        "GERD",
        "refluxní choroba",
        "gastroezofageální reflux",
        "pálení žáhy",
      ],
    },
    specialties: ["general_practice", "gastroenterology"],
    icdHints: ["K21"],
  },
  {
    id: "allergic_rhinitis",
    canonicalName: "Allergic rhinitis",
    triggers: {
      en: [
        "allergic rhinitis",
        "hay fever",
        "seasonal allergies",
        "nasal allergy",
      ],
      sk: [
        "alergická nádcha",
        "senná nádcha",
        "sezónna alergia",
        "alergická rinitída",
      ],
      cs: [
        "alergická rýma",
        "senná rýma",
        "sezónní alergie",
        "alergická rinitida",
      ],
    },
    specialties: ["general_practice", "ent"],
    icdHints: ["J30"],
  },
  {
    id: "acute_bronchitis",
    canonicalName: "Acute bronchitis",
    triggers: {
      en: [
        "acute bronchitis",
        "chest cold",
        "bronchitis",
        "bronchial inflammation",
      ],
      sk: [
        "akútna bronchitída",
        "zápal priedušiek",
        "bronchitída",
        "akútny zápal priedušiek",
      ],
      cs: [
        "akutní bronchitida",
        "zánět průdušek",
        "bronchitida",
        "akutní zánět průdušek",
      ],
    },
    specialties: ["general_practice", "pulmonology"],
    icdHints: ["J20"],
  },
  {
    id: "low_back_pain",
    canonicalName: "Low back pain",
    triggers: {
      en: ["low back pain", "lumbago", "lumbar pain", "lower back pain"],
      sk: [
        "bolesť dolnej časti chrbta",
        "lumbago",
        "lumbálna bolesť",
        "bolesť krížov",
      ],
      cs: [
        "bolest dolní části zad",
        "lumbago",
        "lumbální bolest",
        "bolest beder",
      ],
    },
    specialties: ["general_practice", "orthopedics"],
    icdHints: ["M54"],
  },
  {
    id: "headache",
    canonicalName: "Headache",
    triggers: {
      en: ["headache", "cephalgia", "head pain", "tension headache"],
      sk: ["bolesť hlavy", "cefalgia", "bolesti hlavy", "tenzná bolesť hlavy"],
      cs: ["bolest hlavy", "cefalgie", "bolesti hlavy", "tenzní bolest hlavy"],
    },
    specialties: ["general_practice", "neurology"],
    icdHints: ["R51", "G44"],
  },
  {
    id: "vitamin_d_deficiency",
    canonicalName: "Vitamin D deficiency",
    triggers: {
      en: ["vitamin D deficiency", "low vitamin D", "hypovitaminosis D"],
      sk: ["nedostatok vitamínu D", "nízky vitamín D", "hypovitaminóza D"],
      cs: ["nedostatek vitaminu D", "nízký vitamin D", "hypovitaminóza D"],
    },
    specialties: ["general_practice", "endocrinology"],
    icdHints: ["E55"],
  },
  {
    id: "hypothyroidism",
    canonicalName: "Hypothyroidism",
    triggers: {
      en: ["hypothyroidism", "underactive thyroid", "low thyroid", "Hashimoto"],
      sk: [
        "hypotyreóza",
        "znížená funkcia štítnej žľazy",
        "nedočinnosť štítnej žľazy",
        "Hashimoto",
      ],
      cs: [
        "hypotyreóza",
        "snížená funkce štítné žlázy",
        "nedočinnost štítné žlázy",
        "Hashimoto",
      ],
    },
    specialties: ["general_practice", "endocrinology"],
    icdHints: ["E03"],
  },
  {
    id: "iron_deficiency",
    canonicalName: "Iron deficiency",
    triggers: {
      en: ["iron deficiency", "low iron", "sideropenia", "low ferritin"],
      sk: ["nedostatok železa", "nízke železo", "sideropénia", "nízky feritín"],
      cs: ["nedostatek železa", "nízké železo", "sideropenie", "nízký feritin"],
    },
    specialties: ["general_practice", "internal_medicine"],
    icdHints: ["E61"],
  },
  {
    id: "acute_pharyngitis",
    canonicalName: "Acute pharyngitis",
    triggers: {
      en: ["acute pharyngitis", "sore throat", "strep throat", "pharyngitis"],
      sk: ["akútna faryngitída", "bolesť hrdla", "zápal hltana", "angína"],
      cs: ["akutní faryngitida", "bolest v krku", "zánět hltanu", "angína"],
    },
    specialties: ["general_practice", "ent"],
    icdHints: ["J02", "J03"],
  },
  {
    id: "conjunctivitis",
    canonicalName: "Conjunctivitis",
    triggers: {
      en: ["conjunctivitis", "pink eye", "eye infection", "red eye"],
      sk: ["konjunktivitída", "zápal spojoviek", "ružové oko", "červené oko"],
      cs: ["konjunktivitida", "zánět spojivek", "růžové oko", "červené oko"],
    },
    specialties: ["general_practice"],
    icdHints: ["H10"],
  },
  {
    id: "gastroenteritis",
    canonicalName: "Gastroenteritis",
    triggers: {
      en: [
        "gastroenteritis",
        "stomach flu",
        "stomach bug",
        "viral gastroenteritis",
      ],
      sk: [
        "gastroenteritída",
        "črevná chrípka",
        "žalúdočná chrípka",
        "zápal žalúdka a čriev",
      ],
      cs: [
        "gastroenteritida",
        "střevní chřipka",
        "žaludeční chřipka",
        "zánět žaludku a střev",
      ],
    },
    specialties: ["general_practice", "gastroenterology"],
    icdHints: ["K52", "A09"],
  },
  {
    id: "gout",
    canonicalName: "Gout",
    triggers: {
      en: ["gout", "gouty arthritis", "hyperuricemia", "uric acid"],
      sk: ["dna", "dnavý zápal", "hyperurikémia", "zvýšená kyselina močová"],
      cs: ["dna", "dnavý záchvat", "hyperurikémie", "zvýšená kyselina močová"],
    },
    specialties: ["general_practice", "internal_medicine", "orthopedics"],
    icdHints: ["M10"],
  },
  {
    id: "influenza",
    canonicalName: "Influenza",
    triggers: {
      en: ["influenza", "flu", "seasonal flu", "influenza A"],
      sk: ["chrípka", "gripa", "sezónna chrípka", "influenza"],
      cs: ["chřipka", "gripa", "sezónní chřipka", "influenza"],
    },
    specialties: ["general_practice", "pediatrics"],
    icdHints: ["J10", "J11"],
  },
  {
    id: "covid_19",
    canonicalName: "COVID-19",
    triggers: {
      en: ["COVID-19", "coronavirus", "SARS-CoV-2", "COVID"],
      sk: ["COVID-19", "koronavírus", "SARS-CoV-2", "kovid"],
      cs: ["COVID-19", "koronavirus", "SARS-CoV-2", "kovid"],
    },
    specialties: ["general_practice", "internal_medicine", "pulmonology"],
    icdHints: ["U07"],
  },
  {
    id: "contact_dermatitis",
    canonicalName: "Contact dermatitis",
    triggers: {
      en: [
        "contact dermatitis",
        "skin rash",
        "allergic dermatitis",
        "skin irritation",
      ],
      sk: [
        "kontaktná dermatitída",
        "kožná vyrážka",
        "alergická dermatitída",
        "podráždenie kože",
      ],
      cs: [
        "kontaktní dermatitida",
        "kožní vyrážka",
        "alergická dermatitida",
        "podráždění kůže",
      ],
    },
    specialties: ["general_practice", "dermatology"],
    icdHints: ["L23", "L24", "L25"],
  },
  {
    id: "peripheral_edema",
    canonicalName: "Peripheral edema",
    triggers: {
      en: ["peripheral edema", "leg swelling", "ankle swelling", "edema"],
      sk: ["periférny edém", "opuch nôh", "opuch členkov", "edém"],
      cs: ["periferní edém", "otoky nohou", "otoky kotníků", "edém"],
    },
    specialties: ["general_practice", "internal_medicine", "cardiology"],
    icdHints: ["R60"],
  },
  {
    id: "vertigo",
    canonicalName: "Vertigo",
    triggers: {
      en: ["vertigo", "dizziness", "BPPV", "benign positional vertigo"],
      sk: ["vertigo", "závraty", "BPPV", "polohové vertigo"],
      cs: ["vertigo", "závratě", "BPPV", "polohové vertigo"],
    },
    specialties: ["general_practice", "neurology", "ent"],
    icdHints: ["H81", "R42"],
  },
  {
    id: "lymphadenopathy",
    canonicalName: "Lymphadenopathy",
    triggers: {
      en: [
        "lymphadenopathy",
        "swollen lymph nodes",
        "enlarged lymph nodes",
        "lymph node swelling",
      ],
      sk: [
        "lymfadenopatia",
        "zväčšené lymfatické uzliny",
        "opuchnuté uzliny",
        "zdurené uzliny",
      ],
      cs: [
        "lymfadenopatie",
        "zvětšené lymfatické uzliny",
        "oteklé uzliny",
        "zduřelé uzliny",
      ],
    },
    specialties: ["general_practice", "internal_medicine", "oncology"],
    icdHints: ["R59"],
  },
  {
    id: "chest_pain",
    canonicalName: "Chest pain",
    triggers: {
      en: ["chest pain", "chest tightness", "thoracic pain", "precordial pain"],
      sk: [
        "bolesť na hrudi",
        "tlak na hrudi",
        "torakálna bolesť",
        "bolesť v hrudníku",
      ],
      cs: [
        "bolest na hrudi",
        "tlak na hrudi",
        "torakální bolest",
        "bolest v hrudníku",
      ],
    },
    specialties: ["general_practice", "cardiology"],
    icdHints: ["R07"],
  },
  {
    id: "fatigue",
    canonicalName: "Fatigue",
    triggers: {
      en: ["fatigue", "chronic fatigue", "tiredness", "exhaustion"],
      sk: ["únava", "chronická únava", "vyčerpanosť", "vyčerpanie"],
      cs: ["únava", "chronická únava", "vyčerpanost", "vyčerpání"],
    },
    specialties: ["general_practice", "internal_medicine"],
    icdHints: ["R53"],
  },
  {
    id: "dyspnea",
    canonicalName: "Dyspnea",
    triggers: {
      en: [
        "dyspnea",
        "shortness of breath",
        "SOB",
        "breathlessness",
        "difficulty breathing",
      ],
      sk: ["dýchavičnosť", "dušnosť", "sťažené dýchanie", "dyspnoe"],
      cs: ["dušnost", "dechová nedostatečnost", "ztížené dýchání", "dyspnoe"],
    },
    specialties: ["general_practice", "pulmonology", "cardiology"],
    icdHints: ["R06"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CARDIOLOGY (~15)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "atrial_fibrillation",
    canonicalName: "Atrial fibrillation",
    triggers: {
      en: ["atrial fibrillation", "AFib", "AF", "irregular heartbeat"],
      sk: [
        "fibrilácia predsiení",
        "predsieňová fibrilácia",
        "nepravidelný tep",
      ],
      cs: ["fibrilace síní", "síňová fibrilace", "nepravidelný tep"],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I48"],
  },
  {
    id: "heart_failure",
    canonicalName: "Heart failure",
    triggers: {
      en: [
        "heart failure",
        "congestive heart failure",
        "CHF",
        "HFrEF",
        "HFpEF",
      ],
      sk: [
        "srdcové zlyhávanie",
        "zlyhanie srdca",
        "kongestívne zlyhanie srdca",
      ],
      cs: ["srdeční selhání", "selhání srdce", "kongestivní srdeční selhání"],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I50"],
  },
  {
    id: "coronary_artery_disease",
    canonicalName: "Coronary artery disease",
    triggers: {
      en: [
        "coronary artery disease",
        "CAD",
        "ischemic heart disease",
        "coronary disease",
      ],
      sk: [
        "ischemická choroba srdca",
        "ICHS",
        "koronárna choroba",
        "ateroskleróza koronárnych artérií",
      ],
      cs: [
        "ischemická choroba srdeční",
        "ICHS",
        "koronární nemoc",
        "ateroskleróza koronárních tepen",
      ],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I25"],
  },
  {
    id: "myocardial_infarction",
    canonicalName: "Myocardial infarction",
    triggers: {
      en: ["myocardial infarction", "heart attack", "MI", "STEMI", "NSTEMI"],
      sk: ["infarkt myokardu", "srdcový infarkt", "infarkt", "IM"],
      cs: ["infarkt myokardu", "srdeční infarkt", "infarkt", "IM"],
    },
    specialties: ["cardiology"],
    icdHints: ["I21", "I22"],
  },
  {
    id: "angina_pectoris",
    canonicalName: "Angina pectoris",
    triggers: {
      en: [
        "angina pectoris",
        "angina",
        "stable angina",
        "unstable angina",
        "chest tightness on exertion",
      ],
      sk: ["angina pectoris", "angína", "stabilná angína", "nestabilná angína"],
      cs: ["angina pectoris", "angína", "stabilní angina", "nestabilní angina"],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I20"],
  },
  {
    id: "cardiomyopathy",
    canonicalName: "Cardiomyopathy",
    triggers: {
      en: [
        "cardiomyopathy",
        "dilated cardiomyopathy",
        "hypertrophic cardiomyopathy",
        "DCM",
        "HCM",
      ],
      sk: [
        "kardiomyopatia",
        "dilatačná kardiomyopatia",
        "hypertrofická kardiomyopatia",
      ],
      cs: [
        "kardiomyopatie",
        "dilatační kardiomyopatie",
        "hypertrofická kardiomyopatie",
      ],
    },
    specialties: ["cardiology"],
    icdHints: ["I42"],
  },
  {
    id: "aortic_valve_disease",
    canonicalName: "Aortic valve disease",
    triggers: {
      en: [
        "aortic valve disease",
        "aortic stenosis",
        "aortic regurgitation",
        "aortic valve replacement",
      ],
      sk: [
        "choroba aortálnej chlopne",
        "aortálna stenóza",
        "aortálna regurgitácia",
      ],
      cs: [
        "onemocnění aortální chlopně",
        "aortální stenóza",
        "aortální regurgitace",
      ],
    },
    specialties: ["cardiology"],
    icdHints: ["I35"],
  },
  {
    id: "mitral_valve_disease",
    canonicalName: "Mitral valve disease",
    triggers: {
      en: [
        "mitral valve disease",
        "mitral regurgitation",
        "mitral stenosis",
        "mitral prolapse",
      ],
      sk: [
        "choroba mitrálnej chlopne",
        "mitrálna regurgitácia",
        "prolaps mitrálnej chlopne",
      ],
      cs: [
        "onemocnění mitrální chlopně",
        "mitrální regurgitace",
        "prolaps mitrální chlopně",
      ],
    },
    specialties: ["cardiology"],
    icdHints: ["I34"],
  },
  {
    id: "pericarditis",
    canonicalName: "Pericarditis",
    triggers: {
      en: ["pericarditis", "pericardial inflammation", "pericardial effusion"],
      sk: ["perikarditída", "zápal osrdcovníka", "perikardiálny výpotok"],
      cs: ["perikarditida", "zánět osrdečníku", "perikardiální výpotek"],
    },
    specialties: ["cardiology"],
    icdHints: ["I30", "I31"],
  },
  {
    id: "deep_vein_thrombosis",
    canonicalName: "Deep vein thrombosis",
    triggers: {
      en: ["deep vein thrombosis", "DVT", "leg clot", "venous thrombosis"],
      sk: ["hlboká žilová trombóza", "HŽT", "trombóza hlbokých žíl"],
      cs: ["hluboká žilní trombóza", "HŽT", "trombóza hlubokých žil"],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I80"],
  },
  {
    id: "pulmonary_embolism",
    canonicalName: "Pulmonary embolism",
    triggers: {
      en: [
        "pulmonary embolism",
        "PE",
        "lung clot",
        "pulmonary thromboembolism",
      ],
      sk: ["pľúcna embólia", "PE", "tromboembolizmus pľúc"],
      cs: ["plicní embolie", "PE", "tromboembolismus plic"],
    },
    specialties: ["cardiology", "pulmonology"],
    icdHints: ["I26"],
  },
  {
    id: "supraventricular_tachycardia",
    canonicalName: "Supraventricular tachycardia",
    triggers: {
      en: [
        "supraventricular tachycardia",
        "SVT",
        "paroxysmal SVT",
        "rapid heart rate",
      ],
      sk: ["supraventrikulárna tachykardia", "SVT", "paroxyzmálna SVT"],
      cs: ["supraventrikulární tachykardie", "SVT", "paroxysmální SVT"],
    },
    specialties: ["cardiology"],
    icdHints: ["I47"],
  },
  {
    id: "aortic_aneurysm",
    canonicalName: "Aortic aneurysm",
    triggers: {
      en: [
        "aortic aneurysm",
        "abdominal aortic aneurysm",
        "AAA",
        "thoracic aneurysm",
      ],
      sk: [
        "aneuryzma aorty",
        "abdominálna aneuryzma aorty",
        "hrudná aneuryzma",
      ],
      cs: [
        "aneuryzma aorty",
        "abdominální aneuryzma aorty",
        "hrudní aneuryzma",
      ],
    },
    specialties: ["cardiology"],
    icdHints: ["I71"],
  },
  {
    id: "peripheral_artery_disease",
    canonicalName: "Peripheral artery disease",
    triggers: {
      en: [
        "peripheral artery disease",
        "PAD",
        "claudication",
        "peripheral vascular disease",
      ],
      sk: [
        "periférne artériové ochorenie",
        "PAO",
        "klaudikácia",
        "ateroskleróza končatín",
      ],
      cs: [
        "periferní arteriální onemocnění",
        "PAO",
        "klaudikace",
        "ateroskleróza končetin",
      ],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I73", "I70"],
  },
  {
    id: "endocarditis",
    canonicalName: "Infective endocarditis",
    triggers: {
      en: [
        "endocarditis",
        "infective endocarditis",
        "bacterial endocarditis",
        "valve infection",
      ],
      sk: [
        "endokarditída",
        "infekčná endokarditída",
        "bakteriálna endokarditída",
      ],
      cs: [
        "endokarditida",
        "infekční endokarditida",
        "bakteriální endokarditida",
      ],
    },
    specialties: ["cardiology", "internal_medicine"],
    icdHints: ["I33"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PULMONOLOGY (~15)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "asthma",
    canonicalName: "Asthma",
    triggers: {
      en: ["asthma", "bronchial asthma", "asthma attack", "wheezing"],
      sk: [
        "astma",
        "bronchiálna astma",
        "astmatický záchvat",
        "pískanie pri dýchaní",
      ],
      cs: [
        "astma",
        "bronchiální astma",
        "astmatický záchvat",
        "pískání při dýchání",
      ],
    },
    specialties: ["pulmonology", "general_practice"],
    icdHints: ["J45"],
  },
  {
    id: "copd",
    canonicalName: "Chronic obstructive pulmonary disease",
    triggers: {
      en: [
        "COPD",
        "chronic obstructive pulmonary disease",
        "emphysema",
        "chronic bronchitis",
      ],
      sk: [
        "CHOCHP",
        "chronická obštrukčná choroba pľúc",
        "emfyzém",
        "chronická bronchitída",
      ],
      cs: [
        "CHOPN",
        "chronická obstrukční plicní nemoc",
        "emfyzém",
        "chronická bronchitida",
      ],
    },
    specialties: ["pulmonology", "internal_medicine"],
    icdHints: ["J44", "J43"],
  },
  {
    id: "pneumonia",
    canonicalName: "Pneumonia",
    triggers: {
      en: [
        "pneumonia",
        "lung infection",
        "community-acquired pneumonia",
        "CAP",
      ],
      sk: ["pneumónia", "zápal pľúc", "komunitná pneumónia", "pľúcny zápal"],
      cs: ["pneumonie", "zápal plic", "komunitní pneumonie", "plicní zánět"],
    },
    specialties: ["pulmonology", "general_practice"],
    icdHints: ["J18", "J15"],
  },
  {
    id: "pleural_effusion",
    canonicalName: "Pleural effusion",
    triggers: {
      en: [
        "pleural effusion",
        "fluid around lung",
        "pleurisy",
        "pleural fluid",
      ],
      sk: [
        "pleurálny výpotok",
        "tekutina okolo pľúc",
        "zápal pohrudnice",
        "fluidotorax",
      ],
      cs: [
        "pleurální výpotek",
        "tekutina kolem plic",
        "zánět pohrudnice",
        "fluidotorax",
      ],
    },
    specialties: ["pulmonology"],
    icdHints: ["J90", "J91"],
  },
  {
    id: "pulmonary_fibrosis",
    canonicalName: "Pulmonary fibrosis",
    triggers: {
      en: [
        "pulmonary fibrosis",
        "idiopathic pulmonary fibrosis",
        "IPF",
        "lung fibrosis",
      ],
      sk: ["pľúcna fibróza", "idiopatická pľúcna fibróza", "IPF"],
      cs: ["plicní fibróza", "idiopatická plicní fibróza", "IPF"],
    },
    specialties: ["pulmonology"],
    icdHints: ["J84"],
  },
  {
    id: "sleep_apnea",
    canonicalName: "Obstructive sleep apnea",
    triggers: {
      en: [
        "sleep apnea",
        "obstructive sleep apnea",
        "OSA",
        "sleep-disordered breathing",
      ],
      sk: ["spánkové apnoe", "obštrukčné spánkové apnoe", "OSA", "chrápanie"],
      cs: ["spánková apnoe", "obstrukční spánková apnoe", "OSA", "chrápání"],
    },
    specialties: ["pulmonology", "ent"],
    icdHints: ["G47"],
  },
  {
    id: "pneumothorax",
    canonicalName: "Pneumothorax",
    triggers: {
      en: [
        "pneumothorax",
        "collapsed lung",
        "tension pneumothorax",
        "air in chest",
      ],
      sk: ["pneumotorax", "skolabované pľúca", "tenzný pneumotorax"],
      cs: ["pneumotorax", "zkolabovaná plíce", "tenzní pneumotorax"],
    },
    specialties: ["pulmonology"],
    icdHints: ["J93"],
  },
  {
    id: "tuberculosis",
    canonicalName: "Tuberculosis",
    triggers: {
      en: ["tuberculosis", "TB", "pulmonary tuberculosis", "consumption"],
      sk: ["tuberkulóza", "TBC", "pľúcna tuberkulóza", "suchoty"],
      cs: ["tuberkulóza", "TBC", "plicní tuberkulóza", "souchotiny"],
    },
    specialties: ["pulmonology", "internal_medicine"],
    icdHints: ["A15", "A16"],
  },
  {
    id: "sarcoidosis",
    canonicalName: "Sarcoidosis",
    triggers: {
      en: ["sarcoidosis", "pulmonary sarcoidosis", "granulomatous disease"],
      sk: ["sarkoidóza", "pľúcna sarkoidóza", "granulomatózne ochorenie"],
      cs: ["sarkoidóza", "plicní sarkoidóza", "granulomatózní onemocnění"],
    },
    specialties: ["pulmonology", "internal_medicine"],
    icdHints: ["D86"],
  },
  {
    id: "bronchiectasis",
    canonicalName: "Bronchiectasis",
    triggers: {
      en: ["bronchiectasis", "dilated bronchi", "bronchial dilation"],
      sk: ["bronchiektázie", "rozšírené priedušky", "bronchiektázy"],
      cs: ["bronchiektázie", "rozšířené průdušky", "bronchiektázy"],
    },
    specialties: ["pulmonology"],
    icdHints: ["J47"],
  },
  {
    id: "pulmonary_hypertension",
    canonicalName: "Pulmonary hypertension",
    triggers: {
      en: [
        "pulmonary hypertension",
        "pulmonary arterial hypertension",
        "PAH",
        "elevated PA pressure",
      ],
      sk: ["pľúcna hypertenzia", "pľúcna artériová hypertenzia", "PAH"],
      cs: ["plicní hypertenze", "plicní arteriální hypertenze", "PAH"],
    },
    specialties: ["pulmonology", "cardiology"],
    icdHints: ["I27"],
  },
  {
    id: "lung_abscess",
    canonicalName: "Lung abscess",
    triggers: {
      en: ["lung abscess", "pulmonary abscess", "lung cavity infection"],
      sk: ["pľúcny absces", "absces pľúc", "hnisové ložisko v pľúcach"],
      cs: ["plicní absces", "absces plic", "hnisové ložisko v plicích"],
    },
    specialties: ["pulmonology"],
    icdHints: ["J85"],
  },
  {
    id: "cystic_fibrosis",
    canonicalName: "Cystic fibrosis",
    triggers: {
      en: ["cystic fibrosis", "CF", "mucoviscidosis"],
      sk: ["cystická fibróza", "CF", "mukoviscidóza"],
      cs: ["cystická fibróza", "CF", "mukoviscidóza"],
    },
    specialties: ["pulmonology", "pediatrics"],
    icdHints: ["E84"],
  },
  {
    id: "acute_respiratory_distress",
    canonicalName: "Acute respiratory distress syndrome",
    triggers: {
      en: ["ARDS", "acute respiratory distress syndrome", "acute lung injury"],
      sk: [
        "ARDS",
        "akútny respiračný distres syndróm",
        "akútne poškodenie pľúc",
      ],
      cs: [
        "ARDS",
        "akutní respirační distres syndrom",
        "akutní poškození plic",
      ],
    },
    specialties: ["pulmonology"],
    icdHints: ["J80"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GASTROENTEROLOGY (~15)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "irritable_bowel_syndrome",
    canonicalName: "Irritable bowel syndrome",
    triggers: {
      en: [
        "irritable bowel syndrome",
        "IBS",
        "spastic colon",
        "irritable colon",
      ],
      sk: ["syndróm dráždivého čreva", "IBS", "dráždivé hrubé črevo"],
      cs: ["syndrom dráždivého tračníku", "IBS", "dráždivý tračník"],
    },
    specialties: ["gastroenterology", "general_practice"],
    icdHints: ["K58"],
  },
  {
    id: "crohns_disease",
    canonicalName: "Crohn's disease",
    triggers: {
      en: [
        "Crohn's disease",
        "Crohn disease",
        "regional enteritis",
        "inflammatory bowel disease",
      ],
      sk: ["Crohnova choroba", "regionálna enteritída", "Crohnova nemoc"],
      cs: ["Crohnova choroba", "regionální enteritida", "Crohnova nemoc"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K50"],
  },
  {
    id: "ulcerative_colitis",
    canonicalName: "Ulcerative colitis",
    triggers: {
      en: ["ulcerative colitis", "UC", "colitis ulcerosa", "bloody diarrhea"],
      sk: ["ulcerózna kolitída", "UC", "nešpecifická ulcerózna kolitída"],
      cs: ["ulcerózní kolitida", "UC", "nespecifická ulcerózní kolitida"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K51"],
  },
  {
    id: "peptic_ulcer",
    canonicalName: "Peptic ulcer disease",
    triggers: {
      en: ["peptic ulcer", "stomach ulcer", "gastric ulcer", "duodenal ulcer"],
      sk: [
        "peptický vred",
        "žalúdočný vred",
        "dvanástnikový vred",
        "vred žalúdka",
      ],
      cs: [
        "peptický vřed",
        "žaludeční vřed",
        "dvanáctníkový vřed",
        "vřed žaludku",
      ],
    },
    specialties: ["gastroenterology", "general_practice"],
    icdHints: ["K25", "K26", "K27"],
  },
  {
    id: "celiac_disease",
    canonicalName: "Celiac disease",
    triggers: {
      en: [
        "celiac disease",
        "coeliac disease",
        "gluten intolerance",
        "celiac sprue",
      ],
      sk: ["celiakia", "gluténová intolerancia", "celiakálna choroba"],
      cs: ["celiakie", "glutenová intolerance", "celiakální choroba"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K90"],
  },
  {
    id: "hepatitis_b",
    canonicalName: "Hepatitis B",
    triggers: {
      en: ["hepatitis B", "HBV", "chronic hepatitis B", "HBsAg positive"],
      sk: ["hepatitída B", "HBV", "chronická hepatitída B", "žltačka typu B"],
      cs: ["hepatitida B", "HBV", "chronická hepatitida B", "žloutenka typu B"],
    },
    specialties: ["gastroenterology", "internal_medicine"],
    icdHints: ["B16", "B18"],
  },
  {
    id: "hepatitis_c",
    canonicalName: "Hepatitis C",
    triggers: {
      en: ["hepatitis C", "HCV", "chronic hepatitis C"],
      sk: ["hepatitída C", "HCV", "chronická hepatitída C", "žltačka typu C"],
      cs: ["hepatitida C", "HCV", "chronická hepatitida C", "žloutenka typu C"],
    },
    specialties: ["gastroenterology", "internal_medicine"],
    icdHints: ["B17", "B18"],
  },
  {
    id: "liver_cirrhosis",
    canonicalName: "Liver cirrhosis",
    triggers: {
      en: [
        "liver cirrhosis",
        "cirrhosis",
        "hepatic cirrhosis",
        "liver scarring",
      ],
      sk: [
        "cirhóza pečene",
        "cirhóza",
        "hepatálna cirhóza",
        "zjazvenie pečene",
      ],
      cs: ["cirhóza jater", "cirhóza", "jaterní cirhóza", "zjizvení jater"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K74"],
  },
  {
    id: "acute_pancreatitis",
    canonicalName: "Acute pancreatitis",
    triggers: {
      en: ["acute pancreatitis", "pancreatitis", "pancreatic inflammation"],
      sk: ["akútna pankreatitída", "zápal pankreasu", "pankreatitída"],
      cs: ["akutní pankreatitida", "zánět slinivky", "pankreatitida"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K85"],
  },
  {
    id: "chronic_pancreatitis",
    canonicalName: "Chronic pancreatitis",
    triggers: {
      en: [
        "chronic pancreatitis",
        "chronic pancreatic inflammation",
        "pancreatic insufficiency",
      ],
      sk: [
        "chronická pankreatitída",
        "chronický zápal pankreasu",
        "pankreatická insuficiencia",
      ],
      cs: [
        "chronická pankreatitida",
        "chronický zánět slinivky",
        "pankreatická insuficience",
      ],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K86"],
  },
  {
    id: "cholelithiasis",
    canonicalName: "Cholelithiasis",
    triggers: {
      en: [
        "cholelithiasis",
        "gallstones",
        "gallbladder stones",
        "biliary colic",
      ],
      sk: [
        "cholelitiáza",
        "žlčníkové kamene",
        "žlčové kamene",
        "biliárna kolika",
      ],
      cs: [
        "cholelitáza",
        "žlučníkové kameny",
        "žlučové kameny",
        "biliární kolika",
      ],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K80"],
  },
  {
    id: "fatty_liver_disease",
    canonicalName: "Non-alcoholic fatty liver disease",
    triggers: {
      en: [
        "fatty liver",
        "NAFLD",
        "NASH",
        "non-alcoholic steatohepatitis",
        "hepatic steatosis",
      ],
      sk: [
        "stukovatenie pečene",
        "NAFLD",
        "nealkoholová steatohepatitída",
        "tučná pečeň",
      ],
      cs: [
        "ztučnění jater",
        "NAFLD",
        "nealkoholová steatohepatitida",
        "tučná játra",
      ],
    },
    specialties: ["gastroenterology", "internal_medicine"],
    icdHints: ["K76", "K75"],
  },
  {
    id: "diverticulitis",
    canonicalName: "Diverticulitis",
    triggers: {
      en: ["diverticulitis", "diverticular disease", "inflamed diverticula"],
      sk: ["divertikulitída", "divertikulárna choroba", "zápal divertiklov"],
      cs: ["divertikulitida", "divertikulární choroba", "zánět divertiklů"],
    },
    specialties: ["gastroenterology"],
    icdHints: ["K57"],
  },
  {
    id: "gastritis",
    canonicalName: "Gastritis",
    triggers: {
      en: [
        "gastritis",
        "stomach inflammation",
        "H. pylori gastritis",
        "chronic gastritis",
      ],
      sk: ["gastritída", "zápal žalúdka", "helicobakterová gastritída"],
      cs: ["gastritida", "zánět žaludku", "helicobakterová gastritida"],
    },
    specialties: ["gastroenterology", "general_practice"],
    icdHints: ["K29"],
  },
  {
    id: "hemorrhoids",
    canonicalName: "Hemorrhoids",
    triggers: {
      en: ["hemorrhoids", "piles", "rectal bleeding", "internal hemorrhoids"],
      sk: ["hemoroidy", "kŕčové žily konečníka", "hemoroidálna choroba"],
      cs: ["hemoroidy", "křečové žíly konečníku", "hemoroidální choroba"],
    },
    specialties: ["gastroenterology", "general_practice"],
    icdHints: ["K64"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NEUROLOGY (~15)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "migraine",
    canonicalName: "Migraine",
    triggers: {
      en: [
        "migraine",
        "migraine with aura",
        "migraine without aura",
        "hemicranial headache",
      ],
      sk: [
        "migréna",
        "migréna s aurou",
        "migréna bez aury",
        "záchvatové bolesti hlavy",
      ],
      cs: [
        "migréna",
        "migréna s aurou",
        "migréna bez aury",
        "záchvatové bolesti hlavy",
      ],
    },
    specialties: ["neurology", "general_practice"],
    icdHints: ["G43"],
  },
  {
    id: "epilepsy",
    canonicalName: "Epilepsy",
    triggers: {
      en: [
        "epilepsy",
        "seizure disorder",
        "seizures",
        "convulsions",
        "epileptic fit",
      ],
      sk: ["epilepsia", "záchvaty", "kŕče", "epileptický záchvat", "padúcnica"],
      cs: [
        "epilepsie",
        "záchvaty",
        "křeče",
        "epileptický záchvat",
        "padoucnice",
      ],
    },
    specialties: ["neurology"],
    icdHints: ["G40"],
  },
  {
    id: "stroke",
    canonicalName: "Stroke",
    triggers: {
      en: [
        "stroke",
        "cerebrovascular accident",
        "CVA",
        "ischemic stroke",
        "hemorrhagic stroke",
      ],
      sk: [
        "mozgová príhoda",
        "cievna mozgová príhoda",
        "CMP",
        "mŕtvica",
        "iktus",
      ],
      cs: [
        "mozková příhoda",
        "cévní mozková příhoda",
        "CMP",
        "mrtvice",
        "iktus",
      ],
    },
    specialties: ["neurology"],
    icdHints: ["I63", "I61", "I64"],
  },
  {
    id: "parkinsons_disease",
    canonicalName: "Parkinson's disease",
    triggers: {
      en: [
        "Parkinson's disease",
        "Parkinson",
        "parkinsonism",
        "tremor at rest",
      ],
      sk: [
        "Parkinsonova choroba",
        "parkinsonizmus",
        "Parkinson",
        "pokojový tremor",
      ],
      cs: [
        "Parkinsonova choroba",
        "parkinsonismus",
        "Parkinson",
        "klidový tremor",
      ],
    },
    specialties: ["neurology"],
    icdHints: ["G20"],
  },
  {
    id: "multiple_sclerosis",
    canonicalName: "Multiple sclerosis",
    triggers: {
      en: [
        "multiple sclerosis",
        "MS",
        "demyelinating disease",
        "relapsing-remitting MS",
      ],
      sk: [
        "skleróza multiplex",
        "SM",
        "roztrúsená skleróza",
        "demyelinizačné ochorenie",
      ],
      cs: [
        "roztroušená skleróza",
        "RS",
        "sclerosis multiplex",
        "demyelinizační onemocnění",
      ],
    },
    specialties: ["neurology"],
    icdHints: ["G35"],
  },
  {
    id: "peripheral_neuropathy",
    canonicalName: "Peripheral neuropathy",
    triggers: {
      en: [
        "peripheral neuropathy",
        "neuropathy",
        "nerve damage",
        "diabetic neuropathy",
        "polyneuropathy",
      ],
      sk: [
        "periférna neuropatia",
        "neuropatia",
        "polyneuropatia",
        "diabetická neuropatia",
      ],
      cs: [
        "periferní neuropatie",
        "neuropatie",
        "polyneuropatie",
        "diabetická neuropatie",
      ],
    },
    specialties: ["neurology", "endocrinology"],
    icdHints: ["G62", "G63"],
  },
  {
    id: "dementia",
    canonicalName: "Dementia",
    triggers: {
      en: ["dementia", "cognitive decline", "memory loss", "vascular dementia"],
      sk: [
        "demencia",
        "kognitívny úpadok",
        "strata pamäte",
        "vaskulárna demencia",
      ],
      cs: [
        "demence",
        "kognitivní úpadek",
        "ztráta paměti",
        "vaskulární demence",
      ],
    },
    specialties: ["neurology", "psychiatry"],
    icdHints: ["F03", "F01"],
  },
  {
    id: "alzheimers_disease",
    canonicalName: "Alzheimer's disease",
    triggers: {
      en: [
        "Alzheimer's disease",
        "Alzheimer",
        "Alzheimer dementia",
        "early-onset Alzheimer",
      ],
      sk: ["Alzheimerova choroba", "Alzheimer", "Alzheimerova demencia"],
      cs: ["Alzheimerova choroba", "Alzheimer", "Alzheimerova demence"],
    },
    specialties: ["neurology"],
    icdHints: ["G30"],
  },
  {
    id: "bells_palsy",
    canonicalName: "Bell's palsy",
    triggers: {
      en: [
        "Bell's palsy",
        "facial palsy",
        "facial nerve paralysis",
        "facial droop",
      ],
      sk: ["Bellova obrna", "obrna lícneho nervu", "paréza facialis"],
      cs: ["Bellova obrna", "obrna lícního nervu", "paréza facialis"],
    },
    specialties: ["neurology"],
    icdHints: ["G51"],
  },
  {
    id: "carpal_tunnel_syndrome",
    canonicalName: "Carpal tunnel syndrome",
    triggers: {
      en: [
        "carpal tunnel syndrome",
        "CTS",
        "carpal tunnel",
        "median nerve compression",
      ],
      sk: ["syndróm karpálneho tunela", "SKT", "karpálny tunel"],
      cs: ["syndrom karpálního tunelu", "SKT", "karpální tunel"],
    },
    specialties: ["neurology", "orthopedics"],
    icdHints: ["G56"],
  },
  {
    id: "trigeminal_neuralgia",
    canonicalName: "Trigeminal neuralgia",
    triggers: {
      en: [
        "trigeminal neuralgia",
        "tic douloureux",
        "facial nerve pain",
        "trigeminal pain",
      ],
      sk: [
        "neuralgia trojklaného nervu",
        "trigeminálna neuralgia",
        "bolesť trojklaného nervu",
      ],
      cs: [
        "neuralgie trojklanného nervu",
        "trigeminální neuralgie",
        "bolest trojklanného nervu",
      ],
    },
    specialties: ["neurology"],
    icdHints: ["G50"],
  },
  {
    id: "transient_ischemic_attack",
    canonicalName: "Transient ischemic attack",
    triggers: {
      en: [
        "transient ischemic attack",
        "TIA",
        "mini stroke",
        "transient stroke",
      ],
      sk: ["tranzitórny ischemický atak", "TIA", "prechodná mozgová ischémia"],
      cs: ["tranzitorní ischemická ataka", "TIA", "přechodná mozková ischemie"],
    },
    specialties: ["neurology"],
    icdHints: ["G45"],
  },
  {
    id: "meningitis",
    canonicalName: "Meningitis",
    triggers: {
      en: [
        "meningitis",
        "bacterial meningitis",
        "viral meningitis",
        "meningeal inflammation",
      ],
      sk: ["meningitída", "zápal mozgových blán", "bakteriálna meningitída"],
      cs: ["meningitida", "zánět mozkových blan", "bakteriální meningitida"],
    },
    specialties: ["neurology", "internal_medicine"],
    icdHints: ["G03", "G00"],
  },
  {
    id: "restless_legs_syndrome",
    canonicalName: "Restless legs syndrome",
    triggers: {
      en: [
        "restless legs syndrome",
        "RLS",
        "restless legs",
        "Willis-Ekbom disease",
      ],
      sk: ["syndróm nepokojných nôh", "RLS", "nepokojné nohy"],
      cs: ["syndrom neklidných nohou", "RLS", "neklidné nohy"],
    },
    specialties: ["neurology"],
    icdHints: ["G25"],
  },
  {
    id: "myasthenia_gravis",
    canonicalName: "Myasthenia gravis",
    triggers: {
      en: [
        "myasthenia gravis",
        "MG",
        "muscle weakness autoimmune",
        "myasthenia",
      ],
      sk: ["myasténia gravis", "MG", "myasténia", "svalová slabosť"],
      cs: ["myastenie gravis", "MG", "myastenie", "svalová slabost"],
    },
    specialties: ["neurology"],
    icdHints: ["G70"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ORTHOPEDICS (~15)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "osteoarthritis",
    canonicalName: "Osteoarthritis",
    triggers: {
      en: [
        "osteoarthritis",
        "OA",
        "degenerative joint disease",
        "wear and tear arthritis",
      ],
      sk: ["osteoartróza", "OA", "degeneratívne ochorenie kĺbov", "artróza"],
      cs: ["osteoartróza", "OA", "degenerativní onemocnění kloubů", "artróza"],
    },
    specialties: ["orthopedics", "general_practice"],
    icdHints: ["M15", "M16", "M17"],
  },
  {
    id: "rheumatoid_arthritis",
    canonicalName: "Rheumatoid arthritis",
    triggers: {
      en: ["rheumatoid arthritis", "RA", "rheumatoid", "autoimmune arthritis"],
      sk: [
        "reumatoidná artritída",
        "RA",
        "reumatoidná",
        "autoimunitná artritída",
      ],
      cs: [
        "revmatoidní artritida",
        "RA",
        "revmatoidní",
        "autoimunitní artritida",
      ],
    },
    specialties: ["orthopedics", "internal_medicine"],
    icdHints: ["M05", "M06"],
  },
  {
    id: "disc_herniation",
    canonicalName: "Intervertebral disc herniation",
    triggers: {
      en: [
        "disc herniation",
        "herniated disc",
        "slipped disc",
        "bulging disc",
        "disc prolapse",
      ],
      sk: [
        "hernia disku",
        "vysunutá platňa",
        "výhrez medzistavcovej platne",
        "herniácia disku",
      ],
      cs: [
        "hernie disku",
        "výhřez ploténky",
        "vyhřezlá ploténka",
        "herniace disku",
      ],
    },
    specialties: ["orthopedics", "neurology"],
    icdHints: ["M51"],
  },
  {
    id: "meniscus_tear",
    canonicalName: "Meniscus tear",
    triggers: {
      en: [
        "meniscus tear",
        "torn meniscus",
        "meniscal injury",
        "knee cartilage tear",
      ],
      sk: ["trhlina menisku", "natrhnutý meniskus", "poranenie menisku"],
      cs: ["trhlina menisku", "natržený meniskus", "poranění menisku"],
    },
    specialties: ["orthopedics"],
    icdHints: ["M23", "S83"],
  },
  {
    id: "rotator_cuff_tear",
    canonicalName: "Rotator cuff tear",
    triggers: {
      en: [
        "rotator cuff tear",
        "rotator cuff injury",
        "shoulder tear",
        "torn rotator cuff",
      ],
      sk: [
        "trhlina rotátorovej manžety",
        "poranenie rotátorovej manžety",
        "ruptúra manžety",
      ],
      cs: [
        "trhlina rotátorové manžety",
        "poranění rotátorové manžety",
        "ruptura manžety",
      ],
    },
    specialties: ["orthopedics"],
    icdHints: ["M75"],
  },
  {
    id: "osteoporosis",
    canonicalName: "Osteoporosis",
    triggers: {
      en: ["osteoporosis", "bone loss", "brittle bones", "low bone density"],
      sk: [
        "osteoporóza",
        "rednutie kostí",
        "krehké kosti",
        "nízka hustota kostí",
      ],
      cs: [
        "osteoporóza",
        "řídnutí kostí",
        "křehké kosti",
        "nízká hustota kostí",
      ],
    },
    specialties: ["orthopedics", "endocrinology"],
    icdHints: ["M80", "M81"],
  },
  {
    id: "scoliosis",
    canonicalName: "Scoliosis",
    triggers: {
      en: [
        "scoliosis",
        "spinal curvature",
        "curved spine",
        "lateral spinal curvature",
      ],
      sk: ["skolióza", "zakrivenie chrbtice", "bočné zakrivenie chrbtice"],
      cs: ["skolióza", "zakřivení páteře", "boční zakřivení páteře"],
    },
    specialties: ["orthopedics"],
    icdHints: ["M41"],
  },
  {
    id: "fracture_general",
    canonicalName: "Fracture",
    triggers: {
      en: ["fracture", "broken bone", "bone fracture", "stress fracture"],
      sk: ["zlomenina", "fraktúra", "zlomená kosť", "únavová zlomenina"],
      cs: ["zlomenina", "fraktura", "zlomená kost", "únavová zlomenina"],
    },
    specialties: ["orthopedics"],
    icdHints: ["S42", "S52", "S72", "S82"],
  },
  {
    id: "frozen_shoulder",
    canonicalName: "Adhesive capsulitis (frozen shoulder)",
    triggers: {
      en: [
        "frozen shoulder",
        "adhesive capsulitis",
        "stiff shoulder",
        "shoulder capsulitis",
      ],
      sk: ["zamrznuté rameno", "adhezívna kapsulitída", "stuhnuté rameno"],
      cs: ["zmrzlé rameno", "adhezivní kapsulitida", "ztuhlé rameno"],
    },
    specialties: ["orthopedics"],
    icdHints: ["M75"],
  },
  {
    id: "anterior_cruciate_ligament_tear",
    canonicalName: "Anterior cruciate ligament tear",
    triggers: {
      en: [
        "ACL tear",
        "anterior cruciate ligament tear",
        "torn ACL",
        "ACL injury",
      ],
      sk: [
        "ruptúra predného skríženého väzu",
        "poranenie LCA",
        "pretrhnutý predný skrížený väz",
      ],
      cs: [
        "ruptura předního zkříženého vazu",
        "poranění LCA",
        "přetržený přední zkřížený vaz",
      ],
    },
    specialties: ["orthopedics"],
    icdHints: ["S83"],
  },
  {
    id: "plantar_fasciitis",
    canonicalName: "Plantar fasciitis",
    triggers: {
      en: ["plantar fasciitis", "heel pain", "heel spur", "plantar heel pain"],
      sk: [
        "plantárna fascitída",
        "bolesť päty",
        "pätný ostroha",
        "zápal plantárnej fascie",
      ],
      cs: [
        "plantární fascitida",
        "bolest paty",
        "patní ostruha",
        "zánět plantární fascie",
      ],
    },
    specialties: ["orthopedics"],
    icdHints: ["M72"],
  },
  {
    id: "spinal_stenosis",
    canonicalName: "Spinal stenosis",
    triggers: {
      en: ["spinal stenosis", "lumbar stenosis", "narrowing of spinal canal"],
      sk: ["spinálna stenóza", "lumbálna stenóza", "zúženie spinálneho kanála"],
      cs: ["spinální stenóza", "lumbální stenóza", "zúžení páteřního kanálu"],
    },
    specialties: ["orthopedics", "neurology"],
    icdHints: ["M48"],
  },
  {
    id: "tendinitis",
    canonicalName: "Tendinitis",
    triggers: {
      en: [
        "tendinitis",
        "tendonitis",
        "tendon inflammation",
        "Achilles tendinitis",
      ],
      sk: ["tendinitída", "zápal šľachy", "tendinóza", "achilová tendinitída"],
      cs: ["tendinitida", "zánět šlachy", "tendinóza", "achilová tendinitida"],
    },
    specialties: ["orthopedics"],
    icdHints: ["M76", "M77"],
  },
  {
    id: "cervical_spondylosis",
    canonicalName: "Cervical spondylosis",
    triggers: {
      en: [
        "cervical spondylosis",
        "neck arthritis",
        "cervical osteoarthritis",
        "neck degeneration",
      ],
      sk: [
        "krčná spondylóza",
        "artróza krčnej chrbtice",
        "cervikálna spondylóza",
      ],
      cs: ["krční spondylóza", "artróza krční páteře", "cervikální spondylóza"],
    },
    specialties: ["orthopedics", "neurology"],
    icdHints: ["M47"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DERMATOLOGY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "eczema",
    canonicalName: "Eczema (atopic dermatitis)",
    triggers: {
      en: ["eczema", "atopic dermatitis", "atopic eczema", "skin inflammation"],
      sk: ["ekzém", "atopická dermatitída", "atopický ekzém"],
      cs: ["ekzém", "atopická dermatitida", "atopický ekzém"],
    },
    specialties: ["dermatology", "general_practice"],
    icdHints: ["L20"],
  },
  {
    id: "psoriasis",
    canonicalName: "Psoriasis",
    triggers: {
      en: ["psoriasis", "plaque psoriasis", "psoriatic skin", "scaly patches"],
      sk: ["psoriáza", "lupienka", "ložisková psoriáza", "šupinatá koža"],
      cs: ["psoriáza", "lupénka", "ložisková psoriáza", "šupinatá kůže"],
    },
    specialties: ["dermatology"],
    icdHints: ["L40"],
  },
  {
    id: "acne_vulgaris",
    canonicalName: "Acne vulgaris",
    triggers: {
      en: ["acne", "acne vulgaris", "pimples", "cystic acne"],
      sk: ["akné", "akné vulgaris", "pupence", "vyrážky"],
      cs: ["akné", "akné vulgaris", "pupínky", "vyrážky"],
    },
    specialties: ["dermatology"],
    icdHints: ["L70"],
  },
  {
    id: "melanoma",
    canonicalName: "Melanoma",
    triggers: {
      en: [
        "melanoma",
        "malignant melanoma",
        "skin cancer melanoma",
        "mole cancer",
      ],
      sk: ["melanóm", "malígny melanóm", "kožný melanóm"],
      cs: ["melanom", "maligní melanom", "kožní melanom"],
    },
    specialties: ["dermatology", "oncology"],
    icdHints: ["C43"],
  },
  {
    id: "urticaria",
    canonicalName: "Urticaria",
    triggers: {
      en: ["urticaria", "hives", "chronic urticaria", "allergic hives"],
      sk: ["urtikária", "žihľavka", "chronická urtikária", "koprivka"],
      cs: ["urtikárie", "kopřivka", "chronická urtikárie", "kopřivkový výsev"],
    },
    specialties: ["dermatology", "general_practice"],
    icdHints: ["L50"],
  },
  {
    id: "fungal_skin_infection",
    canonicalName: "Fungal skin infection",
    triggers: {
      en: [
        "fungal infection",
        "ringworm",
        "tinea",
        "athlete's foot",
        "dermatophytosis",
      ],
      sk: ["hubová infekcia", "mykóza", "tinea", "plesňové ochorenie kože"],
      cs: ["plísňová infekce", "mykóza", "tinea", "plísňové onemocnění kůže"],
    },
    specialties: ["dermatology"],
    icdHints: ["B35", "B36"],
  },
  {
    id: "herpes_zoster",
    canonicalName: "Herpes zoster",
    triggers: {
      en: ["herpes zoster", "shingles", "zoster", "postherpetic neuralgia"],
      sk: [
        "herpes zoster",
        "pásový opar",
        "zoster",
        "postherpetická neuralgia",
      ],
      cs: [
        "herpes zoster",
        "pásový opar",
        "zoster",
        "postherpetická neuralgie",
      ],
    },
    specialties: ["dermatology", "neurology"],
    icdHints: ["B02"],
  },
  {
    id: "rosacea",
    canonicalName: "Rosacea",
    triggers: {
      en: ["rosacea", "facial redness", "acne rosacea", "facial flushing"],
      sk: ["rozácea", "sčervenanie tváre", "akné rozácea"],
      cs: ["rozaccea", "zarudnutí obličeje", "akné rozacea"],
    },
    specialties: ["dermatology"],
    icdHints: ["L71"],
  },
  {
    id: "seborrheic_dermatitis",
    canonicalName: "Seborrheic dermatitis",
    triggers: {
      en: ["seborrheic dermatitis", "dandruff", "seborrhea", "cradle cap"],
      sk: ["seboroická dermatitída", "lupiny", "seborea", "mliečny strup"],
      cs: ["seboroická dermatitida", "lupy", "seborea", "mléčný strup"],
    },
    specialties: ["dermatology"],
    icdHints: ["L21"],
  },
  {
    id: "vitiligo",
    canonicalName: "Vitiligo",
    triggers: {
      en: ["vitiligo", "skin depigmentation", "white patches on skin"],
      sk: ["vitiligo", "depigmentácia kože", "biele škvrny na koži"],
      cs: ["vitiligo", "depigmentace kůže", "bílé skvrny na kůži"],
    },
    specialties: ["dermatology"],
    icdHints: ["L80"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PSYCHIATRY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "major_depressive_disorder",
    canonicalName: "Major depressive disorder",
    triggers: {
      en: [
        "depression",
        "major depressive disorder",
        "MDD",
        "clinical depression",
      ],
      sk: [
        "depresia",
        "depresívna porucha",
        "klinická depresia",
        "depresívna epizóda",
      ],
      cs: [
        "deprese",
        "depresivní porucha",
        "klinická deprese",
        "depresivní epizoda",
      ],
    },
    specialties: ["psychiatry", "general_practice"],
    icdHints: ["F32", "F33"],
  },
  {
    id: "generalized_anxiety_disorder",
    canonicalName: "Generalized anxiety disorder",
    triggers: {
      en: [
        "anxiety",
        "generalized anxiety disorder",
        "GAD",
        "anxiety disorder",
      ],
      sk: [
        "úzkosť",
        "generalizovaná úzkostná porucha",
        "GAD",
        "úzkostná porucha",
      ],
      cs: [
        "úzkost",
        "generalizovaná úzkostná porucha",
        "GAD",
        "úzkostná porucha",
      ],
    },
    specialties: ["psychiatry", "general_practice"],
    icdHints: ["F41"],
  },
  {
    id: "ptsd",
    canonicalName: "Post-traumatic stress disorder",
    triggers: {
      en: [
        "PTSD",
        "post-traumatic stress disorder",
        "trauma disorder",
        "post-traumatic stress",
      ],
      sk: [
        "PTSD",
        "posttraumatická stresová porucha",
        "poúrazová stresová porucha",
      ],
      cs: [
        "PTSD",
        "posttraumatická stresová porucha",
        "poúrazová stresová porucha",
      ],
    },
    specialties: ["psychiatry"],
    icdHints: ["F43"],
  },
  {
    id: "bipolar_disorder",
    canonicalName: "Bipolar disorder",
    triggers: {
      en: [
        "bipolar disorder",
        "bipolar",
        "manic-depressive",
        "mania",
        "bipolar I",
        "bipolar II",
      ],
      sk: [
        "bipolárna porucha",
        "bipolárna afektívna porucha",
        "maniodepresívna porucha",
      ],
      cs: [
        "bipolární porucha",
        "bipolární afektivní porucha",
        "maniodepresivní porucha",
      ],
    },
    specialties: ["psychiatry"],
    icdHints: ["F31"],
  },
  {
    id: "schizophrenia",
    canonicalName: "Schizophrenia",
    triggers: {
      en: [
        "schizophrenia",
        "psychosis",
        "schizophrenic disorder",
        "psychotic disorder",
      ],
      sk: ["schizofrénia", "psychóza", "schizofrenická porucha"],
      cs: ["schizofrenie", "psychóza", "schizofrenní porucha"],
    },
    specialties: ["psychiatry"],
    icdHints: ["F20"],
  },
  {
    id: "adhd",
    canonicalName: "Attention-deficit/hyperactivity disorder",
    triggers: {
      en: ["ADHD", "attention deficit", "hyperactivity disorder", "ADD"],
      sk: ["ADHD", "porucha pozornosti", "hyperaktivita", "ADD"],
      cs: ["ADHD", "porucha pozornosti", "hyperaktivita", "ADD"],
    },
    specialties: ["psychiatry", "pediatrics"],
    icdHints: ["F90"],
  },
  {
    id: "insomnia",
    canonicalName: "Insomnia",
    triggers: {
      en: [
        "insomnia",
        "sleeplessness",
        "sleep disorder",
        "difficulty sleeping",
      ],
      sk: ["insomnia", "nespavosť", "porucha spánku", "ťažkosti so spánkom"],
      cs: ["insomnie", "nespavost", "porucha spánku", "potíže se spánkem"],
    },
    specialties: ["psychiatry", "general_practice"],
    icdHints: ["G47", "F51"],
  },
  {
    id: "panic_disorder",
    canonicalName: "Panic disorder",
    triggers: {
      en: ["panic disorder", "panic attack", "panic attacks", "panic"],
      sk: ["panická porucha", "panický záchvat", "záchvaty paniky"],
      cs: ["panická porucha", "panický záchvat", "záchvaty paniky"],
    },
    specialties: ["psychiatry"],
    icdHints: ["F41"],
  },
  {
    id: "ocd",
    canonicalName: "Obsessive-compulsive disorder",
    triggers: {
      en: [
        "OCD",
        "obsessive-compulsive disorder",
        "obsessive compulsive",
        "compulsive behavior",
      ],
      sk: ["OCD", "obsedantno-kompulzívna porucha", "nutkavé správanie"],
      cs: ["OCD", "obsedantně-kompulzivní porucha", "nutkavé chování"],
    },
    specialties: ["psychiatry"],
    icdHints: ["F42"],
  },
  {
    id: "eating_disorder",
    canonicalName: "Eating disorder",
    triggers: {
      en: [
        "eating disorder",
        "anorexia nervosa",
        "bulimia nervosa",
        "anorexia",
        "bulimia",
      ],
      sk: [
        "porucha príjmu potravy",
        "anorexia nervóza",
        "bulímia nervóza",
        "anorexia",
      ],
      cs: [
        "porucha příjmu potravy",
        "anorexie nervóza",
        "bulimie nervóza",
        "anorexie",
      ],
    },
    specialties: ["psychiatry"],
    icdHints: ["F50"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PEDIATRICS (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "otitis_media",
    canonicalName: "Acute otitis media",
    triggers: {
      en: [
        "otitis media",
        "ear infection",
        "middle ear infection",
        "acute otitis media",
      ],
      sk: [
        "zápal stredného ucha",
        "otitis media",
        "akútny zápal stredného ucha",
      ],
      cs: [
        "zánět středního ucha",
        "otitis media",
        "akutní zánět středního ucha",
      ],
    },
    specialties: ["pediatrics", "ent", "general_practice"],
    icdHints: ["H66"],
  },
  {
    id: "bronchiolitis",
    canonicalName: "Bronchiolitis",
    triggers: {
      en: [
        "bronchiolitis",
        "RSV bronchiolitis",
        "infant wheezing",
        "viral bronchiolitis",
      ],
      sk: ["bronchiolitída", "RSV bronchiolitída", "vírusová bronchiolitída"],
      cs: ["bronchiolitida", "RSV bronchiolitida", "virová bronchiolitida"],
    },
    specialties: ["pediatrics", "pulmonology"],
    icdHints: ["J21"],
  },
  {
    id: "croup",
    canonicalName: "Croup",
    triggers: {
      en: ["croup", "laryngotracheobronchitis", "barking cough", "stridor"],
      sk: ["krup", "laryngotracheobronchitída", "štekavý kašeľ", "stridor"],
      cs: ["krup", "laryngotracheobronchitida", "štěkavý kašel", "stridor"],
    },
    specialties: ["pediatrics", "ent"],
    icdHints: ["J05"],
  },
  {
    id: "febrile_seizures",
    canonicalName: "Febrile seizures",
    triggers: {
      en: [
        "febrile seizures",
        "fever seizure",
        "febrile convulsions",
        "fever fits",
      ],
      sk: ["febrilné kŕče", "horúčkové kŕče", "febrilné konvulzie"],
      cs: ["febrilní křeče", "horečkové křeče", "febrilní konvulze"],
    },
    specialties: ["pediatrics", "neurology"],
    icdHints: ["R56"],
  },
  {
    id: "rsv_infection",
    canonicalName: "Respiratory syncytial virus infection",
    triggers: {
      en: [
        "RSV",
        "respiratory syncytial virus",
        "RSV infection",
        "RSV pneumonia",
      ],
      sk: ["RSV", "respiračný syncyciálny vírus", "RSV infekcia"],
      cs: ["RSV", "respirační syncytiální virus", "RSV infekce"],
    },
    specialties: ["pediatrics"],
    icdHints: ["J12", "J21"],
  },
  {
    id: "hand_foot_mouth_disease",
    canonicalName: "Hand, foot, and mouth disease",
    triggers: {
      en: [
        "hand foot mouth disease",
        "HFMD",
        "hand foot and mouth",
        "coxsackievirus",
      ],
      sk: ["choroba ruka-noha-ústa", "HFMD", "ruky-nohy-ústa"],
      cs: ["nemoc ruka-noha-ústa", "HFMD", "ruce-nohy-ústa"],
    },
    specialties: ["pediatrics"],
    icdHints: ["B08"],
  },
  {
    id: "failure_to_thrive",
    canonicalName: "Failure to thrive",
    triggers: {
      en: ["failure to thrive", "FTT", "poor weight gain", "growth failure"],
      sk: [
        "neprospievanie",
        "zlyhanie rastu",
        "nedostatočný prírastok hmotnosti",
      ],
      cs: ["neprospívání", "selhání růstu", "nedostatečný přírůstek hmotnosti"],
    },
    specialties: ["pediatrics"],
    icdHints: ["R62"],
  },
  {
    id: "scarlet_fever",
    canonicalName: "Scarlet fever",
    triggers: {
      en: ["scarlet fever", "scarlatina", "strep rash", "sandpaper rash"],
      sk: ["šarlach", "šarlátová horúčka", "skarlatína"],
      cs: ["spála", "šarlach", "skarlatina"],
    },
    specialties: ["pediatrics", "general_practice"],
    icdHints: ["A38"],
  },
  {
    id: "kawasaki_disease",
    canonicalName: "Kawasaki disease",
    triggers: {
      en: [
        "Kawasaki disease",
        "Kawasaki syndrome",
        "mucocutaneous lymph node syndrome",
      ],
      sk: ["Kawasakiho choroba", "Kawasakiho syndróm"],
      cs: ["Kawasakiho choroba", "Kawasakiho syndrom"],
    },
    specialties: ["pediatrics", "cardiology"],
    icdHints: ["M30"],
  },
  {
    id: "neonatal_jaundice",
    canonicalName: "Neonatal jaundice",
    triggers: {
      en: [
        "neonatal jaundice",
        "newborn jaundice",
        "physiological jaundice",
        "neonatal hyperbilirubinemia",
      ],
      sk: [
        "novorodenecká žltačka",
        "neonatálna žltačka",
        "fyziologická žltačka",
      ],
      cs: [
        "novorozenecká žloutenka",
        "neonatální žloutenka",
        "fyziologická žloutenka",
      ],
    },
    specialties: ["pediatrics"],
    icdHints: ["P59"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GYNECOLOGY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "endometriosis",
    canonicalName: "Endometriosis",
    triggers: {
      en: [
        "endometriosis",
        "endometrial implants",
        "ectopic endometrium",
        "endometrioma",
      ],
      sk: ["endometrióza", "endometriálne implantáty", "endometrióm"],
      cs: ["endometrióza", "endometriální implantáty", "endometriom"],
    },
    specialties: ["gynecology"],
    icdHints: ["N80"],
  },
  {
    id: "pcos",
    canonicalName: "Polycystic ovary syndrome",
    triggers: {
      en: [
        "PCOS",
        "polycystic ovary syndrome",
        "polycystic ovaries",
        "Stein-Leventhal",
      ],
      sk: ["PCOS", "syndróm polycystických ovárií", "polycystické ováriá"],
      cs: ["PCOS", "syndrom polycystických ovarií", "polycystická ovaria"],
    },
    specialties: ["gynecology", "endocrinology"],
    icdHints: ["E28"],
  },
  {
    id: "menorrhagia",
    canonicalName: "Menorrhagia",
    triggers: {
      en: [
        "menorrhagia",
        "heavy menstrual bleeding",
        "heavy periods",
        "excessive menstruation",
      ],
      sk: [
        "menorágia",
        "silné menštruačné krvácanie",
        "silné periódy",
        "nadmerné krvácanie",
      ],
      cs: [
        "menoragie",
        "silné menstruační krvácení",
        "silné periody",
        "nadměrné krvácení",
      ],
    },
    specialties: ["gynecology"],
    icdHints: ["N92"],
  },
  {
    id: "cervicitis",
    canonicalName: "Cervicitis",
    triggers: {
      en: ["cervicitis", "cervical inflammation", "inflamed cervix"],
      sk: ["cervicitída", "zápal krčka maternice", "zápal cervixu"],
      cs: ["cervicitida", "zánět děložního čípku", "zánět cervixu"],
    },
    specialties: ["gynecology"],
    icdHints: ["N72"],
  },
  {
    id: "uterine_fibroids",
    canonicalName: "Uterine fibroids",
    triggers: {
      en: [
        "uterine fibroids",
        "fibroids",
        "leiomyoma",
        "myoma",
        "fibroid uterus",
      ],
      sk: ["myóm maternice", "fibroid", "leiomyóm", "myómy"],
      cs: ["myom dělohy", "fibroid", "leiomyom", "myomy"],
    },
    specialties: ["gynecology"],
    icdHints: ["D25"],
  },
  {
    id: "menopause",
    canonicalName: "Menopause",
    triggers: {
      en: [
        "menopause",
        "menopausal symptoms",
        "hot flashes",
        "climacteric",
        "perimenopause",
      ],
      sk: ["menopauza", "klimaktérium", "návaly horúčavy", "prechod"],
      cs: ["menopauza", "klimakterium", "návaly horka", "přechod"],
    },
    specialties: ["gynecology", "endocrinology"],
    icdHints: ["N95"],
  },
  {
    id: "pelvic_inflammatory_disease",
    canonicalName: "Pelvic inflammatory disease",
    triggers: {
      en: [
        "pelvic inflammatory disease",
        "PID",
        "pelvic infection",
        "adnexitis",
      ],
      sk: [
        "zápal panvových orgánov",
        "PID",
        "adnexitída",
        "zápalové ochorenie panvy",
      ],
      cs: [
        "pánevní zánětlivé onemocnění",
        "PID",
        "adnexitida",
        "zánětlivé onemocnění pánve",
      ],
    },
    specialties: ["gynecology"],
    icdHints: ["N73", "N74"],
  },
  {
    id: "ovarian_cyst",
    canonicalName: "Ovarian cyst",
    triggers: {
      en: ["ovarian cyst", "cyst on ovary", "ovarian mass", "functional cyst"],
      sk: ["cysta vaječníka", "ovariálna cysta", "útvar na vaječníku"],
      cs: ["cysta vaječníku", "ovariální cysta", "útvar na vaječníku"],
    },
    specialties: ["gynecology"],
    icdHints: ["N83"],
  },
  {
    id: "dysmenorrhea",
    canonicalName: "Dysmenorrhea",
    triggers: {
      en: [
        "dysmenorrhea",
        "painful periods",
        "menstrual cramps",
        "period pain",
      ],
      sk: ["dysmenorea", "bolestivá menštruácia", "menštruačné kŕče"],
      cs: ["dysmenorea", "bolestivá menstruace", "menstruační křeče"],
    },
    specialties: ["gynecology", "general_practice"],
    icdHints: ["N94"],
  },
  {
    id: "cervical_dysplasia",
    canonicalName: "Cervical dysplasia",
    triggers: {
      en: [
        "cervical dysplasia",
        "CIN",
        "abnormal pap smear",
        "cervical intraepithelial neoplasia",
      ],
      sk: [
        "cervikálna dysplázia",
        "CIN",
        "abnormálna cytológia",
        "dysplázia krčka maternice",
      ],
      cs: [
        "cervikální dysplazie",
        "CIN",
        "abnormální cytologie",
        "dysplazie děložního čípku",
      ],
    },
    specialties: ["gynecology", "oncology"],
    icdHints: ["N87"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // UROLOGY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "benign_prostatic_hyperplasia",
    canonicalName: "Benign prostatic hyperplasia",
    triggers: {
      en: [
        "benign prostatic hyperplasia",
        "BPH",
        "enlarged prostate",
        "prostatic hypertrophy",
      ],
      sk: [
        "benígna hyperplázia prostaty",
        "BPH",
        "zväčšená prostata",
        "adenóm prostaty",
      ],
      cs: [
        "benigní hyperplazie prostaty",
        "BPH",
        "zvětšená prostata",
        "adenom prostaty",
      ],
    },
    specialties: ["urology"],
    icdHints: ["N40"],
  },
  {
    id: "prostatitis",
    canonicalName: "Prostatitis",
    triggers: {
      en: [
        "prostatitis",
        "prostate inflammation",
        "chronic prostatitis",
        "acute prostatitis",
      ],
      sk: ["prostatitída", "zápal prostaty", "chronická prostatitída"],
      cs: ["prostatitida", "zánět prostaty", "chronická prostatitida"],
    },
    specialties: ["urology"],
    icdHints: ["N41"],
  },
  {
    id: "nephrolithiasis",
    canonicalName: "Nephrolithiasis (kidney stones)",
    triggers: {
      en: [
        "kidney stones",
        "nephrolithiasis",
        "renal calculi",
        "urolithiasis",
        "renal colic",
      ],
      sk: [
        "obličkové kamene",
        "nefrolitiáza",
        "renálna kolika",
        "obličková kolika",
      ],
      cs: [
        "ledvinové kameny",
        "nefrolitiáza",
        "renální kolika",
        "ledvinová kolika",
      ],
    },
    specialties: ["urology", "general_practice"],
    icdHints: ["N20"],
  },
  {
    id: "chronic_kidney_disease",
    canonicalName: "Chronic kidney disease",
    triggers: {
      en: [
        "chronic kidney disease",
        "CKD",
        "renal failure",
        "kidney failure",
        "renal insufficiency",
      ],
      sk: [
        "chronická obličková choroba",
        "CKD",
        "zlyhanie obličiek",
        "renálna insuficiencia",
      ],
      cs: [
        "chronické onemocnění ledvin",
        "CKD",
        "selhání ledvin",
        "renální insuficience",
      ],
    },
    specialties: ["urology", "internal_medicine"],
    icdHints: ["N18"],
  },
  {
    id: "overactive_bladder",
    canonicalName: "Overactive bladder",
    triggers: {
      en: [
        "overactive bladder",
        "OAB",
        "urinary urgency",
        "urgency incontinence",
      ],
      sk: [
        "hyperaktívny mechúr",
        "OAB",
        "urgentná inkontinencia",
        "nutkanie na močenie",
      ],
      cs: [
        "hyperaktivní měchýř",
        "OAB",
        "urgentní inkontinence",
        "nucení na močení",
      ],
    },
    specialties: ["urology"],
    icdHints: ["N32"],
  },
  {
    id: "urinary_incontinence",
    canonicalName: "Urinary incontinence",
    triggers: {
      en: [
        "urinary incontinence",
        "stress incontinence",
        "urine leakage",
        "incontinence",
      ],
      sk: ["močová inkontinencia", "stresová inkontinencia", "únik moču"],
      cs: ["močová inkontinence", "stresová inkontinence", "únik moči"],
    },
    specialties: ["urology", "gynecology"],
    icdHints: ["N39", "R32"],
  },
  {
    id: "pyelonephritis",
    canonicalName: "Pyelonephritis",
    triggers: {
      en: [
        "pyelonephritis",
        "kidney infection",
        "upper UTI",
        "renal infection",
      ],
      sk: ["pyelonefritída", "infekcia obličiek", "zápal obličiek"],
      cs: ["pyelonefritida", "infekce ledvin", "zánět ledvin"],
    },
    specialties: ["urology", "internal_medicine"],
    icdHints: ["N10", "N11"],
  },
  {
    id: "hydronephrosis",
    canonicalName: "Hydronephrosis",
    triggers: {
      en: [
        "hydronephrosis",
        "swollen kidney",
        "renal obstruction",
        "dilated renal pelvis",
      ],
      sk: [
        "hydronefróza",
        "opuchnutá oblička",
        "dilatácia obličkovej panvičky",
      ],
      cs: ["hydronefróza", "oteklá ledvina", "dilatace ledvinné pánvičky"],
    },
    specialties: ["urology"],
    icdHints: ["N13"],
  },
  {
    id: "erectile_dysfunction",
    canonicalName: "Erectile dysfunction",
    triggers: {
      en: ["erectile dysfunction", "ED", "impotence", "erection problems"],
      sk: ["erektilná dysfunkcia", "ED", "impotencia", "porucha erekcie"],
      cs: ["erektilní dysfunkce", "ED", "impotence", "porucha erekce"],
    },
    specialties: ["urology"],
    icdHints: ["N48"],
  },
  {
    id: "testicular_torsion",
    canonicalName: "Testicular torsion",
    triggers: {
      en: ["testicular torsion", "twisted testicle", "torsion of testis"],
      sk: ["torzia semenníka", "skrútenie semenníka", "torzia testisu"],
      cs: ["torze varlete", "zkroucení varlete", "torze testis"],
    },
    specialties: ["urology"],
    icdHints: ["N44"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ENDOCRINOLOGY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "type_1_diabetes",
    canonicalName: "Type 1 diabetes mellitus",
    triggers: {
      en: [
        "type 1 diabetes",
        "T1DM",
        "insulin-dependent diabetes",
        "juvenile diabetes",
      ],
      sk: [
        "diabetes mellitus 1. typu",
        "cukrovka 1. typu",
        "inzulínovo-dependentný diabetes",
        "DM1",
      ],
      cs: [
        "diabetes mellitus 1. typu",
        "cukrovka 1. typu",
        "inzulinově-dependentní diabetes",
        "DM1",
      ],
    },
    specialties: ["endocrinology", "pediatrics"],
    icdHints: ["E10"],
  },
  {
    id: "hyperthyroidism",
    canonicalName: "Hyperthyroidism",
    triggers: {
      en: [
        "hyperthyroidism",
        "overactive thyroid",
        "Graves disease",
        "thyrotoxicosis",
      ],
      sk: [
        "hypertyreóza",
        "zvýšená funkcia štítnej žľazy",
        "Gravesova choroba",
        "tyreotoxikóza",
      ],
      cs: [
        "hypertyreóza",
        "zvýšená funkce štítné žlázy",
        "Gravesova choroba",
        "tyreotoxikóza",
      ],
    },
    specialties: ["endocrinology"],
    icdHints: ["E05"],
  },
  {
    id: "cushings_syndrome",
    canonicalName: "Cushing's syndrome",
    triggers: {
      en: [
        "Cushing's syndrome",
        "hypercortisolism",
        "Cushing's disease",
        "Cushing",
      ],
      sk: ["Cushingov syndróm", "hyperkorticizmus", "Cushingova choroba"],
      cs: ["Cushingův syndrom", "hyperkortizolismus", "Cushingova choroba"],
    },
    specialties: ["endocrinology"],
    icdHints: ["E24"],
  },
  {
    id: "addisons_disease",
    canonicalName: "Addison's disease",
    triggers: {
      en: [
        "Addison's disease",
        "adrenal insufficiency",
        "primary adrenal failure",
        "Addison",
      ],
      sk: [
        "Addisonova choroba",
        "adrenálna insuficiencia",
        "nedostatočnosť nadobličiek",
      ],
      cs: [
        "Addisonova choroba",
        "adrenální insuficience",
        "nedostatečnost nadledvin",
      ],
    },
    specialties: ["endocrinology"],
    icdHints: ["E27"],
  },
  {
    id: "metabolic_syndrome",
    canonicalName: "Metabolic syndrome",
    triggers: {
      en: [
        "metabolic syndrome",
        "syndrome X",
        "insulin resistance syndrome",
        "cardiometabolic syndrome",
      ],
      sk: ["metabolický syndróm", "syndróm X", "inzulínová rezistencia"],
      cs: ["metabolický syndrom", "syndrom X", "inzulinová rezistence"],
    },
    specialties: ["endocrinology", "internal_medicine"],
    icdHints: ["E88"],
  },
  {
    id: "thyroid_nodule",
    canonicalName: "Thyroid nodule",
    triggers: {
      en: ["thyroid nodule", "thyroid mass", "thyroid lump", "nodular goiter"],
      sk: ["uzol štítnej žľazy", "tyreoidálny uzol", "nodulárna struma"],
      cs: ["uzel štítné žlázy", "tyreoidální uzel", "nodulární struma"],
    },
    specialties: ["endocrinology"],
    icdHints: ["E04"],
  },
  {
    id: "hyperparathyroidism",
    canonicalName: "Hyperparathyroidism",
    triggers: {
      en: [
        "hyperparathyroidism",
        "elevated PTH",
        "parathyroid adenoma",
        "hypercalcemia",
      ],
      sk: ["hyperparatyreóza", "zvýšený PTH", "adenóm prištítnych teliesok"],
      cs: ["hyperparatyreóza", "zvýšený PTH", "adenom příštítných tělísek"],
    },
    specialties: ["endocrinology"],
    icdHints: ["E21"],
  },
  {
    id: "diabetic_ketoacidosis",
    canonicalName: "Diabetic ketoacidosis",
    triggers: {
      en: ["diabetic ketoacidosis", "DKA", "ketoacidosis", "diabetic crisis"],
      sk: ["diabetická ketoacidóza", "DKA", "ketoacidóza"],
      cs: ["diabetická ketoacidóza", "DKA", "ketoacidóza"],
    },
    specialties: ["endocrinology", "internal_medicine"],
    icdHints: ["E10", "E11"],
  },
  {
    id: "pheochromocytoma",
    canonicalName: "Pheochromocytoma",
    triggers: {
      en: [
        "pheochromocytoma",
        "adrenal tumor",
        "catecholamine-producing tumor",
      ],
      sk: ["feochromocytóm", "nádor drene nadobličky", "feochromocytom"],
      cs: ["feochromocytom", "nádor dřeně nadledviny", "feochromocytom"],
    },
    specialties: ["endocrinology"],
    icdHints: ["D35", "E27"],
  },
  {
    id: "acromegaly",
    canonicalName: "Acromegaly",
    triggers: {
      en: [
        "acromegaly",
        "growth hormone excess",
        "pituitary adenoma",
        "GH excess",
      ],
      sk: ["akromegália", "nadbytok rastového hormónu", "adenóm hypofýzy"],
      cs: ["akromegalie", "nadbytek růstového hormonu", "adenom hypofýzy"],
    },
    specialties: ["endocrinology"],
    icdHints: ["E22"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ENT (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "sinusitis",
    canonicalName: "Sinusitis",
    triggers: {
      en: [
        "sinusitis",
        "sinus infection",
        "rhinosinusitis",
        "chronic sinusitis",
      ],
      sk: [
        "sinusitída",
        "zápal prínosových dutín",
        "rinosinusitída",
        "zápal dutín",
      ],
      cs: [
        "sinusitida",
        "zánět vedlejších nosních dutin",
        "rinosinusitida",
        "zánět dutin",
      ],
    },
    specialties: ["ent", "general_practice"],
    icdHints: ["J01", "J32"],
  },
  {
    id: "tonsillitis",
    canonicalName: "Tonsillitis",
    triggers: {
      en: [
        "tonsillitis",
        "infected tonsils",
        "strep tonsillitis",
        "swollen tonsils",
      ],
      sk: ["tonzilitída", "zápal mandlí", "angína", "opuchnuté mandle"],
      cs: ["tonzilitida", "zánět mandlí", "angína", "oteklé mandle"],
    },
    specialties: ["ent", "general_practice", "pediatrics"],
    icdHints: ["J03", "J35"],
  },
  {
    id: "hearing_loss",
    canonicalName: "Hearing loss",
    triggers: {
      en: [
        "hearing loss",
        "deafness",
        "sensorineural hearing loss",
        "conductive hearing loss",
      ],
      sk: [
        "strata sluchu",
        "hluchota",
        "senzorineurálna porucha sluchu",
        "prevodová porucha sluchu",
      ],
      cs: [
        "ztráta sluchu",
        "hluchota",
        "senzorineurální porucha sluchu",
        "převodová porucha sluchu",
      ],
    },
    specialties: ["ent"],
    icdHints: ["H90", "H91"],
  },
  {
    id: "tinnitus",
    canonicalName: "Tinnitus",
    triggers: {
      en: ["tinnitus", "ringing in ears", "ear ringing", "buzzing in ears"],
      sk: ["tinnitus", "hučanie v ušiach", "zvonenie v ušiach", "šum v ušiach"],
      cs: ["tinnitus", "hučení v uších", "zvonění v uších", "šum v uších"],
    },
    specialties: ["ent", "neurology"],
    icdHints: ["H93"],
  },
  {
    id: "laryngitis",
    canonicalName: "Laryngitis",
    triggers: {
      en: ["laryngitis", "voice box inflammation", "hoarseness", "lost voice"],
      sk: ["laryngitída", "zápal hrtana", "chrapot", "strata hlasu"],
      cs: ["laryngitida", "zánět hrtanu", "chrapot", "ztráta hlasu"],
    },
    specialties: ["ent"],
    icdHints: ["J04", "J37"],
  },
  {
    id: "otitis_externa",
    canonicalName: "Otitis externa",
    triggers: {
      en: [
        "otitis externa",
        "swimmer's ear",
        "outer ear infection",
        "external ear infection",
      ],
      sk: ["otitis externa", "zápal vonkajšieho ucha", "plavecké ucho"],
      cs: ["otitis externa", "zánět zevního ucha", "plovecké ucho"],
    },
    specialties: ["ent"],
    icdHints: ["H60"],
  },
  {
    id: "nasal_polyps",
    canonicalName: "Nasal polyps",
    triggers: {
      en: ["nasal polyps", "nose polyps", "polyposis", "nasal polyposis"],
      sk: ["nosové polypy", "polypóza nosa", "polypy v nose"],
      cs: ["nosní polypy", "polypóza nosu", "polypy v nose"],
    },
    specialties: ["ent"],
    icdHints: ["J33"],
  },
  {
    id: "deviated_septum",
    canonicalName: "Deviated nasal septum",
    triggers: {
      en: ["deviated septum", "nasal septum deviation", "crooked septum"],
      sk: [
        "vychýlená nosová prepážka",
        "deviácia nosového septa",
        "krivá priehradka",
      ],
      cs: [
        "vychýlená nosní přepážka",
        "deviace nosního septa",
        "křivá přepážka",
      ],
    },
    specialties: ["ent"],
    icdHints: ["J34"],
  },
  {
    id: "menieres_disease",
    canonicalName: "Meniere's disease",
    triggers: {
      en: [
        "Meniere's disease",
        "Meniere",
        "endolymphatic hydrops",
        "Meniere syndrome",
      ],
      sk: ["Menierova choroba", "Menier", "endolymfatický hydrops"],
      cs: ["Menierova choroba", "Menier", "endolymfatický hydrops"],
    },
    specialties: ["ent", "neurology"],
    icdHints: ["H81"],
  },
  {
    id: "vocal_cord_nodules",
    canonicalName: "Vocal cord nodules",
    triggers: {
      en: [
        "vocal cord nodules",
        "singer's nodules",
        "vocal nodules",
        "vocal polyp",
      ],
      sk: ["uzlíky na hlasivkách", "hlasivkové uzlíky", "polyp hlasiviek"],
      cs: ["uzlíky na hlasivkách", "hlasivkové uzlíky", "polyp hlasivek"],
    },
    specialties: ["ent"],
    icdHints: ["J38"],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ONCOLOGY (~10)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "breast_cancer",
    canonicalName: "Breast cancer",
    triggers: {
      en: [
        "breast cancer",
        "breast carcinoma",
        "breast malignancy",
        "breast tumor",
      ],
      sk: [
        "rakovina prsníka",
        "karcinóm prsníka",
        "nádor prsníka",
        "rakovina prsu",
      ],
      cs: ["rakovina prsu", "karcinom prsu", "nádor prsu", "mamární karcinom"],
    },
    specialties: ["oncology", "gynecology"],
    icdHints: ["C50"],
  },
  {
    id: "lung_cancer",
    canonicalName: "Lung cancer",
    triggers: {
      en: [
        "lung cancer",
        "pulmonary carcinoma",
        "NSCLC",
        "SCLC",
        "bronchogenic carcinoma",
      ],
      sk: [
        "rakovina pľúc",
        "karcinóm pľúc",
        "pľúcny nádor",
        "bronchogénny karcinóm",
      ],
      cs: [
        "rakovina plic",
        "karcinom plic",
        "plicní nádor",
        "bronchogenní karcinom",
      ],
    },
    specialties: ["oncology", "pulmonology"],
    icdHints: ["C34"],
  },
  {
    id: "colorectal_cancer",
    canonicalName: "Colorectal cancer",
    triggers: {
      en: [
        "colorectal cancer",
        "colon cancer",
        "rectal cancer",
        "bowel cancer",
      ],
      sk: [
        "kolorektálny karcinóm",
        "rakovina hrubého čreva",
        "rakovina konečníka",
      ],
      cs: [
        "kolorektální karcinom",
        "rakovina tlustého střeva",
        "rakovina konečníku",
      ],
    },
    specialties: ["oncology", "gastroenterology"],
    icdHints: ["C18", "C19", "C20"],
  },
  {
    id: "prostate_cancer",
    canonicalName: "Prostate cancer",
    triggers: {
      en: [
        "prostate cancer",
        "prostatic carcinoma",
        "prostate malignancy",
        "elevated PSA",
      ],
      sk: [
        "rakovina prostaty",
        "karcinóm prostaty",
        "nádor prostaty",
        "zvýšené PSA",
      ],
      cs: [
        "rakovina prostaty",
        "karcinom prostaty",
        "nádor prostaty",
        "zvýšené PSA",
      ],
    },
    specialties: ["oncology", "urology"],
    icdHints: ["C61"],
  },
  {
    id: "lymphoma",
    canonicalName: "Lymphoma",
    triggers: {
      en: ["lymphoma", "Hodgkin lymphoma", "non-Hodgkin lymphoma", "NHL"],
      sk: ["lymfóm", "Hodgkinov lymfóm", "non-Hodgkinov lymfóm", "NHL"],
      cs: ["lymfom", "Hodgkinův lymfom", "non-Hodgkinův lymfom", "NHL"],
    },
    specialties: ["oncology"],
    icdHints: ["C81", "C82", "C83", "C85"],
  },
  {
    id: "leukemia",
    canonicalName: "Leukemia",
    triggers: {
      en: ["leukemia", "leukaemia", "AML", "ALL", "CLL", "CML"],
      sk: [
        "leukémia",
        "akútna leukémia",
        "chronická leukémia",
        "krvná rakovina",
      ],
      cs: [
        "leukémie",
        "akutní leukémie",
        "chronická leukémie",
        "krevní rakovina",
      ],
    },
    specialties: ["oncology"],
    icdHints: ["C91", "C92"],
  },
  {
    id: "pancreatic_cancer",
    canonicalName: "Pancreatic cancer",
    triggers: {
      en: [
        "pancreatic cancer",
        "pancreatic carcinoma",
        "pancreas cancer",
        "pancreatic adenocarcinoma",
      ],
      sk: ["rakovina pankreasu", "karcinóm pankreasu", "nádor pankreasu"],
      cs: ["rakovina slinivky", "karcinom pankreatu", "nádor pankreatu"],
    },
    specialties: ["oncology", "gastroenterology"],
    icdHints: ["C25"],
  },
  {
    id: "thyroid_cancer",
    canonicalName: "Thyroid cancer",
    triggers: {
      en: [
        "thyroid cancer",
        "thyroid carcinoma",
        "papillary thyroid cancer",
        "thyroid malignancy",
      ],
      sk: [
        "rakovina štítnej žľazy",
        "karcinóm štítnej žľazy",
        "papilárny karcinóm",
      ],
      cs: [
        "rakovina štítné žlázy",
        "karcinom štítné žlázy",
        "papilární karcinom",
      ],
    },
    specialties: ["oncology", "endocrinology"],
    icdHints: ["C73"],
  },
  {
    id: "bladder_cancer",
    canonicalName: "Bladder cancer",
    triggers: {
      en: [
        "bladder cancer",
        "bladder carcinoma",
        "urothelial carcinoma",
        "bladder tumor",
      ],
      sk: [
        "rakovina močového mechúra",
        "karcinóm mechúra",
        "urotelový karcinóm",
      ],
      cs: [
        "rakovina močového měchýře",
        "karcinom měchýře",
        "urotelový karcinom",
      ],
    },
    specialties: ["oncology", "urology"],
    icdHints: ["C67"],
  },
  {
    id: "renal_cell_carcinoma",
    canonicalName: "Renal cell carcinoma",
    triggers: {
      en: ["renal cell carcinoma", "kidney cancer", "RCC", "renal carcinoma"],
      sk: ["karcinóm obličky", "rakovina obličky", "renálny karcinóm"],
      cs: ["karcinom ledviny", "rakovina ledviny", "renální karcinom"],
    },
    specialties: ["oncology", "urology"],
    icdHints: ["C64"],
  },
];
