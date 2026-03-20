import Link from "next/link";
import { getUsers } from "@/lib/queries";
import { formatCost } from "@/lib/pricing";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await getUsers();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Signed Up</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link
                    href={`/users/${u.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {u.email}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {u.last_sign_in_at
                    ? new Date(u.last_sign_in_at).toLocaleDateString()
                    : "\u2014"}
                </TableCell>
                <TableCell className="text-right">
                  {u.requests.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCost(u.total_cost)}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
