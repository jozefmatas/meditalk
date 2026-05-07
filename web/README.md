# MediTalk — Web App

AI-powered medical documentation platform. Records consultations, transcribes audio, extracts text from uploaded files (PDFs, images, audio), and generates structured medical notes using Claude.

Runs on **http://localhost:8111**.

## Prerequisites

- Node.js 22+
- npm
- Supabase CLI (`brew install supabase/tap/supabase`)
- API keys: Anthropic, OpenAI, ElevenLabs, Resend (see `.env.local.example`)

## Setup

```bash
cp .env.local.example .env.local   # fill in your keys
npm install
npm run dev                         # http://localhost:8111
```

For HTTPS (needed for microphone on some browsers):

```bash
# generate certs with mkcert first
npm run dev:https
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Dev server (port 8111) |
| `npm run build` | Production build |
| `npm run test:unit` | Unit tests (vitest) |
| `npm run lint` | ESLint |
| `npm run eval` | Run generation eval harness (11 fixtures) |
| `npm run storybook` | Component library (port 8001) |
| `npm run db:push` | Push Supabase migrations |
| `npm run db:reset` | Reset linked Supabase DB |
| `npm run db:types` | Regenerate Supabase TypeScript types |
| `npm run cap:ios` | Run on iOS via Capacitor |
| `npm run cap:android` | Run on Android via Capacitor |

## Documentation

All system documentation lives in `/kb/` — see [kb/README.md](../kb/README.md) for the reading order.
