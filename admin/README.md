# MediTalk — Admin Dashboard

Internal admin panel for managing users, templates, encounters, and monitoring usage.

Runs on **http://localhost:8222**. Authenticated via password + session secret (not Supabase OTP).

## Setup

```bash
cp .env.local.example .env.local   # fill in your keys
npm install
npm run dev                         # http://localhost:8222
```

## Key Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Dev server (port 8222) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Environment Variables

All required (see `.env.local.example`):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (full DB access)
- `ADMIN_PASSWORD` — Login password
- `ADMIN_SESSION_SECRET` — Session cookie signing secret
- `ANTHROPIC_API_KEY` — For template reference-notes ingestion
