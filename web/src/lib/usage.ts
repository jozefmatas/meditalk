import { createAdminClient } from "./supabase/admin";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "text-embedding-ada-002": { input: 0.1, output: 0 },
};

const SCRIBE_PER_HOUR = 0.4;

type Provider = "anthropic" | "openai" | "elevenlabs";
type Operation =
  // Section-agent architecture (current)
  | "generate_section"
  // Legacy pipeline operations — retained so older api_usage rows still classify
  | "generate_template"
  | "generate_template_draft"
  | "generate_template_refine"
  | "generate_title"
  | "reformat_template"
  | "rerender_template"
  | "clinical_analysis"
  | "fact_extraction"
  | "embed"
  | "transcribe"
  | "ocr_image"
  | "ocr_pdf";

export interface UsageContext {
  userId: string;
  visitId?: string;
}

interface UsageParams {
  userId: string;
  visitId?: string;
  provider: Provider;
  model: string;
  operation: Operation;
  inputTokens?: number;
  outputTokens?: number;
  durationSeconds?: number;
  /**
   * Tokens written to a new prompt-cache entry (Anthropic `cache_control`
   * ephemeral blocks). Populated only on calls that use the array-form
   * system prompt with cache breakpoints. Nullable for every other call.
   */
  cacheCreationInputTokens?: number;
  /**
   * Tokens served from an existing prompt-cache entry. Same provenance
   * as `cacheCreationInputTokens` — nullable elsewhere.
   */
  cacheReadInputTokens?: number;
}

// Anthropic prompt-cache pricing multipliers (relative to base input rate):
//   cache writes (creation)  — 1.25× base input
//   cache reads              — 0.10× base input
// Source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;

function calculateCost(params: UsageParams): number {
  const {
    model,
    inputTokens = 0,
    outputTokens = 0,
    durationSeconds,
    cacheCreationInputTokens = 0,
    cacheReadInputTokens = 0,
  } = params;

  if (model === "scribe_v2" && durationSeconds != null) {
    return (durationSeconds / 3600) * SCRIBE_PER_HOUR;
  }

  const pricing = PRICING[model];
  if (!pricing) return 0;

  // `input_tokens` from the Anthropic response excludes cached tokens —
  // cache_creation + cache_read are reported separately and priced at
  // different multipliers.
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (cacheCreationInputTokens / 1_000_000) * pricing.input * CACHE_WRITE_MULT +
    (cacheReadInputTokens / 1_000_000) * pricing.input * CACHE_READ_MULT +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Fire-and-forget usage log. Never throws, never blocks.
 */
export function logUsage(params: UsageParams): void {
  const client = createAdminClient();
  if (!client) {
    // Admin client unavailable — skip silently
    return;
  }

  const cost = calculateCost(params);

  // Build the row; only include cache-token keys when the caller actually
  // reported them. This keeps the insert forward-compatible (still works
  // if the migration adding those columns hasn't been applied yet).
  const row: Record<string, unknown> = {
    user_id: params.userId,
    visit_id: params.visitId ?? null,
    provider: params.provider,
    model: params.model,
    operation: params.operation,
    input_tokens: params.inputTokens ?? 0,
    output_tokens: params.outputTokens ?? 0,
    cost_usd: cost,
    duration_seconds: params.durationSeconds ?? null,
  };
  if (params.cacheCreationInputTokens !== undefined) {
    row.cache_creation_input_tokens = params.cacheCreationInputTokens;
  }
  if (params.cacheReadInputTokens !== undefined) {
    row.cache_read_input_tokens = params.cacheReadInputTokens;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- api_usage not in generated types until migration is pushed
  (client.from("api_usage") as any)
    .insert(row)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        logger.error("[usage-log] Insert failed:", {
          message: error.message,
          provider: params.provider,
          model: params.model,
          operation: params.operation,
        });
      }
    })
    .catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("[usage-log] Network/fetch error:", {
        error: error.message,
        name: error.name,
        cause: error.cause,
        supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        hasServiceKey: !!serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      });
    });
}
