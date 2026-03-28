import Link from "next/link";
import { getUsers } from "@/lib/queries";
import { formatCost } from "@/lib/pricing";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import { DeleteUserDialog } from "@/components/delete-user-dialog";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const users = await getUsers();

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <InviteUserDialog />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Email
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Signed Up
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Last Active
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Requests
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Total Cost
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/users/${u.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {u.email}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {u.last_sign_in_at
                    ? new Date(u.last_sign_in_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.requests.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-medium">
                  {formatCost(u.total_cost)}
                </td>
                <td className="px-2 py-3 text-center">
                  <DeleteUserDialog userId={u.id} email={u.email} />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
