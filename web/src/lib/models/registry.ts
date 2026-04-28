/**
 * Registry — maps (callSite, tier) to a concrete ModelRoute.
 *
 * Defaults reproduce today's Anthropic behaviour byte-for-byte. Any
 * route can be overridden at runtime by setting
 *   MODEL_ROUTE_<CALL>_<TIER>=<json>
 * e.g.
 *   MODEL_ROUTE_CRITIC_SONNET='{"provider":"vertex-gemini","model":"gemini-3.1-pro","thinkingLevel":"MEDIUM"}'
 *
 * The lookup is case-insensitive on the callSite/tier halves of the
 * env var name so both CRITIC_SONNET and critic_sonnet resolve.
 */
import { logger } from "../logger";
import type { CallSite, ModelRoute, ModelTier } from "./types";

/** Default routes — every entry currently maps to Anthropic to preserve
 *  behaviour. Change a single line here to promote a Gemini experiment
 *  after it wins on evals. */
export const DEFAULT_ROUTES: Record<string, ModelRoute> = {
  "critic:haiku": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "critic:sonnet": { provider: "anthropic", model: "claude-sonnet-4-6" },
  "section-agent:haiku": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  },
  "section-agent:sonnet": { provider: "anthropic", model: "claude-sonnet-4-6" },
  "section-agent:opus": { provider: "anthropic", model: "claude-opus-4-6" },
  "suggest-icd:haiku": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  },
  "adjust-router:haiku": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  },
  "file-focus:haiku": {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  },
  "note-skeleton:sonnet": { provider: "anthropic", model: "claude-sonnet-4-6" },
};

function envKey(callSite: CallSite, tier: ModelTier): string {
  return `MODEL_ROUTE_${callSite.replace(/-/g, "_").toUpperCase()}_${tier.toUpperCase()}`;
}

function parseOverride(raw: string, envKeyForLog: string): ModelRoute | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const provider = (parsed as { provider?: unknown }).provider;
    if (provider !== "anthropic" && provider !== "vertex-gemini") return null;
    const model = (parsed as { model?: unknown }).model;
    if (typeof model !== "string" || !model) return null;

    if (provider === "anthropic") {
      return { provider, model };
    }
    const thinking = (parsed as { thinkingLevel?: unknown }).thinkingLevel;
    const validThinking =
      thinking === "LOW" || thinking === "MEDIUM" || thinking === "HIGH";
    const gemini: ModelRoute = {
      provider,
      model: model as Extract<
        ModelRoute,
        { provider: "vertex-gemini" }
      >["model"],
    };
    if (validThinking) gemini.thinkingLevel = thinking;
    return gemini;
  } catch (err) {
    logger.error(`[models/registry] Invalid JSON for ${envKeyForLog}:`, err);
    return null;
  }
}

/** Resolve the ModelRoute for a (callSite, tier) pair. Env override wins;
 *  otherwise falls back to DEFAULT_ROUTES. Returns `null` when no default
 *  exists for this pair (caller treats as misconfiguration). */
export function resolveRoute(
  callSite: CallSite,
  tier: ModelTier,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ModelRoute | null {
  const overrideKey = envKey(callSite, tier);
  const overrideRaw = env[overrideKey];
  if (overrideRaw && overrideRaw.trim()) {
    const parsed = parseOverride(overrideRaw.trim(), overrideKey);
    if (parsed) return parsed;
    logger.warn(
      `[models/registry] Falling back to default for ${callSite}:${tier} — override unparseable`,
    );
  }

  return DEFAULT_ROUTES[`${callSite}:${tier}`] ?? null;
}
