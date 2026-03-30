# MediTalk — Security & Compliance Plan (GDPR / HIPAA / SOC 2)

> **Status:** In Progress
> **Created:** 2026-03-29
> **Compliance targets:** GDPR (EU), HIPAA (US), SOC 2 Type II
> **Current estimate:** GDPR ~20%, HIPAA ~30%, SOC 2 ~40%

---

## What's Already Working

- **Row-Level Security (RLS)** on all tables — `visits`, `transcript_chunks`, `api_usage`, `template_usage`, `templates`
- **Storage isolation** — `encounter-files` bucket uses path-based RLS: `{userId}/{encounterId}/{fileId}`
- **API route auth** — all data endpoints use `requireAuth()` + `.eq("user_id", userId)`
- **Service role segregation** — `SUPABASE_SERVICE_ROLE_KEY` is server-only
- **HTTPS everywhere** — Supabase enforces HTTPS; signed URLs with 5-min expiry
- **Passwordless auth** — email OTP via Supabase; HttpOnly cookies; PKCE
- **Cascade deletes** — FK constraints on `visits` → `transcript_chunks`, `template_usage`

---

## Phase 1 — Critical (Before Handling Real Patient Data)

### 1.1 Security Headers

- [x] Add `Content-Security-Policy` to `web/next.config.ts`
- [x] Add `Strict-Transport-Security` (HSTS)
- [x] Add `X-Frame-Options: DENY`
- [x] Add `X-Content-Type-Options: nosniff`
- [x] Add `Referrer-Policy: strict-origin-when-cross-origin`
- [x] Add `Permissions-Policy` (restrict camera, microphone, geolocation)

**Files:** `web/next.config.ts`

### 1.2 Session Timeout

- [ ] Create idle detection hook (15-min timeout for healthcare)
- [ ] Show warning 60s before logout
- [ ] Clear sensitive data from screen on timeout
- [ ] Force re-authentication after timeout

**Files:** Create `web/src/hooks/use-idle-timeout.ts`, modify `web/src/app/[locale]/(app)/layout.tsx`

### 1.3 Audit Logging

- [x] Create `audit_logs` table: `(id, actor_id, actor_email, action, resource_type, resource_id, metadata, ip_address, is_impersonation, target_user_id, created_at)`
- [x] Create audit logging helper function (`logAudit`, `createAuditContext`, `getClientIp`)
- [x] Log data access events (view encounter)
- [x] Log data modification events (create/edit/delete/archive encounter)
- [x] Log admin impersonation start/stop
- [x] Log file uploads/deletes
- [x] Log email sends
- [x] Log generation/regeneration events
- [x] Log authentication events (login/logout) — via DB trigger on `auth.audit_log_entries`

**Files:** `web/supabase/migrations/013_audit_logs.sql`, `014_auth_audit_trigger.sql`, `web/src/lib/audit.ts`, all API routes

### 1.4 Fix Data Deletion

- [x] User deletion: list and remove all files from `encounter-files` bucket
- [x] User deletion: remove all files from `audio` bucket
- [x] Encounter hard-delete: remove files from `encounter-files` referenced in `metadata.files[]`
- [x] Add deletion verification (check storage delete succeeded)
- [x] Log all deletions to audit table

**Files:** `admin/app/api/users/[userId]/route.ts`, `web/src/app/api/encounters/[encounterId]/route.ts`

### 1.5 Consent Flows

- [ ] Create privacy policy page
- [ ] Create terms of service page
- [ ] Add cookie consent banner (block Vercel Analytics until accepted)
- [ ] Add patient recording consent dialog before first recording
- [ ] Add data processing notice during onboarding (PHI goes to AI services)
- [ ] Track consent per user in database

**Files:** Create `web/src/app/[locale]/(marketing)/privacy/page.tsx`, `terms/page.tsx`, `web/src/components/consent/cookie-banner.tsx`, `web/src/components/encounters/recording-consent-dialog.tsx`

### 1.6 IndexedDB Encryption

- [x] Encrypt blobs before storing in IndexedDB (AES-GCM 256-bit, key in separate IndexedDB store)
- [x] Delete from IndexedDB immediately after confirmed upload (already implemented)
- [x] Reduce retention from 7 days to 24 hours
- ~~Alternative: eliminate IndexedDB persistence~~ — keeping IndexedDB for crash safety

**Files:** `web/src/lib/indexeddb/crypto.ts`, `web/src/lib/indexeddb/pending-uploads.ts`

### 1.7 Remove Unvetted Analytics

- [ ] Disable Vercel Analytics until GDPR consent flow is in place
- [ ] Or switch to privacy-respecting analytics (Plausible, Fathom)

**Files:** `web/src/app/[locale]/layout.tsx`

---

## Phase 2 — High Priority (For Compliance Certification)

### 2.1 Business Associate Agreements / Data Processing Agreements

PHI is sent to 4 external services without documented agreements:

| Service           | PHI Sent                                                      | Used In                              |
| ----------------- | ------------------------------------------------------------- | ------------------------------------ |
| Anthropic Claude  | Transcripts, clinical notes, patient names, medical documents | `/api/generate`, `/api/regenerate`   |
| OpenAI            | Search queries, transcript chunks (embeddings)                | `/api/search`, `/api/generate`       |
| ElevenLabs Scribe | Audio recordings of patient consultations                     | `/api/scribe-token`, `/api/generate` |
| Resend            | Encounter notes, patient letters, user emails                 | `/api/send-note-email`               |

- [ ] Sign Anthropic BAA (available on certain API plans)
- [ ] Sign OpenAI BAA (available on Team/Enterprise plans)
- [ ] Evaluate ElevenLabs HIPAA readiness — may need to switch transcription provider
- [ ] Evaluate Resend — consider HIPAA-compliant email (Paubox, self-hosted)
- [ ] Sign Supabase BAA (available on Pro/Enterprise plans)
- [ ] Document all agreements in compliance register

### 2.2 Rate Limiting

- [ ] Add per-user rate limiting on `/api/generate` (e.g. 10/hour)
- [ ] Add per-user rate limiting on `/api/search`
- [ ] Add per-user rate limiting on `/api/scribe-token`
- [ ] Add IP-based rate limiting on public endpoints (`/api/icd-search`, `/api/templates`)
- [ ] Add rate limiting on admin login (5 attempts / 10 min)

**Files:** Create `web/src/lib/rate-limit.ts`, modify API routes. Consider Upstash or Vercel Edge.

### 2.3 Fix Over-Fetching

- [ ] `GET /api/encounters` — use explicit `.select("id, title, patient_name, patient_id, status, visit_date, visit_type, language, metadata, created_at")` instead of `SELECT *`
- [ ] Verify no other list endpoints return unnecessary PHI

**Files:** `web/src/app/api/encounters/route.ts`

### 2.4 Harden Admin Panel

- [ ] Consider migrating admin auth to Supabase (individual accounts with MFA)
- [ ] Or: add rate limiting on current password login
- [ ] Reduce session cookie expiry from 7 days to 8 hours
- [ ] Log all login attempts (success and failure)
- [ ] Add MFA for admin accounts

**Files:** `admin/middleware.ts`, `admin/app/api/auth/login/route.ts`

### 2.5 Impersonation Audit

- [ ] Log impersonation start/stop to audit table (admin email, target user, timestamp, IP)
- [ ] Require reason field for impersonation
- [ ] Reduce impersonation window from 4 hours to 1-2 hours
- [ ] Notify impersonated user post-access (email or in-app notification)

**Files:** `web/src/app/api/admin/impersonate/route.ts`

### 2.6 Structured Logging

- [ ] Replace all `console.log`/`console.error` (43 occurrences across 9 API files) with structured logger
- [ ] Ensure no PHI in log output (redact user IDs, visit IDs, patient names)
- [ ] Set log retention policy (minimum 6 years for HIPAA)
- [ ] Consider Pino, Winston, or Vercel log drain

**Files:** All files in `web/src/app/api/`

### 2.7 MFA for Users

- [ ] Add TOTP/authenticator app support via Supabase MFA
- [ ] Make MFA recommended (or required for accounts with PHI)

---

## Phase 3 — Medium Priority (Hardening & Polish)

### 3.1 Right to Erasure UI

- [ ] Add "Delete My Account" option in user settings
- [ ] Add "Download My Data" export (GDPR Article 20)
- [ ] Confirmation with recovery window notice
- [ ] 30-day soft-delete recovery period before hard delete

**Files:** `web/src/app/[locale]/(app)/settings/page.tsx`, create new API routes

### 3.2 Data Retention Policy

- [ ] Document retention schedule (HIPAA: typically 6 years from last encounter)
- [ ] Implement automated cleanup of archived encounters past retention period
- [ ] Add retention policy to privacy policy page

### 3.3 Hide Template System Prompts

- [ ] `GET /api/templates` (public, no auth) currently returns `system_prompt` field
- [ ] Remove `system_prompt` from public template API response

**Files:** `web/src/app/api/templates/route.ts`

### 3.4 Verify Audio Bucket RLS

- [ ] Check RLS policies on `audio` storage bucket in live Supabase project
- [ ] Add migration if missing

### 3.5 File Upload Validation

- [ ] Add file type whitelist (MIME + magic bytes validation)
- [ ] Add file size limits (per file and per encounter)
- [ ] Consider malware scanning

**Files:** `web/src/app/api/encounters/[encounterId]/files/route.ts`

### 3.6 Email PHI Handling

- [ ] Evaluate switching to HIPAA-compliant email service
- [ ] Or add opt-in warning: "Email is not end-to-end encrypted"
- [ ] Ensure subject line doesn't contain patient name

**Files:** `web/src/app/api/send-note-email/route.ts`, `web/src/lib/email/send-note-email.ts`

### 3.7 Incident Response

- [ ] Document breach notification workflow (GDPR: 72 hours, HIPAA: 60 days)
- [ ] Define incident response procedures
- [ ] Set up monitoring and alerting (error tracking, anomaly detection)

### 3.8 Metadata Field Governance

- [ ] Document allowed keys for `visits.metadata` JSONB field
- [ ] Add schema validation on INSERT/UPDATE

---

## PHI Data Map

| Table/Location                       | PHI Fields                               | Risk     |
| ------------------------------------ | ---------------------------------------- | -------- |
| `visits.patient_name`                | Direct patient identifier                | High     |
| `visits.patient_id`                  | Direct patient identifier                | High     |
| `visits.encounter_note`              | Clinical notes, diagnoses                | High     |
| `visits.patient_letter`              | Medical correspondence                   | High     |
| `visits.raw_text`                    | Full consultation transcript             | High     |
| `visits.audio_path`                  | Reference to audio recording             | High     |
| `visits.metadata`                    | Flexible JSONB (may contain PHI)         | Medium   |
| `transcript_chunks.content`          | Segments of medical conversation         | High     |
| `transcript_chunks.embedding`        | Vector of PHI (lossy but derived)        | Medium   |
| `encounter-files` bucket             | Audio, PDFs, images of medical documents | High     |
| `audio` bucket                       | Audio recordings                         | High     |
| IndexedDB `meditalk-pending-uploads` | Raw file blobs (unencrypted)             | Critical |
| Resend emails                        | Full encounter notes in transit          | High     |

---

## Third-Party Data Flow

```
Patient Audio ──▶ Browser ──▶ ElevenLabs Scribe (transcription)
                           ──▶ Supabase Storage (file storage)
                           ──▶ IndexedDB (temporary, UNENCRYPTED)

Transcript ──▶ Anthropic Claude (note generation)
           ──▶ OpenAI (embeddings for search)

Generated Note ──▶ Supabase DB (storage)
               ──▶ Resend (email delivery)
```

---

## Compliance Checklist Summary

### GDPR

| Requirement                   | Status                        |
| ----------------------------- | ----------------------------- |
| Lawful basis / consent        | Not implemented               |
| Privacy policy                | Not created                   |
| Data Processing Agreements    | Not signed                    |
| Right to access (data export) | Not implemented               |
| Right to erasure (deletion)   | Partial (API only, not in UI) |
| Data breach notification      | Not documented                |
| DPIA for AI processing        | Not conducted                 |

### HIPAA

| Requirement                   | Status                        |
| ----------------------------- | ----------------------------- |
| Business Associate Agreements | Not signed                    |
| Minimum necessary principle   | Violated (over-fetching)      |
| Access controls               | Strong (RLS + auth)           |
| Audit & accountability        | Not implemented               |
| Transmission security         | Good (HTTPS)                  |
| Encryption at rest            | Supabase-managed (verify BAA) |
| Automatic logoff              | Not implemented               |
| Breach notification           | Not documented                |

### SOC 2 Type II

| Requirement             | Status                     |
| ----------------------- | -------------------------- |
| Access control logging  | Not implemented            |
| Change management       | Not documented             |
| Incident response       | Not documented             |
| Data retention policy   | Not defined                |
| Periodic access reviews | Not implemented            |
| Segregation of duties   | Good (admin/user separate) |
| Security monitoring     | Not implemented            |
