import Link from "next/link";
import { getEncounters } from "@/lib/queries";
import { formatCost } from "@/lib/pricing";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function EncountersPage() {
  const encounters = await getEncounters();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Encounters</h1>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {encounters.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Link
                    href={`/encounters/${e.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {e.title || "Untitled"}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {e.patient_name || "\u2014"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(e.visit_date).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {e.user_email}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{e.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {e.requests.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCost(e.total_cost)}
                </TableCell>
              </TableRow>
            ))}
            {encounters.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  No encounters found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
