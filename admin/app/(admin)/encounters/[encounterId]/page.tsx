import Link from "next/link";
import { getEncounterDetail } from "@/lib/queries";
import {
  formatCost,
  formatDuration,
  formatTokens,
  modelLabel,
} from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default async function EncounterDetailPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  const { encounterId } = await params;
  const encounter = await getEncounterDetail(encounterId);

  return (
    <div className="max-w-6xl space-y-6">
      <Link
        href={`/users/${encounter.user_id}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to {encounter.user_email || "user"}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">
          {encounter.title || "Untitled Encounter"}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
          {encounter.patient_name && (
            <span>Patient: {encounter.patient_name}</span>
          )}
          <span>{new Date(encounter.visit_date).toLocaleDateString()}</span>
          <Badge variant="secondary">{encounter.status}</Badge>
          <span>{encounter.user_email}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatCost(encounter.totalCost)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {encounter.totalRequests.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Encounter ID
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {encounter.id.slice(0, 8)}...
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">API Calls</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {encounter.usage.map((r) => {
                const isDuration =
                  r.duration_seconds != null && r.duration_seconds > 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.operation}</Badge>
                    </TableCell>
                    <TableCell>{modelLabel(r.model)}</TableCell>
                    <TableCell className="text-right">
                      {isDuration
                        ? formatDuration(r.duration_seconds!)
                        : formatTokens(r.input_tokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isDuration ? "\u2014" : formatTokens(r.output_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCost(r.cost_usd)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {encounter.usage.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No API calls for this encounter
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
