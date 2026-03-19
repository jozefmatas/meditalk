"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DragDropVerticalIcon,
  Delete02Icon,
  Add01Icon,
  ArrowUp02Icon,
  ArrowDown02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/shared/button";
import { Input } from "@/components/shared/input";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from "@/components/shared/sortable";

export interface EditorSection {
  id: string;
  label: string;
  level: "header" | "subheader";
  parentId?: string;
}

interface SectionEditorProps {
  sections: EditorSection[];
  onChange: (sections: EditorSection[]) => void;
}

let nextId = 1;
function generateId() {
  return `section_${Date.now()}_${nextId++}`;
}

/**
 * Slugify a label to create a section ID.
 * Falls back to a generated ID if the label produces an empty slug.
 */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug || generateId();
}

export function SectionEditor({ sections, onChange }: SectionEditorProps) {
  const t = useTranslations("templateEditor");

  const addHeader = () => {
    const id = generateId();
    onChange([...sections, { id, label: "", level: "header" }]);
  };

  const addSubheader = (parentId: string) => {
    const id = generateId();
    // Insert right after the last subheader of this parent (or right after the parent)
    const idx = sections.findLastIndex(
      (s) => s.parentId === parentId || s.id === parentId,
    );
    const next = [...sections];
    next.splice(idx + 1, 0, { id, label: "", level: "subheader", parentId });
    onChange(next);
  };

  const updateLabel = (id: string, label: string) => {
    onChange(sections.map((s) => (s.id === id ? { ...s, label } : s)));
  };

  const removeSection = (id: string) => {
    const section = sections.find((s) => s.id === id);
    if (!section) return;

    if (section.level === "header") {
      // Remove header + all its subheaders
      const hasChildren = sections.some((s) => s.parentId === id);
      if (hasChildren && !window.confirm(t("deleteConfirm"))) return;
      onChange(sections.filter((s) => s.id !== id && s.parentId !== id));
    } else {
      onChange(sections.filter((s) => s.id !== id));
    }
  };

  const promote = (id: string) => {
    onChange(
      sections.map((s) =>
        s.id === id
          ? { ...s, level: "header" as const, parentId: undefined }
          : s,
      ),
    );
  };

  const demote = (id: string) => {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;

    // Find nearest header above
    let parentId: string | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (sections[i].level === "header") {
        parentId = sections[i].id;
        break;
      }
    }
    if (!parentId) return; // Can't demote if no header above

    // Move any subheaders of this header to the parent above
    const updated = sections.map((s) => {
      if (s.id === id)
        return { ...s, level: "subheader" as const, parentId };
      if (s.parentId === id) return { ...s, parentId };
      return s;
    });
    onChange(updated);
  };

  // Group sections by header for rendering
  const headerGroups = React.useMemo(() => {
    const groups: {
      header: EditorSection;
      subheaders: EditorSection[];
    }[] = [];

    for (const section of sections) {
      if (section.level === "header") {
        groups.push({ header: section, subheaders: [] });
      } else if (section.level === "subheader" && section.parentId) {
        const group = groups.find((g) => g.header.id === section.parentId);
        if (group) group.subheaders.push(section);
      }
    }

    return groups;
  }, [sections]);

  const handleReorder = (reordered: EditorSection[]) => {
    // Rebuild parent relationships after reorder
    const rebuilt: EditorSection[] = [];
    let currentParent: string | undefined;

    for (const section of reordered) {
      if (section.level === "header") {
        currentParent = section.id;
        rebuilt.push(section);
      } else {
        rebuilt.push({
          ...section,
          parentId: currentParent,
        });
      }
    }

    onChange(rebuilt);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("sections")}</h3>
        <Button type="button" variant="outline" size="sm" onClick={addHeader}>
          <HugeiconsIcon icon={Add01Icon} size={14} />
          {t("addHeader")}
        </Button>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("addHeader")}
        </div>
      ) : (
        <Sortable
          value={sections}
          onValueChange={handleReorder}
          getItemValue={(item) => item.id}
        >
          <SortableContent className="space-y-1">
            {sections.map((section) => (
              <SortableItem
                key={section.id}
                value={section.id}
                asChild
              >
                <div
                  className={`flex items-center gap-1.5 rounded-md border bg-background p-1.5 ${
                    section.level === "subheader" ? "ml-8" : ""
                  }`}
                >
                  <SortableItemHandle asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 cursor-grab p-0"
                    >
                      <HugeiconsIcon
                        icon={DragDropVerticalIcon}
                        size={14}
                        className="text-muted-foreground"
                      />
                    </Button>
                  </SortableItemHandle>

                  <Input
                    value={section.label}
                    onChange={(e) => updateLabel(section.id, e.target.value)}
                    placeholder={
                      section.level === "header"
                        ? t("headerPlaceholder")
                        : t("subheaderPlaceholder")
                    }
                    className="h-7 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                  />

                  {section.level === "subheader" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0"
                      onClick={() => promote(section.id)}
                      title={t("promote")}
                    >
                      <HugeiconsIcon
                        icon={ArrowUp02Icon}
                        size={14}
                        className="text-muted-foreground"
                      />
                    </Button>
                  )}

                  {section.level === "header" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0"
                      onClick={() => demote(section.id)}
                      title={t("demote")}
                    >
                      <HugeiconsIcon
                        icon={ArrowDown02Icon}
                        size={14}
                        className="text-muted-foreground"
                      />
                    </Button>
                  )}

                  {section.level === "header" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-1.5 text-xs text-muted-foreground"
                      onClick={() => addSubheader(section.id)}
                    >
                      <HugeiconsIcon icon={Add01Icon} size={12} />
                      {t("addSubheader")}
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeSection(section.id)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={14} />
                  </Button>
                </div>
              </SortableItem>
            ))}
          </SortableContent>
          <SortableOverlay>
            <div className="h-10 rounded-md border bg-accent/50" />
          </SortableOverlay>
        </Sortable>
      )}
    </div>
  );
}

/**
 * Convert EditorSection[] to the nested Template sections format for API submission.
 */
export function editorSectionsToNested(
  sections: EditorSection[],
): { id: string; label: string; subsections?: { id: string; label: string }[] }[] {
  const result: {
    id: string;
    label: string;
    subsections?: { id: string; label: string }[];
  }[] = [];

  for (const section of sections) {
    if (section.level === "header") {
      const subsections = sections
        .filter((s) => s.parentId === section.id && s.level === "subheader")
        .map((s) => ({
          id: slugify(s.label) || s.id,
          label: s.label,
        }));

      result.push({
        id: slugify(section.label) || section.id,
        label: section.label,
        ...(subsections.length > 0 ? { subsections } : {}),
      });
    }
  }

  return result;
}

/**
 * Convert nested Template sections to flat EditorSection[] for the editor.
 */
export function nestedToEditorSections(
  sections: { id: string; label?: string; labelKey?: string; subsections?: { id: string; label?: string; labelKey?: string }[] }[],
  sectionLabels?: Record<string, string>,
): EditorSection[] {
  const result: EditorSection[] = [];

  for (const section of sections) {
    const headerLabel = section.label || sectionLabels?.[section.labelKey ?? ""] || section.labelKey || section.id;
    result.push({
      id: section.id,
      label: headerLabel,
      level: "header",
    });

    if (section.subsections) {
      for (const sub of section.subsections) {
        const subLabel = sub.label || sectionLabels?.[sub.labelKey ?? ""] || sub.labelKey || sub.id;
        result.push({
          id: sub.id,
          label: subLabel,
          level: "subheader",
          parentId: section.id,
        });
      }
    }
  }

  return result;
}
