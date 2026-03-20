/**
 * Section label translations for template preview.
 * Sourced from web/messages/{sk,en,cs}.json → templates.sections
 */

export type SectionLocale = "sk" | "cs" | "en";

const LABELS: Record<SectionLocale, Record<string, string>> = {
  sk: {
    reason_for_contact: "Dôvod kontaktu",
    past_history: "Osobná anamnéza",
    assistive_devices: "Pomôcky",
    family_history: "Rodinná anamnéza",
    allergies: "Alergie",
    current_medications: "Aktuálna medikácia",
    social_history: "Sociálna anamnéza",
    tobacco: "Tabak",
    alcohol: "Alkohol",
    controlled_substances: "Kontrolované látky",
    physical_activity: "Fyzická aktivita",
    diet: "Diéta",
    history_present_illness: "Anamnéza súčasného ochorenia",
    physical_exam: "Fyzikálne vyšetrenie",
    general_condition: "Celkový stav",
    body_temp: "Telesná teplota",
    height: "Výška",
    weight: "Hmotnosť",
    bmi: "BMI",
    skin: "Koža",
    eyes: "Oči",
    ears: "Uši",
    nose: "Nos",
    mouth_throat: "Ústa a hrdlo",
    lymph_nodes: "Lymfatické uzliny",
    thyroid: "Štítna žľaza",
    breast_exam: "Vyšetrenie prsníkov",
    heart: "Srdce",
    pulse: "Pulz",
    blood_pressure: "Krvný tlak",
    peripheral_pulses: "Periférne pulzy",
    ecg: "EKG",
    lungs: "Pľúca",
    respiratory_rate: "Dychová frekvencia",
    spo2: "SpO2",
    abdomen: "Brucho",
    rectal_exam: "Rektálne vyšetrenie",
    gynaecology: "Gynekológia",
    penis_scrotum: "Penis a skrótum",
    neurological: "Neurológia",
    mental_state_exam: "Vyšetrenie psychického stavu",
    suicide_risk_assessment: "Posúdenie suicidálneho rizika",
    neck: "Krk",
    back: "Chrbát",
    shoulders: "Ramená",
    elbows: "Lakte",
    hands: "Ruky",
    hips: "Bedrá",
    knees: "Kolená",
    feet: "Nohy",
    lab: "Laboratórium",
    radiology: "Rádiológia",
    other_exam_findings: "Ostatné nálezy vyšetrení",
    assessment: "Záver",
    action_and_plan: "Postup a plán",
    subjective: "Subjektívne",
    objective: "Objektívne",
    plan: "Plán",
    anamnesis: "Anamnézy",
    epidemiological_history: "Epidemiologická anamnéza",
    work_history: "Pracovná anamnéza",
    substance_use: "Abúzus",
    objective_examination: "Objektívne vyšetrenie",
    general_examination: "Celkové vyšetrenie",
  },
  en: {
    reason_for_contact: "Reason for contact",
    past_history: "Past history",
    assistive_devices: "Assistive devices",
    family_history: "Family history",
    allergies: "Allergies",
    current_medications: "Current medications",
    social_history: "Social history",
    tobacco: "Tobacco",
    alcohol: "Alcohol",
    controlled_substances: "Controlled substances",
    physical_activity: "Physical activity",
    diet: "Diet",
    history_present_illness: "History of present illness",
    physical_exam: "Physical examination",
    general_condition: "General condition",
    body_temp: "Body temperature",
    height: "Height",
    weight: "Weight",
    bmi: "BMI",
    skin: "Skin",
    eyes: "Eyes",
    ears: "Ears",
    nose: "Nose",
    mouth_throat: "Mouth and throat",
    lymph_nodes: "Lymph nodes",
    thyroid: "Thyroid",
    breast_exam: "Breast examination",
    heart: "Heart",
    pulse: "Pulse",
    blood_pressure: "Blood pressure",
    peripheral_pulses: "Peripheral pulses",
    ecg: "ECG",
    lungs: "Lungs",
    respiratory_rate: "Respiratory rate",
    spo2: "SpO2",
    abdomen: "Abdomen",
    rectal_exam: "Rectal examination",
    gynaecology: "Gynaecology",
    penis_scrotum: "Penis and scrotum",
    neurological: "Neurological",
    mental_state_exam: "Mental state examination",
    suicide_risk_assessment: "Suicide risk assessment",
    neck: "Neck",
    back: "Back",
    shoulders: "Shoulders",
    elbows: "Elbows",
    hands: "Hands",
    hips: "Hips",
    knees: "Knees",
    feet: "Feet",
    lab: "Laboratory",
    radiology: "Radiology",
    other_exam_findings: "Other examination findings",
    assessment: "Assessment",
    action_and_plan: "Action and plan",
    subjective: "Subjective",
    objective: "Objective",
    plan: "Plan",
    anamnesis: "History",
    epidemiological_history: "Epidemiological history",
    work_history: "Work history",
    substance_use: "Substance use",
    objective_examination: "Objective examination",
    general_examination: "General examination",
  },
  cs: {
    reason_for_contact: "Důvod kontaktu",
    past_history: "Osobní anamnéza",
    assistive_devices: "Pomůcky",
    family_history: "Rodinná anamnéza",
    allergies: "Alergie",
    current_medications: "Aktuální medikace",
    social_history: "Sociální anamnéza",
    tobacco: "Tabák",
    alcohol: "Alkohol",
    controlled_substances: "Kontrolované látky",
    physical_activity: "Fyzická aktivita",
    diet: "Dieta",
    history_present_illness: "Anamnéza současného onemocnění",
    physical_exam: "Fyzikální vyšetření",
    general_condition: "Celkový stav",
    body_temp: "Tělesná teplota",
    height: "Výška",
    weight: "Hmotnost",
    bmi: "BMI",
    skin: "Kůže",
    eyes: "Oči",
    ears: "Uši",
    nose: "Nos",
    mouth_throat: "Ústa a hrdlo",
    lymph_nodes: "Lymfatické uzliny",
    thyroid: "Štítná žláza",
    breast_exam: "Vyšetření prsů",
    heart: "Srdce",
    pulse: "Puls",
    blood_pressure: "Krevní tlak",
    peripheral_pulses: "Periferní pulsy",
    ecg: "EKG",
    lungs: "Plíce",
    respiratory_rate: "Dechová frekvence",
    spo2: "SpO2",
    abdomen: "Břicho",
    rectal_exam: "Rektální vyšetření",
    gynaecology: "Gynekologie",
    penis_scrotum: "Penis a skrotum",
    neurological: "Neurologie",
    mental_state_exam: "Vyšetření psychického stavu",
    suicide_risk_assessment: "Posouzení suicidálního rizika",
    neck: "Krk",
    back: "Záda",
    shoulders: "Ramena",
    elbows: "Lokty",
    hands: "Ruce",
    hips: "Kyčle",
    knees: "Kolena",
    feet: "Nohy",
    lab: "Laboratoř",
    radiology: "Radiologie",
    other_exam_findings: "Ostatní nálezy vyšetření",
    assessment: "Závěr",
    action_and_plan: "Postup a plán",
    subjective: "Subjektivně",
    objective: "Objektivně",
    plan: "Plán",
    anamnesis: "Anamnézy",
    epidemiological_history: "Epidemiologická anamnéza",
    work_history: "Pracovní anamnéza",
    substance_use: "Abúzus",
    objective_examination: "Objektivní vyšetření",
    general_examination: "Celkové vyšetření",
  },
};

/**
 * Resolve a section labelKey to a localized label.
 * Falls back to the labelKey itself if no translation exists.
 */
export function getSectionLabel(
  labelKey: string,
  locale: SectionLocale,
): string {
  return LABELS[locale]?.[labelKey] ?? labelKey;
}

// ── Reverse lookup (localized text → canonical key) ─────────────

const REVERSE_CACHE = new Map<SectionLocale, Map<string, string>>();

function getReverseLookup(locale: SectionLocale): Map<string, string> {
  let map = REVERSE_CACHE.get(locale);
  if (!map) {
    map = new Map();
    for (const [key, label] of Object.entries(LABELS[locale])) {
      map.set(label.toLowerCase(), key);
    }
    REVERSE_CACHE.set(locale, map);
  }
  return map;
}

/**
 * Given a localized label typed by the user, find the canonical key.
 * Case-insensitive match. Returns undefined if no match.
 */
export function reverseLookupKey(
  text: string,
  locale: SectionLocale,
): string | undefined {
  return getReverseLookup(locale).get(text.toLowerCase());
}

/**
 * Return all known section labels for a locale.
 * Useful for autocomplete / datalist.
 */
export function getAllSectionLabels(
  locale: SectionLocale,
): { key: string; label: string }[] {
  return Object.entries(LABELS[locale]).map(([key, label]) => ({ key, label }));
}
