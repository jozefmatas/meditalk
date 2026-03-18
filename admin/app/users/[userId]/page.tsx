import Link from 'next/link';
import { getUserDetail, getUserEncounters } from '@/lib/queries';
import { formatCost } from '@/lib/pricing';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const [user, encounters] = await Promise.all([
    getUserDetail(userId),
    getUserEncounters(userId),
  ]);

  const totalEncounterCost = encounters.reduce((s, e) => s + e.total_cost, 0);
  const totalRequests = encounters.reduce((s, e) => s + e.requests, 0);

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
        <StatCard label="Total Cost" value={formatCost(totalEncounterCost)} />
        <StatCard label="Total Requests" value={totalRequests.toLocaleString()} />
        <StatCard label="Encounters" value={encounters.length.toLocaleString()} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">Encounters</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Patient</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
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
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No encounters yet
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
