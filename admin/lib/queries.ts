import { supabaseAdmin } from "./supabase";
import { logger } from "@/lib/logger";

export interface ModelBreakdown {
  provider: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
  total_duration_seconds: number;
}

export interface OperationBreakdown {
  operation: string;
  requests: number;
  total_cost: number;
}

export interface DashboardStats {
  totalCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEncounters: number;
  avgCostPerEncounter: number;
  totalRecordingMinutes: number;
  costPerRecordingMinute: number;
  avgTimePerEncounterSeconds: number;
  byModel: ModelBreakdown[];
  byOperation: OperationBreakdown[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const sb = supabaseAdmin();

  const emptyStats: DashboardStats = {
    totalCost: 0,
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEncounters: 0,
    avgCostPerEncounter: 0,
    totalRecordingMinutes: 0,
    costPerRecordingMinute: 0,
    avgTimePerEncounterSeconds: 0,
    byModel: [],
    byOperation: [],
  };

  // Use SQL aggregation (RPCs) to avoid Supabase 1000-row default limit
  const [totalsRes, modelRes, opRes] = await Promise.all([
    sb.rpc("get_dashboard_usage_totals"),
    sb.rpc("aggregate_usage_by_model"),
    sb.rpc("aggregate_usage_by_operation"),
  ]);

  if (totalsRes.error) {
    logger.error(
      "[admin] getDashboardStats totals error:",
      totalsRes.error.message,
    );
    return emptyStats;
  }

  const t = totalsRes.data?.[0];
  if (!t) return emptyStats;

  const totalCost = Number(t.total_cost);
  const totalRequests = Number(t.total_requests);
  const totalEncounters = Number(t.unique_visit_count);
  const totalRecordingSeconds = Number(t.total_recording_seconds);
  const totalRecordingMinutes = totalRecordingSeconds / 60;

  const byModel: ModelBreakdown[] = (modelRes.data ?? []).map(
    (r: Record<string, unknown>) => ({
      provider: String(r.provider),
      model: String(r.model),
      requests: Number(r.requests),
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      total_cost: Number(r.total_cost),
      total_duration_seconds: Number(r.total_duration_seconds),
    }),
  );

  const byOperation: OperationBreakdown[] = (opRes.data ?? []).map(
    (r: Record<string, unknown>) => ({
      operation: String(r.operation),
      requests: Number(r.requests),
      total_cost: Number(r.total_cost),
    }),
  );

  return {
    totalCost,
    totalRequests,
    totalInputTokens: Number(t.total_input_tokens),
    totalOutputTokens: Number(t.total_output_tokens),
    totalEncounters,
    avgCostPerEncounter: totalEncounters > 0 ? totalCost / totalEncounters : 0,
    totalRecordingMinutes,
    costPerRecordingMinute:
      totalRecordingMinutes > 0 ? totalCost / totalRecordingMinutes : 0,
    avgTimePerEncounterSeconds:
      totalEncounters > 0 ? totalRecordingSeconds / totalEncounters : 0,
    byModel,
    byOperation,
  };
}

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_active: string | null;
  requests: number;
  total_cost: number;
}

export async function getUsers(): Promise<UserRow[]> {
  const sb = supabaseAdmin();

  // Fetch auth users and SQL-aggregated usage in parallel
  const [authRes, usageRes] = await Promise.all([
    sb.auth.admin.listUsers(),
    sb.rpc("aggregate_usage_by_user"),
  ]);

  if (authRes.error) throw authRes.error;

  if (usageRes.error) {
    logger.error("[admin] getUsers usage error:", usageRes.error.message);
  }

  const userUsage = new Map<
    string,
    { requests: number; cost: number; lastActive: string | null }
  >();
  for (const r of usageRes.data ?? []) {
    userUsage.set(String(r.user_id), {
      requests: Number(r.requests),
      cost: Number(r.total_cost),
      lastActive: r.last_active ? String(r.last_active) : null,
    });
  }

  return authRes.data.users
    .map((u) => {
      const usage = userUsage.get(u.id) ?? {
        requests: 0,
        cost: 0,
        lastActive: null,
      };
      return {
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at,
        last_active: usage.lastActive,
        requests: usage.requests,
        total_cost: usage.cost,
      };
    })
    .sort((a, b) => {
      const aTime = a.last_active ? new Date(a.last_active).getTime() : 0;
      const bTime = b.last_active ? new Date(b.last_active).getTime() : 0;
      return bTime - aTime;
    });
}

export interface UserUsageRow {
  id: string;
  operation: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_seconds: number | null;
  created_at: string;
}

export interface UserDetail {
  id: string;
  email: string;
  created_at: string;
  totalCost: number;
  totalRequests: number;
  usage: UserUsageRow[];
}

// ── Encounters ──────────────────────────────────────────────────────

export interface EncounterRow {
  id: string;
  title: string | null;
  patient_name: string | null;
  visit_date: string;
  status: string;
  user_email: string;
  user_id: string;
  requests: number;
  total_cost: number;
}

export async function getEncounters(): Promise<EncounterRow[]> {
  const sb = supabaseAdmin();

  // Fetch visits, SQL-aggregated usage, and user emails in parallel
  const [visitRes, usageRes, authRes] = await Promise.all([
    sb
      .from("visits")
      .select("id, title, patient_name, visit_date, status, user_id")
      .order("visit_date", { ascending: false }),
    sb.rpc("aggregate_usage_by_visit"),
    sb.auth.admin.listUsers(),
  ]);

  if (visitRes.error || !visitRes.data) {
    logger.error("[admin] getEncounters error:", visitRes.error?.message);
    return [];
  }

  if (usageRes.error) {
    logger.error("[admin] getEncounters usage error:", usageRes.error.message);
  }

  const visitUsage = new Map<string, { requests: number; cost: number }>();
  for (const r of usageRes.data ?? []) {
    visitUsage.set(String(r.visit_id), {
      requests: Number(r.requests),
      cost: Number(r.total_cost),
    });
  }

  const emailMap = new Map<string, string>();
  for (const u of authRes.data?.users ?? []) {
    emailMap.set(u.id, u.email ?? "");
  }

  return visitRes.data.map((v) => {
    const usage = visitUsage.get(v.id) ?? { requests: 0, cost: 0 };
    return {
      id: v.id,
      title: v.title,
      patient_name: v.patient_name,
      visit_date: v.visit_date,
      status: v.status,
      user_id: v.user_id,
      user_email: emailMap.get(v.user_id) ?? "",
      requests: usage.requests,
      total_cost: usage.cost,
    };
  });
}

export interface EncounterDetail {
  id: string;
  title: string | null;
  patient_name: string | null;
  visit_date: string;
  status: string;
  user_id: string;
  user_email: string;
  totalCost: number;
  totalRequests: number;
  usage: UserUsageRow[];
}

export async function getEncounterDetail(
  encounterId: string,
): Promise<EncounterDetail> {
  const sb = supabaseAdmin();

  const { data: visit, error: visitError } = await sb
    .from("visits")
    .select("id, title, patient_name, visit_date, status, user_id")
    .eq("id", encounterId)
    .single();

  if (visitError || !visit)
    throw visitError ?? new Error("Encounter not found");

  const { data: authData } = await sb.auth.admin.getUserById(visit.user_id);

  const { data: usageRows, error: usageError } = await sb
    .from("api_usage")
    .select(
      "id, operation, model, provider, input_tokens, output_tokens, cost_usd, duration_seconds, created_at",
    )
    .eq("visit_id", encounterId)
    .order("created_at", { ascending: false });

  if (usageError) {
    logger.error("[admin] getEncounterDetail usage error:", usageError.message);
  }

  const safeRows = usageRows ?? [];
  const totalCost = safeRows.reduce((s, r) => s + Number(r.cost_usd), 0);

  return {
    id: visit.id,
    title: visit.title,
    patient_name: visit.patient_name,
    visit_date: visit.visit_date,
    status: visit.status,
    user_id: visit.user_id,
    user_email: authData?.user?.email ?? "",
    totalCost,
    totalRequests: safeRows.length,
    usage: safeRows.map((r) => ({
      ...r,
      cost_usd: Number(r.cost_usd),
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      duration_seconds: r.duration_seconds ?? null,
    })),
  };
}

export async function getUserEncounters(
  userId: string,
): Promise<EncounterRow[]> {
  const sb = supabaseAdmin();

  // Fetch visits and SQL-aggregated usage in parallel
  const [visitRes, usageRes] = await Promise.all([
    sb
      .from("visits")
      .select("id, title, patient_name, visit_date, status, user_id")
      .eq("user_id", userId)
      .order("visit_date", { ascending: false }),
    sb.rpc("aggregate_usage_by_visit"),
  ]);

  if (visitRes.error || !visitRes.data) {
    logger.error("[admin] getUserEncounters error:", visitRes.error?.message);
    return [];
  }

  if (usageRes.error) {
    logger.error(
      "[admin] getUserEncounters usage error:",
      usageRes.error.message,
    );
  }

  const visitUsage = new Map<string, { requests: number; cost: number }>();
  for (const r of usageRes.data ?? []) {
    visitUsage.set(String(r.visit_id), {
      requests: Number(r.requests),
      cost: Number(r.total_cost),
    });
  }

  return visitRes.data.map((v) => {
    const usage = visitUsage.get(v.id) ?? { requests: 0, cost: 0 };
    return {
      id: v.id,
      title: v.title,
      patient_name: v.patient_name,
      visit_date: v.visit_date,
      status: v.status,
      user_id: v.user_id,
      user_email: "",
      requests: usage.requests,
      total_cost: usage.cost,
    };
  });
}

export async function getUserDetail(userId: string): Promise<UserDetail> {
  const sb = supabaseAdmin();

  // Fetch auth, accurate totals (RPC), and recent rows in parallel
  const [authRes, totalsRes, rowsRes] = await Promise.all([
    sb.auth.admin.getUserById(userId),
    sb.rpc("aggregate_usage_by_user"),
    sb
      .from("api_usage")
      .select(
        "id, operation, model, provider, input_tokens, output_tokens, cost_usd, duration_seconds, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (authRes.error) throw authRes.error;

  if (totalsRes.error) {
    logger.error(
      "[admin] getUserDetail totals error:",
      totalsRes.error.message,
    );
  }
  if (rowsRes.error) {
    logger.error("[admin] getUserDetail rows error:", rowsRes.error.message);
  }

  // Find this user's totals from the aggregated results
  const userTotals = (totalsRes.data ?? []).find(
    (r: Record<string, unknown>) => String(r.user_id) === userId,
  );
  const totalCost = userTotals ? Number(userTotals.total_cost) : 0;
  const totalRequests = userTotals ? Number(userTotals.requests) : 0;

  const safeRows = rowsRes.data ?? [];

  return {
    id: authRes.data.user.id,
    email: authRes.data.user.email ?? "",
    created_at: authRes.data.user.created_at,
    totalCost,
    totalRequests,
    usage: safeRows.map((r) => ({
      ...r,
      cost_usd: Number(r.cost_usd),
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      duration_seconds: r.duration_seconds ?? null,
    })),
  };
}

// ── Templates ──────────────────────────────────────────────────────

import type { TemplateRow as FullTemplateRow } from "./template-types";

export interface TemplateRow {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  specialties: string[];
  locales: string[];
  sections: unknown[];
  is_system: boolean;
  visible: boolean;
  sort_order: number;
  created_at: string;
}

export async function getTemplates(): Promise<TemplateRow[]> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("templates")
    .select(
      "id, name, description, specialties, locales, sections, is_system, visible, sort_order, created_at",
    )
    .order("sort_order");

  if (error || !data) {
    logger.error("[admin] getTemplates error:", error?.message);
    return [];
  }

  // Filter out templates with no name (unsaved new templates)
  return (data as TemplateRow[]).filter((t) =>
    Object.values(t.name).some((v) => v.trim()),
  );
}

export async function getTemplateById(
  id: string,
): Promise<FullTemplateRow | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as FullTemplateRow;
}
