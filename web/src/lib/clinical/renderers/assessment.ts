/**
 * Deterministic Assessment / Záver renderer.
 *
 * Reads directly from the `EncounterModel` — the single source of truth.
 * No cleanup pass. No LLM. Classification was done once in Stage 3
 * (model build); the renderer only formats.
 */

import type { SupportedLanguage } from "../../types";
import type { EncounterModel, ProblemItem } from "../encounter-model";

type BucketHeadings = {
  primary: string;
  secondary: string;
  chronic: string;
  differential: string;
};

const HEADINGS: Record<SupportedLanguage, BucketHeadings> = {
  sk: {
    primary: "Hlavná diagnóza",
    secondary: "Vedľajšie diagnózy",
    chronic: "Chronické ochorenia",
    differential: "Diferenciálna diagnostika",
  },
  cs: {
    primary: "Hlavní diagnóza",
    secondary: "Vedlejší diagnózy",
    chronic: "Chronická onemocnění",
    differential: "Diferenciální diagnostika",
  },
  en: {
    primary: "Primary diagnosis",
    secondary: "Secondary diagnoses",
    chronic: "Chronic conditions",
    differential: "Differential diagnoses",
  },
};

function renderProblem(p: ProblemItem): string {
  if (p.icdCode) return `${p.icdCode} ${p.label}`;
  return p.label;
}

/**
 * Render the Assessment / Záver section from the encounter model.
 * Returns the section text, or `""` when every bucket is empty.
 */
export function renderAssessmentFromModel(model: EncounterModel): string {
  const headings = HEADINGS[model.language];
  const blocks: string[] = [];

  if (model.currentEncounter.primaryProblem) {
    blocks.push(
      [
        headings.primary,
        renderProblem(model.currentEncounter.primaryProblem),
      ].join("\n"),
    );
  }

  if (model.currentEncounter.supportingProblems.length > 0) {
    blocks.push(
      [
        headings.secondary,
        ...model.currentEncounter.supportingProblems.map(renderProblem),
      ].join("\n"),
    );
  }

  if (model.chronicConditions.length > 0) {
    blocks.push(
      [headings.chronic, ...model.chronicConditions.map(renderProblem)].join(
        "\n",
      ),
    );
  }

  if (model.currentEncounter.differentialProblems.length > 0) {
    blocks.push(
      [
        headings.differential,
        ...model.currentEncounter.differentialProblems.map(renderProblem),
      ].join("\n"),
    );
  }

  return blocks.join("\n\n");
}

/** True when the model has at least one diagnosis item anywhere. */
export function modelHasAnyProblem(model: EncounterModel): boolean {
  return (
    !!model.currentEncounter.primaryProblem ||
    model.currentEncounter.supportingProblems.length > 0 ||
    model.currentEncounter.differentialProblems.length > 0 ||
    model.chronicConditions.length > 0
  );
}
