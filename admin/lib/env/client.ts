/**
 * Type-safe access to NEXT_PUBLIC_* environment variables.
 *
 * These are inlined by webpack at build time as string literals, so they
 * MUST be accessed as literal `process.env.NEXT_PUBLIC_X` expressions.
 */

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
} as const;

if (!clientEnv.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
}
