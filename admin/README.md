# MediTalk — Admin Dashboard

Internal admin panel for managing users, templates, encounters, and monitoring usage.

Runs on **http://localhost:8222**. Authenticated via password + session secret (not Supabase OTP).

## Setup

```bash
vercel link             # link to the Vercel project (one-time)
pnpm install
pnpm run setup:env      # pulls env from Vercel (or copies example)
pnpm run dev            # http://localhost:8222
```

> If `vercel env pull` fails, `setup:env` falls back to copying `.env.local.example` — you'll need to fill in the values manually.

## Key Commands

| Command | What it does |
|---------|-------------|
| `pnpm run dev` | Dev server (port 8222) |
| `pnpm run build` | Production build |
| `pnpm run lint` | ESLint |
| `pnpm run setup:env` | Pull env vars from Vercel (or copy example) |

## Environment Variables

All required (see `.env.local.example`):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (full DB access)
- `ADMIN_PASSWORD` — Login password
- `ADMIN_SESSION_SECRET` — Session cookie signing secret
- `ANTHROPIC_API_KEY` — For template reference-notes ingestion
