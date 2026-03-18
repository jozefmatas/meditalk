import Link from 'next/link';
import { getEncounterDetail } from '@/lib/queries';
import { formatCost, formatDuration, formatTokens, modelLabel } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export default async function EncounterDetailPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  const { encounterId } = await params;
  const encounter = await getEncounterDetail(encounterId);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href={`/users/${encounter.user_id}`} className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to {encounter.user_email || 'user'}
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{encounter.title || 'Untitled Encounter'}</h1>
      <div className="mb-6 flex flex-wrap gap-x-4 text-sm text-muted-foreground">
        {encounter.patient_name && <span>Patient: {encounter.patient_name}</span>}
        <span>{new Date(encounter.visit_date).toLocaleDateString()}</span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{encounter.status}</span>
        <span>{encounter.user_email}</span>
      </div>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <StatCard label="Total Cost" value={formatCost(encounter.totalCost)} />
        <StatCard label="Total Requests" value={encounter.totalRequests.toLocaleString()} />
        <StatCard label="Encounter ID" value={encounter.id.slice(0, 8) + '...'} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">API Calls</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Operation</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Model</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Input</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Output</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
            </tr>
          </thead>
          <tbody>
            {encounter.usage.map((r) => {
              const isDuration = r.duration_seconds != null && r.duration_seconds > 0;
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                      {r.operation}
                    </span>
                  </td>
                  <td className="px-4 py-3">{modelLabel(r.model)}</td>
                  <td className="px-4 py-3 text-right">
                    {isDuration ? formatDuration(r.duration_seconds!) : formatTokens(r.input_tokens)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isDuration ? '—' : formatTokens(r.output_tokens)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCost(r.cost_usd)}</td>
                </tr>
              );
            })}
            {encounter.usage.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No API calls for this encounter
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
