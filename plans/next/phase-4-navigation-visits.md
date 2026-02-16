# Phase 4: Navigation & Visit Management

## Context

Building on the POC, we need proper navigation structure and visit management. Currently the app is a single-page POC. This phase adds:
- Dashboard with visit history
- Individual visit pages
- Visit CRUD operations
- Proper routing structure

---

## Database Schema Changes

### 4.1 New Tables

```sql
-- Rename transcripts to visits for clarity
ALTER TABLE transcripts RENAME TO visits;

-- Add visit-specific columns
ALTER TABLE visits ADD COLUMN visit_date timestamptz DEFAULT now();
ALTER TABLE visits ADD COLUMN patient_name text;
ALTER TABLE visits ADD COLUMN patient_id text; -- optional external reference
ALTER TABLE visits ADD COLUMN visit_type text DEFAULT 'consultation';
ALTER TABLE visits ADD COLUMN status text DEFAULT 'draft'; -- draft, completed, archived
ALTER TABLE visits ADD COLUMN soap_note text;
ALTER TABLE visits ADD COLUMN patient_letter text;
ALTER TABLE visits ADD COLUMN metadata jsonb DEFAULT '{}';

-- Update foreign key reference
ALTER TABLE transcript_chunks RENAME COLUMN transcript_id TO visit_id;

-- Indexes for common queries
CREATE INDEX idx_visits_user_date ON visits(user_id, visit_date DESC);
CREATE INDEX idx_visits_status ON visits(user_id, status);
CREATE INDEX idx_visits_patient ON visits(user_id, patient_name);
```

### 4.2 Update RPC Functions

```sql
-- Update match_chunks to use visit_id
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count int,
  p_visit_id uuid
)
RETURNS TABLE (
  id uuid,
  visit_id uuid,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    tc.id,
    tc.visit_id,
    tc.chunk_index,
    tc.content,
    1 - (tc.embedding <=> query_embedding) as similarity
  FROM transcript_chunks tc
  WHERE tc.visit_id = p_visit_id
  ORDER BY tc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## Navigation Structure

### 4.3 Route Architecture

```
/[locale]/
├── page.tsx              # Dashboard (visit list)
├── visits/
│   ├── new/
│   │   └── page.tsx      # New visit form
│   └── [visitId]/
│       ├── page.tsx      # Visit detail/editor
│       └── review/
│           └── page.tsx  # Generated SOAP + letter review
├── settings/
│   └── page.tsx          # User preferences
└── login/
    └── page.tsx          # Auth (exists)
```

### 4.4 Navigation Component

**File:** `src/components/nav/sidebar.tsx`

```tsx
// Sidebar navigation with:
// - Logo/brand
// - Dashboard link
// - New Visit button
// - Settings link
// - User info + sign out
// - Language switcher (moved here)
```

**File:** `src/components/nav/header.tsx`

```tsx
// Top header with:
// - Breadcrumb navigation
// - Quick actions (new visit)
// - Mobile menu toggle
```

---

## UI Components

### 4.5 Dashboard Page

**File:** `src/app/[locale]/page.tsx`

- Visit list with columns: Date, Patient, Type, Status
- Search/filter visits
- Sort by date (default: newest first)
- Pagination (10 visits per page)
- Empty state for new users
- "New Visit" CTA button

### 4.6 Visit List Component

**File:** `src/components/visits/visit-list.tsx`

```tsx
interface VisitListProps {
  visits: Visit[];
  onSelect: (visitId: string) => void;
  onDelete: (visitId: string) => void;
}
```

### 4.7 New Visit Page

**File:** `src/app/[locale]/visits/new/page.tsx`

- Patient name input (optional)
- Visit type selector
- Date picker (defaults to now)
- Audio upload/record (from POC)
- Process and create visit

### 4.8 Visit Detail Page

**File:** `src/app/[locale]/visits/[visitId]/page.tsx`

- Audio player (if audio exists)
- Transcript viewer
- Search within visit
- Edit patient info
- Generate/regenerate SOAP + letter
- Export options
- Delete visit

---

## API Routes

### 4.9 Visit CRUD

**GET `/api/visits`**
- List user's visits with pagination
- Query params: `page`, `limit`, `status`, `search`

**POST `/api/visits`**
- Create new visit (with or without audio)
- Process audio if provided

**GET `/api/visits/[visitId]`**
- Get visit details with chunks

**PATCH `/api/visits/[visitId]`**
- Update visit metadata
- Update SOAP/letter

**DELETE `/api/visits/[visitId]`**
- Soft delete (status = 'archived') or hard delete
- Clean up audio from storage

### 4.10 Update Existing Routes

- `/api/process-audio` → Create visit or update existing
- `/api/generate` → Save SOAP/letter to visit record

---

## i18n Updates

### 4.11 New Translation Keys

```json
{
  "nav": {
    "dashboard": "Dashboard / Prehľad / Přehled",
    "newVisit": "New Visit / Nová návšteva / Nová návštěva",
    "settings": "Settings / Nastavenia / Nastavení"
  },
  "visits": {
    "title": "Visits / Návštevy / Návštěvy",
    "empty": "No visits yet / Zatiaľ žiadne návštevy / Zatím žádné návštěvy",
    "patient": "Patient / Pacient / Pacient",
    "date": "Date / Dátum / Datum",
    "type": "Type / Typ / Typ",
    "status": "Status / Stav / Stav",
    "draft": "Draft / Koncept / Koncept",
    "completed": "Completed / Dokončené / Dokončeno"
  }
}
```

---

## File Tree

```
src/
├── app/
│   └── [locale]/
│       ├── page.tsx                    # REWRITE → Dashboard
│       ├── layout.tsx                  # UPDATE → Add sidebar
│       ├── visits/
│       │   ├── new/
│       │   │   └── page.tsx            # NEW
│       │   └── [visitId]/
│       │       ├── page.tsx            # NEW
│       │       └── review/
│       │           └── page.tsx        # NEW
│       └── settings/
│           └── page.tsx                # NEW
├── components/
│   ├── nav/
│   │   ├── sidebar.tsx                 # NEW
│   │   ├── header.tsx                  # NEW
│   │   └── breadcrumb.tsx              # NEW
│   └── visits/
│       ├── visit-list.tsx              # NEW
│       ├── visit-card.tsx              # NEW
│       └── visit-form.tsx              # NEW
├── lib/
│   └── types.ts                        # UPDATE → Visit type
└── api/
    └── visits/
        ├── route.ts                    # NEW (list, create)
        └── [visitId]/
            └── route.ts                # NEW (get, update, delete)

supabase/migrations/
└── 002_visits_schema.sql               # NEW
```

---

## Implementation Order

1. Database migration (rename + new columns)
2. Update types and API routes
3. Create navigation components
4. Build dashboard page
5. Build new visit flow
6. Build visit detail page
7. Update i18n messages
8. Test full flow

---

## Verification

1. Login → lands on dashboard
2. Empty state shows for new users
3. Create new visit → appears in list
4. Click visit → detail page loads
5. Generate SOAP → saves to visit
6. Back to dashboard → status updated
7. Search/filter works
8. Delete visit → removed from list
