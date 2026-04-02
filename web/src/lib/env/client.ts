/**
 * Type-safe access to NEXT_PUBLIC_* environment variables.
 *
 * These are inlined by webpack at build time as string literals, so they
 * MUST be accessed as literal `process.env.NEXT_PUBLIC_X` expressions.
 * Zod runtime validation won't work on the client (process.env is empty).
 */

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "",
  NEXT_PUBLIC_DEFAULT_LOCALE: (process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim() ||
    "sk") as "sk" | "cs" | "en",
  NEXT_PUBLIC_ENABLE_ERUDA: process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true",
} as const;

if (!clientEnv.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
}
if (!clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
}
