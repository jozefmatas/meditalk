import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  ELEVENLABS_API_KEY: z.string().min(1, "ELEVENLABS_API_KEY is required"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("MediTalk <team@meditalk.ai>"),
  ADMIN_EMAILS: z.string().default(""),
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

export const serverEnv: ServerEnv = process.env.VITEST
  ? ({} as ServerEnv)
  : validateServerEnv();
