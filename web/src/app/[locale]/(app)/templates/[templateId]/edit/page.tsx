"use client";

import { useState, useEffect, use } from "react";
import { AppShell } from "@/components/nav/app-shell";
import { TemplateEditor } from "@/components/templates/template-editor";
import { Skeleton } from "@/components/shared/skeleton";
import type { Template } from "@/lib/templates/types";

interface EditPageProps {
  params: Promise<{ templateId: string }>;
}

interface InsightsData {
  exampleNotes: { text: string; uploadedAt: string }[];
  styleGuide: string | null;
}

export default function EditTemplatePage({ params }: EditPageProps) {
  const { templateId } = use(params);
  const [template, setTemplate] = useState<Template | null>(null);
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [templateRes, insightsRes] = await Promise.all([
          fetch(`/api/templates/${templateId}`),
          fetch(`/api/templates/${templateId}/insights`),
        ]);

        if (templateRes.ok) {
          setTemplate(await templateRes.json());
        }

        if (insightsRes.ok) {
          const data = await insightsRes.json();
          setInsights({
            exampleNotes: (data.example_notes || []).map(
              (n: { text: string; uploaded_at: string }) => ({
                text: n.text,
                uploadedAt: n.uploaded_at,
              }),
            ),
            styleGuide: data.style_guide || null,
          });
        }
      } catch {
        // Error loading template
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [templateId]);

  return (
    <AppShell>
      {isLoading ? (
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : template ? (
        <TemplateEditor
          template={template}
          insights={insights ?? undefined}
        />
      ) : (
        <p className="text-muted-foreground">Template not found</p>
      )}
    </AppShell>
  );
}
