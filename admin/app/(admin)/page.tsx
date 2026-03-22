import { getDashboardStats } from "@/lib/queries";
import {
  formatCost,
  formatDuration,
  formatTokens,
  modelLabel,
} from "@/lib/pricing";

export const dynamic = "force-dynamic";

const OPERATION_LABELS: Record<string, string> = {
  generate_template: "Note Generation",
  reformat_template: "Note Reformat",
  clinical_analysis: "Clinical Analysis",
  ocr_image: "Image OCR",
  ocr_pdf: "PDF OCR",
  embed: "Embeddings",
  transcribe: "Transcription",
};

function opLabel(op: string): string {
  return OPERATION_LABELS[op] || op;
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Key pricing metrics */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard label="Total Cost" value={formatCost(stats.totalCost)} />
        <StatCard
          label="Total Encounters"
          value={(stats.totalEncounters ?? 0).toLocaleString()}
        />
        <StatCard
          label="Avg Cost / Encounter"
          value={formatCost(stats.avgCostPerEncounter ?? 0)}
          highlight
        />
        <StatCard
          label="Avg Time / Encounter"
          value={
            (stats.avgTimePerEncounterSeconds ?? 0) > 0
              ? formatDuration(stats.avgTimePerEncounterSeconds)
              : "—"
          }
          highlight
        />
        <StatCard
          label="Cost / Min of Recording"
          value={
            (stats.totalRecordingMinutes ?? 0) > 0
              ? formatCost(stats.costPerRecordingMinute ?? 0)
              : "—"
          }
          subtitle={
            (stats.totalRecordingMinutes ?? 0) > 0
              ? `${Math.round(stats.totalRecordingMinutes)} min total`
              : undefined
          }
          highlight
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-4">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By Operation */}
        <div>
          <h2 className="mb-3 text-lg font-semibold">By Operation</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Operation
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Requests
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    % of Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.byOperation.map((o) => (
                  <tr
                    key={o.operation}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3">{opLabel(o.operation)}</td>
                    <td className="px-4 py-3 text-right">
                      {o.requests.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCost(o.total_cost)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {stats.totalCost > 0
                        ? `${((o.total_cost / stats.totalCost) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
                {stats.byOperation.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
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

        {/* By Model */}
        <div>
          <h2 className="mb-3 text-lg font-semibold">By Model</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Model
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Requests
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Tokens / Duration
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
                      <td className="px-4 py-3">
                        <div>{modelLabel(m.model)}</div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {m.provider}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {m.requests.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {isDuration
                          ? formatDuration(m.total_duration_seconds)
                          : `${formatTokens(m.input_tokens)} in / ${formatTokens(m.output_tokens)} out`}
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
                      colSpan={4}
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
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  highlight,
}: {
  label: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
