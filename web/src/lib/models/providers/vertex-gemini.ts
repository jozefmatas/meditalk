/**
 * Gemini provider — wraps @google/genai's unified SDK.
 *
 * Supports both backends the SDK exposes:
 *
 *   1. **Gemini Developer API** (ai.google.dev). Set `GEMINI_API_KEY`
 *      in .env.local. Simplest path — no GCP project needed. Pricing
 *      matches Vertex's per-token rates.
 *
 *   2. **Vertex AI**. Set `VERTEX_PROJECT_ID` (+ optional
 *      `VERTEX_LOCATION`, defaults to `global`) and provide
 *      Application Default Credentials via `GOOGLE_APPLICATION_CREDENTIALS`
 *      or `gcloud auth application-default login`.
 *
 * `GEMINI_API_KEY` wins when both are set — it's a deliberate escape
 * hatch for local development without GCP setup. In production swap
 * to Vertex by unsetting the API key.
 *
 * Tool-use: when `tool` is set, the provider forces a single function
 * call via FunctionCallingConfigMode.ANY + allowedFunctionNames, so the
 * response always carries the function call as `toolInput`. Free-text
 * mode concatenates text parts.
 *
 * Prompt caching: phase 1 relies on Gemini's implicit prefix caching.
 * `cacheReadTokens` surfaces `cachedContentTokenCount`. Explicit
 * `cachedContents` resources are a phase 2 optimisation.
 */
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  ThinkingLevel,
} from "@google/genai";
import type { GenerateContentConfig, FunctionDeclaration } from "@google/genai";
import type {
  GenerateParams,
  GenerateResult,
  Provider,
  SystemBlock,
  ToolSpec,
} from "../types";

/** Tier label → concrete model id. Keep the mapping in one place so we
 *  can swap preview → GA without touching call sites. Gemini 3.1 model
 *  ids are the Vertex preview identifiers; the Gemini Developer API
 *  accepts the same `gemini-2.5-*` ids. For the 3.1 previews on the
 *  Developer API, pass the exact `gemini-3-*-preview` id via env
 *  override to bypass this map. */
const MODEL_RESOURCE: Record<string, string> = {
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
  // NOTE: no gemini-3.1-flash preview exists yet; 3-series Flash is only
  // available as `gemini-3-flash-preview`. Leaving the map alias points
  // there so callers can still use the friendly 3.1 name.
  "gemini-3.1-flash": "gemini-3-flash-preview",
  "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey.trim()) {
    _client = new GoogleGenAI({ apiKey: apiKey.trim() });
    return _client;
  }

  const project = process.env.VERTEX_PROJECT_ID;
  if (project) {
    const location = process.env.VERTEX_LOCATION ?? "global";
    _client = new GoogleGenAI({ vertexai: true, project, location });
    return _client;
  }

  throw new Error(
    "[gemini] No credentials configured. Set GEMINI_API_KEY (Gemini Developer API) or VERTEX_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS (Vertex AI) in .env.local.",
  );
}

export interface VertexGeminiOptions {
  /** Tier label from ModelRoute. Mapped to a concrete Vertex model id. */
  model: string;
  /** LOW / MEDIUM / HIGH thinking level (Gemini 3.x). Omit to leave default. */
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
}

export class VertexGeminiProvider implements Provider {
  readonly name = "vertex-gemini" as const;
  readonly supportsToolUse = true;
  readonly supportsPromptCache = true;
  readonly model: string;
  private readonly thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";

  constructor(opts: VertexGeminiOptions) {
    this.model = MODEL_RESOURCE[opts.model] ?? opts.model;
    this.thinkingLevel = opts.thinkingLevel;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const config: GenerateContentConfig = {
      systemInstruction: joinSystem(params.system),
      temperature: params.temperature ?? 0,
      maxOutputTokens: params.maxTokens,
    };

    if (this.thinkingLevel) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel[this.thinkingLevel],
      };
    }

    if (params.tool) {
      const declaration = toFunctionDeclaration(params.tool);
      config.tools = [{ functionDeclarations: [declaration] }];
      config.toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [params.tool.name],
        },
      };
    }

    const response = await client().models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: params.user }] }],
      config,
    });

    let text: string | undefined;
    let toolInput: Record<string, unknown> | undefined;
    if (params.tool) {
      const calls = response.functionCalls;
      if (calls && calls.length > 0) {
        const hit = calls.find((c) => c.name === params.tool?.name) ?? calls[0];
        if (hit?.args && typeof hit.args === "object") {
          toolInput = hit.args as Record<string, unknown>;
        } else {
          toolInput = {};
        }
      }
    } else {
      text = response.text ?? "";
    }

    const usage = response.usageMetadata;
    return {
      text,
      toolInput,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens:
          (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheReadTokens: usage?.cachedContentTokenCount,
      },
      providerRaw: response,
    };
  }
}

function joinSystem(blocks: SystemBlock[]): string {
  // Gemini's systemInstruction is a single string/content. Cache flags are
  // ignored in phase 1 — implicit prefix caching kicks in automatically
  // when the same prefix is sent repeatedly within the cache window.
  return blocks.map((b) => b.text).join("\n\n");
}

function toFunctionDeclaration(tool: ToolSpec): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    // `parametersJsonSchema` accepts our Anthropic-style JSON Schema as-is,
    // avoiding the OpenAPI 3 Schema enum translation.
    parametersJsonSchema: tool.schema,
  };
}
