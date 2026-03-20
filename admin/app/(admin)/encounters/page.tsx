import Link from "next/link";
import { getEncounters } from "@/lib/queries";
import { formatCost } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function EncountersPage() {
  const encounters = await getEncounters();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Encounters</h1>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Title
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Patient
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Date
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                User
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Requests
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr
                key={e.id}
                className="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/encounters/${e.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {e.title || "Untitled"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {e.patient_name || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(e.visit_date).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {e.user_email}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                    {e.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {e.requests.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatCost(e.total_cost)}
                </td>
              </tr>
            ))}
            {encounters.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No encounters found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
