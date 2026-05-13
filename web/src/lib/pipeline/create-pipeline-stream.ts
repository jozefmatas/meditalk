/**
 * Shared SSE stream factory for pipeline routes.
 *
 * Concentrates the try/catch → runPipelineSession → persistGeneration →
 * sendEvent(complete) → safeClose boilerplate that both /api/generate
 * and /api/adjust repeat verbatim.
 *
 * Each route still owns:  body parsing, visit fetching, source resolution,
 * and PipelineSessionInput assembly.  This module owns the inner loop.
 */
import { createSSEStream, sseResponse } from "@/lib/api/sse";
import { runPipelineSession, persistGeneration } from "./index";
import type { PipelineSessionInput, PipelineSessionResult } from "./session";
import type { PersistGenerationInput } from "./persist";
import { logger } from "@/lib/logger";

export interface CreatePipelineStreamOptions {
  /** Fully-assembled pipeline session input (sendEvent is injected). */
  sessionInput: Omit<PipelineSessionInput, "sendEvent">;
  /** Fields for persistGeneration (generatedNote etc. are filled from the result). */
  persist: Omit<
    PersistGenerationInput,
    "generatedNote" | "templateId" | "sectionContents" | "updatedFileFocusCache"
  >;
  /**
   * Extra fields to include in the SSE `complete` event.
   * The base complete event always includes `generatedNote` and `templateId`.
   */
  completeEventExtras?: (
    result: PipelineSessionResult,
  ) => Record<string, unknown>;
  /**
   * Fire-and-forget side effects to run after persistence succeeds
   * (e.g. email dispatch, audio cleanup).
   */
  afterPersist?: (result: PipelineSessionResult) => void | Promise<void>;
  /**
   * Runs inside the SSE stream BEFORE the pipeline session starts.
   * Use to perform slow async work (e.g. source resolution, transcription)
   * while sending progress events to keep the connection alive.
   *
   * May return partial overrides that are merged into `sessionInput`.
   */
  beforeSession?: (ctx: {
    sendEvent: (data: Record<string, unknown>) => void;
  }) => Promise<Partial<Omit<PipelineSessionInput, "sendEvent">> | void>;
  /** Label for error logging (e.g. "generate", "adjust"). */
  label: string;
}

/**
 * Creates a ReadableStream wired for SSE that runs the pipeline,
 * persists the result, and sends a `complete` event.
 *
 * Returns a Response ready to be returned from the route handler.
 */
export function createPipelineStream(
  options: CreatePipelineStreamOptions,
): Response {
  const {
    sessionInput,
    persist,
    completeEventExtras,
    afterPersist,
    beforeSession,
    label,
  } = options;

  const readable = createSSEStream(async ({ sendEvent, safeClose }) => {
    try {
      // Run beforeSession (e.g. resolve source with progress events)
      let finalInput = sessionInput;
      if (beforeSession) {
        const overrides = await beforeSession({ sendEvent });
        if (overrides) {
          finalInput = { ...sessionInput, ...overrides };
        }
      }

      const result = await runPipelineSession({
        ...finalInput,
        sendEvent: sendEvent as (data: Record<string, unknown>) => void,
      });

      const persistResult = await persistGeneration({
        ...persist,
        generatedNote: result.generatedNote,
        templateId: result.templateId,
        sectionContents: result.sectionContents,
        updatedFileFocusCache: result.updatedFileFocusCache,
        clinicalAnalysis: result.clinicalAnalysis,
      });

      if (!persistResult.success) {
        sendEvent({ type: "error", error: "save_failed" });
        safeClose();
        return;
      }

      sendEvent({
        type: "complete",
        generatedNote: result.generatedNote,
        templateId: result.templateId,
        ...(completeEventExtras?.(result) ?? {}),
      });

      if (afterPersist) {
        try {
          await afterPersist(result);
        } catch (err) {
          logger.error(`[${label}] afterPersist failed:`, err);
        }
      }

      safeClose();
    } catch (err) {
      logger.error(`[${label}] pipeline stream error:`, err);
      sendEvent({
        type: "error",
        error: err instanceof Error ? err.message : `${label}_failed`,
      });
      safeClose();
    }
  });

  return sseResponse(readable);
}
