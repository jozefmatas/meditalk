import OpenAI from "openai";
import { logUsage, type UsageContext } from "./usage";

let _openai: OpenAI | null = null;
function openai() {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

/**
 * Generate a 1536-dim embedding for a single text.
 */
export async function embedText(
  text: string,
  ctx?: UsageContext,
): Promise<number[]> {
  const response = await openai().embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "openai",
      model: "text-embedding-ada-002",
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
): Promise<number[][]> {
  const response = await openai().embeddings.create({
    model: "text-embedding-ada-002",
    input: texts,
  });

  if (ctx) {
    logUsage({
      userId: ctx.userId,
      visitId: ctx.visitId,
      provider: "openai",
      model: "text-embedding-ada-002",
      operation: "embed",
      inputTokens: response.usage.prompt_tokens,
    });
  }

  return response.data.map((d) => d.embedding);
}
