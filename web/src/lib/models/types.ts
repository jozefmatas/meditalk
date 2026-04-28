/**
 * Model provider abstraction — types.
 *
 * The pipeline's 6 LLM call sites no longer talk to the Anthropic SDK
 * directly; they resolve a `Provider` for a (callSite, tier) pair via
 * `./registry.ts` and call its `generate()`. This lets the Anthropic
 * defaults stay unchanged while an env var reroutes any call to
 * Vertex Gemini without a refactor.
 */

/** Logical tier exposed on templates (`section.model`). The registry
 *  maps (callSite, tier) to a concrete ModelRoute. */
export type ModelTier = "haiku" | "sonnet" | "opus";

/** Concrete model binding — provider + model id + any provider-specific
 *  knobs (e.g. Gemini `thinkingLevel`). */
export type ModelRoute =
  | { provider: "anthropic"; model: string }
  | {
      provider: "vertex-gemini";
      model:
        | "gemini-3.1-pro"
        | "gemini-3.1-flash"
        | "gemini-3.1-flash-lite"
        | "gemini-2.5-pro"
        | "gemini-2.5-flash";
      thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
    };

/** A system-prompt block with optional cache marker. Anthropic translates
 *  `cache: true` to `cache_control: { type: "ephemeral" }`. Gemini uses
 *  implicit prefix caching in phase 1 — the flag is informational only
 *  but kept on the shape so we can add explicit `cachedContents` later
 *  without changing call sites. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

/** Declarative tool-call schema. We force a single tool call when set —
 *  that mirrors the critic/suggester/adjust-router/file-focus/skeleton
 *  contract. No free multi-tool negotiation, no streaming. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. Follows Anthropic's input_schema
   *  shape; providers translate as needed. */
  schema: Record<string, unknown>;
}

export interface GenerateParams {
  /** Ordered system blocks. The concatenated text is the full system
   *  prompt; blocks with `cache: true` are cache breakpoints for
   *  providers that support prompt caching. */
  system: SystemBlock[];
  /** User message body. */
  user: string;
  /** Output token budget. Applied to Anthropic `max_tokens` and Gemini
   *  `maxOutputTokens`. */
  maxTokens: number;
  /** Sampling temperature. Defaults to 0 at call sites — the pipeline
   *  wants deterministic output. */
  temperature?: number;
  /** When set, the call is forced to return a single tool_use / function
   *  call matching this schema. Leave unset for free-text. */
  tool?: ToolSpec;
}

export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache read (Anthropic cache_read_input_tokens; Gemini
   *  cachedContentTokenCount). Providers that don't track cache reads
   *  leave this undefined. */
  cacheReadTokens?: number;
  /** Prompt-cache write (Anthropic cache_creation_input_tokens). Gemini
   *  implicit caching doesn't surface this. */
  cacheCreationTokens?: number;
}

/** Result returned by every provider. Exactly one of `text` / `toolInput`
 *  is populated, matching whether the caller asked for free-text or a
 *  forced tool call. */
export interface GenerateResult {
  text?: string;
  toolInput?: Record<string, unknown>;
  usage: GenerateUsage;
  /** Raw provider response, opaque to callers — kept for debugging /
   *  telemetry drill-down and never serialised to the client. */
  providerRaw: unknown;
}

export interface Provider {
  /** Stable name used in usage logs ("anthropic" / "vertex-gemini"). */
  name: "anthropic" | "vertex-gemini";
  /** The concrete model id this provider will send. */
  model: string;
  supportsToolUse: boolean;
  supportsPromptCache: boolean;
  generate(params: GenerateParams): Promise<GenerateResult>;
}

/** The six pipeline call sites the abstraction covers. File-extraction
 *  and admin calls are NOT registered here — those still use the
 *  Anthropic SDK directly until a follow-up PR. */
export type CallSite =
  | "section-agent"
  | "critic"
  | "suggest-icd"
  | "adjust-router"
  | "file-focus"
  | "note-skeleton";
