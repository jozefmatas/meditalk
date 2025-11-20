'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { useTransition } from 'react';

const localeNames: Record<Locale, string> = {
  sk: 'Slovenčina',
  cs: 'Čeština',
  en: 'English',
};

const localeFlags: Record<Locale, string> = {
  sk: '🇸🇰',
  cs: '🇨🇿',
  en: '🇬🇧',
};

export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLocaleChange = (newLocale: Locale) => {
    // Build path based on whether it's the default locale
    const newPath = newLocale === routing.defaultLocale ? '/' : `/${newLocale}`;

    // Set cookie for persistence
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;

    // Navigate with transition
    startTransition(() => {
      router.push(newPath);
      router.refresh();
    });
  };

  return (
    <div className="relative inline-block">
      <select
        value={locale}
        onChange={(e) => handleLocaleChange(e.target.value as Locale)}
        disabled={isPending}
        className="appearance-none bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-4 py-2 pr-8 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Select language"
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeFlags[loc]} {localeNames[loc]}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-700 dark:text-zinc-300">
        <svg
          className="fill-current h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
        >
          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
        </svg>
      </div>
    </div>
  );
}
