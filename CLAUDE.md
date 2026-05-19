Always run low-risk bash commands directly instead of telling Jozef what to run. Test features yourself before reporting results.

Write tests every time we build significant new functionality.

When I say "Commit and push": run lint, prettier, and tests first. Write a short commit message and push.

When committing changes, you MUST update the relevant knowledge base docs in the SAME commit so they never drift from the code:

1. **`kb/prompt-pipeline.md`** — update when changes touch the generation pipeline (anything under `web/src/lib/clinical/**`, `web/src/lib/anthropic.ts`, prompts, models, ICD certainty, fact extraction/validation/resolution, or anything else documented there).

2. **`kb/data-extraction.md`** — update when changes touch recording, transcription, file upload/OCR, doctor notes intake, or anything else documented there (`web/src/app/api/transcribe/**`, `web/src/app/api/extract/**`, `web/src/lib/elevenlabs.ts`, etc.).

3. **`kb/documentation.md`** — update when changes touch ANY part of the system documented there (auth, app shell, encounters, generation pipeline, templates, transcription, file upload, data model, i18n, native app, admin, API routes, tech stack, testing, etc.).

Both docs must always reflect the current state of the code. If a change is trivial and doesn't affect anything documented in either file, skip this step.

---

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
