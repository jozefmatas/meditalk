# Phase 5: Medical Documentation Templates

## Context

Inspired by [Tandem Health](https://www.tandemhealth.ai/product), we need to provide medical documentation templates that doctors commonly use in Czech, Slovak, and English contexts. This includes:
- SOAP notes (already have basic version)
- Patient letters
- Referrals
- Sick leave certificates (PN - pracovná neschopnosť)
- Specialist consultations
- Follow-up summaries

---

## Template Types

### 5.1 Core Document Types

| Type | SK Name | CS Name | EN Name |
|------|---------|---------|---------|
| SOAP Note | SOAP záznam | SOAP záznam | SOAP Note |
| Patient Letter | List pacientovi | Dopis pacientovi | Patient Letter |
| Referral | Žiadanka | Žádanka | Referral |
| Sick Leave | PN - Pracovná neschopnosť | Neschopenka | Sick Leave Certificate |
| Prescription Note | Recept poznámka | Poznámka k receptu | Prescription Note |
| Consultation Summary | Zhrnutie vyšetrenia | Shrnutí vyšetření | Consultation Summary |
| Discharge Summary | Prepúšťacia správa | Propouštěcí zpráva | Discharge Summary |

### 5.2 Visit Types (Specialty-Aware)

```typescript
type VisitType =
  | 'general_consultation'    // Všeobecná konzultácia
  | 'follow_up'              // Kontrola
  | 'preventive'             // Preventívna prehliadka
  | 'acute'                  // Akútne vyšetrenie
  | 'specialist_referral'    // Odborné vyšetrenie
  | 'telemedicine'           // Telemedicína
  | 'home_visit';            // Návštevná služba
```

---

## Database Schema

### 5.3 Templates Table

```sql
-- Document templates (system + user custom)
CREATE TABLE document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id), -- NULL for system templates
  name text NOT NULL,
  type text NOT NULL, -- soap, letter, referral, sick_leave, etc.
  language text NOT NULL DEFAULT 'sk',
  specialty text, -- general, cardiology, neurology, etc.
  content jsonb NOT NULL, -- template structure
  is_system boolean DEFAULT false,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view system templates"
  ON document_templates FOR SELECT
  USING (is_system = true OR user_id = auth.uid());

CREATE POLICY "Users can manage own templates"
  ON document_templates FOR ALL
  USING (user_id = auth.uid());

-- Generated documents
CREATE TABLE generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid REFERENCES visits(id) ON DELETE CASCADE,
  template_id uuid REFERENCES document_templates(id),
  type text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own documents"
  ON generated_documents FOR ALL
  USING (
    visit_id IN (SELECT id FROM visits WHERE user_id = auth.uid())
  );
```

---

## Template Structures

### 5.4 SOAP Note Template (Enhanced)

```json
{
  "type": "soap",
  "sections": [
    {
      "key": "subjective",
      "label": { "sk": "Subjektívne", "cs": "Subjektivně", "en": "Subjective" },
      "subsections": [
        { "key": "chief_complaint", "label": { "sk": "Hlavná sťažnosť", "cs": "Hlavní stížnost", "en": "Chief Complaint" }},
        { "key": "history_present", "label": { "sk": "Anamnéza", "cs": "Anamnéza", "en": "History of Present Illness" }},
        { "key": "allergies", "label": { "sk": "Alergie", "cs": "Alergie", "en": "Allergies" }},
        { "key": "medications", "label": { "sk": "Lieky", "cs": "Léky", "en": "Current Medications" }}
      ]
    },
    {
      "key": "objective",
      "label": { "sk": "Objektívne", "cs": "Objektivně", "en": "Objective" },
      "subsections": [
        { "key": "vitals", "label": { "sk": "Vitálne funkcie", "cs": "Vitální funkce", "en": "Vital Signs" }},
        { "key": "physical_exam", "label": { "sk": "Fyzikálne vyšetrenie", "cs": "Fyzikální vyšetření", "en": "Physical Examination" }},
        { "key": "lab_results", "label": { "sk": "Laboratórne výsledky", "cs": "Laboratorní výsledky", "en": "Lab Results" }}
      ]
    },
    {
      "key": "assessment",
      "label": { "sk": "Hodnotenie", "cs": "Hodnocení", "en": "Assessment" },
      "subsections": [
        { "key": "diagnosis", "label": { "sk": "Diagnóza", "cs": "Diagnóza", "en": "Diagnosis" }},
        { "key": "icd_codes", "label": { "sk": "MKN kódy", "cs": "MKN kódy", "en": "ICD-10 Codes" }},
        { "key": "differential", "label": { "sk": "Diferenciálna diagnóza", "cs": "Diferenciální diagnóza", "en": "Differential Diagnosis" }}
      ]
    },
    {
      "key": "plan",
      "label": { "sk": "Plán", "cs": "Plán", "en": "Plan" },
      "subsections": [
        { "key": "treatment", "label": { "sk": "Liečba", "cs": "Léčba", "en": "Treatment" }},
        { "key": "prescriptions", "label": { "sk": "Predpisy", "cs": "Předpisy", "en": "Prescriptions" }},
        { "key": "follow_up", "label": { "sk": "Kontrola", "cs": "Kontrola", "en": "Follow-up" }},
        { "key": "referrals", "label": { "sk": "Odporúčania", "cs": "Doporučení", "en": "Referrals" }}
      ]
    }
  ]
}
```

### 5.5 Referral Template (SK/CS Focus)

```json
{
  "type": "referral",
  "sections": [
    {
      "key": "header",
      "fields": [
        { "key": "referring_doctor", "label": { "sk": "Odosielajúci lekár", "cs": "Odesílající lékař", "en": "Referring Physician" }},
        { "key": "target_specialty", "label": { "sk": "Odbornosť", "cs": "Odbornost", "en": "Specialty" }},
        { "key": "urgency", "label": { "sk": "Naliehavosť", "cs": "Naléhavost", "en": "Urgency" }}
      ]
    },
    {
      "key": "patient_info",
      "fields": [
        { "key": "name", "label": { "sk": "Meno pacienta", "cs": "Jméno pacienta", "en": "Patient Name" }},
        { "key": "birth_number", "label": { "sk": "Rodné číslo", "cs": "Rodné číslo", "en": "Birth Number" }},
        { "key": "insurance", "label": { "sk": "Poisťovňa", "cs": "Pojišťovna", "en": "Insurance" }}
      ]
    },
    {
      "key": "clinical_info",
      "fields": [
        { "key": "reason", "label": { "sk": "Dôvod odoslania", "cs": "Důvod odeslání", "en": "Reason for Referral" }},
        { "key": "history", "label": { "sk": "Relevantná anamnéza", "cs": "Relevantní anamnéza", "en": "Relevant History" }},
        { "key": "findings", "label": { "sk": "Súčasné nálezy", "cs": "Současné nálezy", "en": "Current Findings" }},
        { "key": "medications", "label": { "sk": "Aktuálna liečba", "cs": "Aktuální léčba", "en": "Current Treatment" }}
      ]
    },
    {
      "key": "request",
      "fields": [
        { "key": "requested_action", "label": { "sk": "Požadované vyšetrenie", "cs": "Požadované vyšetření", "en": "Requested Examination" }},
        { "key": "questions", "label": { "sk": "Klinické otázky", "cs": "Klinické otázky", "en": "Clinical Questions" }}
      ]
    }
  ]
}
```

### 5.6 Sick Leave Certificate (SK: PN)

```json
{
  "type": "sick_leave",
  "sections": [
    {
      "key": "patient",
      "fields": [
        { "key": "name", "label": { "sk": "Meno", "cs": "Jméno", "en": "Name" }},
        { "key": "birth_number", "label": { "sk": "Rodné číslo", "cs": "Rodné číslo", "en": "Birth Number" }},
        { "key": "address", "label": { "sk": "Adresa", "cs": "Adresa", "en": "Address" }},
        { "key": "employer", "label": { "sk": "Zamestnávateľ", "cs": "Zaměstnavatel", "en": "Employer" }}
      ]
    },
    {
      "key": "sick_leave_details",
      "fields": [
        { "key": "start_date", "label": { "sk": "Dátum začiatku", "cs": "Datum začátku", "en": "Start Date" }},
        { "key": "end_date", "label": { "sk": "Dátum ukončenia", "cs": "Datum ukončení", "en": "End Date" }},
        { "key": "diagnosis_code", "label": { "sk": "Kód diagnózy", "cs": "Kód diagnózy", "en": "Diagnosis Code" }},
        { "key": "diagnosis_text", "label": { "sk": "Diagnóza", "cs": "Diagnóza", "en": "Diagnosis" }},
        { "key": "regime", "label": { "sk": "Liečebný režim", "cs": "Léčebný režim", "en": "Treatment Regime" }}
      ]
    },
    {
      "key": "doctor",
      "fields": [
        { "key": "name", "label": { "sk": "Meno lekára", "cs": "Jméno lékaře", "en": "Doctor Name" }},
        { "key": "facility", "label": { "sk": "Zdravotnícke zariadenie", "cs": "Zdravotnické zařízení", "en": "Healthcare Facility" }},
        { "key": "stamp", "label": { "sk": "Pečiatka", "cs": "Razítko", "en": "Stamp" }}
      ]
    }
  ]
}
```

### 5.7 Patient Letter Template

```json
{
  "type": "patient_letter",
  "sections": [
    {
      "key": "header",
      "fields": [
        { "key": "date", "label": { "sk": "Dátum", "cs": "Datum", "en": "Date" }},
        { "key": "patient_name", "label": { "sk": "Vážený pán/Vážená pani", "cs": "Vážený pane/Vážená paní", "en": "Dear" }}
      ]
    },
    {
      "key": "body",
      "fields": [
        { "key": "visit_summary", "label": { "sk": "Zhrnutie návštevy", "cs": "Shrnutí návštěvy", "en": "Visit Summary" }},
        { "key": "findings_explained", "label": { "sk": "Vysvetlenie nálezov", "cs": "Vysvětlení nálezů", "en": "Findings Explained" }},
        { "key": "treatment_instructions", "label": { "sk": "Pokyny k liečbe", "cs": "Pokyny k léčbě", "en": "Treatment Instructions" }},
        { "key": "lifestyle_recommendations", "label": { "sk": "Odporúčania životného štýlu", "cs": "Doporučení životního stylu", "en": "Lifestyle Recommendations" }},
        { "key": "warning_signs", "label": { "sk": "Varovné príznaky", "cs": "Varovné příznaky", "en": "Warning Signs" }},
        { "key": "next_steps", "label": { "sk": "Ďalšie kroky", "cs": "Další kroky", "en": "Next Steps" }}
      ]
    },
    {
      "key": "footer",
      "fields": [
        { "key": "closing", "label": { "sk": "S pozdravom", "cs": "S pozdravem", "en": "Sincerely" }},
        { "key": "doctor_name", "label": { "sk": "Meno lekára", "cs": "Jméno lékaře", "en": "Doctor Name" }},
        { "key": "contact", "label": { "sk": "Kontakt", "cs": "Kontakt", "en": "Contact" }}
      ]
    }
  ]
}
```

---

## Generation Prompts

### 5.8 Enhanced Claude Prompts

**File:** `src/lib/anthropic.ts`

```typescript
const TEMPLATE_PROMPTS = {
  soap: {
    sk: `Vytvor SOAP záznam z poskytnutých informácií. Použi slovenčinu.
         Štruktúra: Subjektívne, Objektívne, Hodnotenie, Plán.
         Ak informácia chýba, napíš "Neuvedené".
         Používaj správnu lekársku terminológiu.`,
    cs: `Vytvoř SOAP záznam z poskytnutých informací. Použij češtinu.
         Struktura: Subjektivně, Objektivně, Hodnocení, Plán.
         Pokud informace chybí, napiš "Neuvedeno".
         Používej správnou lékařskou terminologii.`,
    en: `Create a SOAP note from the provided information.
         Structure: Subjective, Objective, Assessment, Plan.
         If information is missing, write "Not stated".
         Use proper medical terminology.`
  },
  referral: {
    sk: `Vytvor žiadanku na odborné vyšetrenie. Slovenčina.
         Zahrň: dôvod odoslania, relevantnú anamnézu, aktuálne nálezy.
         Formuluj jasné klinické otázky pre špecialistu.`,
    // ... cs, en
  },
  sick_leave: {
    sk: `Vytvor podklady pre pracovnú neschopnosť (PN).
         Zahrň diagnózu, odporúčaný liečebný režim.
         Dodržuj formát požadovaný pre Sociálnu poisťovňu.`,
    // ... cs, en
  },
  patient_letter: {
    sk: `Napíš list pacientovi v zrozumiteľnom jazyku.
         Vyhni sa odborným termínom alebo ich vysvetli.
         Zahrň: čo sme zistili, čo to znamená, čo robiť.
         Tón: empatický, jasný, podporujúci.`,
    // ... cs, en
  }
};
```

---

## API Routes

### 5.9 Template Management

**GET `/api/templates`**
- List available templates (system + user's custom)
- Filter by type, language, specialty

**POST `/api/templates`**
- Create custom template
- Clone and modify system template

**GET `/api/templates/[templateId]`**
- Get template details

**PATCH `/api/templates/[templateId]`**
- Update custom template

**DELETE `/api/templates/[templateId]`**
- Delete custom template

### 5.10 Document Generation

**POST `/api/visits/[visitId]/generate`**
```typescript
// Request
{
  templateId?: string, // optional, uses default for type
  type: 'soap' | 'referral' | 'sick_leave' | 'patient_letter',
  options?: {
    includeIcdCodes?: boolean,
    formalityLevel?: 'formal' | 'friendly'
  }
}

// Response
{
  documentId: string,
  content: string,
  usedChunks: string[]
}
```

---

## UI Components

### 5.11 Template Selector

**File:** `src/components/templates/template-selector.tsx`

- Dropdown/modal to select document type
- Preview template structure
- Select from default or custom templates

### 5.12 Document Editor

**File:** `src/components/templates/document-editor.tsx`

- View generated document
- Section-by-section editing
- Regenerate individual sections
- Copy/export functionality

### 5.13 Template Manager

**File:** `src/app/[locale]/settings/templates/page.tsx`

- List user's custom templates
- Create new from blank or clone system
- Edit template structure
- Set defaults per type

---

## File Tree

```
src/
├── app/
│   └── [locale]/
│       ├── visits/
│       │   └── [visitId]/
│       │       └── documents/
│       │           └── page.tsx              # NEW - document generation
│       └── settings/
│           └── templates/
│               └── page.tsx                  # NEW - template manager
├── components/
│   └── templates/
│       ├── template-selector.tsx             # NEW
│       ├── document-editor.tsx               # NEW
│       ├── document-preview.tsx              # NEW
│       └── section-editor.tsx                # NEW
├── lib/
│   ├── templates/
│   │   ├── index.ts                          # NEW - template utilities
│   │   ├── soap.ts                           # NEW - SOAP template
│   │   ├── referral.ts                       # NEW - referral template
│   │   ├── sick-leave.ts                     # NEW - PN template
│   │   └── patient-letter.ts                 # NEW - letter template
│   └── anthropic.ts                          # UPDATE - add template prompts
└── api/
    ├── templates/
    │   ├── route.ts                          # NEW
    │   └── [templateId]/
    │       └── route.ts                      # NEW
    └── visits/
        └── [visitId]/
            └── generate/
                └── route.ts                  # UPDATE - template-based generation

supabase/migrations/
└── 003_templates.sql                         # NEW
```

---

## Seed Data

### 5.14 Default System Templates

Create seed migration to insert default templates for each type in sk/cs/en.

```sql
-- Insert system templates
INSERT INTO document_templates (name, type, language, is_system, is_default, content)
VALUES
  ('SOAP záznam', 'soap', 'sk', true, true, '{"sections": [...]}'),
  ('SOAP záznam', 'soap', 'cs', true, true, '{"sections": [...]}'),
  ('SOAP Note', 'soap', 'en', true, true, '{"sections": [...]}'),
  -- referrals, sick_leave, patient_letter for each language
  ...
```

---

## Implementation Order

1. Database migration (templates + documents tables)
2. Seed system templates
3. Update generation prompts in anthropic.ts
4. Create template API routes
5. Build template selector component
6. Build document editor component
7. Integrate into visit detail page
8. Build template manager in settings
9. Test full generation flow

---

## Verification

1. Visit detail → select "Generate Referral" → creates Slovak referral
2. Change language → regenerate → outputs in correct language
3. Settings → Templates → clone SOAP → customize → save
4. Generate using custom template → uses custom structure
5. All document types generate correctly in sk/cs/en
