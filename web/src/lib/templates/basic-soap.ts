import type { Template } from "./types";

export const basicSoap: Template = {
  id: "t_X2cOl91J5A",
  name: {
    sk: "Základná SOAP poznámka",
    en: "Basic SOAP Note",
    cs: "Základní SOAP poznámka",
  },
  description: {
    sk: "Štandardný 4-sekciový SOAP formát",
    en: "Standard 4-section SOAP format",
    cs: "Standardní 4-sekciový SOAP formát",
  },
  sections: [
    {
      id: "s_7PrqLo50FX",
      labels: { sk: "Subjektívne", en: "Subjective", cs: "Subjektivně" },
    },
    {
      id: "s_-hDgYz1VoE",
      labels: { sk: "Objektívne", en: "Objective", cs: "Objektivně" },
    },
    {
      id: "s_tii89moyLY",
      labels: { sk: "Záver", en: "Assessment", cs: "Závěr" },
    },
    { id: "s_K4JiIfkiOy", labels: { sk: "Plán", en: "Plan", cs: "Plán" } },
  ],
};
