import OpenAI from "openai";
import { logUsage, type UsageContext } from "./usage";

let _openai: OpenAI | null = null;
function openai() {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Generate a 1536-dim embedding for a single text.
 */
export async function embedText(
  text: string,
  ctx?: UsageContext,
  model: string = EMBEDDING_MODEL,
): Promise<number[]> {
  const response = await openai().embeddings.create({
    model,
    input: text,
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "openai",
      model,
      operation: "embed",
      inputTokens: response.usage.prompt_tokens,
    });
  }

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 */
export async function embedTexts(
  texts: string[],
  ctx?: UsageContext,
  model: string = EMBEDDING_MODEL,
): Promise<number[][]> {
  const response = await openai().embeddings.create({
    model,
    input: texts,
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "openai",
      model,
      operation: "embed",
      inputTokens: response.usage.prompt_tokens,
    });
  }

  return response.data.map((d) => d.embedding);
}
