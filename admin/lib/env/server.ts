import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required"),
  ADMIN_SESSION_SECRET: z.string().min(1, "ADMIN_SESSION_SECRET is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Exported for testing — accepts an env object parameter. */
export function validateServerEnv(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): ServerEnv {
  const result = serverSchema.safeParse(env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `\n\n❌ Invalid server environment variables:\n${formatted}\n\n` +
        `Copy .env.local.example to .env.local and fill in the values.\n`,
    );
  }

  return result.data;
}

export const serverEnv = validateServerEnv();
