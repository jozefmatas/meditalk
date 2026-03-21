import type { Template } from "./types";

export const focusedCardiologyExam: Template = {
  id: "t_KZPRXwjQye",
  name: {
    sk: "Cielené kardiologické vyšetrenie",
    en: "Focused Cardiology Examination",
    cs: "Cílené kardiologické vyšetření",
  },
  description: {
    sk: "Kardiologická šablóna s anamnézami, objektívnym vyšetrením a EKG",
    en: "Cardiology template with history, objective examination and ECG",
    cs: "Kardiologická šablona s anamnézami, objektivním vyšetřením a EKG",
  },
  sections: [
    {
      id: "s_-wS8Uj0TcZ",
      labels: { sk: "Anamnézy", en: "History", cs: "Anamnézy" },
      subsections: [
        { id: "s_ed25tSj0lW", labels: { sk: "RA", en: "RA", cs: "RA" } },
        { id: "s_wKysyf88eU", labels: { sk: "OA", en: "OA", cs: "OA" } },
        { id: "s_cZr8VV7GmI", labels: { sk: "SA", en: "SA", cs: "SA" } },
        { id: "s_samVolnuU-", labels: { sk: "EA", en: "EA", cs: "EA" } },
        { id: "s_j9PmnNau7B", labels: { sk: "PA", en: "PA", cs: "PA" } },
        { id: "s_GqxtL1i4s5", labels: { sk: "AA", en: "AA", cs: "AA" } },
        { id: "s_QSCbariJ7v", labels: { sk: "LA", en: "LA", cs: "LA" } },
        { id: "s_xLqDLHemKe", labels: { sk: "Ab", en: "Ab", cs: "Ab" } },
        { id: "s_WFjjP0IolT", labels: { sk: "TO", en: "TO", cs: "TO" } },
      ],
    },
    {
      id: "s_qTC70j5skX",
      labels: {
        sk: "Objektívne vyšetrenie",
        en: "Objective examination",
        cs: "Objektivní vyšetření",
      },
      subsections: [
        {
          id: "s_dPSamv9rto",
          labels: { sk: "Krvný tlak", en: "Blood pressure", cs: "Krevní tlak" },
        },
        { id: "s_EYImimCuS-", labels: { sk: "Pulz", en: "Pulse", cs: "Puls" } },
        {
          id: "s_TFFOsSuY0v",
          labels: { sk: "Výška", en: "Height", cs: "Výška" },
        },
        {
          id: "s_inVDYeWk9i",
          labels: { sk: "Hmotnosť", en: "Weight", cs: "Hmotnost" },
        },
        { id: "s__LyYjs6yqf", labels: { sk: "BMI", en: "BMI", cs: "BMI" } },
        {
          id: "s_N8hLjRbNpp",
          labels: {
            sk: "Celkové vyšetrenie",
            en: "General examination",
            cs: "Celkové vyšetření",
          },
        },
        { id: "s_-qhI6i3tP2", labels: { sk: "EKG", en: "ECG", cs: "EKG" } },
      ],
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
