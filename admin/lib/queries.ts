import { supabaseAdmin } from "./supabase";

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

  const { data: rows, error } = await sb
    .from("api_usage")
    .select(
      "provider, model, operation, input_tokens, output_tokens, cost_usd, duration_seconds, visit_id",
    );

  if (error || !rows) {
    console.error("[admin] getDashboardStats error:", error?.message);
    return {
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
  }

  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const totalRequests = rows.length;
  const totalInputTokens = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const totalOutputTokens = rows.reduce(
    (s, r) => s + (r.output_tokens ?? 0),
    0,
  );

  // Unique encounters (visit_ids)
  const visitIds = new Set<string>();
  for (const r of rows) {
    if (r.visit_id) visitIds.add(r.visit_id);
  }
  const totalEncounters = visitIds.size;
  const avgCostPerEncounter =
    totalEncounters > 0 ? totalCost / totalEncounters : 0;

  // Total recording minutes (from Scribe transcription duration)
  let totalRecordingSeconds = 0;
  for (const r of rows) {
    if (r.operation === "transcribe" && r.duration_seconds) {
      totalRecordingSeconds += Number(r.duration_seconds);
    }
  }
  const totalRecordingMinutes = totalRecordingSeconds / 60;
  const costPerRecordingMinute =
    totalRecordingMinutes > 0 ? totalCost / totalRecordingMinutes : 0;
  const avgTimePerEncounterSeconds =
    totalEncounters > 0 ? totalRecordingSeconds / totalEncounters : 0;

  // By model
  const modelMap = new Map<string, ModelBreakdown>();
  for (const r of rows) {
    const key = `${r.provider}:${r.model}`;
    const existing = modelMap.get(key);
    if (existing) {
      existing.requests++;
      existing.input_tokens += r.input_tokens ?? 0;
      existing.output_tokens += r.output_tokens ?? 0;
      existing.total_cost += Number(r.cost_usd);
      existing.total_duration_seconds += r.duration_seconds ?? 0;
    } else {
      modelMap.set(key, {
        provider: r.provider,
        model: r.model,
        requests: 1,
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        total_cost: Number(r.cost_usd),
        total_duration_seconds: r.duration_seconds ?? 0,
      });
    }
  }

  // By operation
  const opMap = new Map<string, OperationBreakdown>();
  for (const r of rows) {
    const existing = opMap.get(r.operation);
    if (existing) {
      existing.requests++;
      existing.total_cost += Number(r.cost_usd);
    } else {
      opMap.set(r.operation, {
        operation: r.operation,
        requests: 1,
        total_cost: Number(r.cost_usd),
      });
    }
  }

  return {
    totalCost,
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    totalEncounters,
    avgCostPerEncounter,
    totalRecordingMinutes,
    costPerRecordingMinute,
    avgTimePerEncounterSeconds,
    byModel: Array.from(modelMap.values()).sort(
      (a, b) => b.total_cost - a.total_cost,
    ),
    byOperation: Array.from(opMap.values()).sort(
      (a, b) => b.total_cost - a.total_cost,
    ),
  };
}

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  requests: number;
  total_cost: number;
}

export async function getUsers(): Promise<UserRow[]> {
  const sb = supabaseAdmin();

  // Get all users from auth
  const { data: authData, error: authError } = await sb.auth.admin.listUsers();
  if (authError) throw authError;

  // Get aggregated usage per user
  const { data: usageRows, error: usageError } = await sb
    .from("api_usage")
    .select("user_id, cost_usd");

  if (usageError) {
    console.error("[admin] getUsers usage error:", usageError.message);
  }

  const userUsage = new Map<string, { requests: number; cost: number }>();
  for (const r of usageRows ?? []) {
    const existing = userUsage.get(r.user_id);
    if (existing) {
      existing.requests++;
      existing.cost += Number(r.cost_usd);
    } else {
      userUsage.set(r.user_id, { requests: 1, cost: Number(r.cost_usd) });
    }
  }

  return authData.users
    .map((u) => {
      const usage = userUsage.get(u.id) ?? { requests: 0, cost: 0 };
      return {
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        requests: usage.requests,
        total_cost: usage.cost,
      };
    })
    .sort((a, b) => b.total_cost - a.total_cost);
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

  // Fetch visits
  const { data: visits, error: visitError } = await sb
    .from("visits")
    .select("id, title, patient_name, visit_date, status, user_id")
    .order("visit_date", { ascending: false });

  if (visitError || !visits) {
    console.error("[admin] getEncounters error:", visitError?.message);
    return [];
  }

  // Fetch usage grouped by visit_id
  const { data: usageRows, error: usageError } = await sb
    .from("api_usage")
    .select("visit_id, cost_usd");

  if (usageError) {
    console.error("[admin] getEncounters usage error:", usageError.message);
  }

  const visitUsage = new Map<string, { requests: number; cost: number }>();
  for (const r of usageRows ?? []) {
    if (!r.visit_id) continue;
    const existing = visitUsage.get(r.visit_id);
    if (existing) {
      existing.requests++;
      existing.cost += Number(r.cost_usd);
    } else {
      visitUsage.set(r.visit_id, { requests: 1, cost: Number(r.cost_usd) });
    }
  }

  // Get user emails
  const { data: authData } = await sb.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    emailMap.set(u.id, u.email ?? "");
  }

  return visits.map((v) => {
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
    console.error(
      "[admin] getEncounterDetail usage error:",
      usageError.message,
    );
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

  const { data: visits, error: visitError } = await sb
    .from("visits")
    .select("id, title, patient_name, visit_date, status, user_id")
    .eq("user_id", userId)
    .order("visit_date", { ascending: false });

  if (visitError || !visits) {
    console.error("[admin] getUserEncounters error:", visitError?.message);
    return [];
  }

  const visitIds = visits.map((v) => v.id);

  const { data: usageRows, error: usageError } = await sb
    .from("api_usage")
    .select("visit_id, cost_usd")
    .in("visit_id", visitIds);

  if (usageError) {
    console.error("[admin] getUserEncounters usage error:", usageError.message);
  }

  const visitUsage = new Map<string, { requests: number; cost: number }>();
  for (const r of usageRows ?? []) {
    if (!r.visit_id) continue;
    const existing = visitUsage.get(r.visit_id);
    if (existing) {
      existing.requests++;
      existing.cost += Number(r.cost_usd);
    } else {
      visitUsage.set(r.visit_id, { requests: 1, cost: Number(r.cost_usd) });
    }
  }

  return visits.map((v) => {
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

  const { data: authData, error: authError } =
    await sb.auth.admin.getUserById(userId);
  if (authError) throw authError;

  const { data: usageRows, error: usageError } = await sb
    .from("api_usage")
    .select(
      "id, operation, model, provider, input_tokens, output_tokens, cost_usd, duration_seconds, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (usageError) {
    console.error("[admin] getUserDetail usage error:", usageError.message);
  }

  const safeRows = usageRows ?? [];
  const totalCost = safeRows.reduce((s, r) => s + Number(r.cost_usd), 0);

  return {
    id: authData.user.id,
    email: authData.user.email ?? "",
    created_at: authData.user.created_at,
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

// ── Templates ──────────────────────────────────────────────────────

import type { TemplateRow as FullTemplateRow } from "./template-types";

export interface TemplateRow {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  specialties: string[];
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
      "id, name, description, specialties, sections, is_system, visible, sort_order, created_at",
    )
    .order("sort_order");

  if (error || !data) {
    console.error("[admin] getTemplates error:", error?.message);
    return [];
  }

  return data as TemplateRow[];
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
