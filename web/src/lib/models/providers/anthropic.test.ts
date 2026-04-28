// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env/server", () => ({ serverEnv: { NODE_ENV: "test" } }));

const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { AnthropicProvider } from "./anthropic";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnthropicProvider — free text", () => {
  it("concatenates text blocks and surfaces usage", async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 1,
      },
    });

    const provider = new AnthropicProvider("claude-haiku-4-5-20251001");
    const result = await provider.generate({
      system: [{ text: "sys" }],
      user: "hi",
      maxTokens: 100,
    });

    expect(result.text).toBe("Hello world");
    expect(result.toolInput).toBeUndefined();
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheCreationTokens: 2,
      cacheReadTokens: 1,
    });

    // Verify the SDK call shape.
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("claude-haiku-4-5-20251001");
    expect(call.max_tokens).toBe(100);
    expect(call.temperature).toBe(0);
    expect(call.system).toEqual([{ type: "text", text: "sys" }]);
    expect(call.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(call.tools).toBeUndefined();
    expect(call.tool_choice).toBeUndefined();
  });

  it("marks system blocks with cache:true as cache_control ephemeral", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const provider = new AnthropicProvider("claude-sonnet-4-6");
    await provider.generate({
      system: [{ text: "cached", cache: true }, { text: "uncached" }],
      user: "u",
      maxTokens: 10,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toEqual([
      {
        type: "text",
        text: "cached",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "uncached" },
    ]);
  });
});

describe("AnthropicProvider — forced tool-use", () => {
  it("extracts toolInput from the forced tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "submit_thing",
          input: { foo: "bar" },
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const provider = new AnthropicProvider("claude-haiku-4-5-20251001");
    const result = await provider.generate({
      system: [{ text: "sys" }],
      user: "u",
      maxTokens: 100,
      tool: {
        name: "submit_thing",
        description: "submit",
        schema: {
          type: "object",
          properties: { foo: { type: "string" } },
          required: ["foo"],
        },
      },
    });

    expect(result.text).toBeUndefined();
    expect(result.toolInput).toEqual({ foo: "bar" });

    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toEqual([
      {
        name: "submit_thing",
        description: "submit",
        input_schema: {
          type: "object",
          properties: { foo: { type: "string" } },
          required: ["foo"],
        },
      },
    ]);
    expect(call.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
  });

  it("returns undefined toolInput when no matching tool_use block is present", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I refuse to use the tool." }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const provider = new AnthropicProvider("claude-haiku-4-5-20251001");
    const result = await provider.generate({
      system: [{ text: "sys" }],
      user: "u",
      maxTokens: 100,
      tool: {
        name: "submit_thing",
        description: "submit",
        schema: { type: "object", properties: {} },
      },
    });

    expect(result.toolInput).toBeUndefined();
  });
});
