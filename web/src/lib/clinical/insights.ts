/**
 * Enrich a generation system prompt with template insights
 * (doctor's personal style + content preferences).
 */
export function buildInsightsEnrichedPrompt(
  basePrompt: string,
  insights: { style_guide?: string | null; preference_summary?: string | null } | null,
): string {
  if (!insights?.style_guide && !insights?.preference_summary) return basePrompt;
  const parts = [basePrompt];

  if (insights.style_guide) {
    parts.push(`\nDOCTOR'S DOCUMENTATION STYLE (MANDATORY — follow closely):
${insights.style_guide}`);
  }

  if (insights.preference_summary) {
    parts.push(`\nDOCTOR'S QUALITY PREFERENCES (MANDATORY — apply these corrections):
${insights.preference_summary}`);
  }

  return parts.join("\n");
}
