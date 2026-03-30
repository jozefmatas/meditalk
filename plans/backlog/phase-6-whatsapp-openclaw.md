# Phase 6: WhatsApp Integration via OpenClaw

## Context

Integrate [OpenClaw](https://docs.openclaw.ai/) to enable doctors to capture patient data via WhatsApp. This allows:
- Upload audio recordings from phone
- Upload documents (lab results, referrals, images)
- Voice messages → transcription → visit creation
- Quick access from mobile without web app

**Reference docs:**
- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [WhatsApp Integration Guide](https://openclawdoc.com/docs/channels/whatsapp/)
- [GitHub Repository](https://github.com/openclaw/openclaw)

---

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   WhatsApp      │────▶│   OpenClaw      │────▶│   MediTalk      │
│   (Doctor)      │◀────│   Gateway       │◀────│   API           │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │   Claude/AI     │
                        │   Processing    │
                        └─────────────────┘
```

**Flow:**
1. Doctor sends audio/document to WhatsApp bot
2. OpenClaw receives via webhook
3. OpenClaw calls MediTalk API with media
4. MediTalk processes and creates/updates visit
5. Response sent back to doctor via WhatsApp

---

## OpenClaw Setup

### 6.1 Prerequisites

- Node.js 22+
- Meta Developer Account (developers.facebook.com)
- Phone number not registered with WhatsApp
- Publicly accessible HTTPS endpoint (or ngrok for dev)

### 6.2 Installation

```bash
# Install OpenClaw globally
npm install -g openclaw

# Run onboarding wizard
openclaw onboard --install-daemon
```

### 6.3 WhatsApp Business API Setup

1. **Create Meta App**
   - Go to developers.facebook.com/apps
   - Create App → Business type
   - Name: "MediTalk WhatsApp Bot"

2. **Configure WhatsApp**
   - Add WhatsApp product to app
   - Note: Phone Number ID, Business Account ID
   - Generate permanent System User Token with permissions:
     - `whatsapp_business_management`
     - `whatsapp_business_messaging`

3. **Environment Variables**
   ```env
   WHATSAPP_ACCESS_TOKEN=your_permanent_token
   WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
   WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
   WHATSAPP_VERIFY_TOKEN=your_custom_verify_token
   ```

4. **Webhook Configuration**
   - Callback URL: `https://your-domain.com/api/channels/whatsapp/webhook`
   - Verify token: matches `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to: messages, message_echoes

---

## Database Schema

### 6.4 WhatsApp Sessions Table

```sql
-- Track WhatsApp user sessions
CREATE TABLE whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  phone_number text NOT NULL UNIQUE,
  verified_at timestamptz,
  active_visit_id uuid REFERENCES visits(id),
  session_state jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sessions"
  ON whatsapp_sessions FOR ALL
  USING (user_id = auth.uid());

-- Index for phone lookup
CREATE UNIQUE INDEX idx_whatsapp_phone ON whatsapp_sessions(phone_number);

-- Uploaded media tracking
CREATE TABLE whatsapp_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES visits(id),
  media_type text NOT NULL, -- audio, image, document
  whatsapp_media_id text,
  storage_path text,
  processed boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE whatsapp_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own media"
  ON whatsapp_media FOR ALL
  USING (
    session_id IN (SELECT id FROM whatsapp_sessions WHERE user_id = auth.uid())
  );
```

---

## OpenClaw Agent Configuration

### 6.5 MediTalk Agent Skill

**File:** `openclaw/skills/meditalk.ts`

```typescript
import { Skill, Message, MediaAttachment } from 'openclaw';

export const meditalkSkill: Skill = {
  name: 'meditalk',
  description: 'Medical transcription and visit management',

  // Commands the bot responds to
  commands: {
    '/start': handleStart,
    '/newvisit': handleNewVisit,
    '/status': handleStatus,
    '/help': handleHelp,
  },

  // Handle incoming media
  onMedia: handleMedia,

  // Handle text messages
  onMessage: handleMessage,
};

async function handleStart(msg: Message) {
  // Link WhatsApp to MediTalk account
  return {
    text: `Vitajte v MediTalk! 🏥\n\n` +
          `Pre prepojenie účtu navštívte:\n` +
          `${process.env.MEDITALK_URL}/settings/whatsapp?code=${generateLinkCode(msg.from)}\n\n` +
          `Napíšte /help pre zoznam príkazov.`,
  };
}

async function handleNewVisit(msg: Message) {
  // Create new visit and set as active
  const session = await getSession(msg.from);
  if (!session.user_id) {
    return { text: 'Najprv prepojte účet pomocou /start' };
  }

  const visit = await createVisit(session.user_id);
  await setActiveVisit(session.id, visit.id);

  return {
    text: `Nová návšteva vytvorená! 📝\n\n` +
          `Pošlite audio nahrávku alebo dokumenty.\n` +
          `Pre ukončenie napíšte /done`,
  };
}

async function handleMedia(msg: Message, media: MediaAttachment) {
  const session = await getSession(msg.from);

  if (!session.active_visit_id) {
    return { text: 'Najprv vytvorte návštevu pomocou /newvisit' };
  }

  // Download media from WhatsApp
  const mediaBuffer = await downloadWhatsAppMedia(media.id);

  // Process based on type
  switch (media.type) {
    case 'audio':
    case 'voice':
      return await processAudio(session, mediaBuffer, media);
    case 'image':
      return await processImage(session, mediaBuffer, media);
    case 'document':
      return await processDocument(session, mediaBuffer, media);
  }
}
```

### 6.6 Media Processing

```typescript
async function processAudio(
  session: WhatsAppSession,
  buffer: Buffer,
  media: MediaAttachment
) {
  // Upload to MediTalk API
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), media.filename || 'voice.ogg');
  formData.append('visitId', session.active_visit_id);
  formData.append('language', session.session_state.language || 'sk');

  const response = await fetch(`${MEDITALK_API}/api/whatsapp/process-audio`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.api_token}`,
    },
    body: formData,
  });

  const result = await response.json();

  return {
    text: `Audio spracované! ✅\n\n` +
          `Dĺžka prepisu: ${result.chunkCount} častí\n` +
          `Napíšte /generate pre vytvorenie SOAP záznamu.`,
  };
}

async function processImage(session, buffer, media) {
  // Store image and optionally run OCR
  const response = await fetch(`${MEDITALK_API}/api/whatsapp/upload-media`, {
    method: 'POST',
    body: createFormData(buffer, media, session),
  });

  return {
    text: `Obrázok uložený! 📷\n` +
          `Pošlite ďalšie súbory alebo /done pre ukončenie.`,
  };
}

async function processDocument(session, buffer, media) {
  // Store document (PDF, etc.)
  const response = await fetch(`${MEDITALK_API}/api/whatsapp/upload-media`, {
    method: 'POST',
    body: createFormData(buffer, media, session),
  });

  return {
    text: `Dokument uložený! 📄\n` +
          `Typ: ${media.mimeType}\n` +
          `Pošlite ďalšie súbory alebo /done pre ukončenie.`,
  };
}
```

---

## MediTalk API Endpoints

### 6.7 WhatsApp-Specific Routes

**POST `/api/whatsapp/link`**
- Link WhatsApp number to MediTalk account
- Verify link code from `/start` command

```typescript
// Request
{ code: string, phoneNumber: string }

// Response
{ success: true, sessionId: string }
```

**POST `/api/whatsapp/process-audio`**
- Receive audio from WhatsApp
- Transcribe and add to visit

```typescript
// Request (multipart)
FormData: file, visitId, language

// Response
{ success: true, chunkCount: number, transcriptPreview: string }
```

**POST `/api/whatsapp/upload-media`**
- Store images/documents for visit

```typescript
// Request (multipart)
FormData: file, visitId, mediaType

// Response
{ success: true, mediaId: string, storageUrl: string }
```

**POST `/api/whatsapp/generate`**
- Generate document from visit
- Send result back via WhatsApp

```typescript
// Request
{ visitId: string, type: 'soap' | 'letter' | 'referral' }

// Response
{ success: true, documentId: string, preview: string }
```

**GET `/api/whatsapp/visits`**
- List recent visits for WhatsApp user

---

## Bot Commands

### 6.8 Available Commands

| Command | SK Description | Action |
|---------|----------------|--------|
| `/start` | Prepojenie účtu | Generate link code |
| `/newvisit` | Nová návšteva | Create visit, set active |
| `/done` | Ukončiť návštevu | Close active visit |
| `/generate` | Vytvoriť SOAP | Generate SOAP note |
| `/letter` | List pacientovi | Generate patient letter |
| `/status` | Stav | Show active visit info |
| `/visits` | Návštevy | List recent visits |
| `/language sk\|cs\|en` | Jazyk | Set preferred language |
| `/help` | Pomoc | Show command list |

### 6.9 Conversation Flows

**New Visit Flow:**
```
Doctor: /newvisit
Bot: Nová návšteva vytvorená! Pošlite audio alebo dokumenty.

Doctor: [sends voice message]
Bot: Audio spracované! ✅ Dĺžka prepisu: 5 častí

Doctor: [sends photo of lab results]
Bot: Obrázok uložený! 📷

Doctor: /generate
Bot: SOAP záznam vytvorený!
     Subjektívne: Pacient udáva bolesti hlavy...
     [truncated preview]

     Celý záznam: https://meditalk.app/visits/xxx

Doctor: /done
Bot: Návšteva ukončená. ✅
```

---

## Security Considerations

### 6.10 Authentication Flow

1. **Initial Link**
   - User visits `/settings/whatsapp` in web app
   - Generates time-limited link code
   - Sends `/start` in WhatsApp
   - Bot provides link with code
   - User clicks link → account linked

2. **Session Tokens**
   - Each linked session gets API token
   - Token scoped to specific user
   - Tokens rotatable from web app

3. **Data Protection**
   - All media encrypted in transit (HTTPS)
   - Media stored in user's Supabase storage folder
   - PHI handled per GDPR requirements
   - Option to auto-delete media after processing

### 6.11 Access Control

```typescript
// Allowlist configuration in OpenClaw
const config = {
  channels: {
    whatsapp: {
      allowFrom: [
        // Only allow verified MediTalk users
        // Populated dynamically from database
      ],
      // Or use domain verification
      requireVerification: true,
    }
  }
};
```

---

## Deployment

### 6.12 OpenClaw Deployment Options

**Option A: Self-hosted (Recommended for PHI)**
```bash
# On your server
openclaw daemon start
openclaw channels add whatsapp

# Configure webhook URL
# https://your-meditalk-domain.com/api/openclaw/webhook
```

**Option B: Docker**
```yaml
# docker-compose.yml
services:
  openclaw:
    image: openclaw/openclaw:latest
    environment:
      - WHATSAPP_ACCESS_TOKEN=${WHATSAPP_ACCESS_TOKEN}
      - WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID}
      - MEDITALK_API_URL=${MEDITALK_API_URL}
    ports:
      - "18789:18789"
```

**Option C: Zeabur/Railway**
- Use template deployment
- Configure environment variables
- Point webhook to deployment URL

### 6.13 Production Checklist

- [ ] Meta Business Verification completed
- [ ] Permanent System User Token generated
- [ ] Webhook endpoint publicly accessible
- [ ] SSL certificate valid
- [ ] Rate limiting configured
- [ ] Error alerting set up
- [ ] Backup/recovery tested

---

## File Tree

```
src/
├── app/
│   └── [locale]/
│       └── settings/
│           └── whatsapp/
│               └── page.tsx                  # NEW - WhatsApp linking UI
├── api/
│   └── whatsapp/
│       ├── link/
│       │   └── route.ts                      # NEW - account linking
│       ├── process-audio/
│       │   └── route.ts                      # NEW - audio from WhatsApp
│       ├── upload-media/
│       │   └── route.ts                      # NEW - images/docs
│       ├── generate/
│       │   └── route.ts                      # NEW - document generation
│       └── webhook/
│           └── route.ts                      # NEW - OpenClaw webhook
├── lib/
│   └── whatsapp/
│       ├── index.ts                          # NEW - WhatsApp utilities
│       ├── session.ts                        # NEW - session management
│       └── media.ts                          # NEW - media handling

# Separate OpenClaw config (can be in same repo or separate)
openclaw/
├── config.ts                                 # OpenClaw configuration
├── skills/
│   └── meditalk.ts                           # MediTalk skill
└── .env                                      # OpenClaw environment

supabase/migrations/
└── 004_whatsapp.sql                          # NEW
```

---

## i18n Updates

### 6.14 WhatsApp-Related Strings

```json
{
  "whatsapp": {
    "title": "WhatsApp prepojenie / WhatsApp propojení / WhatsApp Connection",
    "link": "Prepojiť WhatsApp / Propojit WhatsApp / Link WhatsApp",
    "unlink": "Odpojiť / Odpojit / Unlink",
    "linked": "Prepojené / Propojeno / Connected",
    "notLinked": "Neprepojené / Nepropojeno / Not connected",
    "instructions": "Pošlite /start na číslo... / Pošlete /start na číslo... / Send /start to number...",
    "commands": {
      "newvisit": "Nová návšteva / Nová návštěva / New visit",
      "done": "Ukončiť / Ukončit / Done",
      "generate": "Vytvoriť záznam / Vytvořit záznam / Generate note"
    }
  }
}
```

---

## Implementation Order

1. Database migration (sessions, media tables)
2. Create WhatsApp linking page in web app
3. Set up OpenClaw locally
4. Configure WhatsApp Business API
5. Implement MediTalk API endpoints
6. Create OpenClaw skill
7. Test end-to-end flow
8. Deploy OpenClaw to production
9. Complete Meta Business Verification
10. Go live

---

## Verification

1. `/start` → generates link code
2. Visit link in browser → accounts linked
3. `/newvisit` → creates visit
4. Send voice message → transcribed, added to visit
5. Send image → stored in visit
6. `/generate` → SOAP created
7. View visit in web app → all data present
8. `/done` → visit closed
