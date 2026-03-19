"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { Input } from "@/components/shared/input";
import { Textarea } from "@/components/shared/textarea";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import {
  SectionEditor,
  editorSectionsToNested,
  nestedToEditorSections,
  type EditorSection,
} from "./section-editor";
import { SpecialtySelect } from "./specialty-select";
import { ExampleNotesPanel } from "./example-notes-panel";
import type { Template } from "@/lib/templates/types";

interface ExampleNote {
  text: string;
  uploadedAt: string;
}

interface TemplateEditorProps {
  /** Pass a template for edit mode. Omit for create mode. */
  template?: Template;
  /** Pre-loaded insights for the template (example notes, style guide) */
  insights?: {
    exampleNotes: ExampleNote[];
    styleGuide: string | null;
  };
}

export function TemplateEditor({ template, insights }: TemplateEditorProps) {
  const t = useTranslations("templateEditor");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const getHref = useLocalizedHref();
  const isEditMode = !!template;

  const [name, setName] = React.useState(template?.name ?? "");
  const [description, setDescription] = React.useState(
    template?.description ?? "",
  );
  const [specialties, setSpecialties] = React.useState<string[]>(
    template?.specialties ?? [],
  );
  const [sections, setSections] = React.useState<EditorSection[]>(() => {
    if (template) {
      return nestedToEditorSections(template.sections);
    }
    return [];
  });
  const [exampleNotes, setExampleNotes] = React.useState<ExampleNote[]>(
    insights?.exampleNotes ?? [],
  );
  const [styleGuide, setStyleGuide] = React.useState<string | null>(
    insights?.styleGuide ?? null,
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [isGeneratingSections, setIsGeneratingSections] = React.useState(false);
  const [isAnalyzingStyle, setIsAnalyzingStyle] = React.useState(false);

  const handleAutoGenerateSections = async (
    text: string,
  ): Promise<EditorSection[]> => {
    setIsGeneratingSections(true);
    try {
      const res = await fetch("/api/templates/analyze-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error("Failed to analyze notes");

      const data = await res.json();
      const generated = nestedToEditorSections(data.sections);
      setSections(generated);
      return generated;
    } catch {
      toast.error(t("error"));
      return [];
    } finally {
      setIsGeneratingSections(false);
    }
  };

  const analyzeStyle = async (notes: ExampleNote[]) => {
    if (notes.length === 0) return;
    setIsAnalyzingStyle(true);
    try {
      const res = await fetch("/api/templates/analyze-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: notes.map((n) => n.text).join("\n\n---\n\n"),
          analyzeStyle: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.styleGuide) {
          setStyleGuide(data.styleGuide);
        }
      }
    } catch {
      // Style analysis is non-critical
    } finally {
      setIsAnalyzingStyle(false);
    }
  };

  const handleNotesChange = (notes: ExampleNote[]) => {
    setExampleNotes(notes);
    // Auto-analyze style when notes are added
    if (notes.length > 0 && notes.length > exampleNotes.length) {
      analyzeStyle(notes);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }

    const nonEmptySections = sections.filter((s) => s.label.trim());
    if (nonEmptySections.length === 0) {
      toast.error(t("sectionsRequired"));
      return;
    }

    setIsSaving(true);
    try {
      const nestedSections = editorSectionsToNested(nonEmptySections);
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        specialties,
        sections: nestedSections,
      };

      const url = isEditMode
        ? `/api/templates/${template!.id}`
        : "/api/templates";
      const method = isEditMode ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save template");
      }

      const saved = await res.json();

      // Save insights (example notes + style guide) if we have any
      if (exampleNotes.length > 0 || styleGuide) {
        const templateId = saved.id || template?.id;
        if (templateId) {
          await fetch(`/api/templates/${templateId}/insights`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              exampleNotes: exampleNotes.map((n) => ({
                text: n.text,
                uploaded_at: n.uploadedAt,
              })),
              styleGuide,
            }),
          }).catch(() => {
            // Insights save is non-critical
          });
        }
      }

      toast.success(isEditMode ? t("updated") : t("created"));
      router.push(getHref("/"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isEditMode ? t("editTitle") : t("createTitle")}
      </h1>

      {/* Name */}
      <div className="space-y-2">
        <label htmlFor="template-name" className="text-sm font-medium">
          {t("name")}
        </label>
        <Input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <label htmlFor="template-description" className="text-sm font-medium">
          {t("description")}
        </label>
        <Textarea
          id="template-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="min-h-20"
        />
      </div>

      {/* Specialties */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("specialties")}</label>
        <SpecialtySelect
          value={specialties}
          onChange={setSpecialties}
        />
      </div>

      <hr className="border-border" />

      {/* Sections */}
      <SectionEditor sections={sections} onChange={setSections} />

      <hr className="border-border" />

      {/* Example Notes */}
      <ExampleNotesPanel
        notes={exampleNotes}
        onNotesChange={handleNotesChange}
        styleGuide={styleGuide}
        onAutoGenerateSections={handleAutoGenerateSections}
        isGeneratingSections={isGeneratingSections}
        isAnalyzingStyle={isAnalyzingStyle}
      />

      <hr className="border-border" />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              className="animate-spin"
            />
          )}
          {isSaving
            ? isEditMode
              ? t("saving")
              : t("creating")
            : isEditMode
              ? t("save")
              : t("create")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(getHref("/"))}
        >
          {tCommon("cancel")}
        </Button>
      </div>
    </div>
  );
}
