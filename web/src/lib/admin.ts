import { serverEnv } from "@/lib/env/server";

/**
 * Check whether an email address belongs to a designated admin user.
 * Admin emails are defined in the ADMIN_EMAILS env var (comma-separated).
 */
export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const adminEmails = serverEnv.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.toLowerCase());
}

export const IMPERSONATE_COOKIE = "x-impersonate-user-id";
