/**
 * Anthropic provider — wraps @anthropic-ai/sdk.
 *
 * Supports the two shapes every current pipeline call uses:
 *   - free-text (no `tool`): extract concatenated text blocks.
 *   - forced tool-use (`tool` set): force `tool_choice: tool` and return
 *     the tool_use block's input as `toolInput`.
 *
 * Cache flags on system blocks translate to `cache_control: { type:
 * "ephemeral" }`. Anthropic supports up to 4 cache breakpoints — callers
 * never set more than 2 today.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  GenerateParams,
  GenerateResult,
  Provider,
  SystemBlock,
  ToolSpec,
} from "../types";

type SdkSystemBlock =
  | { type: "text"; text: string }
  | { type: "text"; text: string; cache_control: { type: "ephemeral" } };

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 4 });
  return _client;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  readonly supportsToolUse = true;
  readonly supportsPromptCache = true;

  constructor(public readonly model: string) {}

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const system = toSdkSystem(params.system);
    const tools = params.tool ? [toSdkTool(params.tool)] : undefined;
    const tool_choice = params.tool
      ? { type: "tool" as const, name: params.tool.name }
      : undefined;

    const response = await client().messages.create({
      model: this.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0,
      system,
      messages: [{ role: "user", content: params.user }],
      ...(tools ? { tools, tool_choice } : {}),
    });

    let text: string | undefined;
    let toolInput: Record<string, unknown> | undefined;
    if (params.tool) {
      for (const block of response.content) {
        if (block.type === "tool_use" && block.name === params.tool.name) {
          toolInput = (block.input ?? {}) as Record<string, unknown>;
          break;
        }
      }
    } else {
      text = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
    }

    return {
      text,
      toolInput,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens:
          response.usage.cache_creation_input_tokens ?? undefined,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      providerRaw: response,
    };
  }
}

function toSdkSystem(blocks: SystemBlock[]): SdkSystemBlock[] {
  return blocks.map((b) =>
    b.cache
      ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
      : { type: "text", text: b.text },
  );
}

function toSdkTool(tool: ToolSpec) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema as Record<string, unknown> & { type: "object" },
  };
}
