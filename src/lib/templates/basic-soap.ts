import type { Template } from "./types";

export const basicSoap: Template = {
  id: "basic-soap",
  nameKey: "basic-soap.name",
  descriptionKey: "basic-soap.description",
  sections: [
    { id: "subjective", labelKey: "subjective" },
    { id: "objective", labelKey: "objective" },
    { id: "assessment", labelKey: "assessment" },
    { id: "plan", labelKey: "plan" },
  ],
};
