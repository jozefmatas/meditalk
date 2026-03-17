import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // Wait for the locale from the request (trim to guard against env-var whitespace)
  let locale = (await requestLocale)?.trim();

  // Validate that the incoming locale is valid
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  // Load messages for the locale
  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Failed to load messages for locale: ${locale}`, error);
    // Fallback to default locale messages
    messages = (await import(`../../messages/${routing.defaultLocale}.json`))
      .default;
  }

  return {
    locale,
    messages,
    // Optional: Configure time zone
    // timeZone: 'Europe/Bratislava',
    // Optional: Configure now for consistent date/time in Server Components
    // now: new Date(),
  };
});
