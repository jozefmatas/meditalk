import Link from 'next/link';
import { getDashboardStats, getUsers, getEncounters } from '@/lib/queries';
import { formatCost, formatDuration, formatTokens, modelLabel } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab ?? 'dashboard';

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">MediTalk Admin</h1>

      <div className="mb-6 flex gap-2">
        <TabLink label="Dashboard" value="dashboard" active={tab} />
        <TabLink label="Users" value="users" active={tab} />
        <TabLink label="Encounters" value="encounters" active={tab} />
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'encounters' && <EncountersTab />}
    </div>
  );
}

function TabLink({ label, value, active }: { label: string; value: string; active: string }) {
  const isActive = active === value;
  return (
    <Link
      href={`/?tab=${value}`}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );
}

async function DashboardTab() {
  const stats = await getDashboardStats();

  return (
    <>
      <div className="mb-8 grid grid-cols-4 gap-4">
        <StatCard label="Total Cost" value={formatCost(stats.totalCost)} />
        <StatCard label="Total Requests" value={stats.totalRequests.toLocaleString()} />
        <StatCard label="Input Tokens" value={formatTokens(stats.totalInputTokens)} />
        <StatCard label="Output Tokens" value={formatTokens(stats.totalOutputTokens)} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">By Model</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Provider</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Model</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Requests</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Input Tokens</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Output Tokens</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
            </tr>
          </thead>
          <tbody>
            {stats.byModel.map((m) => {
              const isDuration = m.total_duration_seconds > 0;
              return (
                <tr key={`${m.provider}:${m.model}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 capitalize">{m.provider}</td>
                  <td className="px-4 py-3">{modelLabel(m.model)}</td>
                  <td className="px-4 py-3 text-right">{m.requests.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {isDuration ? formatDuration(m.total_duration_seconds) : formatTokens(m.input_tokens)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isDuration ? '—' : formatTokens(m.output_tokens)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCost(m.total_cost)}</td>
                </tr>
              );
            })}
            {stats.byModel.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No usage data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function UsersTab() {
  const users = await getUsers();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Signed Up</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Active</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Requests</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link href={`/users/${u.id}`} className="text-primary underline-offset-4 hover:underline">
                  {u.email}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(u.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : '—'}
              </td>
              <td className="px-4 py-3 text-right">{u.requests.toLocaleString()}</td>
              <td className="px-4 py-3 text-right font-medium">{formatCost(u.total_cost)}</td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

async function EncountersTab() {
  const encounters = await getEncounters();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Requests</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
          </tr>
        </thead>
        <tbody>
          {encounters.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link href={`/encounters/${e.id}`} className="text-primary underline-offset-4 hover:underline">
                  {e.title || 'Untitled'}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{e.patient_name || '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(e.visit_date).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{e.user_email}</td>
              <td className="px-4 py-3">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                  {e.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right">{e.requests.toLocaleString()}</td>
              <td className="px-4 py-3 text-right font-medium">{formatCost(e.total_cost)}</td>
            </tr>
          ))}
          {encounters.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                No encounters found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
