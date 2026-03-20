import Link from "next/link";
import { getUserDetail, getUserEncounters } from "@/lib/queries";
import { formatCost } from "@/lib/pricing";
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
    <div className="max-w-6xl space-y-6">
      <Link
        href="/users"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to users
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{user.email}</h1>
        <p className="text-sm text-muted-foreground">
          Member since {new Date(user.created_at).toLocaleDateString()}
        </p>
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
              {formatCost(totalEncounterCost)}
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
              {totalRequests.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Encounters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {encounters.length.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Encounters</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Date</TableHead>
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
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No encounters yet
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
