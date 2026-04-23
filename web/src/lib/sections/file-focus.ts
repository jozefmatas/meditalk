/**
 * Per-file focus directive enforcement.
 *
 * Upload dialog UX maps to two modes:
 *   - Actual (no directive typed): take the whole file as today's data.
 *   - Past  (directive typed):     take ONLY the passages the doctor
 *                                  distilled into the directive.
 *
 * When a directive is present we run a single Haiku extraction pass
 * per file: the model reads the document + directive and returns the
 * verbatim matching passages. Runs ONCE before any section agent or
 * ICD suggester sees the source, so the downstream pipeline operates
 * on the already-filtered content.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { logUsage, type UsageContext } from "../usage";
import { logger } from "../logger";
import type { Language, RawSource } from "./section-agent";

/**
 * Per-visit cache shape stored under `visit.metadata.file_focus_cache`:
 *   { [fileId]: { textHash: string; directive: string; output: string } }
 *
 * Cache hit when: same fileId, same extracted_text hash, same directive.
 * Prevents re-running the extraction Haiku call on every regenerate.
 */
export interface FileFocusCacheEntry {
  textHash: string;
  directive: string;
  output: string;
}
export type FileFocusCache = Record<string, FileFocusCacheEntry>;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

const MODEL_ID = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 2 });
  return _client;
}

const LANGUAGE_LABEL: Record<Language, string> = {
  sk: "Slovak",
  cs: "Czech",
  en: "English",
};

/**
 * Extract only the sections of `text` that match `directive`. Returns
 * the verbatim matched text (headings preserved). Empty string when
 * nothing matches. Falls back to the original text on API error so
 * generation isn't blocked by the filter.
 */
export async function extractWithDirective(params: {
  text: string;
  directive: string;
  fileName: string;
  language?: Language;
  usage?: UsageContext;
}): Promise<string> {
  const { text, directive, fileName, usage } = params;
  const language = params.language ?? "sk";

  const systemPrompt = `You extract verbatim passages from a ${LANGUAGE_LABEL[language]}-language medical document per the uploading physician's directive.

The physician has restricted which parts of the document should feed the clinical note. Your job: read the document, decide which sections match the directive, and return them — VERBATIM, in their original order, with their headings preserved. Nothing else.

# Rules
- Return ONLY verbatim passages from the document. No summary, no rewrite, no commentary.
- Preserve headings, line breaks, and original formatting of matched passages.
- If NOTHING in the document matches, return an empty string (zero characters).
- If the directive is broad or ambiguous ("echokg a záver"), err on the side of INCLUSION — pull every passage whose heading or content plausibly matches either keyword.
- Match loosely on section headings: "echokg" / "echo" / "ECHOKG" / "echokardiografia" all match. "záver" / "Záver" / "Diagnostický záver" / "Summary" all match.
- Do NOT include adjacent unrelated content just because it's near a matched section.

# Output
Raw ${LANGUAGE_LABEL[language]} text of the matched passages, concatenated in their original order with a blank line between distinct passages. No preamble, no markdown wrapping, no explanation. Empty string when nothing matches.`;

  const userMessage = `# Directive
${directive}

# Document
${text}`;

  try {
    const response = await client().messages.create({
      model: MODEL_ID,
      max_tokens: 4000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    if (usage) {
      logUsage({
        userId: usage.userId,
        visitId: usage.visitId,
        provider: "anthropic",
        model: MODEL_ID,
        operation: "generate_section",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }

    const extracted = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    logger.debug(
      `[file-focus] "${fileName}" directive="${directive.slice(0, 60)}" — ${text.length}ch → ${extracted.length}ch`,
    );
    return extracted;
  } catch (err) {
    logger.error(`[file-focus] extraction failed for ${fileName}:`, err);
    // Fall through — return original text so generation isn't blocked.
    return text;
  }
}

/**
 * Pre-filter each uploaded file per the doctor's distillation directive.
 *
 * Rule is simple and maps 1:1 to the upload dialog UX:
 *   - directive EMPTY   ("Actual" mode) → use the whole file as-is,
 *                                         treating it as today's data.
 *   - directive PRESENT ("Past" mode)   → Haiku extracts ONLY the
 *                                         passages matching the directive.
 *
 * Runs the filter calls in parallel per file. Call this ONCE per
 * encounter before any section agent or ICD suggester reads the source,
 * so both consume the filtered content.
 */
export async function applyFileFocusDirectives(
  source: RawSource,
  language: Language = "sk",
  usage?: UsageContext,
  /**
   * Optional caching layer. Pass `fileIds` (parallel to source.files) so
   * the filter output can be keyed on the stable file id. Pass `cache`
   * (read from visit.metadata.file_focus_cache) to short-circuit
   * re-extraction when the file text + directive didn't change. Pass
   * `onCacheUpdate` to receive the updated cache for persistence. When
   * any of these are omitted, caching is disabled (current behaviour).
   */
  opts?: {
    fileIds?: string[];
    cache?: FileFocusCache;
    onCacheUpdate?: (next: FileFocusCache) => void;
  },
): Promise<RawSource> {
  const files = source.files;
  if (!files?.length) return source;

  const cache: FileFocusCache = { ...(opts?.cache ?? {}) };
  let cacheTouched = false;

  const filtered = await Promise.all(
    files.map(async (f, idx) => {
      if (!f.text.trim()) return f;
      const directive = f.context?.trim();
      if (!directive) return f; // Actual mode — no filter.

      const fileId = opts?.fileIds?.[idx];
      const textHash = hashText(f.text);

      if (fileId && cache[fileId]) {
        const entry = cache[fileId];
        if (entry.textHash === textHash && entry.directive === directive) {
          logger.debug(`[file-focus] cache HIT for "${f.name}" (${fileId})`);
          return { ...f, text: entry.output };
        }
      }

      logger.debug(
        `[file-focus] filtering "${f.name}": directive="${directive.slice(0, 80)}"`,
      );
      const extracted = await extractWithDirective({
        text: f.text,
        directive,
        fileName: f.name,
        language,
        usage,
      });

      if (fileId) {
        cache[fileId] = { textHash, directive, output: extracted };
        cacheTouched = true;
      }
      return { ...f, text: extracted };
    }),
  );

  if (cacheTouched && opts?.onCacheUpdate) {
    opts.onCacheUpdate(cache);
  }

  return { ...source, files: filtered };
}
