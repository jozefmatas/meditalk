import type { Template } from "./types";

export const basicSoap: Template = {
  id: "basic-soap",
  nameKey: "basic-soap.name",
  descriptionKey: "basic-soap.description",
  specialties: ["general_practice"],
  sections: [
    { id: "subjective", labelKey: "subjective" },
    { id: "objective", labelKey: "objective" },
    { id: "assessment", labelKey: "assessment" },
    { id: "plan", labelKey: "plan" },
  ],
  isSystem: true,
  sortOrder: 1,
};
