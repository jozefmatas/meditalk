import type { Template } from "./types";

export const comprehensiveMedicalExam: Template = {
  id: "comprehensive-medical-exam",
  name: {
    sk: "Komplexné lekárske vyšetrenie",
    en: "Comprehensive Medical Exam",
    cs: "Komplexní lékařské vyšetření",
  },
  description: {
    sk: "Kompletná šablóna vyšetrenia s ~50 sekciami",
    en: "Complete examination template with ~50 sections",
    cs: "Kompletní šablona vyšetření s ~50 sekcemi",
  },
  sections: [
    {
      id: "s_C-by_DTvyO",
      labels: {
        sk: "Dôvod kontaktu",
        en: "Reason for contact",
        cs: "Důvod kontaktu",
      },
    },
    {
      id: "s_EIWsmcB2MM",
      labels: {
        sk: "Osobná anamnéza",
        en: "Past history",
        cs: "Osobní anamnéza",
      },
    },
    {
      id: "s_7oI2ZLuvNT",
      labels: { sk: "Pomôcky", en: "Assistive devices", cs: "Pomůcky" },
    },
    {
      id: "s_u9xmKBjzyn",
      labels: {
        sk: "Rodinná anamnéza",
        en: "Family history",
        cs: "Rodinná anamnéza",
      },
    },
    {
      id: "s_5CUGOo7wWY",
      labels: { sk: "Alergie", en: "Allergies", cs: "Alergie" },
    },
    {
      id: "s_gMjgwIgq56",
      labels: {
        sk: "Aktuálna medikácia",
        en: "Current medications",
        cs: "Aktuální medikace",
      },
    },
    {
      id: "s_8c5bd3phYR",
      labels: {
        sk: "Sociálna anamnéza",
        en: "Social history",
        cs: "Sociální anamnéza",
      },
      subsections: [
        {
          id: "s_SLj_NDUPrJ",
          labels: { sk: "Tabak", en: "Tobacco", cs: "Tabák" },
        },
        {
          id: "s_Im25u82krx",
          labels: { sk: "Alkohol", en: "Alcohol", cs: "Alkohol" },
        },
        {
          id: "s_cpBJcTvQJZ",
          labels: {
            sk: "Kontrolované látky",
            en: "Controlled substances",
            cs: "Kontrolované látky",
          },
        },
        {
          id: "s_UgoJX1IttG",
          labels: {
            sk: "Fyzická aktivita",
            en: "Physical activity",
            cs: "Fyzická aktivita",
          },
        },
        {
          id: "s_Q0QMzO2XR4",
          labels: { sk: "Diéta", en: "Diet", cs: "Dieta" },
        },
      ],
    },
    {
      id: "s_uwJ3jH8Vh-",
      labels: {
        sk: "Anamnéza súčasného ochorenia",
        en: "History of present illness",
        cs: "Anamnéza současného onemocnění",
      },
    },
    {
      id: "s_oMyUjTphxE",
      labels: {
        sk: "Fyzikálne vyšetrenie",
        en: "Physical examination",
        cs: "Fyzikální vyšetření",
      },
      subsections: [
        {
          id: "s_QKNMCuXJul",
          labels: {
            sk: "Celkový stav",
            en: "General condition",
            cs: "Celkový stav",
          },
        },
        {
          id: "s_1JjpbsuZ8I",
          labels: {
            sk: "Telesná teplota",
            en: "Body temperature",
            cs: "Tělesná teplota",
          },
        },
        {
          id: "s_TFFOsSuY0v",
          labels: { sk: "Výška", en: "Height", cs: "Výška" },
        },
        {
          id: "s_inVDYeWk9i",
          labels: { sk: "Hmotnosť", en: "Weight", cs: "Hmotnost" },
        },
        { id: "s__LyYjs6yqf", labels: { sk: "BMI", en: "BMI", cs: "BMI" } },
        { id: "s__7jbZG4lUT", labels: { sk: "Koža", en: "Skin", cs: "Kůže" } },
        { id: "s_Ym3I8Y_ivK", labels: { sk: "Oči", en: "Eyes", cs: "Oči" } },
        { id: "s_l-OeZyYU6Z", labels: { sk: "Uši", en: "Ears", cs: "Uši" } },
        { id: "s_E0oqaOHGah", labels: { sk: "Nos", en: "Nose", cs: "Nos" } },
        {
          id: "s_TTjU5_b8Kh",
          labels: {
            sk: "Ústa a hrdlo",
            en: "Mouth and throat",
            cs: "Ústa a hrdlo",
          },
        },
        {
          id: "s_mMfVazapFL",
          labels: {
            sk: "Lymfatické uzliny",
            en: "Lymph nodes",
            cs: "Lymfatické uzliny",
          },
        },
        {
          id: "s_WyIAi1JjF6",
          labels: { sk: "Štítna žľaza", en: "Thyroid", cs: "Štítná žláza" },
        },
        {
          id: "s_s47MWcDFlT",
          labels: {
            sk: "Vyšetrenie prsníkov",
            en: "Breast examination",
            cs: "Vyšetření prsů",
          },
        },
        {
          id: "s_3F8nuMoK5r",
          labels: { sk: "Srdce", en: "Heart", cs: "Srdce" },
        },
        { id: "s_EYImimCuS-", labels: { sk: "Pulz", en: "Pulse", cs: "Puls" } },
        {
          id: "s_dPSamv9rto",
          labels: { sk: "Krvný tlak", en: "Blood pressure", cs: "Krevní tlak" },
        },
        {
          id: "s_lMGjg4GPkz",
          labels: {
            sk: "Periférne pulzy",
            en: "Peripheral pulses",
            cs: "Periferní pulsy",
          },
        },
        { id: "s_-qhI6i3tP2", labels: { sk: "EKG", en: "ECG", cs: "EKG" } },
        {
          id: "s_XEDKyxMRSZ",
          labels: { sk: "Pľúca", en: "Lungs", cs: "Plíce" },
        },
        {
          id: "s_mBfWjeWg91",
          labels: {
            sk: "Dychová frekvencia",
            en: "Respiratory rate",
            cs: "Dechová frekvence",
          },
        },
        { id: "s_himDDQWDRn", labels: { sk: "SpO2", en: "SpO2", cs: "SpO2" } },
        {
          id: "s_kOx_jB5faM",
          labels: { sk: "Brucho", en: "Abdomen", cs: "Břicho" },
        },
        {
          id: "s_tvkD4Jji4k",
          labels: {
            sk: "Rektálne vyšetrenie",
            en: "Rectal examination",
            cs: "Rektální vyšetření",
          },
        },
        {
          id: "s_3glLP8yCw5",
          labels: { sk: "Gynekológia", en: "Gynaecology", cs: "Gynekologie" },
        },
        {
          id: "s_TQXGLXUTR9",
          labels: {
            sk: "Penis a skrótum",
            en: "Penis and scrotum",
            cs: "Penis a skrotum",
          },
        },
        {
          id: "s_lDNw60buLs",
          labels: { sk: "Neurológia", en: "Neurological", cs: "Neurologie" },
        },
        {
          id: "s_SJbEWdH3jI",
          labels: {
            sk: "Vyšetrenie psychického stavu",
            en: "Mental state examination",
            cs: "Vyšetření psychického stavu",
          },
        },
        {
          id: "s_ZruQtPyMFy",
          labels: {
            sk: "Posúdenie suicidálneho rizika",
            en: "Suicide risk assessment",
            cs: "Posouzení suicidálního rizika",
          },
        },
        { id: "s_qefFEfSJWA", labels: { sk: "Krk", en: "Neck", cs: "Krk" } },
        {
          id: "s_RzS9tNxamq",
          labels: { sk: "Chrbát", en: "Back", cs: "Záda" },
        },
        {
          id: "s_JjMP1YNrel",
          labels: { sk: "Ramená", en: "Shoulders", cs: "Ramena" },
        },
        {
          id: "s_UqCQ_gH4HB",
          labels: { sk: "Lakte", en: "Elbows", cs: "Lokty" },
        },
        { id: "s_Ww_xMj7vkT", labels: { sk: "Ruky", en: "Hands", cs: "Ruce" } },
        {
          id: "s_nnLckgK6o7",
          labels: { sk: "Bedrá", en: "Hips", cs: "Kyčle" },
        },
        {
          id: "s_C7W5LWhQUC",
          labels: { sk: "Kolená", en: "Knees", cs: "Kolena" },
        },
        { id: "s_d_uE4S6C8k", labels: { sk: "Nohy", en: "Feet", cs: "Nohy" } },
      ],
    },
    {
      id: "s_06F-_T0_kG",
      labels: { sk: "Laboratórium", en: "Laboratory", cs: "Laboratoř" },
    },
    {
      id: "s_m41ZmZihik",
      labels: { sk: "Rádiológia", en: "Radiology", cs: "Radiologie" },
    },
    {
      id: "s_7txnnyMcbY",
      labels: {
        sk: "Ostatné nálezy vyšetrení",
        en: "Other examination findings",
        cs: "Ostatní nálezy vyšetření",
      },
    },
    {
      id: "s_tii89moyLY",
      labels: { sk: "Záver", en: "Assessment", cs: "Závěr" },
    },
    {
      id: "s_ls52uxKBwz",
      labels: {
        sk: "Postup a plán",
        en: "Action and plan",
        cs: "Postup a plán",
      },
    },
  ],
};
