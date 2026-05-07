# Knowledge Base

Start here to understand the MediTalk codebase.

## Core Documents

| Document | Scope | Update when... |
|----------|-------|----------------|
| [documentation.md](documentation.md) | End-to-end system architecture | Touching any documented system part |
| [prompt-pipeline.md](prompt-pipeline.md) | Generation engine internals | Touching clinical/\*, anthropic.ts, prompts, models |
| [data-extraction.md](data-extraction.md) | Recording, transcription, file upload | Touching transcribe/\*, extract/\*, elevenlabs.ts |

## Reading Order for New Engineers

1. **documentation.md** — system overview, data model, API routes, tech stack
2. **prompt-pipeline.md** — how notes are generated (read after you've seen the app)
3. **data-extraction.md** — how audio/files become text for the pipeline

## Plans

See `/plans/` for upcoming work. Completed plans are in `/plans/done/`.
