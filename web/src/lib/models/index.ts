/**
 * Models public API.
 *
 * Callers do `resolve("critic", "sonnet").generate(...)`. The registry
 * picks a provider; the provider handles SDK differences.
 */
import type { CallSite, ModelTier, Provider } from "./types";
import { resolveRoute } from "./registry";
import { AnthropicProvider } from "./providers/anthropic";
import { VertexGeminiProvider } from "./providers/vertex-gemini";

export type {
  CallSite,
  ModelTier,
  ModelRoute,
  GenerateParams,
  GenerateResult,
  GenerateUsage,
  Provider,
  SystemBlock,
  ToolSpec,
} from "./types";
export { DEFAULT_ROUTES, resolveRoute } from "./registry";

/**
 * Resolve a Provider for the given (callSite, tier). Throws synchronously
 * when the pair has no route configured — pipeline misconfiguration
 * should surface early, not at call time.
 */
export function resolve(callSite: CallSite, tier: ModelTier): Provider {
  const route = resolveRoute(callSite, tier);
  if (!route) {
    throw new Error(
      `[models] No route configured for ${callSite}:${tier}. Check DEFAULT_ROUTES or MODEL_ROUTE_${callSite
        .replace(/-/g, "_")
        .toUpperCase()}_${tier.toUpperCase()}.`,
    );
  }

  if (route.provider === "anthropic") {
    return new AnthropicProvider(route.model);
  }
  return new VertexGeminiProvider({
    model: route.model,
    thinkingLevel: route.thinkingLevel,
  });
}
