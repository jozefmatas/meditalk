# MediTalk — Web App

AI-powered medical documentation platform. Records consultations, transcribes audio, extracts text from uploaded files (PDFs, images, audio), and generates structured medical notes using Claude.

Runs on **http://localhost:8111**.

## Prerequisites

- Node.js 22+
- pnpm (`corepack enable && corepack prepare`)
- Supabase CLI (`brew install supabase/tap/supabase`)
- mkcert (`brew install mkcert`) — for local HTTPS
- Vercel CLI (`npm i -g vercel`) — to pull env vars from the project

## Setup

```bash
vercel link             # link to the Vercel project (one-time)
pnpm install
pnpm run setup          # pulls env from Vercel + generates HTTPS certs
pnpm run dev            # http://localhost:8111
pnpm run dev:https      # https://localhost:8111 (needed for microphone)
```

> If `vercel env pull` fails (not logged in, no project linked), `setup` falls back to copying `.env.local.example` — you'll need to fill in the values manually.

## Key Commands

| Command | What it does |
|---------|-------------|
| `pnpm run dev` | Dev server (port 8111) |
| `pnpm run dev:https` | HTTPS dev server (auto-generates certs if missing) |
| `pnpm run setup` | One-time setup (pulls env from Vercel + HTTPS certs) |
| `pnpm run build` | Production build |
| `pnpm run test:unit` | Unit tests (vitest) |
| `pnpm run lint` | ESLint |
| `pnpm run eval` | Run generation eval harness (11 fixtures) |
| `pnpm run storybook` | Component library (port 8001) |
| `pnpm run db:push` | Push Supabase migrations |
| `pnpm run db:reset` | Reset linked Supabase DB |
| `pnpm run db:types` | Regenerate Supabase TypeScript types |
| `pnpm run cap:ios` | Run on iOS via Capacitor |
| `pnpm run cap:android` | Run on Android via Capacitor |

## Documentation

All system documentation lives in `/kb/` — see [kb/README.md](../kb/README.md) for the reading order.
