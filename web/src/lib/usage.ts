import { createAdminClient } from "./supabase/admin";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "text-embedding-ada-002": { input: 0.1, output: 0 },
};

const SCRIBE_PER_HOUR = 0.4;

type Provider = "anthropic" | "openai" | "elevenlabs";
type Operation =
  | "generate_template"
  | "reformat_template"
  | "clinical_analysis"
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
}

function calculateCost(params: UsageParams): number {
  const { model, inputTokens = 0, outputTokens = 0, durationSeconds } = params;

  if (model === "scribe_v2" && durationSeconds != null) {
    return (durationSeconds / 3600) * SCRIBE_PER_HOUR;
  }

  const pricing = PRICING[model];
  if (!pricing) return 0;

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Fire-and-forget usage log. Never throws, never blocks.
 */
export function logUsage(params: UsageParams): void {
  const cost = calculateCost(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- api_usage not in generated types until migration is pushed
  (createAdminClient().from("api_usage") as any)
    .insert({
      user_id: params.userId,
      visit_id: params.visitId ?? null,
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      input_tokens: params.inputTokens ?? 0,
      output_tokens: params.outputTokens ?? 0,
      cost_usd: cost,
      duration_seconds: params.durationSeconds ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[usage-log] Insert failed:", error.message);
    })
    .catch(() => {
      // Network-level fetch failure — nothing we can do, silently drop
    });
}
