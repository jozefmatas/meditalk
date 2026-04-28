// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveRoute, DEFAULT_ROUTES } from "./registry";

describe("resolveRoute — defaults", () => {
  it("falls back to Anthropic defaults for every registered pair", () => {
    expect(resolveRoute("critic", "sonnet", {})).toEqual(
      DEFAULT_ROUTES["critic:sonnet"],
    );
    expect(resolveRoute("critic", "haiku", {})).toEqual(
      DEFAULT_ROUTES["critic:haiku"],
    );
    expect(resolveRoute("section-agent", "opus", {})).toEqual(
      DEFAULT_ROUTES["section-agent:opus"],
    );
    expect(resolveRoute("suggest-icd", "haiku", {})).toEqual(
      DEFAULT_ROUTES["suggest-icd:haiku"],
    );
    expect(resolveRoute("adjust-router", "haiku", {})).toEqual(
      DEFAULT_ROUTES["adjust-router:haiku"],
    );
    expect(resolveRoute("file-focus", "haiku", {})).toEqual(
      DEFAULT_ROUTES["file-focus:haiku"],
    );
    expect(resolveRoute("note-skeleton", "sonnet", {})).toEqual(
      DEFAULT_ROUTES["note-skeleton:sonnet"],
    );
  });

  it("returns null for pairs with no default", () => {
    expect(resolveRoute("critic", "opus", {})).toBeNull();
    expect(resolveRoute("suggest-icd", "opus", {})).toBeNull();
  });
});

describe("resolveRoute — env overrides", () => {
  it("parses a valid Gemini override", () => {
    const env = {
      MODEL_ROUTE_CRITIC_SONNET: JSON.stringify({
        provider: "vertex-gemini",
        model: "gemini-3.1-pro",
        thinkingLevel: "MEDIUM",
      }),
    };
    expect(resolveRoute("critic", "sonnet", env)).toEqual({
      provider: "vertex-gemini",
      model: "gemini-3.1-pro",
      thinkingLevel: "MEDIUM",
    });
  });

  it("parses a valid Anthropic override (model swap)", () => {
    const env = {
      MODEL_ROUTE_CRITIC_HAIKU: JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
      }),
    };
    expect(resolveRoute("critic", "haiku", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
  });

  it("handles call-site names containing hyphens (env var uppercases + underscores)", () => {
    const env = {
      MODEL_ROUTE_SECTION_AGENT_SONNET: JSON.stringify({
        provider: "vertex-gemini",
        model: "gemini-3.1-pro",
      }),
    };
    expect(resolveRoute("section-agent", "sonnet", env)).toEqual({
      provider: "vertex-gemini",
      model: "gemini-3.1-pro",
    });
  });

  it("drops invalid thinkingLevel but keeps the route", () => {
    const env = {
      MODEL_ROUTE_CRITIC_SONNET: JSON.stringify({
        provider: "vertex-gemini",
        model: "gemini-3.1-pro",
        thinkingLevel: "bogus",
      }),
    };
    expect(resolveRoute("critic", "sonnet", env)).toEqual({
      provider: "vertex-gemini",
      model: "gemini-3.1-pro",
    });
  });

  it("falls back to default when override JSON is malformed", () => {
    const env = { MODEL_ROUTE_CRITIC_SONNET: "not-json" };
    expect(resolveRoute("critic", "sonnet", env)).toEqual(
      DEFAULT_ROUTES["critic:sonnet"],
    );
  });

  it("falls back to default when provider is unknown", () => {
    const env = {
      MODEL_ROUTE_CRITIC_SONNET: JSON.stringify({
        provider: "openai",
        model: "gpt-5",
      }),
    };
    expect(resolveRoute("critic", "sonnet", env)).toEqual(
      DEFAULT_ROUTES["critic:sonnet"],
    );
  });

  it("falls back to default when model is missing", () => {
    const env = {
      MODEL_ROUTE_CRITIC_SONNET: JSON.stringify({ provider: "anthropic" }),
    };
    expect(resolveRoute("critic", "sonnet", env)).toEqual(
      DEFAULT_ROUTES["critic:sonnet"],
    );
  });

  it("ignores an override for an unrelated pair", () => {
    const env = {
      MODEL_ROUTE_CRITIC_SONNET: JSON.stringify({
        provider: "vertex-gemini",
        model: "gemini-3.1-pro",
      }),
    };
    // haiku tier unaffected
    expect(resolveRoute("critic", "haiku", env)).toEqual(
      DEFAULT_ROUTES["critic:haiku"],
    );
  });
});
