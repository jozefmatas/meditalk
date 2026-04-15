Always run low-risk bash commands directly instead of telling Jozef what to run. Test features yourself before reporting results.

Write tests every time we build significant new functionality.

When I say "Commit and push": run lint, prettier, and tests first. Write a short commit message and push.

When committing changes, you MUST update the relevant knowledge base docs in the SAME commit so they never drift from the code:

1. **`kb/prompt-pipeline.md`** — update when changes touch the generation pipeline (anything under `web/src/lib/clinical/**`, `web/src/lib/anthropic.ts`, prompts, models, ICD certainty, fact extraction/validation/resolution, or anything else documented there).

2. **`kb/data-extraction.md`** — update when changes touch recording, transcription, file upload/OCR, doctor notes intake, or anything else documented there (`web/src/app/api/transcribe/**`, `web/src/app/api/extract/**`, `web/src/lib/elevenlabs.ts`, etc.).

3. **`kb/documentation.md`** — update when changes touch ANY part of the system documented there (auth, app shell, encounters, generation pipeline, templates, transcription, file upload, data model, i18n, native app, admin, API routes, tech stack, testing, etc.).

Both docs must always reflect the current state of the code. If a change is trivial and doesn't affect anything documented in either file, skip this step.
