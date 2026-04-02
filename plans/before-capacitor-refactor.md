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

### 1. Extract shared generate/regenerate streaming logic

> **Why:** These routes handle file extraction + SSE streaming. Capacitor may need different file handling. Clean shared code = easier to adapt.

- [ ] Extract duplicated `tryExtractSections()` to `lib/api/streaming.ts`
- [ ] Extract shared SSE encoding helpers
- [ ] Extract `normalizeStatus()` (duplicated in 2 encounter routes)
- [ ] Centralize error response helpers to `lib/api/responses.ts`

**Files:** `app/api/generate/route.ts` (632 lines), `app/api/regenerate/route.ts` (516 lines)

### 2. Split `use-encounter-generation.ts` (1,038 lines)

> **Why:** Generation lifecycle, caching, retry, streaming all in one hook. Capacitor adds app background/foreground state. Clean boundaries prevent spaghetti.

- [ ] Extract `useGenerationLifecycle` — start/stop/retry orchestration
- [ ] Extract `useGenerationStreaming` — SSE parsing, section accumulation
- [ ] Extract `useGenerationCache` — cached results, revalidation

### 3. Add env var validation

> **Why:** Capacitor adds `CAP_SERVER_URL`, native API endpoints, etc. Currently 18 files access `process.env` with no validation. One missing var = silent failure.

- [ ] Create `src/env.ts` with Zod schema
- [ ] Validate all required vars at startup
- [ ] Type-safe access throughout (replace raw `process.env` usage)

---

## Nice-to-Have (Can Do During or After Capacitor)

### 4. Fix arbitrary Tailwind values

- [ ] `adjust-drawer.tsx`: `min-h-[50vh]` → standard class
- [ ] `files-panel.tsx`: `w-[280px]` → `w-72`
- [ ] `recording-bar.tsx`: `max-w-[320px]` → `max-w-xs`

### 5. Test coverage for critical modules

- [ ] `app/api/regenerate/route.ts` — no tests
- [ ] `lib/file-extraction.ts` — no tests
- [ ] `lib/anthropic.ts` — no tests (core generation, 404 lines)
- [ ] `lib/clinical/pipeline.ts` — no tests

### 6. Clean up console.logs (58+ in API routes)

- [ ] Replace with structured logger or remove debug logs
- [ ] Important for Capacitor — WebView console isn't easily accessible

### 7. Remove dead code

- [ ] Verify `spiral.tsx` usage — possibly unused
- [ ] Verify `animated-magic-wand.tsx` usage — possibly unused
- [ ] Check if `generateSOAPAndLetter()` in `lib/anthropic.ts` is still called

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
