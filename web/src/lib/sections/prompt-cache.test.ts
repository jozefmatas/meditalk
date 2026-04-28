// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildSystemBlocks as buildRendererBlocks,
  type SectionConfig,
} from "./section-agent";
import {
  buildSystemBlocks as buildCriticBlocks,
  type CriticInput,
} from "./critic";

const SECTION: SectionConfig = {
  id: "la",
  title: "LA",
  context: "Medications only — never list diagnoses here.",
  model: "haiku",
};

describe("renderSection prompt-cache layout", () => {
  it("block 1 (ROLE + CORE_RULES) carries cache=true", () => {
    const blocks = buildRendererBlocks(SECTION, "sk");
    const first = blocks[0];
    expect(first.cache).toBe(true);
    expect(first.text).toMatch(/# Role/);
    expect(first.text).toMatch(/# Core rules/);
  });

  it("template block is injected ONLY when templateSystemPrompt is present", () => {
    const without = buildRendererBlocks(SECTION, "sk");
    expect(without).toHaveLength(2); // role + per-section

    const withTpl = buildRendererBlocks(
      SECTION,
      "sk",
      "Template guardrail: always use clinical Slovak.",
    );
    expect(withTpl).toHaveLength(3); // role + template + per-section
    const templateBlock = withTpl[1];
    expect(templateBlock.cache).toBe(true);
    expect(templateBlock.text).toContain("Template guardrail");
  });

  it("deterministic output — identical input yields identical bytes (cache-safe)", () => {
    const tplPrompt = "Clinical Slovak, abbreviations preserved.";
    const examples = ["Example alpha", "Example beta"];
    const a = buildRendererBlocks(SECTION, "sk", tplPrompt, examples);
    const b = buildRendererBlocks(SECTION, "sk", tplPrompt, examples);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("per-section block (last) is NOT cached — it carries the section contract", () => {
    const blocks = buildRendererBlocks(SECTION, "sk", "Template guardrail", [
      "ex",
    ]);
    const last = blocks[blocks.length - 1];
    expect(last.cache).toBeUndefined();
    expect(last.text).toContain("Medications only");
  });

  it("voice examples appear in the uncached per-section block (per-section-specific)", () => {
    const blocks = buildRendererBlocks(SECTION, "sk", undefined, [
      "alpha example",
      "beta example",
    ]);
    const last = blocks[blocks.length - 1];
    expect(last.text).toContain("alpha example");
    expect(last.text).toContain("beta example");
    expect(last.cache).toBeUndefined();
  });

  it("locale changes the role block (different cache keys)", () => {
    const sk = buildRendererBlocks(SECTION, "sk");
    const en = buildRendererBlocks(SECTION, "en");
    expect(sk[0].text).not.toBe(en[0].text);
  });
});

const CRITIC_INPUT_BASE: CriticInput = {
  draft: "x",
  source: { doctorNotes: "y" },
  sectionId: "la",
  sectionTitle: "LA",
  sectionContext: "Medications only.",
  language: "sk",
};

describe("criticPass prompt-cache layout + template context", () => {
  it("block 1 (rules) carries cache=true", () => {
    const blocks = buildCriticBlocks(CRITIC_INPUT_BASE);
    const first = blocks[0];
    expect(first.cache).toBe(true);
    expect(first.text).toMatch(/# Role/);
  });

  it("template-guardrails block appears ONLY when templateSystemPrompt is provided", () => {
    const without = buildCriticBlocks(CRITIC_INPUT_BASE);
    expect(without).toHaveLength(2); // rules + per-section

    const withTpl = buildCriticBlocks({
      ...CRITIC_INPUT_BASE,
      templateSystemPrompt: "Clinical Slovak guardrail.",
    });
    expect(withTpl).toHaveLength(3);
    const tblock = withTpl[1];
    expect(tblock.cache).toBe(true);
    expect(tblock.text).toContain("Clinical Slovak guardrail");
    expect(tblock.text).toMatch(/source wins/i);
  });

  it("sectionExamples land in the uncached per-section block", () => {
    const blocks = buildCriticBlocks({
      ...CRITIC_INPUT_BASE,
      sectionExamples: ["LA example 1", "LA example 2"],
    });
    const last = blocks[blocks.length - 1];
    expect(last.cache).toBeUndefined();
    expect(last.text).toContain("LA example 1");
    expect(last.text).toContain("LA example 2");
  });

  it("no template block when templateSystemPrompt is whitespace-only", () => {
    const blocks = buildCriticBlocks({
      ...CRITIC_INPUT_BASE,
      templateSystemPrompt: "   \n  ",
    });
    expect(blocks).toHaveLength(2);
  });

  it("section contract is in the per-section (uncached) block", () => {
    const blocks = buildCriticBlocks(CRITIC_INPUT_BASE);
    const last = blocks[blocks.length - 1];
    expect(last.cache).toBeUndefined();
    expect(last.text).toContain("Medications only.");
  });

  it("deterministic output — identical input yields identical bytes", () => {
    const a = buildCriticBlocks({
      ...CRITIC_INPUT_BASE,
      templateSystemPrompt: "tp",
      sectionExamples: ["ex"],
    });
    const b = buildCriticBlocks({
      ...CRITIC_INPUT_BASE,
      templateSystemPrompt: "tp",
      sectionExamples: ["ex"],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
