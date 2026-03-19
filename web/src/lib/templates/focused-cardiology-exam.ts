import type { Template } from "./types";

export const focusedCardiologyExam: Template = {
  id: "focused-cardiology-exam",
  nameKey: "focused-cardiology-exam.name",
  descriptionKey: "focused-cardiology-exam.description",
  sections: [
    {
      id: "anamnesis",
      labelKey: "anamnesis",
      subsections: [
        { id: "ra", labelKey: "ra" },
        { id: "oa", labelKey: "oa" },
        { id: "sa", labelKey: "sa" },
        { id: "ea", labelKey: "ea" },
        { id: "pa", labelKey: "pa" },
        { id: "aa", labelKey: "aa" },
        { id: "la", labelKey: "la" },
        { id: "ab", labelKey: "ab" },
        { id: "to_present_illness", labelKey: "to_present_illness" },
      ],
    },
    {
      id: "objective_examination",
      labelKey: "objective_examination",
      subsections: [
        { id: "blood_pressure", labelKey: "blood_pressure" },
        { id: "pulse", labelKey: "pulse" },
        { id: "height", labelKey: "height" },
        { id: "weight", labelKey: "weight" },
        { id: "bmi", labelKey: "bmi" },
        { id: "general_examination", labelKey: "general_examination" },
        { id: "ecg", labelKey: "ecg" },
      ],
    },
    { id: "assessment", labelKey: "assessment" },
    { id: "action_and_plan", labelKey: "action_and_plan" },
  ],
};
