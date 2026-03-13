import { supabaseAdmin } from './supabase';

export interface ModelBreakdown {
  provider: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  total_cost: number;
}

export interface DashboardStats {
  totalCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byModel: ModelBreakdown[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const sb = supabaseAdmin();

  const { data: rows, error } = await sb
    .from('api_usage')
    .select('provider, model, input_tokens, output_tokens, cost_usd');

  if (error || !rows) {
    console.error('[admin] getDashboardStats error:', error?.message);
    return { totalCost: 0, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, byModel: [] };
  }

  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const totalRequests = rows.length;
  const totalInputTokens = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const totalOutputTokens = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0);

  const modelMap = new Map<string, ModelBreakdown>();
  for (const r of rows) {
    const key = `${r.provider}:${r.model}`;
    const existing = modelMap.get(key);
    if (existing) {
      existing.requests++;
      existing.input_tokens += r.input_tokens ?? 0;
      existing.output_tokens += r.output_tokens ?? 0;
      existing.total_cost += Number(r.cost_usd);
    } else {
      modelMap.set(key, {
        provider: r.provider,
        model: r.model,
        requests: 1,
        input_tokens: r.input_tokens ?? 0,
        output_tokens: r.output_tokens ?? 0,
        total_cost: Number(r.cost_usd),
      });
    }
  }

  return {
    totalCost,
    totalRequests,
    totalInputTokens,
    totalOutputTokens,
    byModel: Array.from(modelMap.values()).sort((a, b) => b.total_cost - a.total_cost),
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
    .from('api_usage')
    .select('user_id, cost_usd');

  if (usageError) {
    console.error('[admin] getUsers usage error:', usageError.message);
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

  return authData.users.map((u) => {
    const usage = userUsage.get(u.id) ?? { requests: 0, cost: 0 };
    return {
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      requests: usage.requests,
      total_cost: usage.cost,
    };
  }).sort((a, b) => b.total_cost - a.total_cost);
}

export interface UserUsageRow {
  id: string;
  operation: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
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

export async function getUserDetail(userId: string): Promise<UserDetail> {
  const sb = supabaseAdmin();

  const { data: authData, error: authError } = await sb.auth.admin.getUserById(userId);
  if (authError) throw authError;

  const { data: usageRows, error: usageError } = await sb
    .from('api_usage')
    .select('id, operation, model, provider, input_tokens, output_tokens, cost_usd, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (usageError) {
    console.error('[admin] getUserDetail usage error:', usageError.message);
  }

  const safeRows = usageRows ?? [];
  const totalCost = safeRows.reduce((s, r) => s + Number(r.cost_usd), 0);

  return {
    id: authData.user.id,
    email: authData.user.email ?? '',
    created_at: authData.user.created_at,
    totalCost,
    totalRequests: safeRows.length,
    usage: safeRows.map((r) => ({
      ...r,
      cost_usd: Number(r.cost_usd),
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
    })),
  };
}
