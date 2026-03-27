import type { Template } from "./types";

export type TemplateUsageMap = Record<string, number>;

/**
 * Fetch usage counts for all templates from the server.
 */
export async function fetchTemplateUsage(): Promise<TemplateUsageMap> {
  try {
    const res = await fetch("/api/templates/usage");
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Increment usage count for a template (server-side, persists across devices).
 * Fire-and-forget — does not block the caller.
 */
export function incrementTemplateUsage(templateId: string): void {
  fetch("/api/templates/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId }),
  }).catch(() => {
    // Silently fail — usage tracking is non-critical
  });
}

/**
 * Sort templates by usage frequency (most used first).
 * Accepts a pre-fetched usage map.
 */
export function sortTemplatesByUsage(
  templates: Template[],
  usage: TemplateUsageMap,
): Template[] {
  return [...templates].sort((a, b) => {
    const usageA = usage[a.id] || 0;
    const usageB = usage[b.id] || 0;

    if (usageB !== usageA) {
      return usageB - usageA;
    }

    // If usage is equal, maintain original order (by sort_order from DB)
    return 0;
  });
}
