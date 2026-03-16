import type { RegionalTerm } from "./types";

/**
 * Multi-dialect normalization rules for medical terminology.
 *
 * Maps colloquial, abbreviated, and legacy medical terms used in Slovak (sk),
 * Czech (cs), and English (en) to their standard clinical equivalents.
 * Used to normalize transcripts before AI processing.
 *
 * Organised by clinical domain (~180 entries).
 */

// ---------------------------------------------------------------------------
// 1. Cardiovascular (~20)
// ---------------------------------------------------------------------------
const cardiovascular: RegionalTerm[] = [
  {
    variants: ["vysoký tlak", "tlak", "zvýšený tlak"],
    standard: "artériová hypertenzia",
    languages: ["sk"],
  },
  {
    variants: ["vysoký krevní tlak", "hypertenze", "vysokej tlak"],
    standard: "arteriální hypertenze",
    languages: ["cs"],
  },
  {
    variants: ["high blood pressure", "high BP", "elevated BP"],
    standard: "arterial hypertension",
    languages: ["en"],
  },
  {
    variants: ["nízky tlak", "padá mi tlak", "slabý tlak"],
    standard: "artériová hypotenzia",
    languages: ["sk"],
  },
  {
    variants: ["nízký tlak", "nízký krevní tlak", "padá mi tlak"],
    standard: "arteriální hypotenze",
    languages: ["cs"],
  },
  {
    variants: ["low blood pressure", "low BP"],
    standard: "arterial hypotension",
    languages: ["en"],
  },
  {
    variants: ["tlakomer", "meranie tlaku"],
    standard: "meranie krvného tlaku",
    languages: ["sk"],
  },
  {
    variants: ["tlakoměr", "měření tlaku"],
    standard: "měření krevního tlaku",
    languages: ["cs"],
  },
  {
    variants: ["srdciak", "srdcovka", "srdcový záchvat", "infarkt"],
    standard: "akútny infarkt myokardu",
    languages: ["sk"],
  },
  {
    variants: ["srdeční záchvat", "srdcovka", "infarkt", "srdečák"],
    standard: "akutní infarkt myokardu",
    languages: ["cs"],
  },
  {
    variants: ["heart attack", "MI"],
    standard: "acute myocardial infarction",
    languages: ["en"],
  },
  {
    variants: ["cholesterol", "vysoký cholesterol", "tuky v krvi"],
    standard: "hypercholesterolémia",
    languages: ["sk"],
  },
  {
    variants: ["cholesterol", "vysokej cholesterol", "tuky v krvi"],
    standard: "hypercholesterolémie",
    languages: ["cs"],
  },
  {
    variants: ["high cholesterol", "elevated cholesterol", "hyperlipidemia"],
    standard: "hypercholesterolaemia",
    languages: ["en"],
  },
  {
    variants: [
      "arytmia",
      "nepravidelný tep",
      "preskoky srdca",
      "preskakovanie",
    ],
    standard: "srdcová arytmia",
    languages: ["sk"],
  },
  {
    variants: ["arytmie", "nepravidelný tep", "přeskoky srdce", "přeskakování"],
    standard: "srdeční arytmie",
    languages: ["cs"],
  },
  {
    variants: ["irregular heartbeat", "heart palpitations", "skipped beats"],
    standard: "cardiac arrhythmia",
    languages: ["en"],
  },
  {
    variants: ["zlyhávanie srdca", "slabé srdce", "srdce nestíha"],
    standard: "srdcové zlyhávanie",
    languages: ["sk"],
  },
  {
    variants: ["selhávání srdce", "slabé srdce", "srdeční selhání"],
    standard: "srdeční selhání",
    languages: ["cs"],
  },
  {
    variants: [
      "heart failure",
      "weak heart",
      "congestive heart failure",
      "CHF",
    ],
    standard: "heart failure",
    languages: ["en"],
  },
  {
    variants: ["kŕčové žily", "varixy", "vystúpené žily"],
    standard: "varikózne vény dolných končatín",
    languages: ["sk"],
  },
  {
    variants: ["křečové žíly", "varixy", "vystoupené žíly"],
    standard: "varikózní žíly dolních končetin",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 2. Respiratory (~15)
// ---------------------------------------------------------------------------
const respiratory: RegionalTerm[] = [
  {
    variants: [
      "dýchavica",
      "nemôžem dýchať",
      "zle sa mi dýcha",
      "zadýchavam sa",
    ],
    standard: "dyspnoe",
    languages: ["sk"],
  },
  {
    variants: [
      "dušnost",
      "nemůžu dýchat",
      "špatně se mi dýchá",
      "zadýchávám se",
    ],
    standard: "dyspnoe",
    languages: ["cs"],
  },
  {
    variants: [
      "shortness of breath",
      "SOB",
      "breathlessness",
      "difficulty breathing",
    ],
    standard: "dyspnoea",
    languages: ["en"],
  },
  {
    variants: ["astma", "záchvaty dýchania", "pískanie na hrudníku"],
    standard: "bronchiálna astma",
    languages: ["sk"],
  },
  {
    variants: ["astma", "záchvaty dýchání", "pískání na hrudi"],
    standard: "bronchiální astma",
    languages: ["cs"],
  },
  {
    variants: ["asthma", "wheezing", "chest tightness"],
    standard: "bronchial asthma",
    languages: ["en"],
  },
  {
    variants: ["zápal pľúc", "pneumónia", "pľúcny zápal"],
    standard: "pneumónia",
    languages: ["sk"],
  },
  {
    variants: ["zápal plic", "pneumonie", "plicní zápal"],
    standard: "pneumonie",
    languages: ["cs"],
  },
  {
    variants: ["pneumonia", "lung infection"],
    standard: "pneumonia",
    languages: ["en"],
  },
  {
    variants: [
      "kašeľ",
      "kašlem",
      "suchý kašeľ",
      "vlhký kašeľ",
      "dráždivý kašeľ",
    ],
    standard: "kašeľ",
    languages: ["sk"],
  },
  {
    variants: [
      "kašel",
      "kašlu",
      "suchý kašel",
      "vlhký kašel",
      "dráždivý kašel",
    ],
    standard: "kašel",
    languages: ["cs"],
  },
  {
    variants: ["cough", "dry cough", "wet cough", "productive cough"],
    standard: "cough",
    languages: ["en"],
  },
  {
    variants: ["chorobná", "chronický bronchitída", "zápal priedušiek"],
    standard: "chronická bronchitída",
    languages: ["sk"],
  },
  {
    variants: ["chronická bronchitida", "zápal průdušek"],
    standard: "chronická bronchitida",
    languages: ["cs"],
  },
  {
    variants: ["angína", "zapálené mandle", "bolí ma hrdlo"],
    standard: "akútna tonzilitída",
    languages: ["sk"],
  },
  {
    variants: ["angína", "zapálené mandle", "bolí mě v krku"],
    standard: "akutní tonzilitida",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 3. Endocrine / Metabolic (~15)
// ---------------------------------------------------------------------------
const endocrineMetabolic: RegionalTerm[] = [
  {
    variants: ["cukrovka", "cukor v krvi", "diabetes", "vysoký cukor"],
    standard: "diabetes mellitus",
    languages: ["sk", "cs"],
  },
  {
    variants: ["sugar disease", "diabetes", "high blood sugar", "high sugar"],
    standard: "diabetes mellitus",
    languages: ["en"],
  },
  {
    variants: [
      "cukrovka dvojkového typu",
      "cukrovka druhého typu",
      "diabetes druhý typ",
    ],
    standard: "diabetes mellitus 2. typu",
    languages: ["sk"],
  },
  {
    variants: ["cukrovka druhého typu", "cukrovka dvoj", "diabetes druhý typ"],
    standard: "diabetes mellitus 2. typu",
    languages: ["cs"],
  },
  {
    variants: [
      "type 2 diabetes",
      "type two diabetes",
      "T2DM",
      "adult onset diabetes",
    ],
    standard: "diabetes mellitus type 2",
    languages: ["en"],
  },
  {
    variants: ["inzulín", "pichám si inzulín", "inzulínová liečba"],
    standard: "inzulínoterapia",
    languages: ["sk"],
  },
  {
    variants: ["inzulín", "píchám si inzulín", "inzulínová léčba"],
    standard: "inzulínoterapie",
    languages: ["cs"],
  },
  {
    variants: ["štítna žľaza", "štítna", "problémy so štítnou"],
    standard: "ochorenie štítnej žľazy",
    languages: ["sk"],
  },
  {
    variants: ["štítná žláza", "štítná", "problémy se štítnou"],
    standard: "onemocnění štítné žlázy",
    languages: ["cs"],
  },
  {
    variants: ["thyroid", "thyroid problems", "thyroid disease"],
    standard: "thyroid disease",
    languages: ["en"],
  },
  {
    variants: ["nadváha", "obezita", "príliš veľa vážim", "tučný"],
    standard: "obezita",
    languages: ["sk"],
  },
  {
    variants: ["nadváha", "obezita", "příliš moc vážím", "tlustý"],
    standard: "obezita",
    languages: ["cs"],
  },
  {
    variants: ["overweight", "obese", "obesity", "too heavy"],
    standard: "obesity",
    languages: ["en"],
  },
  {
    variants: ["zvýšená štítna", "hypertyreóza", "rýchla štítna"],
    standard: "hypertyreóza",
    languages: ["sk"],
  },
  {
    variants: ["zvýšená štítná", "hypertyreóza", "rychlá štítná"],
    standard: "hypertyreóza",
    languages: ["cs"],
  },
  {
    variants: ["znížená štítna", "hypotyreóza", "pomalá štítna"],
    standard: "hypotyreóza",
    languages: ["sk"],
  },
  {
    variants: ["snížená štítná", "hypotyreóza", "pomalá štítná"],
    standard: "hypotyreóza",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 4. Gastrointestinal (~15)
// ---------------------------------------------------------------------------
const gastrointestinal: RegionalTerm[] = [
  {
    variants: [
      "bolí ma žalúdok",
      "žalúdok",
      "bolesti žalúdka",
      "trápi ma žalúdok",
    ],
    standard: "gastrická bolesť",
    languages: ["sk"],
  },
  {
    variants: [
      "bolí mě žaludek",
      "žaludek",
      "bolesti žaludku",
      "trápí mě žaludek",
    ],
    standard: "gastrická bolest",
    languages: ["cs"],
  },
  {
    variants: ["stomach ache", "stomach pain", "upset stomach", "tummy ache"],
    standard: "gastric pain",
    languages: ["en"],
  },
  {
    variants: ["pálenie záhy", "záha", "pálenie žalúdka", "reflux"],
    standard: "gastroezofágový reflux",
    languages: ["sk"],
  },
  {
    variants: ["pálení žáhy", "žáha", "pálení žaludku", "reflux"],
    standard: "gastroezofageální reflux",
    languages: ["cs"],
  },
  {
    variants: ["heartburn", "acid reflux", "GERD", "reflux"],
    standard: "gastro-oesophageal reflux disease",
    languages: ["en"],
  },
  {
    variants: [
      "žlčník",
      "žlčníkové kamene",
      "kamene v žlčníku",
      "bolí ma žlčník",
    ],
    standard: "cholelitiáza",
    languages: ["sk"],
  },
  {
    variants: [
      "žlučník",
      "žlučníkové kameny",
      "kameny ve žlučníku",
      "bolí mě žlučník",
    ],
    standard: "cholelithiáza",
    languages: ["cs"],
  },
  {
    variants: ["gallstones", "gallbladder stones", "gallbladder problems"],
    standard: "cholelithiasis",
    languages: ["en"],
  },
  {
    variants: ["pečeň", "problémy s pečeňou", "zlá pečeň", "chorá pečeň"],
    standard: "hepatopatia",
    languages: ["sk"],
  },
  {
    variants: ["játra", "problémy s játry", "špatná játra", "nemocná játra"],
    standard: "hepatopatie",
    languages: ["cs"],
  },
  {
    variants: ["hnačka", "riedka stolica", "priehon"],
    standard: "hnačka",
    languages: ["sk"],
  },
  {
    variants: ["průjem", "řídká stolice", "průhon"],
    standard: "průjem",
    languages: ["cs"],
  },
  {
    variants: ["diarrhoea", "diarrhea", "loose stools", "the runs"],
    standard: "diarrhoea",
    languages: ["en"],
  },
  {
    variants: ["zápcha", "tvrdá stolica", "nemôžem na stolicu"],
    standard: "obstipácia",
    languages: ["sk"],
  },
  {
    variants: ["zácpa", "tvrdá stolice", "nemůžu na stolici"],
    standard: "obstipace",
    languages: ["cs"],
  },
  {
    variants: ["constipation", "blocked up", "irregular bowel"],
    standard: "constipation",
    languages: ["en"],
  },
  {
    variants: ["dráždivý črevný syndróm", "dráždivé črevo", "nervové brucho"],
    standard: "syndróm dráždivého čreva",
    languages: ["sk"],
  },
  {
    variants: ["dráždivý tračník", "dráždivé střevo", "nervové břicho"],
    standard: "syndrom dráždivého tračníku",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 5. Musculoskeletal (~15)
// ---------------------------------------------------------------------------
const musculoskeletal: RegionalTerm[] = [
  {
    variants: [
      "bolí ma chrbát",
      "chrbtica",
      "bolesti chrbta",
      "krížová bolesť",
    ],
    standard: "dorzalgia",
    languages: ["sk"],
  },
  {
    variants: ["bolí mě záda", "páteř", "bolesti zad", "křížová bolest"],
    standard: "dorzalgie",
    languages: ["cs"],
  },
  {
    variants: ["back pain", "backache", "lower back pain", "lumbago"],
    standard: "dorsalgia",
    languages: ["en"],
  },
  {
    variants: ["platničky", "vyskočená platnička", "hernia disku"],
    standard: "hernia nucleus pulposus",
    languages: ["sk"],
  },
  {
    variants: ["plotýnky", "vyskočená plotýnka", "hernie disku"],
    standard: "hernie nucleus pulposus",
    languages: ["cs"],
  },
  {
    variants: [
      "slipped disc",
      "herniated disc",
      "disc herniation",
      "bulging disc",
    ],
    standard: "herniated nucleus pulposus",
    languages: ["en"],
  },
  {
    variants: ["bolesti kĺbov", "kĺby", "bolí ma kĺby", "opuchnuté kĺby"],
    standard: "artralgia",
    languages: ["sk"],
  },
  {
    variants: ["bolesti kloubů", "klouby", "bolí mě klouby", "opuchlé klouby"],
    standard: "artralgie",
    languages: ["cs"],
  },
  {
    variants: ["joint pain", "sore joints", "aching joints"],
    standard: "arthralgia",
    languages: ["en"],
  },
  {
    variants: ["reuma", "reumatizmus", "reumatické bolesti"],
    standard: "reumatoidná artritída",
    languages: ["sk"],
  },
  {
    variants: ["revma", "revmatismus", "revmatické bolesti"],
    standard: "revmatoidní artritida",
    languages: ["cs"],
  },
  {
    variants: ["rheumatism", "rheumatic pain", "RA"],
    standard: "rheumatoid arthritis",
    languages: ["en"],
  },
  {
    variants: ["osteoporóza", "rednutie kostí", "krehké kosti"],
    standard: "osteoporóza",
    languages: ["sk"],
  },
  {
    variants: ["osteoporóza", "řídnutí kostí", "křehké kosti"],
    standard: "osteoporóza",
    languages: ["cs"],
  },
  {
    variants: ["osteoporosis", "brittle bones", "bone loss"],
    standard: "osteoporosis",
    languages: ["en"],
  },
  {
    variants: ["koleno", "bolí ma koleno", "kolenný kĺb", "artróza kolena"],
    standard: "gonartróza",
    languages: ["sk"],
  },
  {
    variants: ["koleno", "bolí mě koleno", "kolenní kloub", "artróza kolena"],
    standard: "gonartróza",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 6. Neurological (~15)
// ---------------------------------------------------------------------------
const neurological: RegionalTerm[] = [
  {
    variants: ["bolí ma hlava", "bolesti hlavy", "hlavička"],
    standard: "cefalea",
    languages: ["sk"],
  },
  {
    variants: ["bolí mě hlava", "bolesti hlavy"],
    standard: "cefalea",
    languages: ["cs"],
  },
  {
    variants: ["headache", "head pain", "cephalgia"],
    standard: "cephalgia",
    languages: ["en"],
  },
  {
    variants: ["migreňa", "migréna", "záchvaty hlavy"],
    standard: "migréna",
    languages: ["sk"],
  },
  {
    variants: ["migréna", "migrény", "záchvaty hlavy"],
    standard: "migréna",
    languages: ["cs"],
  },
  {
    variants: ["migraine", "migraine headache"],
    standard: "migraine",
    languages: ["en"],
  },
  {
    variants: ["závraty", "točí sa mi hlava", "motá sa mi", "vertigo"],
    standard: "vertigo",
    languages: ["sk"],
  },
  {
    variants: ["závrať", "točí se mi hlava", "motá se mi", "vertigo"],
    standard: "vertigo",
    languages: ["cs"],
  },
  {
    variants: ["dizziness", "vertigo", "lightheaded", "feeling dizzy"],
    standard: "vertigo",
    languages: ["en"],
  },
  {
    variants: ["epilepsia", "záchvaty", "kŕče", "padúcnica"],
    standard: "epilepsia",
    languages: ["sk"],
  },
  {
    variants: ["epilepsie", "záchvaty", "křeče", "padoucnice"],
    standard: "epilepsie",
    languages: ["cs"],
  },
  {
    variants: ["epilepsy", "seizure", "fits", "convulsions"],
    standard: "epilepsy",
    languages: ["en"],
  },
  {
    variants: [
      "mŕtvica",
      "porážka",
      "mozgová príhoda",
      "cievna mozgová príhoda",
    ],
    standard: "cievna mozgová príhoda",
    languages: ["sk"],
  },
  {
    variants: ["mrtvice", "mozková příhoda", "cévní mozková příhoda", "iktus"],
    standard: "cévní mozková příhoda",
    languages: ["cs"],
  },
  {
    variants: ["stroke", "brain attack", "CVA", "cerebrovascular accident"],
    standard: "cerebrovascular accident",
    languages: ["en"],
  },
  {
    variants: ["tŕpnutie rúk", "tŕpnutie nôh", "mravčenie", "necitlivosť"],
    standard: "parestézia",
    languages: ["sk"],
  },
  {
    variants: ["brnění rukou", "brnění nohou", "mravenčení", "necitlivost"],
    standard: "parestezie",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 7. Psychiatric (~10)
// ---------------------------------------------------------------------------
const psychiatric: RegionalTerm[] = [
  {
    variants: [
      "depresia",
      "depka",
      "smutný",
      "nemám náladu",
      "trpím depresiou",
    ],
    standard: "depresívna porucha",
    languages: ["sk"],
  },
  {
    variants: ["deprese", "depka", "smutný", "nemám náladu", "trpím depresí"],
    standard: "depresivní porucha",
    languages: ["cs"],
  },
  {
    variants: ["depression", "feeling down", "depressed", "low mood"],
    standard: "depressive disorder",
    languages: ["en"],
  },
  {
    variants: ["úzkosť", "úzkosti", "strach", "panika", "panické záchvaty"],
    standard: "úzkostná porucha",
    languages: ["sk"],
  },
  {
    variants: ["úzkost", "úzkosti", "strach", "panika", "panické záchvaty"],
    standard: "úzkostná porucha",
    languages: ["cs"],
  },
  {
    variants: ["anxiety", "panic attacks", "feeling anxious", "nervousness"],
    standard: "anxiety disorder",
    languages: ["en"],
  },
  {
    variants: ["nespavosť", "nespím", "nemôžem spať", "poruchy spánku"],
    standard: "insomnia",
    languages: ["sk"],
  },
  {
    variants: ["nespavost", "nespím", "nemůžu spát", "poruchy spánku"],
    standard: "insomnie",
    languages: ["cs"],
  },
  {
    variants: ["insomnia", "sleep problems", "cannot sleep", "sleeplessness"],
    standard: "insomnia",
    languages: ["en"],
  },
  {
    variants: ["syndróm vyhorenia", "vyhorenie", "burnout"],
    standard: "syndróm vyhorenia",
    languages: ["sk"],
  },
  {
    variants: ["syndrom vyhoření", "vyhoření", "burnout"],
    standard: "syndrom vyhoření",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 8. Dermatological (~10)
// ---------------------------------------------------------------------------
const dermatological: RegionalTerm[] = [
  {
    variants: ["vyrážka", "vysýpka", "vyrážky na koži"],
    standard: "exantém",
    languages: ["sk"],
  },
  {
    variants: ["vyrážka", "vysypání", "vyrážky na kůži"],
    standard: "exantém",
    languages: ["cs"],
  },
  {
    variants: ["rash", "skin rash", "skin eruption"],
    standard: "exanthem",
    languages: ["en"],
  },
  {
    variants: ["ekzém", "suchá koža", "svrbenie kože", "atopický ekzém"],
    standard: "atopická dermatitída",
    languages: ["sk"],
  },
  {
    variants: ["ekzém", "suchá kůže", "svědění kůže", "atopický ekzém"],
    standard: "atopická dermatitida",
    languages: ["cs"],
  },
  {
    variants: ["eczema", "atopic eczema", "itchy skin", "dry skin condition"],
    standard: "atopic dermatitis",
    languages: ["en"],
  },
  {
    variants: ["lupienka", "psoriáza", "šupinatá koža"],
    standard: "psoriáza",
    languages: ["sk"],
  },
  {
    variants: ["lupénka", "psoriáza", "šupinatá kůže"],
    standard: "psoriáza",
    languages: ["cs"],
  },
  {
    variants: ["psoriasis", "scaly skin", "plaque psoriasis"],
    standard: "psoriasis",
    languages: ["en"],
  },
  {
    variants: ["akné", "pupienky", "vyrážky v tvári", "upchaté póry"],
    standard: "acne vulgaris",
    languages: ["sk"],
  },
  {
    variants: ["akné", "pupínky", "vyrážky v obličeji", "ucpané póry"],
    standard: "acne vulgaris",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 9. Urological / Renal (~10)
// ---------------------------------------------------------------------------
const urologicalRenal: RegionalTerm[] = [
  {
    variants: [
      "obličky",
      "bolesti obličiek",
      "bolí ma oblička",
      "problémy s obličkami",
    ],
    standard: "nefropatia",
    languages: ["sk"],
  },
  {
    variants: [
      "ledviny",
      "bolesti ledvin",
      "bolí mě ledviny",
      "problémy s ledvinami",
    ],
    standard: "nefropatie",
    languages: ["cs"],
  },
  {
    variants: ["kidney problems", "kidney pain", "renal problems"],
    standard: "nephropathy",
    languages: ["en"],
  },
  {
    variants: ["obličkové kamene", "kamene v obličkách", "renálne kamene"],
    standard: "nefrolitiáza",
    languages: ["sk"],
  },
  {
    variants: ["ledvinové kameny", "kameny v ledvinách", "renální kameny"],
    standard: "nefrolitiáza",
    languages: ["cs"],
  },
  {
    variants: ["kidney stones", "renal calculi", "renal stones"],
    standard: "nephrolithiasis",
    languages: ["en"],
  },
  {
    variants: [
      "zápal močového mechúra",
      "cystitída",
      "pálenie pri močení",
      "časté močenie",
    ],
    standard: "cystitída",
    languages: ["sk"],
  },
  {
    variants: [
      "zápal močového měchýře",
      "cystitida",
      "pálení při močení",
      "časté močení",
    ],
    standard: "cystitida",
    languages: ["cs"],
  },
  {
    variants: [
      "cystitis",
      "bladder infection",
      "UTI",
      "urinary tract infection",
      "burning when urinating",
    ],
    standard: "cystitis",
    languages: ["en"],
  },
  {
    variants: ["prostata", "zväčšená prostata", "problémy s prostatou"],
    standard: "benígna hyperplázia prostaty",
    languages: ["sk"],
  },
  {
    variants: ["prostata", "zvětšená prostata", "problémy s prostatou"],
    standard: "benigní hyperplazie prostaty",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// 10. Common abbreviations (~20)
// ---------------------------------------------------------------------------
const abbreviations: RegionalTerm[] = [
  {
    variants: ["TK"],
    standard: "krvný tlak",
    languages: ["sk", "cs"],
  },
  {
    variants: ["RR"],
    standard: "krvný tlak (Riva-Rocci)",
    languages: ["sk", "cs"],
  },
  {
    variants: ["BP"],
    standard: "blood pressure",
    languages: ["en"],
  },
  {
    variants: ["EKG"],
    standard: "elektrokardiografia",
    languages: ["sk", "cs"],
  },
  {
    variants: ["ECG", "EKG"],
    standard: "electrocardiography",
    languages: ["en"],
  },
  {
    variants: ["RTG", "rentgen", "röntgen"],
    standard: "röntgenové vyšetrenie",
    languages: ["sk", "cs"],
  },
  {
    variants: ["X-ray", "xray", "x ray"],
    standard: "radiography",
    languages: ["en"],
  },
  {
    variants: ["CT", "cétéčko"],
    standard: "počítačová tomografia",
    languages: ["sk", "cs"],
  },
  {
    variants: ["CT", "CT scan", "CAT scan"],
    standard: "computed tomography",
    languages: ["en"],
  },
  {
    variants: ["MR", "MRI", "magnetická rezonancia", "emérko"],
    standard: "magnetická rezonancia",
    languages: ["sk", "cs"],
  },
  {
    variants: ["MRI", "MR", "magnetic resonance"],
    standard: "magnetic resonance imaging",
    languages: ["en"],
  },
  {
    variants: ["USG", "ultrazvuk", "sono"],
    standard: "ultrasonografia",
    languages: ["sk", "cs"],
  },
  {
    variants: ["ultrasound", "USG", "US", "sonography"],
    standard: "ultrasonography",
    languages: ["en"],
  },
  {
    variants: ["BMI"],
    standard: "index telesnej hmotnosti",
    languages: ["sk", "cs"],
  },
  {
    variants: ["BMI", "body mass index"],
    standard: "body mass index",
    languages: ["en"],
  },
  {
    variants: ["ATB", "antibiotiká"],
    standard: "antibiotiká",
    languages: ["sk"],
  },
  {
    variants: ["ATB", "antibiotika"],
    standard: "antibiotika",
    languages: ["cs"],
  },
  {
    variants: ["ABx", "antibiotics"],
    standard: "antibiotics",
    languages: ["en"],
  },
  {
    variants: ["CRP", "céérpé"],
    standard: "C-reaktívny proteín",
    languages: ["sk", "cs"],
  },
  {
    variants: ["CRP", "C-reactive protein"],
    standard: "C-reactive protein",
    languages: ["en"],
  },
  {
    variants: ["FW", "sedimentácia"],
    standard: "sedimentácia erytrocytov",
    languages: ["sk", "cs"],
  },
  {
    variants: ["ESR", "sed rate", "sedimentation rate"],
    standard: "erythrocyte sedimentation rate",
    languages: ["en"],
  },
  {
    variants: ["KO", "krvný obraz"],
    standard: "kompletný krvný obraz",
    languages: ["sk", "cs"],
  },
  {
    variants: ["CBC", "FBC", "full blood count", "complete blood count"],
    standard: "complete blood count",
    languages: ["en"],
  },
  {
    variants: ["GF", "glomerulárna filtrácia", "GFR"],
    standard: "glomerulárna filtrácia",
    languages: ["sk", "cs"],
  },
  {
    variants: ["GFR", "glomerular filtration rate"],
    standard: "glomerular filtration rate",
    languages: ["en"],
  },
];

// ---------------------------------------------------------------------------
// 11. Legacy terminology (~15)
// ---------------------------------------------------------------------------
const legacyTerminology: RegionalTerm[] = [
  {
    variants: ["apoplexia", "apoplektický záchvat"],
    standard: "cievna mozgová príhoda",
    languages: ["sk"],
  },
  {
    variants: ["apoplexie", "apoplektický záchvat"],
    standard: "cévní mozková příhoda",
    languages: ["cs"],
  },
  {
    variants: ["apoplexy", "apoplectic stroke"],
    standard: "cerebrovascular accident",
    languages: ["en"],
  },
  {
    variants: ["suchoty", "tuberkulóza", "TBC"],
    standard: "tuberkulóza",
    languages: ["sk", "cs"],
  },
  {
    variants: ["consumption", "TB", "tuberculosis"],
    standard: "tuberculosis",
    languages: ["en"],
  },
  {
    variants: ["vodnatieľka", "hydrops"],
    standard: "edém",
    languages: ["sk"],
  },
  {
    variants: ["vodnatelnost", "hydrops"],
    standard: "edém",
    languages: ["cs"],
  },
  {
    variants: ["dropsy", "hydrops"],
    standard: "oedema",
    languages: ["en"],
  },
  {
    variants: ["ohňový pásovc", "pásový opar"],
    standard: "herpes zoster",
    languages: ["sk"],
  },
  {
    variants: ["pásový opar", "ohnivý pás"],
    standard: "herpes zoster",
    languages: ["cs"],
  },
  {
    variants: ["shingles", "zona"],
    standard: "herpes zoster",
    languages: ["en"],
  },
  {
    variants: ["žlčová kolika", "žlčník mi robí"],
    standard: "biliárna kolika",
    languages: ["sk"],
  },
  {
    variants: ["žlučová kolika", "žlučník mi dělá"],
    standard: "biliární kolika",
    languages: ["cs"],
  },
  {
    variants: ["bilious attack", "biliary colic"],
    standard: "biliary colic",
    languages: ["en"],
  },
  {
    variants: ["zhubný nádor", "rakovina"],
    standard: "malígny nádor",
    languages: ["sk"],
  },
  {
    variants: ["zhoubný nádor", "rakovina"],
    standard: "maligní nádor",
    languages: ["cs"],
  },
  {
    variants: ["cancer", "malignant tumour", "malignant tumor"],
    standard: "malignant neoplasm",
    languages: ["en"],
  },
  {
    variants: ["reumatická horúčka", "reumatická febra"],
    standard: "reumatická horúčka",
    languages: ["sk"],
  },
  {
    variants: ["revmatická horečka", "revmatická febra"],
    standard: "revmatická horečka",
    languages: ["cs"],
  },
  {
    variants: ["rheumatic fever"],
    standard: "rheumatic fever",
    languages: ["en"],
  },
  {
    variants: ["lumbágo", "strelilo ma v krížoch"],
    standard: "lumbálna bolesť",
    languages: ["sk"],
  },
  {
    variants: ["lumbágo", "střelilo mě v kříži"],
    standard: "lumbální bolest",
    languages: ["cs"],
  },
];

// ---------------------------------------------------------------------------
// Export combined array
// ---------------------------------------------------------------------------

export const REGIONAL_TERMS: RegionalTerm[] = [
  ...cardiovascular,
  ...respiratory,
  ...endocrineMetabolic,
  ...gastrointestinal,
  ...musculoskeletal,
  ...neurological,
  ...psychiatric,
  ...dermatological,
  ...urologicalRenal,
  ...abbreviations,
  ...legacyTerminology,
];
