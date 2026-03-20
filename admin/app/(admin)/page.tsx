import { getDashboardStats } from "@/lib/queries";
import {
  formatCost,
  formatDuration,
  formatTokens,
  modelLabel,
} from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Cost" value={formatCost(stats.totalCost)} />
        <StatCard
          label="Total Requests"
          value={stats.totalRequests.toLocaleString()}
        />
        <StatCard
          label="Input Tokens"
          value={formatTokens(stats.totalInputTokens)}
        />
        <StatCard
          label="Output Tokens"
          value={formatTokens(stats.totalOutputTokens)}
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">By Model</h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Provider
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Model
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Requests
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Input Tokens
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Output Tokens
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.byModel.map((m) => {
                const isDuration = m.total_duration_seconds > 0;
                return (
                  <tr
                    key={`${m.provider}:${m.model}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 capitalize">{m.provider}</td>
                    <td className="px-4 py-3">{modelLabel(m.model)}</td>
                    <td className="px-4 py-3 text-right">
                      {m.requests.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDuration
                        ? formatDuration(m.total_duration_seconds)
                        : formatTokens(m.input_tokens)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDuration ? "—" : formatTokens(m.output_tokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCost(m.total_cost)}
                    </td>
                  </tr>
                );
              })}
              {stats.byModel.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No usage data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
