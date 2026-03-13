export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'text-embedding-ada-002': 'Ada Embeddings',
  'scribe_v2': 'Scribe v2',
  'whisper-1': 'Whisper (legacy)',
};

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] || model;
}
