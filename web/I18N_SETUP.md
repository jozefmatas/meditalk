# MediTalk Internationalization (i18n) Setup

This document explains how the multilingual setup works in MediTalk and how to use it.

## Supported Languages

- 🇸🇰 **Slovak (sk)** - Primary language (default)
- 🇨🇿 **Czech (cs)** - Secondary language
- 🇬🇧 **English (en)** - International language

## Architecture

The project uses **next-intl** for internationalization, which provides:

- Automatic locale detection
- Cookie-based locale persistence
- Clean URL structure
- Type-safe translations
- Server and Client Component support

## File Structure

```
meditalk/
├── messages/                    # Translation files
│   ├── sk.json                 # Slovak translations
│   ├── cs.json                 # Czech translations
│   └── en.json                 # English translations
├── src/
│   ├── i18n/
│   │   ├── routing.ts          # Locale routing configuration
│   │   └── request.ts          # Request handler for loading translations
│   ├── app/
│   │   ├── [locale]/           # Locale-based routes
│   │   │   ├── layout.tsx      # Root layout with locale support
│   │   │   └── page.tsx        # Home page
│   │   ├── layout.tsx          # Root redirect layout
│   │   └── page.tsx            # Root redirect page
│   ├── components/
│   │   └── language-switcher.tsx  # Language switcher component
│   └── proxy.ts                # Middleware with i18n + Supabase auth
├── .env.local                   # Environment variables
└── next.config.ts              # Next.js config with next-intl plugin
```

## Configuration

### Default Language

Change the default language by updating `.env.local`:

```bash
NEXT_PUBLIC_DEFAULT_LOCALE=sk  # Options: sk, cs, en
```

### URL Structure

URLs automatically adapt based on the locale:

- Slovak (default): `/` → `https://app.meditalk.com/`
- Czech: `/cs` → `https://app.meditalk.com/cs`
- English: `/en` → `https://app.meditalk.com/en`

Example pages:

- Slovak: `/dashboard` (no prefix needed)
- Czech: `/cs/dashboard`
- English: `/en/dashboard`

## Usage

### 1. Using Translations in Server Components

```tsx
import { useTranslations } from "next-intl";

export default function ServerComponent() {
  const t = useTranslations("common");

  return (
    <div>
      <h1>{t("appName")}</h1>
      <p>{t("loading")}</p>
    </div>
  );
}
```

### 2. Using Translations in Client Components

```tsx
"use client";

import { useTranslations } from "next-intl";

export default function ClientComponent() {
  const t = useTranslations("auth");

  return <button>{t("signIn")}</button>;
}
```

### 3. Getting Current Locale

```tsx
import { useLocale } from "next-intl";

export default function Component() {
  const locale = useLocale(); // 'sk', 'cs', or 'en'

  return <div>Current language: {locale}</div>;
}
```

### 4. Adding the Language Switcher

```tsx
import { LanguageSwitcher } from "@/components/language-switcher";

export default function Header() {
  return (
    <header>
      <LanguageSwitcher />
    </header>
  );
}
```

### 5. Formatting Dates and Numbers

```tsx
import { useFormatter } from "next-intl";

export default function Component() {
  const format = useFormatter();

  return (
    <div>
      {/* Date formatting */}
      {format.dateTime(new Date(), { dateStyle: "long" })}

      {/* Number formatting */}
      {format.number(1234.56, { style: "currency", currency: "EUR" })}
    </div>
  );
}
```

## Adding New Translations

### Step 1: Add to Translation Files

Add your new translation key to all three language files:

**messages/sk.json:**

```json
{
  "appointments": {
    "title": "Vyšetrenia",
    "create": "Vytvoriť vyšetrenie"
  }
}
```

**messages/cs.json:**

```json
{
  "appointments": {
    "title": "Vyšetření",
    "create": "Vytvořit vyšetření"
  }
}
```

**messages/en.json:**

```json
{
  "appointments": {
    "title": "Appointments",
    "create": "Create Appointment"
  }
}
```

### Step 2: Use in Your Component

```tsx
import { useTranslations } from "next-intl";

export default function AppointmentsPage() {
  const t = useTranslations("appointments");

  return (
    <div>
      <h1>{t("title")}</h1>
      <button>{t("create")}</button>
    </div>
  );
}
```

## Framer Marketing Site Integration

To pass language from your Framer marketing site to the Next.js app:

### On Framer:

Set your CTA button links to include the `?lang=` parameter:

- Slovak page: `https://app.meditalk.com?lang=sk`
- Czech page: `https://app.meditalk.com?lang=cs`
- English page: `https://app.meditalk.com?lang=en`

### How It Works:

1. User clicks CTA on Framer marketing site
2. Redirected to app with `?lang=sk` parameter
3. Middleware detects language, sets cookie, redirects to clean URL
4. User sees app in their selected language
5. Language preference persists across sessions via cookie

## Locale Detection Priority

The app detects locale in this order:

1. **Query parameter** (from Framer: `?lang=sk`)
2. **Cookie** (`NEXT_LOCALE` from previous visit)
3. **Accept-Language header** (browser preference)
4. **Default locale** (from `.env.local`)

## Adding New Languages

To add a new language (e.g., Polish):

### Step 1: Create Translation File

Create `messages/pl.json` with all translations.

### Step 2: Update Routing Config

Edit `src/i18n/routing.ts`:

```typescript
export const routing = defineRouting({
  locales: ["sk", "cs", "en", "pl"], // Add 'pl'
  defaultLocale: "sk",
  // ... rest of config
});
```

### Step 3: Update Language Switcher

Edit `src/components/language-switcher.tsx`:

```typescript
const localeNames: Record<Locale, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
  pl: "Polski", // Add Polish
};

const localeFlags: Record<Locale, string> = {
  sk: "🇸🇰",
  cs: "🇨🇿",
  en: "🇬🇧",
  pl: "🇵🇱", // Add Polish
};
```

That's it! The new language is now available.

## TypeScript Support

All translations are type-safe. If you try to use a translation key that doesn't exist, TypeScript will warn you during development.

## Best Practices

1. **Organize translations by feature**: Use namespaces like `common`, `auth`, `dashboard`, `patients`, `medical`
2. **Keep keys descriptive**: Use dot notation for nested structure (e.g., `auth.signIn`, `dashboard.title`)
3. **Avoid hardcoded strings**: Always use translation keys, even for simple text
4. **Test all languages**: Verify that all UI looks correct in SK, CS, and EN
5. **Use plural rules**: For Slovak and Czech, use next-intl's plural formatting

## Medical Terminology

When adding medical terminology, ensure accuracy across all languages:

- **Slovak**: Medical terms often follow Latin roots
- **Czech**: Very similar to Slovak but with slight variations
- **English**: International standard terminology

Consider consulting medical professionals or translators for critical medical content.

## Troubleshooting

### Build Errors

If you get build errors after adding translations:

1. Ensure all translation files have valid JSON syntax
2. Check that all locale files have the same structure
3. Verify imports in your components

### Missing Translations

If translations don't appear:

1. Check that you're using the correct namespace
2. Verify the translation key exists in all locale files
3. Ensure the component is wrapped in `NextIntlClientProvider` (automatically done in layout)

### Language Not Switching

If the language switcher doesn't work:

1. Check browser console for errors
2. Verify cookies are enabled
3. Clear browser cache and cookies
4. Check that the locale is valid in routing config

## Resources

- [next-intl Documentation](https://next-intl-docs.vercel.app/)
- [Next.js Internationalization](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [Intl API (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
