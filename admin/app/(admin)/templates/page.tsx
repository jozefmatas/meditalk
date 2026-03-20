"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  specialties: string[];
  sections: { id: string; subsections?: unknown[] }[];
  is_system: boolean;
  visible: boolean;
  sort_order: number;
  system_prompt: string | null;
  style_examples: unknown[];
}

function countSections(
  sections: { id: string; subsections?: unknown[] }[],
): number {
  let count = 0;
  for (const s of sections) {
    count++;
    if (Array.isArray(s.subsections)) {
      count += s.subsections.length;
    }
  }
  return count;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/templates");
        if (res.ok) {
          setTemplates(await res.json());
        }
      } catch {
        // Silently fail
      } finally {
        setIsLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  async function toggleVisibility(id: string, currentVisible: boolean) {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: !currentVisible }),
      });

      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, visible: !currentVisible } : t,
          ),
        );
      }
    } catch {
      // Silently fail
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Templates</h1>
        <p className="text-sm text-muted-foreground">
          Manage system and custom templates. Toggle visibility to control what
          users see.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Sections</TableHead>
              <TableHead>Prompt</TableHead>
              <TableHead>Style Examples</TableHead>
              <TableHead className="text-center">Visible</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell className="text-center">
                    <Skeleton className="mx-auto h-5 w-10" />
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))}
            {!isLoading &&
              templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant={t.is_system ? "default" : "secondary"}>
                      {t.is_system ? "System" : "Custom"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {countSections(t.sections)}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {t.system_prompt ? "Custom" : "Default"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {t.style_examples?.length || 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={t.visible}
                      onCheckedChange={() => toggleVisibility(t.id, t.visible)}
                      disabled={togglingId === t.id}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/templates/${t.id}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Edit
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && templates.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  No templates found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
