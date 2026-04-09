Always run low-risk bash commands directly instead of telling Jozef what to run. Test features yourself before reporting results.

Write tests every time we build significant new functionality.

When I say "Commit and push": run lint, prettier, and tests first. Write a short commit message and push.

When committing changes that touch the note-generation pipeline (anything under `web/src/lib/clinical/**`, `web/src/lib/anthropic.ts`, `web/src/lib/elevenlabs.ts`, `web/src/app/api/generate/**`, `web/src/app/api/regenerate/**`, `web/src/app/api/transcribe/**`, `web/src/app/api/extract/**`, templates, prompts, or anything else documented in `kb/note-generation-engine.md`), you MUST also update `kb/note-generation-engine.md` in the same commit so the doc never drifts from the code. If a change does not affect the pipeline, skip this step.
