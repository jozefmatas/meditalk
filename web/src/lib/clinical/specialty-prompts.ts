import type { SpecialtyPromptPack, SpecialtyId } from "./types";

export const SPECIALTY_PROMPT_PACKS: Record<SpecialtyId, SpecialtyPromptPack> =
  {
    general_practice: {
      id: "general_practice",
      name: "General Practice",
      systemPromptAddendum: `Focus on the chief complaint and its evolution. Document the presenting problem clearly with onset, duration, severity, and aggravating/relieving factors.
Build a concise differential diagnosis ranked by likelihood. Note any red-flag symptoms that warrant urgent referral.
Document preventive screening status relevant to the patient's age and sex (e.g., cancer screenings, vaccinations, metabolic panels).
For chronic disease management, record current control status, medication adherence, and any needed adjustments.
When a referral is indicated, explicitly state the clinical reasoning and urgency.
Capture relevant social determinants of health that affect the management plan.
Ensure continuity-of-care notes reference prior visits and pending results where applicable.`,
      emphasizedSections: [
        "reason_for_contact",
        "history_present_illness",
        "past_history",
        "current_medications",
        "review_of_systems",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Use standard primary care abbreviations: HPI, ROS, PMH, FH, SH, BMI, BP, HR. Spell out less common terms on first use. Avoid sub-specialist jargon unless referencing a specialist report.",
    },

    internal_medicine: {
      id: "internal_medicine",
      name: "Internal Medicine",
      systemPromptAddendum: `Perform a thorough, systematic review of all organ systems. Document positive and pertinent negative findings for each.
Conduct detailed medication reconciliation: list all current medications with doses, frequencies, and route. Flag potential interactions and duplications.
For patients with multiple comorbidities, organize the assessment problem-by-problem with individual plans for each active issue.
Document relevant lab trends (not just the latest value) to track disease trajectory.
Note the patient's functional status and how it impacts treatment decisions.
Quantify disease severity using validated scoring systems where applicable (e.g., CHA2DS2-VASc, MELD, CKD stage).
Record immunization status, screening tests due, and health maintenance items.`,
      emphasizedSections: [
        "review_of_systems",
        "current_medications",
        "physical_exam",
        "lab",
        "assessment",
        "action_and_plan",
        "past_history",
      ],
      terminologyNotes:
        "Standard internal medicine abbreviations are acceptable: CBC, BMP, CMP, LFT, TSH, HbA1c, eGFR, CKD, CHF, COPD, HTN, DM, DVT, PE. Document lab values with units and reference ranges when abnormal.",
    },

    cardiology: {
      id: "cardiology",
      name: "Cardiology",
      systemPromptAddendum: `Document heart sounds in detail: S1/S2 quality, presence of S3/S4, murmurs (grade, timing, location, radiation, and maneuvers performed).
Record ECG interpretation systematically: rate, rhythm, axis, intervals (PR, QRS, QTc), ST-T changes, and comparison to prior tracings.
Classify heart failure severity using NYHA functional class (I-IV). Record left ventricular ejection fraction (LVEF) with date and modality.
Characterize chest pain precisely: location, quality, radiation, duration, provocative/palliative factors, and associated symptoms.
Document cardiovascular risk factors: hypertension, diabetes, dyslipidemia, smoking, family history of premature CAD, obesity.
Record hemodynamic parameters when available: JVP, peripheral edema grade, capillary refill.
Note anticoagulation status with indication, agent, dose, and monitoring values (INR, anti-Xa).`,
      emphasizedSections: [
        "heart",
        "ecg",
        "blood_pressure",
        "pulse",
        "peripheral_pulses",
        "history_present_illness",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: LVEF, NYHA, CAD, ACS, STEMI, NSTEMI, AF/AFib, VT, PCI, CABG, CHA2DS2-VASc, HAS-BLED, JVP, ECG/EKG, BNP, NT-proBNP. Murmur grading uses Levine I-VI scale.",
    },

    pulmonology: {
      id: "pulmonology",
      name: "Pulmonology",
      systemPromptAddendum: `Document the respiratory examination thoroughly: inspection (chest shape, accessory muscle use, breathing pattern), palpation (tactile fremitus, chest expansion), percussion, and auscultation (breath sounds, adventitious sounds with location).
Record spirometry values when available: FEV1, FVC, FEV1/FVC ratio, DLCO, with percent predicted and comparison to prior values.
Document oxygen status: SpO2 at rest and on exertion, supplemental O2 flow rate and delivery method, ABG results if available.
Quantify dyspnea using validated scales (mMRC Dyspnea Scale 0-4 or Borg Scale). Record exercise tolerance in functional terms.
Capture detailed smoking history in pack-years (packs per day x years smoked). Note cessation date or current status and cessation interventions offered.
For asthma/COPD, document exacerbation frequency, current step therapy, inhaler technique assessment, and GOLD stage or asthma severity classification.
Note relevant occupational and environmental exposures.`,
      emphasizedSections: [
        "lungs",
        "respiratory_rate",
        "spo2",
        "tobacco",
        "history_present_illness",
        "radiology",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Standard pulmonology abbreviations: FEV1, FVC, DLCO, PFT, ABG, SpO2, PaO2, PaCO2, COPD, GOLD, ICS, LABA, LAMA, PE, CTA, mMRC. Express smoking history in pack-years.",
    },

    gastroenterology: {
      id: "gastroenterology",
      name: "Gastroenterology",
      systemPromptAddendum: `Document the abdominal examination with precision: inspection, auscultation (bowel sounds quality and frequency), percussion (tympany, shifting dullness, liver span), and palpation (tenderness location, guarding, rebound, organomegaly, masses).
Use the Bristol Stool Scale (types 1-7) when documenting stool characteristics. Record frequency, color, presence of blood or mucus.
Document hepatic function comprehensively: liver enzymes with pattern (hepatocellular vs. cholestatic), synthetic function (albumin, INR), and bilirubin fractionation.
For endoscopy findings, describe location, size, morphology (Paris classification if applicable), and interventions performed with histology pending status.
Record nutritional status, weight trends, and dietary history relevant to GI conditions.
Note alarm features systematically: unintentional weight loss, dysphagia, GI bleeding, persistent vomiting, family history of GI malignancy, iron deficiency anemia.
Document hepatitis serologies, celiac panel, and H. pylori status when relevant.`,
      emphasizedSections: [
        "abdomen",
        "rectal_exam",
        "history_present_illness",
        "lab",
        "diet",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: EGD, GERD, IBD, IBS, UC, CD, LFT, AST, ALT, GGT, ALP, ERCP, MRCP, PPI, H. pylori, HBsAg, anti-HCV, CEA. Use Bristol Stool Scale types 1-7 for stool description.",
    },

    neurology: {
      id: "neurology",
      name: "Neurology",
      systemPromptAddendum: `Document a structured neurological examination: mental status (orientation, attention, memory, language), cranial nerves (I-XII individually), motor exam (bulk, tone, strength graded 0-5 per MRC scale by muscle group), sensory exam (light touch, pinprick, vibration, proprioception by dermatome), coordination (finger-to-nose, heel-to-shin, rapid alternating movements), gait (tandem, Romberg), and reflexes (graded 0-4+ with plantar responses).
Record GCS (E+V+M breakdown) for altered consciousness. Use NIHSS scoring for stroke presentations.
Clearly lateralize all findings: specify left vs. right, proximal vs. distal, upper vs. lower extremity.
Document cognitive assessments with validated tools: MMSE, MoCA scores with date.
Note temporal profile of symptoms: sudden vs. gradual onset, progressive vs. relapsing-remitting, duration of episodes.
Record relevant imaging findings (CT, MRI, MRA) with attention to lesion location, size, and correlation with clinical findings.
Document seizure semiology in detail when applicable: aura, motor features, duration, post-ictal state.`,
      emphasizedSections: [
        "neurological",
        "mental_state_exam",
        "history_present_illness",
        "radiology",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Standard neurology abbreviations: GCS, NIHSS, MRC, DTR, CN I-XII, MRI, MRA, CT, CTA, LP, CSF, EEG, EMG, NCS, MS, TIA, CVA, SAH. Grade motor strength 0-5 (MRC scale) and reflexes 0-4+.",
    },

    orthopedics: {
      id: "orthopedics",
      name: "Orthopedics",
      systemPromptAddendum: `Document the musculoskeletal examination with precision: inspection (swelling, deformity, alignment, atrophy, skin changes), palpation (point tenderness, effusion, crepitus, warmth), active and passive range of motion (in degrees using goniometry), strength testing (graded 0-5), and neurovascular status distally.
Perform and document specific provocative tests by joint: shoulder (Neer, Hawkins, empty can, Speed, O'Brien), knee (Lachman, anterior/posterior drawer, McMurray, valgus/varus stress), hip (FADIR, FABER, Trendelenburg), spine (straight leg raise, femoral nerve stretch).
Use standard fracture classification systems: AO/OTA for long bones, Weber for ankle, Garden for femoral neck, Neer for proximal humerus.
Document functional assessment: ambulatory status, assistive device use, ADL limitations, work capacity.
Record mechanism of injury with force vector, position at time of injury, and immediate post-injury function.
Note relevant imaging: X-ray views obtained, alignment, joint space, fracture pattern. MRI and CT findings when available.
Describe surgical plans with approach, implant type, and weight-bearing status when applicable.`,
      emphasizedSections: [
        "musculoskeletal",
        "neck",
        "back",
        "shoulders",
        "elbows",
        "hands",
        "hips",
        "knees",
        "feet",
        "radiology",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Standard orthopedic abbreviations: ROM, ACL, PCL, MCL, LCL, RTC, TKA, THA, ORIF, MRI, CT, XR, WB (weight-bearing), NWB, WBAT, ADL, PT, OT. Document ROM in degrees with normal reference values.",
    },

    dermatology: {
      id: "dermatology",
      name: "Dermatology",
      systemPromptAddendum: `Describe skin lesions using standardized dermatologic terminology: primary morphology (macule, papule, patch, plaque, nodule, vesicle, bulla, pustule, wheal), secondary changes (scale, crust, erosion, ulcer, excoriation, lichenification, atrophy), and configuration (grouped, linear, annular, reticular, dermatomal).
Document precise location using anatomic landmarks. Record number of lesions (solitary, few, numerous, generalized) and distribution pattern (localized, regional, symmetric, photodistributed, acral, truncal).
Measure lesion size in millimeters or centimeters. Document color precisely (erythematous, violaceous, hyperpigmented, hypopigmented, flesh-colored).
Apply ABCDE criteria for melanocytic lesions: Asymmetry, Border irregularity, Color variation, Diameter >6mm, Evolution.
Document dermatoscopy findings when performed: pattern (reticular, globular, homogeneous, starburst), structures (pigment network, dots, globules, streaks, vascular pattern).
Note relevant history: duration, evolution, symptoms (pruritus, pain, burning), prior treatments and response, sun exposure history, family history of skin cancer.
Record biopsy site, technique (shave, punch, excisional), and specimen handling.`,
      emphasizedSections: [
        "skin",
        "history_present_illness",
        "family_history",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Use standardized dermatologic morphology terms. Accepted abbreviations: BCC, SCC, AK, SLE, HSV, VZV, KOH, ABCDE, SPF, UV, UVA, UVB, PDT. Describe color using clinical terms (erythematous, violaceous) rather than colloquial color names.",
    },

    psychiatry: {
      id: "psychiatry",
      name: "Psychiatry",
      systemPromptAddendum: `Document a comprehensive mental status examination: appearance (grooming, attire, psychomotor activity, eye contact), speech (rate, rhythm, volume, tone, latency), mood (patient's own words in quotes), affect (quality, range, congruence with mood, reactivity, stability), thought process (linear, circumstantial, tangential, loose associations, flight of ideas), thought content (suicidal ideation, homicidal ideation, delusions, obsessions, phobias), perceptual disturbances (hallucinations by modality), cognition (orientation, attention, memory), insight, and judgment.
Perform and document structured risk assessments: suicidal ideation (plan, intent, means, protective factors), self-harm, violence risk, and elopement risk. Use the Columbia Suicide Severity Rating Scale (C-SSRS) framework.
Record standardized screening scores: PHQ-9 for depression, GAD-7 for anxiety, AUDIT-C for alcohol use, MDQ for bipolar screening, PCL-5 for PTSD. Include the total score and date.
Document substance use history in detail: substances, route, frequency, quantity, last use, withdrawal history, prior treatment.
Note current psychotropic medications with dose, duration, response, and side effects. Track medication trials history.
Record functional status: occupational, social, self-care capacity. Note legal issues (involuntary status, guardianship) when applicable.`,
      emphasizedSections: [
        "mental_state_exam",
        "suicide_risk_assessment",
        "history_present_illness",
        "current_medications",
        "alcohol",
        "controlled_substances",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: MSE, SI, HI, AH, VH, PHQ-9, GAD-7, C-SSRS, MDQ, AUDIT-C, PCL-5, MDD, GAD, PTSD, ADHD, ASD, BPD, SUD, TCA, SSRI, SNRI, ECT. Always quote mood in the patient's own words.",
    },

    pediatrics: {
      id: "pediatrics",
      name: "Pediatrics",
      systemPromptAddendum: `Document growth parameters with percentiles: weight, length/height, head circumference (for children <2 years), and BMI (for children >=2 years). Plot on age- and sex-appropriate growth charts (WHO for <2y, CDC for 2-18y). Flag any crossing of percentile lines.
Assess and document developmental milestones appropriate to the child's age: gross motor, fine motor, language (receptive and expressive), and social/adaptive domains. Note any developmental concerns or regression.
Record vaccination status in detail: vaccines received, due, and overdue per the national immunization schedule. Document any vaccine refusals, adverse reactions, or contraindications.
Use age-appropriate vital sign reference ranges. Flag abnormal values according to pediatric norms, not adult ranges.
Document feeding history for infants: breastfeeding/formula type, volume/frequency, introduction of solids, and any feeding difficulties.
Note the informant (parent, caregiver, adolescent) and the reliability of the history.
For adolescents, use the HEEADSSS framework: Home, Education, Eating, Activities, Drugs, Sexuality, Suicide/depression, Safety.
Record birth history when relevant: gestational age, birth weight, delivery method, NICU stay, neonatal complications.`,
      emphasizedSections: [
        "height",
        "weight",
        "bmi",
        "general_condition",
        "history_present_illness",
        "past_history",
        "review_of_systems",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        'Use pediatric-specific abbreviations: GA, BW, NICU, VLBW, AGA, SGA, LGA, HEEADSSS, WHO, CDC, DTaP, MMR, IPV, Hib, PCV. Always express age precisely (e.g., "14-month-old" not "1-year-old") and use pediatric normal ranges for vitals.',
    },

    gynecology: {
      id: "gynecology",
      name: "Gynecology",
      systemPromptAddendum: `Document menstrual history in detail: menarche age, cycle length, duration of flow, regularity, volume (light/moderate/heavy), last menstrual period (LMP), dysmenorrhea, and intermenstrual bleeding.
Record obstetric history using GTPAL notation: Gravida, Term, Preterm, Abortions, Living children. For each pregnancy, note year, gestational age at delivery, mode of delivery, birth weight, and complications.
Document pelvic examination findings systematically: external genitalia, speculum exam (vaginal mucosa, cervix appearance, discharge), bimanual exam (uterine size, shape, position, tenderness, adnexal masses, cervical motion tenderness).
Record cervical cancer screening status: last Pap smear date and result, HPV co-testing result, and colposcopy history if applicable.
Document hormonal status indicators: perimenopausal/menopausal symptoms, hormone therapy use, contraceptive method and duration.
Note sexual history when relevant: sexually active status, number of partners, STI screening, dyspareunia.
Record relevant imaging: pelvic ultrasound findings (endometrial thickness, ovarian morphology, uterine fibroids with size and location).`,
      emphasizedSections: [
        "gynaecology",
        "history_present_illness",
        "past_history",
        "current_medications",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: LMP, GTPAL, G_P_, EDD, GA, US, TVS, HSG, Pap, HPV, LEEP, LLETZ, HRT, OCP, IUD, IUS, STI, PCOS, PID, BSO, TAH. Use FIGO staging for gynecologic malignancies.",
    },

    urology: {
      id: "urology",
      name: "Urology",
      systemPromptAddendum: `Document lower urinary tract symptoms (LUTS) systematically: storage symptoms (frequency, urgency, nocturia, incontinence type), voiding symptoms (hesitancy, weak stream, intermittency, straining, terminal dribbling), and post-micturition symptoms (incomplete emptying, post-void dribbling).
Record IPSS (International Prostate Symptom Score) with total score (0-35), quality of life score, and classification (mild 0-7, moderate 8-19, severe 20-35).
Document PSA values with context: total PSA, free/total ratio when available, PSA velocity/doubling time, and prior biopsy results.
Record urinalysis findings: dipstick results and microscopy (WBC, RBC, bacteria, casts, crystals).
Document renal function: serum creatinine, eGFR, and imaging (ultrasound with kidney sizes, hydronephrosis grading, post-void residual volume).
For digital rectal exam, document prostate size (estimated grams), consistency, nodularity, tenderness, and symmetry.
Note sexual function when relevant: erectile function (IIEF-5 score), ejaculatory function, and impact on quality of life.
Record stone history: composition if known, size, location, prior interventions.`,
      emphasizedSections: [
        "penis_scrotum",
        "rectal_exam",
        "history_present_illness",
        "lab",
        "radiology",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: LUTS, IPSS, PSA, DRE, BPH, PVR, UTI, GFR, eGFR, IIEF, TURP, TURBT, URS, ESWL, PCN, CKD, RCC, TCC, BCG. Use IPSS categories: mild (0-7), moderate (8-19), severe (20-35).",
    },

    endocrinology: {
      id: "endocrinology",
      name: "Endocrinology",
      systemPromptAddendum: `Document glycemic control comprehensively for diabetes: HbA1c with date and trend, fasting and post-prandial glucose targets, hypoglycemia frequency and severity, time in range (if CGM data available), and current insulin/medication regimen with doses.
Record thyroid assessment in detail: palpation findings (size, nodularity, tenderness), thyroid function tests (TSH, fT4, fT3), thyroid antibodies (TPO, TRAb, Tg), and ultrasound findings (nodule size, TI-RADS classification).
Document hormonal profiles with reference ranges: cortisol (with time of collection), ACTH, growth hormone, IGF-1, prolactin, testosterone, estradiol, FSH, LH, DHEA-S, PTH, vitamin D.
Record metabolic panel: fasting glucose, HbA1c, lipid profile, BMI, waist circumference, blood pressure. Calculate and document cardiovascular risk.
Document bone density when relevant: DXA T-scores at spine and hip, FRAX score, and fracture history.
Note relevant physical findings: acanthosis nigricans, striae, moon facies, exophthalmos, goiter, gynecomastia, visual field defects.
Track weight trends with dates and correlation to treatment changes.`,
      emphasizedSections: [
        "thyroid",
        "bmi",
        "weight",
        "lab",
        "current_medications",
        "history_present_illness",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: HbA1c, FPG, OGTT, CGM, TIR, TSH, fT4, fT3, TPO, TRAb, DXA, FRAX, ACTH, GH, IGF-1, PTH, DHEA-S, BMI, DM, T1D, T2D, DKA, TI-RADS, PCOS. Always include units and reference ranges for hormonal values.",
    },

    oncology: {
      id: "oncology",
      name: "Oncology",
      systemPromptAddendum: `Document tumor staging using the TNM system (AJCC edition) with individual T, N, M components and overall stage grouping. Specify clinical (c) vs. pathological (p) staging.
Record performance status using ECOG (0-5) or Karnofsky (0-100%) scale at each visit. Note any change from prior assessment.
Document treatment response using standardized criteria: RECIST 1.1 for solid tumors (CR, PR, SD, PD), Lugano classification for lymphoma, or disease-specific criteria as applicable.
Record tumor markers with trends: PSA, CEA, CA-125, CA 19-9, AFP, beta-hCG, LDH, and others relevant to the specific malignancy. Include dates for trend assessment.
Document treatment history in detail: chemotherapy regimens (drugs, doses, number of cycles), radiation (field, total dose, fractions), surgery (procedure, margins, pathology), immunotherapy, and targeted therapy.
Record treatment toxicity using CTCAE grading (1-5). Note dose modifications, delays, and supportive care measures.
Document pathology details: histologic type, grade, receptor status (ER/PR/HER2 for breast), molecular markers (EGFR, ALK, KRAS, MSI, PDL-1), and any genomic testing results.
Assess and document patient goals of care and advance directive status.`,
      emphasizedSections: [
        "assessment",
        "action_and_plan",
        "history_present_illness",
        "lab",
        "radiology",
        "current_medications",
        "general_condition",
        "weight",
      ],
      terminologyNotes:
        "Accepted abbreviations: TNM, AJCC, ECOG, KPS, RECIST, CR, PR, SD, PD, CTCAE, ER, PR, HER2, EGFR, ALK, KRAS, MSI, PDL-1, BSA, ANC, G-CSF, IO, TKI, mAb, RT, XRT, Gy. Specify AJCC edition when staging.",
    },

    ent: {
      id: "ent",
      name: "Ear, Nose & Throat",
      systemPromptAddendum: `Document otoscopic findings systematically: external ear canal (cerumen, edema, discharge), tympanic membrane (color, translucency, position, mobility, perforation with size and location, presence of retraction pockets or cholesteatoma), and middle ear status.
Record nasal examination findings: external nose (deformity, swelling), anterior rhinoscopy or endoscopy (mucosa color, turbinate size, septal deviation with direction, polyps, discharge character and location), and posterior nasopharynx when examined.
Document oropharyngeal examination: lips, oral mucosa, dentition, tongue (mobility, lesions), hard and soft palate, tonsils (size graded 0-4, crypts, exudate), posterior pharyngeal wall, and uvula position.
Record audiometry results when available: pure tone averages, air and bone conduction thresholds, speech discrimination scores, and tympanometry findings (type A, B, or C curves).
Document voice assessment: quality (hoarseness, breathiness, strain), onset, duration, and laryngoscopy findings if performed (vocal fold mobility, lesions, glottic closure).
Note hearing loss characterization: type (conductive, sensorineural, mixed), laterality, onset (sudden vs. gradual), and associated symptoms (tinnitus, vertigo, aural fullness).
For vertigo, document: onset, duration of episodes, triggers, Dix-Hallpike result, nystagmus characteristics (direction, fatigability), and Romberg test.`,
      emphasizedSections: [
        "ears",
        "nose",
        "mouth_throat",
        "history_present_illness",
        "assessment",
        "action_and_plan",
      ],
      terminologyNotes:
        "Accepted abbreviations: TM, EAC, OM, AOM, OME, CSOM, SNHL, CHL, PTA, SRT, ABR, OAE, FESS, ESS, CT, MRI, FNA, SCC, NPC, OSA, GERD, LPR, VHI. Grade tonsil size 0-4 (Brodsky scale).",
    },
  };

export function getSpecialtyPromptPack(
  id: string,
): SpecialtyPromptPack | undefined {
  return SPECIALTY_PROMPT_PACKS[id as SpecialtyId];
}
