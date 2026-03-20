import { describe, it, expect } from "vitest";
import {
  buildTemplateSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "./anthropic";
import type { Template } from "./templates/types";

const soapTemplate: Template = {
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

const sectionLabels: Record<string, string> = {
  subjective: "Subjektívne",
  objective: "Objektívne",
  assessment: "Hodnotenie",
  plan: "Plán",
};

describe("buildTemplateSystemPrompt", () => {
  it("uses DEFAULT_SYSTEM_PROMPT when template has no custom prompt", () => {
    const result = buildTemplateSystemPrompt(soapTemplate, "sk", sectionLabels);

    // Should contain interpolated language
    expect(result).toContain("Slovak");
    // Should NOT contain raw placeholders
    expect(result).not.toContain("{{language}}");
    expect(result).not.toContain("{{sections}}");
    // Should contain section list
    expect(result).toContain('"subjective": Subjektívne');
    expect(result).toContain('"plan": Plán');
  });

  it("interpolates {{language}} for different languages", () => {
    const sk = buildTemplateSystemPrompt(soapTemplate, "sk", sectionLabels);
    const en = buildTemplateSystemPrompt(soapTemplate, "en", sectionLabels);
    const cs = buildTemplateSystemPrompt(soapTemplate, "cs", sectionLabels);

    expect(sk).toContain("Slovak");
    expect(en).toContain("English");
    expect(cs).toContain("Czech");
  });

  it("uses custom systemPrompt when provided", () => {
    const customTemplate: Template = {
      ...soapTemplate,
      systemPrompt:
        "You are a {{language}} medical assistant.\n\nSections:\n{{sections}}",
    };

    const result = buildTemplateSystemPrompt(
      customTemplate,
      "sk",
      sectionLabels,
    );

    expect(result).toBe(
      'You are a Slovak medical assistant.\n\nSections:\n- "subjective": Subjektívne\n- "objective": Objektívne\n- "assessment": Hodnotenie\n- "plan": Plán',
    );
  });

  it("interpolates {{languageCode}} in custom prompts", () => {
    const customTemplate: Template = {
      ...soapTemplate,
      systemPrompt: "Output in {{languageCode}} ({{language}}).",
    };

    const result = buildTemplateSystemPrompt(
      customTemplate,
      "cs",
      sectionLabels,
    );

    expect(result).toBe("Output in cs (Czech).");
  });

  it("handles templates with subsections", () => {
    const template: Template = {
      id: "with-subs",
      nameKey: "test.name",
      descriptionKey: "test.description",
      sections: [
        {
          id: "history",
          labelKey: "history",
          subsections: [
            { id: "family", labelKey: "family" },
            { id: "social", labelKey: "social" },
          ],
        },
        { id: "plan", labelKey: "plan" },
      ],
    };

    const labels: Record<string, string> = {
      history: "History",
      family: "Family",
      social: "Social",
      plan: "Plan",
    };

    const result = buildTemplateSystemPrompt(template, "en", labels);

    expect(result).toContain('"history": History');
    expect(result).toContain('"family": Family');
    expect(result).toContain('"social": Social');
    expect(result).toContain('"plan": Plan');
  });

  it("DEFAULT_SYSTEM_PROMPT contains required placeholders", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("{{sections}}");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("{{language}}");
  });

  it("appends style examples when provided", () => {
    const template: Template = {
      ...soapTemplate,
      styleExamples: [
        { name: "Cardiology Note", text: "Patient presented with chest pain..." },
        { name: "Follow-up Visit", text: "Routine follow-up for hypertension..." },
      ],
    };

    const result = buildTemplateSystemPrompt(template, "sk", sectionLabels);

    expect(result).toContain("STYLE REFERENCE");
    expect(result).toContain("--- Cardiology Note ---");
    expect(result).toContain("Patient presented with chest pain...");
    expect(result).toContain("--- Follow-up Visit ---");
    expect(result).toContain("Routine follow-up for hypertension...");
  });

  it("does not append style section when styleExamples is empty", () => {
    const template: Template = {
      ...soapTemplate,
      styleExamples: [],
    };

    const result = buildTemplateSystemPrompt(template, "sk", sectionLabels);

    expect(result).not.toContain("STYLE REFERENCE");
  });

  it("does not append style section when styleExamples is undefined", () => {
    const result = buildTemplateSystemPrompt(soapTemplate, "sk", sectionLabels);

    expect(result).not.toContain("STYLE REFERENCE");
  });

  it("works with both custom prompt and style examples", () => {
    const template: Template = {
      ...soapTemplate,
      systemPrompt: "Custom prompt for {{language}}.\n\n{{sections}}",
      styleExamples: [
        { name: "Example", text: "Sample note text" },
      ],
    };

    const result = buildTemplateSystemPrompt(template, "en", sectionLabels);

    expect(result).toContain("Custom prompt for English.");
    expect(result).toContain('"subjective": Subjektívne');
    expect(result).toContain("STYLE REFERENCE");
    expect(result).toContain("--- Example ---");
    expect(result).toContain("Sample note text");
  });
});
