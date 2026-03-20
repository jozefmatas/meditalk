import { getDashboardStats } from "@/lib/queries";
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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCost(stats.totalCost)}</p>
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
              {stats.totalRequests.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Input Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatTokens(stats.totalInputTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Output Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {formatTokens(stats.totalOutputTokens)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">By Model</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Input Tokens</TableHead>
                <TableHead className="text-right">Output Tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byModel.map((m) => {
                const isDuration = m.total_duration_seconds > 0;
                return (
                  <TableRow key={`${m.provider}:${m.model}`}>
                    <TableCell className="capitalize">{m.provider}</TableCell>
                    <TableCell>{modelLabel(m.model)}</TableCell>
                    <TableCell className="text-right">
                      {m.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {isDuration
                        ? formatDuration(m.total_duration_seconds)
                        : formatTokens(m.input_tokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isDuration ? "\u2014" : formatTokens(m.output_tokens)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCost(m.total_cost)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {stats.byModel.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No usage data yet
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
