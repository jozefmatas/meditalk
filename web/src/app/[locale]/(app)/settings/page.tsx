"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/nav/app-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useImpersonation } from "@/components/admin/impersonation-context";

interface UserEntry {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function SettingsPage() {
  const t = useTranslations("nav");
  const { isAdmin, isImpersonating, target, startImpersonating } =
    useImpersonation();
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    fetch("/api/admin/impersonate")
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [isAdmin]);

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("settings")}
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Language / Jazyk / Jazyk</CardTitle>
          </CardHeader>
          <CardContent>
            <LanguageSwitcher />
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Admin: User Impersonation</CardTitle>
            </CardHeader>
            <CardContent>
              {isImpersonating && target && (
                <p className="mb-4 text-sm text-amber-600">
                  Currently viewing as: {target.name || target.email}
                </p>
              )}
              {loadingUsers ? (
                <p className="text-sm text-muted-foreground">
                  Loading users...
                </p>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startImpersonating(user.id)}
                      >
                        View as
                      </Button>
                    </div>
                  ))}
                  {users.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No users found.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
