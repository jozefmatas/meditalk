import Link from 'next/link';
import { getUserDetail } from '@/lib/queries';
import { formatCost, formatTokens, modelLabel } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const user = await getUserDetail(userId);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/?tab=users" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to users
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{user.email}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Member since {new Date(user.created_at).toLocaleDateString()}
      </p>

      <div className="mb-8 grid grid-cols-3 gap-4">
        <StatCard label="Total Cost" value={formatCost(user.totalCost)} />
        <StatCard label="Total Requests" value={user.totalRequests.toLocaleString()} />
        <StatCard label="User ID" value={user.id.slice(0, 8) + '...'} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">Recent API Calls</h2>
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
            {user.usage.map((r) => (
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
                <td className="px-4 py-3 text-right">{formatTokens(r.input_tokens)}</td>
                <td className="px-4 py-3 text-right">{formatTokens(r.output_tokens)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCost(r.cost_usd)}</td>
              </tr>
            ))}
            {user.usage.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No API calls yet
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
