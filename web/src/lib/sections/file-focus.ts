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
import { createHash } from "node:crypto";
import { resolve } from "../models";
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

The physician has restricted which parts of the document should feed the clinical note. Your job: read the document, decide which passages match the directive, and return ONLY matching passages — each VERBATIM from the source. Everything NOT mentioned in the directive must be EXCLUDED. The directive is an EXCLUSIVE filter.

# Rules
- Every \`text\` you return MUST be a verbatim substring of the document. Fake passages get DROPPED by server-side substring validation.
- EXCLUSIVE: extract ONLY content matching the directive. Content NOT matching ANY directive keyword must be excluded, even if it appears in the same section. When a document section mixes relevant and irrelevant content (e.g. "Odporúčanie" contains both medication lines AND diet/lifestyle recommendations), extract ONLY the relevant lines — NOT the whole section.
- If the directive is broad ("echokg a záver"), err on the side of INCLUSION within those topics — but still exclude content that doesn't match any keyword.
- Match loosely on section headings: "echokg" / "echo" / "ECHOKG" / "echokardiografia" all match. "záver" / "Záver" / "Diagnostický záver" / "Summary" all match.
- Medical-document synonym awareness — doctors use shorthand in directives. Expand these:
  - "DG" / "diagnózy" / "diagnóza" → also match "Záver", "Dg.:", "Diagnózy:", "Assessment", "Diagnostický záver"
  - "LA" / "lieky" / "medikácia" / "terapia" → also match "Odporúčanie" (ONLY medication lines within it — drug name + dose + frequency), "medik.", "R:" (prescription lines), "Terapia", "Lieková anamnéza", "Medications". CRITICAL: include the FULL medication lines with drug name + dose (mg) + frequency (e.g. "1-0-1") — never strip dosing information. EXCLUDE diet, lifestyle, and management recommendations from Odporúčanie.
  - "laby" / "laboratórium" / "lab" → also match "Krvný obraz", "Biochem", "Výsledky laboratórnych testov"
  - "echo" / "echokg" → also match "Echokardiografia", "ECHOKG"
- Return an empty array when nothing matches.`;

  const userMessage = `# Directive
${directive}

# Document
${text}`;

  try {
    const provider = resolve("file-focus", "haiku");
    const result = await provider.generate({
      maxTokens: 4000,
      temperature: 0,
      system: [{ text: systemPrompt }],
      user: userMessage,
      tool: {
        name: "submit_extracted_passages",
        description:
          "Submit the passages of the document that match the physician's directive, verbatim.",
        schema: {
          type: "object",
          properties: {
            passages: {
              type: "array",
              description:
                "Verbatim passages matching the directive, in original document order. Empty array when nothing matches.",
              items: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    description:
                      "ONE contiguous verbatim substring of the document (≥8 chars). NEVER concatenate multiple places with '…' or '...'. Server validates via substring match — concatenated spans will be dropped.",
                  },
                  match_reason: {
                    type: "string",
                    description:
                      "Short rationale (e.g. 'matches echokg heading').",
                  },
                },
                required: ["text"],
              },
            },
          },
          required: ["passages"],
        },
      },
    });

    if (usage) {
      logUsage({
        userId: usage.userId,
        visitId: usage.visitId,
        provider: provider.name,
        model: provider.model,
        operation: "generate_section",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }

    const passages: Array<{ text: string }> = [];
    if (Array.isArray(result.toolInput?.passages)) {
      for (const p of result.toolInput.passages as unknown[]) {
        if (!p || typeof p !== "object") continue;
        const obj = p as { text?: unknown };
        if (typeof obj.text === "string" && obj.text.trim().length >= 8) {
          passages.push({ text: obj.text });
        }
      }
    }

    const sourceFolded = text.toLowerCase();
    const valid: string[] = [];
    for (const p of passages) {
      const span = p.text.trim();
      // Substring match in source (case-insensitive, preserves diacritics).
      if (sourceFolded.includes(span.toLowerCase())) {
        valid.push(span);
      } else {
        logger.debug(
          `[file-focus] dropped ungrounded passage (${span.length}ch) from ${fileName}`,
        );
      }
    }

    const extracted = valid.join("\n\n");

    logger.debug(
      `[file-focus] "${fileName}" directive="${directive.slice(0, 60)}" — ${text.length}ch → ${extracted.length}ch (${valid.length}/${passages.length} passages kept)`,
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
