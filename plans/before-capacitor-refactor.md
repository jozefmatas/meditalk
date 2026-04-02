# Before Capacitor — Refactor Checklist

> **Status:** In Progress
> **Created:** 2026-04-01
> **Goal:** Clean up technical debt before Capacitor native app migration
> **Verdict:** Codebase is in good shape. A few targeted refactors in the encounters area will make Capacitor migration smooth.

---

## Pipeline Refactor (from generation-pipeline-refactor.md)

- [x] Phase 1: Remove recording.webm upload
- [x] Phase 2: Split RecordingBar into hooks
- [x] Phase 3: Consolidate extraction logic
- [x] Phase 5: Simplify file metadata
- [x] Phase 4: Split ReviewView (~1,054 → ~660 lines)
- [x] Phase 6: Consolidate email logic

---

## Recommended Before Capacitor

### 1. ~~Extract shared generate/regenerate streaming logic~~ ✅

> Extracted `createSSEStream()`, `sseResponse()`, `extractSectionsFromStream()` → `lib/api/sse.ts`
> Extracted `normalizeStatus()` → `lib/encounters/normalize-status.ts`
> Standardized regenerate route error responses to `NextResponse.json()`

### 2. ~~Split `use-encounter-generation.ts` (1,038 → 864 lines)~~ ✅

> Extracted `parseSSEStream` → `lib/api/parse-sse-stream.ts` (client-side SSE parser, deduped 3× loop)
> Extracted `useTemplateCache` → `encounters/hooks/use-template-cache.ts`
> Extracted `useGenerationPolling` → `encounters/hooks/use-generation-polling.ts`
> Removed dead code (`handleRecordingComplete`)

### 3. ~~Add env var validation~~ ✅

> Created `lib/env/server.ts` (Zod schema, fail-fast validation) + `lib/env/client.ts` (typed NEXT*PUBLIC* constants)
> Migrated all `process.env` call sites in both web/ (17 files) and admin/ (2 files)
> Added `server-only` guard, 8 tests for validation logic
> Global `vi.mock("server-only")` in test setup for vitest compatibility

---

## Nice-to-Have (Can Do During or After Capacitor)

### 4. ~~Fix arbitrary Tailwind values~~ ✅

> Replaced all bracket-value classes with standard Tailwind utilities across 12 files:
> `adjust-drawer.tsx`, `files-panel.tsx`, `recording-bar.tsx`, `tiptap-editor.tsx`,
> `page.tsx` (home), `[visitId]/page.tsx` (4× `max-w-5xl`, `w-72`, `h-18`),
>
> - 6 stories files (card, tabs, accordion, command, input-group, table)
>   Only `generated/ui/` files (untouchable) retain bracket values

### 5. ~~Test coverage for critical modules~~ ✅

> Added 58 tests across 4 new test files (334 total, up from 276):
> `lib/anthropic.test.ts` (22 tests) — buildTemplateSystemPrompt, buildTemplateUserMessage, InsufficientContextError, GENERATION_MODELS
> `lib/clinical/pipeline.test.ts` (12 tests) — buildEnrichedSystemPrompt (ICD codes, concepts, medications, clusters)
> `lib/file-extraction.test.ts` (16 tests) — extractTextFromFile routing (PDF/image/audio), normalizeImage, priority, error handling
> `app/api/regenerate/route.test.ts` (8 tests) — auth, validation, 404s, audit logging

### 6. Clean up console.logs (58+ in API routes) ✅

> Created `logger.ts` utility (debug/info/warn/error). `debug` is silent in production.
> Replaced 90+ console.\* calls across 35 files (web + admin).
> Skipped: logger.ts itself, eruda-loader (debug tool), stories (dev-only callbacks).

- [x] Replace with structured logger or remove debug logs
- [x] Important for Capacitor — WebView console isn't easily accessible

### 7. Remove dead code ✅

> `spiral.tsx` and `animated-magic-wand.tsx` are used by the processing overlay — kept.
> Removed `generateSOAPAndLetter()` and its helper `buildSystemPrompt()` from `lib/anthropic.ts` — legacy SOAP generation replaced by template-based `generateFromTemplate()`.

- [x] Verify `spiral.tsx` usage — used (processing overlay)
- [x] Verify `animated-magic-wand.tsx` usage — used (processing overlay)
- [x] Check if `generateSOAPAndLetter()` in `lib/anthropic.ts` is still called — removed (dead code)

---

## Passing the Audit (No Action Needed)

| Area                                      | Status                |
| ----------------------------------------- | --------------------- |
| Import patterns (`@/components/shared/`)  | All correct           |
| Icon library (hugeicons, no lucide)       | Consistent            |
| i18n translations (sk/en/cs)              | Complete, balanced    |
| TypeScript strict mode                    | Enabled               |
| `"use client"` directives                 | Correct               |
| Hardcoded strings                         | None — all translated |
| CSP security headers                      | Well-configured       |
| Component architecture (shared/generated) | Clean                 |
| CSS/Tailwind organization                 | Well-structured       |

---

## Admin App (Not Blocking Capacitor)

- [ ] Add security headers to `next.config.ts`
- [ ] Replace plain text password comparison with bcrypt
- [ ] Add tests (currently zero)
- [ ] Standardize package manager (mixed pnpm/npm)
