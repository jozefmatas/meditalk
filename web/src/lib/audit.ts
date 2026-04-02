import { createAdminClient } from "./supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

export interface AuditEntry {
  actorId: string;
  actorEmail?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  isImpersonation?: boolean;
  targetUserId?: string;
}

/**
 * Fire-and-forget audit log. Never throws, never blocks.
 * Uses admin client to bypass RLS.
 */
export function logAudit(entry: AuditEntry): void {
  const client = createAdminClient();
  if (!client) {
    // Admin client unavailable (missing service role key) — skip silently
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- audit_logs not in generated types until migration is pushed
  (client.from("audit_logs") as any)
    .insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      resource_type: entry.resourceType ?? null,
      resource_id: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
      ip_address: entry.ipAddress ?? null,
      is_impersonation: entry.isImpersonation ?? false,
      target_user_id: entry.targetUserId ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      // Only log errors in development — production fails silently
      if (error && serverEnv.NODE_ENV === "development") {
        logger.error("[audit] Insert failed:", error.message);
      }
    })
    .catch(() => {
      // Network-level fetch failure — silently drop
    });
}

/** Extract client IP from request headers. */
export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Build common audit fields from requireAuth() result + request.
 * Spread into logAudit() calls to avoid repetition.
 */
export function createAuditContext(
  auth: {
    realUserId: string;
    realUserEmail?: string;
    isImpersonating: boolean;
    userId: string;
  },
  request: Request,
) {
  return {
    actorId: auth.realUserId,
    actorEmail: auth.realUserEmail,
    isImpersonation: auth.isImpersonating,
    targetUserId: auth.isImpersonating ? auth.userId : undefined,
    ipAddress: getClientIp(request),
  };
}
