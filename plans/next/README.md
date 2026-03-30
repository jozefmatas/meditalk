# MediTalk — Next Phases Overview

Building on the completed POC, these phases add production-ready features.

## Phase Summary

| Phase | Name | Description | Dependencies |
|-------|------|-------------|--------------|
| 4 | Navigation & Visits | Dashboard, visit CRUD, proper routing | POC complete |
| 5 | Medical Templates | SK/CS/EN templates: SOAP, referrals, PN, letters | Phase 4 |

---

## Phase 4: Navigation & Visit Management
[Full plan](./phase-4-navigation-visits.md)

**Goal:** Transform single-page POC into proper app with visit history.

**Key deliverables:**
- Dashboard with visit list
- Visit CRUD (create, view, update, delete)
- Sidebar navigation
- Database schema updates (transcripts → visits)

**Status:** In Progress

---

## Phase 5: Medical Documentation Templates
[Full plan](./phase-5-medical-templates.md)

**Goal:** Provide localized medical templates for CZ/SK/EN markets.

**Document types:**
- SOAP notes (enhanced)
- Patient letters
- Referrals (Žiadanky)
- Sick leave certificates (PN)
- Consultation summaries

**Key features:**
- Template selection per document type
- Custom template creation
- Language-aware generation prompts
- ICD-10 code support

**Inspired by:** [Tandem Health](https://www.tandemhealth.ai/)

---

## Recommended Order

```
Phase 4 (Navigation) ──▶ Phase 5 (Templates) ──▶ Production Ready
```

---

## Database Migration Summary

```sql
-- Migration 002: Visits (Phase 4)
ALTER TABLE transcripts RENAME TO visits;
-- + new columns, indexes

-- Migration 003: Templates (Phase 5)
CREATE TABLE document_templates (...);
CREATE TABLE generated_documents (...);
```

---

## Quick Start

1. Read [Phase 4 plan](./phase-4-navigation-visits.md) first
2. Start with database migration
3. Build navigation + dashboard
4. Then proceed to Phase 5

---

## Backlog

See [plans/backlog/](../backlog/) for deprioritized features:
- Phase 6: WhatsApp Integration via OpenClaw
