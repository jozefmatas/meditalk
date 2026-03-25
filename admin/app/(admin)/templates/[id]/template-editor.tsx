"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { nanoid } from "nanoid";
import {
  ChevronRight,
  Copy,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  TemplateRow,
  TemplateSection,
  Locale,
} from "@/lib/template-types";
import { PRIMARY_LOCALE } from "@/lib/template-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SpecialtyCombobox } from "@/components/specialty-combobox";
import { LocaleCombobox } from "@/components/locale-combobox";

// ── Analysis types ──────────────────────────────────────────────────

interface AnalyzedSection {
  label: string;
  context: string;
  subsections?: { label: string; context: string }[];
}

interface AnalysisResult {
  extractedText: string;
  sections: AnalyzedSection[];
  styleGuide: string;
}

// ── Default system prompt (with {{variables}} for interpolation) ────

const DEFAULT_SYSTEM_PROMPT = `You are a medical documentation assistant. You MUST follow these rules strictly:

1. INSUFFICIENT CONTEXT CHECK: Before generating, assess whether the provided input contains enough meaningful clinical information (symptoms, findings, diagnoses, treatments, etc.) to produce a useful medical note. If the input is too vague, too short, or lacks any real clinical content (e.g. just a greeting, a single word, or unrelated text), return ONLY this exact JSON: {"insufficient_context": true}. Do NOT attempt to generate a note from insufficient input.

2. STRICT GROUNDING: Only use information explicitly present in the provided transcript chunks, uploaded file contents, and doctor's notes. Do NOT infer, assume, estimate, or hallucinate any medical facts. If a value (age, duration, measurement, dosage, etc.) is not explicitly stated, do NOT guess — omit it entirely.

3. OUTPUT LANGUAGE: Write ALL content exclusively in {{language}}. This includes section content, the patient letter, and the encounter title. The only exceptions are established Latin/international medical terminology (e.g. "status praesens", "per os") and proper nouns (drug brand names, institution names). Do not mix languages.

4. MISSING SECTIONS: If a section or subsection has no relevant information from the source material, output an empty string "" for that key. Do NOT write placeholder text like "Not stated" or "Neuvedené" — just use "".

5. FORMATTING: Use bullet points (starting with "- ") for lists of diagnoses, ICD codes, medications, and action items — they are much easier to scan. For diagnoses/ICD codes, put the code first, then the name (e.g. "- I10 Esenciálna hypertenzia"). For plans and recommendations, use one bullet per action. Narrative sections (history, examination findings) should remain as flowing prose paragraphs — do not bullet-ify everything.

6. FORMAT: Return valid JSON with the following keys:
   - One key for each section ID listed below, with the section content as a string value (or "" if no information).
   - A "letter" key with a patient-friendly summary letter.
   - A "title" key with a short encounter title (max 6 words) summarizing the main reason for the visit in {{language}}. Example: "Kontrola krvného tlaku" or "Acute back pain consultation".

TEMPLATE SECTIONS (fill each one, or "" if no relevant information):
{{sections}}
{{styleGuide}}`;

// ── ID generators ───────────────────────────────────────────────────

function generateSectionId(): string {
  return `s_${nanoid(10)}`;
}

// ── Immutable section operations ────────────────────────────────────

function addHeader(
  sections: TemplateSection[],
  locale: string,
): TemplateSection[] {
  return [...sections, { id: generateSectionId(), labels: { [locale]: "" } }];
}

function addSubsection(
  sections: TemplateSection[],
  parentIndex: number,
  locale: string,
): TemplateSection[] {
  return sections.map((s, i) => {
    if (i !== parentIndex) return s;
    return {
      ...s,
      subsections: [
        ...(s.subsections || []),
        { id: generateSectionId(), labels: { [locale]: "" } },
      ],
    };
  });
}

function deleteSection(
  sections: TemplateSection[],
  topIndex: number,
  subIndex?: number,
): TemplateSection[] {
  if (subIndex === undefined) {
    return sections.filter((_, i) => i !== topIndex);
  }
  return sections.map((s, i) => {
    if (i !== topIndex) return s;
    return {
      ...s,
      subsections: s.subsections?.filter((_, j) => j !== subIndex),
    };
  });
}

function updateSectionField(
  sections: TemplateSection[],
  topIndex: number,
  subIndex: number | undefined,
  updater: (s: TemplateSection) => TemplateSection,
): TemplateSection[] {
  if (subIndex === undefined) {
    return sections.map((s, i) => (i === topIndex ? updater(s) : s));
  }
  return sections.map((s, i) => {
    if (i !== topIndex) return s;
    return {
      ...s,
      subsections: s.subsections?.map((sub, j) =>
        j === subIndex ? updater(sub) : sub,
      ),
    };
  });
}

// ── Collect translatable texts ──────────────────────────────────────

function collectTexts(
  name: Record<string, string>,
  description: Record<string, string>,
  sections: TemplateSection[],
  locale: string,
): Record<string, string> {
  const texts: Record<string, string> = {};
  texts["__name__"] = name[locale] ?? "";
  texts["__desc__"] = description[locale] ?? "";
  for (const s of sections) {
    texts[s.id] = s.labels[locale] ?? "";
    for (const sub of s.subsections ?? []) {
      texts[sub.id] = sub.labels[locale] ?? "";
    }
  }
  return texts;
}

// ── Merge translations into data ────────────────────────────────────

function mergeTranslations(
  name: Record<string, string>,
  description: Record<string, string>,
  sections: TemplateSection[],
  translations: Record<string, Record<string, string>>,
): {
  name: Record<string, string>;
  description: Record<string, string>;
  sections: TemplateSection[];
} {
  const newName = { ...name };
  const newDesc = { ...description };

  for (const [locale, t] of Object.entries(translations)) {
    if ("__name__" in t) newName[locale] = t["__name__"];
    if ("__desc__" in t) newDesc[locale] = t["__desc__"];
  }

  function applySectionLabels(secs: TemplateSection[]): TemplateSection[] {
    return secs.map((s) => {
      const merged: Record<string, string> = { ...s.labels };
      for (const [locale, t] of Object.entries(translations)) {
        if (s.id in t) merged[locale] = t[s.id];
      }
      return {
        ...s,
        labels: merged,
        subsections: s.subsections
          ? applySectionLabels(s.subsections)
          : s.subsections,
      };
    });
  }

  return {
    name: newName,
    description: newDesc,
    sections: applySectionLabels(sections),
  };
}

// ── Section row component (sortable) ────────────────────────────────

function SectionRow({
  section,
  level,
  locale,
  topIndex,
  subIndex,
  onUpdateLabel,
  onUpdateContext,
  onDelete,
  onAddSub,
}: {
  section: TemplateSection;
  level: 2 | 3;
  locale: string;
  topIndex: number;
  subIndex: number | undefined;
  onUpdateLabel: (
    topIndex: number,
    subIndex: number | undefined,
    locale: string,
    value: string,
  ) => void;
  onUpdateContext: (
    topIndex: number,
    subIndex: number | undefined,
    value: string,
  ) => void;
  onDelete: (topIndex: number, subIndex: number | undefined) => void;
  onAddSub?: () => void;
}) {
  const [showContext, setShowContext] = useState(!!section.context);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-col gap-1.5 border-b border-border bg-background py-2.5 last:border-0",
        level === 3 && "ml-8",
        isDragging && "z-50 opacity-80 shadow-lg",
      )}
    >
      <div className="flex items-center gap-1.5">
        {/* Drag handle */}
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>

        {/* Level badge */}
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold",
            level === 2
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          H{level}
        </span>

        {/* Label input */}
        <Input
          value={section.labels[locale] ?? ""}
          onChange={(e) =>
            onUpdateLabel(topIndex, subIndex, locale, e.target.value)
          }
          placeholder={
            (locale !== "sk" && section.labels.sk) ||
            (level === 2
              ? `Section name (${locale.toUpperCase()})`
              : `Subsection name (${locale.toUpperCase()})`)
          }
          className="flex-1"
        />

        {/* ID badge */}
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {section.id}
        </span>

        {/* Context toggle */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowContext((prev) => !prev)}
          className={cn(showContext && "text-primary")}
          title="AI context"
        >
          <ChevronRight
            className={cn("transition-transform", showContext && "rotate-90")}
          />
        </Button>

        {/* Add subheader */}
        {onAddSub && (
          <Button variant="ghost" size="xs" onClick={onAddSub}>
            <Plus /> Add subheader
          </Button>
        )}

        {/* Delete */}
        <Button
          variant="destructive"
          size="icon-xs"
          onClick={() => {
            const subCount = section.subsections?.length ?? 0;
            const label =
              section.labels[locale] || section.labels.sk || "section";
            const msg =
              subCount > 0
                ? `Delete "${label}" and its ${subCount} subsection(s)?`
                : `Delete "${label}"?`;
            if (confirm(msg)) onDelete(topIndex, subIndex);
          }}
        >
          <Trash2 />
        </Button>
      </div>

      {/* Context textarea (collapsible) */}
      {showContext && (
        <textarea
          value={section.context ?? ""}
          onChange={(e) => onUpdateContext(topIndex, subIndex, e.target.value)}
          placeholder="AI context — What should go in this section? (e.g. 'Auscultation findings, murmurs, rhythm')"
          rows={2}
          className="ml-10 w-[calc(100%-2.5rem)] resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
    </div>
  );
}

// ── Main editor component ───────────────────────────────────────────

export function TemplateEditor({ initialData }: { initialData: TemplateRow }) {
  const [editLocale, setEditLocale] = useState<Locale>(PRIMARY_LOCALE);
  const [name, setName] = useState(initialData.name);
  const [description, setDescription] = useState(initialData.description);
  const [specialties, setSpecialties] = useState(initialData.specialties);
  const [locales, setLocales] = useState(initialData.locales);
  const [sections, setSections] = useState<TemplateSection[]>(
    initialData.sections,
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialData.system_prompt ?? "",
  );
  const [styleGuide, setStyleGuide] = useState(initialData.style_guide ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(
    null,
  );
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const styleGuideRef = useRef<HTMLTextAreaElement>(null);
  const refNoteInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textareas to hug content
  const resizeTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea(promptRef.current);
  }, [systemPrompt, resizeTextarea]);

  useEffect(() => {
    resizeTextarea(styleGuideRef.current);
  }, [styleGuide, resizeTextarea]);

  // ── Guard editLocale — reset if current locale is removed ──

  useEffect(() => {
    if (!locales.includes(editLocale)) {
      setEditLocale((locales[0] as Locale) ?? PRIMARY_LOCALE);
    }
  }, [locales, editLocale]);

  // ── Handle locale changes — auto-translate when a locale is added ──

  const handleLocalesChange = useCallback(
    async (newLocales: string[]) => {
      const added = newLocales.filter((l) => !locales.includes(l));
      setLocales(newLocales);

      if (added.length === 0) return;

      // Determine source locale for translation
      const textsFromEdit = collectTexts(
        name,
        description,
        sections,
        editLocale,
      );
      const editHasContent = Object.values(textsFromEdit).some((v) => v.trim());
      const sourceLocale = editHasContent ? editLocale : PRIMARY_LOCALE;
      const texts = editHasContent
        ? textsFromEdit
        : collectTexts(name, description, sections, PRIMARY_LOCALE);
      const hasTexts = Object.values(texts).some((v) => v.trim());

      if (!hasTexts) return;

      setTranslating(true);
      try {
        const translateRes = await fetch("/api/templates/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts, sourceLocale, targetLocales: added }),
        });

        if (translateRes.ok) {
          const { translations } = await translateRes.json();
          const merged = mergeTranslations(
            name,
            description,
            sections,
            translations,
          );
          setName(merged.name);
          setDescription(merged.description);
          setSections(merged.sections);
        }
      } finally {
        setTranslating(false);
      }
    },
    [locales, name, description, sections, editLocale],
  );

  // ── Reference note upload + analysis ──

  function applyAnalysis(result: AnalysisResult, mode: "both" | "style_only") {
    // Add blank lines between bullets for readability
    const formatted = result.styleGuide.replace(/\n- /g, "\n\n- ");
    setStyleGuide(formatted);

    if (mode === "both") {
      const newSections: TemplateSection[] = result.sections.map((s) => ({
        id: generateSectionId(),
        labels: { [editLocale]: s.label },
        context: s.context,
        subsections: s.subsections?.map((sub) => ({
          id: generateSectionId(),
          labels: { [editLocale]: sub.label },
          context: sub.context,
        })),
      }));
      setSections(newSections);
    }

    setShowAnalysisDialog(false);
    setAnalysisResult(null);
  }

  async function handleReferenceUpload(file: File) {
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/templates/analyze-note", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Analysis failed");
        return;
      }

      const result: AnalysisResult = await res.json();
      setAnalysisResult(result);

      if (sections.length > 0) {
        setShowAnalysisDialog(true);
      } else {
        applyAnalysis(result, "both");
      }
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Dirty tracking ──

  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify({
      name: initialData.name,
      description: initialData.description,
      specialties: initialData.specialties,
      locales: initialData.locales,
      sections: initialData.sections,
      system_prompt: initialData.system_prompt ?? "",
      style_guide: initialData.style_guide ?? "",
    }),
  );

  const isDirty = useMemo(
    () =>
      JSON.stringify({
        name,
        description,
        specialties,
        locales,
        sections,
        system_prompt: systemPrompt,
        style_guide: styleGuide,
      }) !== savedSnapshot,
    [
      name,
      description,
      specialties,
      locales,
      sections,
      systemPrompt,
      styleGuide,
      savedSnapshot,
    ],
  );

  // Unsaved changes dialog state
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const pendingNavUrl = useRef<string | null>(null);

  // Browser tab close / refresh — native dialog (can't be customized)
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Client-side navigation — intercept link clicks
  useEffect(() => {
    if (!isDirty) return;

    function handleClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("http")) return;
      e.preventDefault();
      e.stopPropagation();
      pendingNavUrl.current = href;
      setShowLeaveDialog(true);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isDirty]);

  function handleConfirmLeave() {
    setShowLeaveDialog(false);
    const url = pendingNavUrl.current;
    pendingNavUrl.current = null;
    if (url) {
      window.location.href = url;
    }
  }

  // ── Section operations ──

  const handleUpdateLabel = useCallback(
    (
      topIndex: number,
      subIndex: number | undefined,
      locale: string,
      value: string,
    ) => {
      setSections((prev) =>
        updateSectionField(prev, topIndex, subIndex, (s) => ({
          ...s,
          labels: { ...s.labels, [locale]: value },
        })),
      );
    },
    [],
  );

  const handleUpdateContext = useCallback(
    (topIndex: number, subIndex: number | undefined, value: string) => {
      setSections((prev) =>
        updateSectionField(prev, topIndex, subIndex, (s) => ({
          ...s,
          context: value || undefined,
        })),
      );
    },
    [],
  );

  const handleDelete = useCallback(
    (topIndex: number, subIndex: number | undefined) => {
      setSections((prev) => deleteSection(prev, topIndex, subIndex));
    },
    [],
  );

  // ── Save (with auto-translate) ──

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    try {
      // 1. Auto-translate — use editing locale as source, fall back to SK if empty
      const textsFromEdit = collectTexts(
        name,
        description,
        sections,
        editLocale,
      );
      const editHasContent = Object.values(textsFromEdit).some((v) => v.trim());
      const sourceLocale = editHasContent ? editLocale : PRIMARY_LOCALE;
      const texts = editHasContent
        ? textsFromEdit
        : collectTexts(name, description, sections, PRIMARY_LOCALE);
      const hasTexts = Object.values(texts).some((v) => v.trim());

      let finalName = name;
      let finalDesc = description;
      let finalSections = sections;

      const saveTargetLocales = locales.filter((l) => l !== sourceLocale);

      if (hasTexts && saveTargetLocales.length > 0) {
        const translateRes = await fetch("/api/templates/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts,
            sourceLocale,
            targetLocales: saveTargetLocales,
          }),
        });

        if (translateRes.ok) {
          const { translations } = await translateRes.json();
          const merged = mergeTranslations(
            name,
            description,
            sections,
            translations,
          );
          finalName = merged.name;
          finalDesc = merged.description;
          finalSections = merged.sections;

          // Update local state with translations
          setName(finalName);
          setDescription(finalDesc);
          setSections(finalSections);
        } else {
          console.error(
            "[template-editor] translate failed:",
            translateRes.status,
            await translateRes.text(),
          );
        }
      }

      // 2. Save to DB
      const body = {
        name: finalName,
        description: finalDesc,
        specialties,
        locales,
        sections: finalSections,
        system_prompt:
          !systemPrompt.trim() ||
          systemPrompt.trim() === DEFAULT_SYSTEM_PROMPT.trim()
            ? null
            : systemPrompt.trim(),
        style_guide: styleGuide.trim() || null,
      };
      const res = await fetch(`/api/templates/${initialData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSavedSnapshot(
          JSON.stringify({
            name: finalName,
            description: finalDesc,
            specialties,
            locales,
            sections: finalSections,
            system_prompt: systemPrompt,
            style_guide: styleGuide,
          }),
        );
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Duplicate ──

  async function handleDuplicate() {
    if (!confirm("Duplicate this template?")) return;
    setDuplicating(true);
    const res = await fetch("/api/templates/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceTemplateId: initialData.id }),
    });
    if (res.ok) {
      const { id } = await res.json();
      window.location.href = `/templates/${id}`;
    }
    setDuplicating(false);
  }

  // ── Delete template ──

  async function handleDeleteTemplate() {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeleting(true);
    const res = await fetch(`/api/templates/${initialData.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      window.location.href = "/templates";
    }
    setDeleting(false);
  }

  // ── Drag-and-drop ──

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleTopDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSections((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const handleSubDragEnd = useCallback(
    (topIndex: number) => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setSections((prev) => {
        const parent = prev[topIndex];
        if (!parent.subsections) return prev;
        const oldIndex = parent.subsections.findIndex(
          (s) => s.id === active.id,
        );
        const newIndex = parent.subsections.findIndex((s) => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return prev.map((s, i) =>
          i === topIndex
            ? {
                ...s,
                subsections: arrayMove(s.subsections!, oldIndex, newIndex),
              }
            : s,
        );
      });
    },
    [],
  );

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">
            {name[editLocale] || name[PRIMARY_LOCALE] || "Untitled template"}
          </h1>
          <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {initialData.id}
          </span>
          {initialData.is_system && (
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              System
            </span>
          )}

          {/* Locale picker — only show selected locales */}
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg border border-border">
              {locales.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setEditLocale(l as Locale)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium uppercase transition-colors first:rounded-l-lg last:rounded-r-lg",
                    l === editLocale
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {translating && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDuplicate}
            disabled={duplicating}
          >
            {duplicating ? <Loader2 className="animate-spin" /> : <Copy />}
            Duplicate
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteTemplate}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving..." : saved ? "Saved!" : "Save"}
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Metadata + Sections */}
        <div className="space-y-5">
          <div className="rounded-lg border border-border p-4 space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Metadata
            </h2>

            <div className="space-y-1.5">
              <Label>Name ({editLocale.toUpperCase()})</Label>
              <Input
                value={name[editLocale] ?? ""}
                onChange={(e) =>
                  setName((prev) => ({
                    ...prev,
                    [editLocale]: e.target.value,
                  }))
                }
                placeholder={
                  editLocale !== "sk" ? name.sk || undefined : undefined
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Description ({editLocale.toUpperCase()})</Label>
              <textarea
                value={description[editLocale] ?? ""}
                onChange={(e) =>
                  setDescription((prev) => ({
                    ...prev,
                    [editLocale]: e.target.value,
                  }))
                }
                placeholder={
                  editLocale !== "sk" ? description.sk || undefined : undefined
                }
                rows={3}
                className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Specialties</Label>
              <SpecialtyCombobox
                value={specialties}
                onChange={setSpecialties}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Locales</Label>
              <LocaleCombobox value={locales} onChange={handleLocalesChange} />
            </div>
          </div>

          {/* Section editor */}
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Sections ({sections.length} headers,{" "}
                {sections.reduce(
                  (sum, s) => sum + (s.subsections?.length ?? 0),
                  0,
                )}{" "}
                subheaders)
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={analyzing}
                  onClick={() => refNoteInputRef.current?.click()}
                >
                  {analyzing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}
                  {analyzing ? "Analyzing..." : "Upload reference note"}
                </Button>
                <input
                  ref={refNoteInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0])
                      handleReferenceUpload(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSections((prev) => addHeader(prev, editLocale))
                  }
                >
                  <Plus /> Add header
                </Button>
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTopDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-border">
                  {sections.map((section, topIndex) => (
                    <div key={section.id}>
                      <SectionRow
                        section={section}
                        level={2}
                        locale={editLocale}
                        topIndex={topIndex}
                        subIndex={undefined}
                        onUpdateLabel={handleUpdateLabel}
                        onUpdateContext={handleUpdateContext}
                        onDelete={handleDelete}
                        onAddSub={() =>
                          setSections((prev) =>
                            addSubsection(prev, topIndex, editLocale),
                          )
                        }
                      />
                      {section.subsections &&
                        section.subsections.length > 0 && (
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleSubDragEnd(topIndex)}
                          >
                            <SortableContext
                              items={section.subsections.map((s) => s.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {section.subsections.map((sub, subIndex) => (
                                <SectionRow
                                  key={sub.id}
                                  section={sub}
                                  level={3}
                                  locale={editLocale}
                                  topIndex={topIndex}
                                  subIndex={subIndex}
                                  onUpdateLabel={handleUpdateLabel}
                                  onUpdateContext={handleUpdateContext}
                                  onDelete={handleDelete}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        )}
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {sections.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sections yet. Click &ldquo;Add header&rdquo; to start.
              </p>
            )}
          </div>
        </div>

        {/* Right: System prompt + Style guide */}
        <div className="space-y-6">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                System Prompt
              </h2>
              {systemPrompt !== DEFAULT_SYSTEM_PROMPT && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                  className="h-6 text-xs text-muted-foreground"
                >
                  Reset to default
                </Button>
              )}
            </div>
            <textarea
              ref={promptRef}
              value={systemPrompt || DEFAULT_SYSTEM_PROMPT}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full resize-none overflow-hidden rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p className="text-xs text-muted-foreground">
              Variables interpolated at generation time:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {"{{sections}}"}
              </code>{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {"{{language}}"}
              </code>{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {"{{languageCode}}"}
              </code>{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {"{{styleGuide}}"}
              </code>
            </p>
          </div>

          {/* Writing Style Guide */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-muted-foreground">
                Writing Style Guide
              </h2>
              {styleGuide && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStyleGuide("")}
                  className="h-6 text-xs text-muted-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
            {styleGuide ? (
              <textarea
                ref={styleGuideRef}
                value={styleGuide}
                onChange={(e) => setStyleGuide(e.target.value)}
                className="w-full resize-none overflow-hidden rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No style guide yet. Upload a reference note to auto-generate
                one, or write your own.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Analysis result dialog */}
      <Dialog open={showAnalysisDialog} onOpenChange={setShowAnalysisDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reference Note Analyzed</DialogTitle>
            <DialogDescription>
              This template already has {sections.length} section
              {sections.length !== 1 && "s"}. How would you like to apply the
              analysis?
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm">
            <p>
              <strong>Detected:</strong> {analysisResult?.sections.length}{" "}
              sections, writing style analyzed.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() =>
                analysisResult && applyAnalysis(analysisResult, "style_only")
              }
            >
              Keep structure, apply style only
            </Button>
            <Button
              onClick={() =>
                analysisResult && applyAnalysis(analysisResult, "both")
              }
            >
              Override structure + apply style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved changes dialog */}
      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes have not been saved. Are you sure you want to leave
              this page?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmLeave}
            >
              Yes, leave without saving
            </AlertDialogAction>
            <AlertDialogCancel>No, keep editing</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
