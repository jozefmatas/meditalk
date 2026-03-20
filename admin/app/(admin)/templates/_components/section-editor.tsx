"use client";

import React, { useCallback, useState } from "react";
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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getSectionLabel,
  type SectionLocale,
} from "@/lib/constants/section-labels";

interface Section {
  id: string;
  labelKey: string;
  labels?: Partial<Record<SectionLocale, string>>;
  context?: string;
  subsections?: Section[];
}

interface SectionEditorProps {
  sections: Section[];
  onChange: (sections: Section[]) => void;
  locale: SectionLocale;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Resolve display label: per-locale labels → i18n fallback → raw labelKey */
function getLabel(section: Section, locale: SectionLocale): string {
  return section.labels?.[locale] || getSectionLabel(section.labelKey, locale);
}

// ── Sortable row ────────────────────────────────────────────────────

function SortableRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      {children}
    </div>
  );
}

// ── Main editor ─────────────────────────────────────────────────────

export function SectionEditor({
  sections,
  onChange,
  locale,
}: SectionEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Track which section's subsection list is being reordered
  const [activeParent, setActiveParent] = useState<number | null>(null);

  // Track in-progress editing so we don't slugify while typing
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const addSection = useCallback(() => {
    const idx = sections.length + 1;
    onChange([
      ...sections,
      { id: `section_${idx}`, labelKey: `section_${idx}` },
    ]);
  }, [sections, onChange]);

  const removeSection = useCallback(
    (index: number) => {
      onChange(sections.filter((_, i) => i !== index));
    },
    [sections, onChange],
  );

  const updateSection = useCallback(
    (index: number, update: Partial<Section>) => {
      onChange(
        sections.map((s, i) => (i === index ? { ...s, ...update } : s)),
      );
    },
    [sections, onChange],
  );

  const addSubsection = useCallback(
    (parentIndex: number) => {
      const parent = sections[parentIndex];
      const subs = parent.subsections || [];
      const idx = subs.length + 1;
      updateSection(parentIndex, {
        subsections: [
          ...subs,
          {
            id: `${parent.id}_sub_${idx}`,
            labelKey: `${parent.id}_sub_${idx}`,
          },
        ],
      });
    },
    [sections, updateSection],
  );

  const removeSubsection = useCallback(
    (parentIndex: number, subIndex: number) => {
      const parent = sections[parentIndex];
      const subs = (parent.subsections || []).filter((_, i) => i !== subIndex);
      updateSection(parentIndex, {
        subsections: subs.length > 0 ? subs : undefined,
      });
    },
    [sections, updateSection],
  );

  const updateSubsection = useCallback(
    (parentIndex: number, subIndex: number, update: Partial<Section>) => {
      const parent = sections[parentIndex];
      const subs = (parent.subsections || []).map((s, i) =>
        i === subIndex ? { ...s, ...update } : s,
      );
      updateSection(parentIndex, { subsections: subs });
    },
    [sections, updateSection],
  );

  // Focus: start editing with the displayed label
  const startEditing = useCallback(
    (fieldId: string, displayValue: string) => {
      setEditingField(fieldId);
      setEditingValue(displayValue);
    },
    [],
  );

  // Blur: store label for current locale, slugify only the id
  const commitSectionLabel = useCallback(
    (index: number) => {
      const label = editingValue.trim();
      if (!label) {
        setEditingField(null);
        return;
      }
      const section = sections[index];
      const labels = { ...section.labels, [locale]: label };
      // Only update id/labelKey if this is the first label being set
      const hasExistingLabel = section.labels && Object.values(section.labels).some(Boolean);
      const updates: Partial<Section> = { labels };
      if (!hasExistingLabel) {
        updates.id = slugify(label) || `section_${index + 1}`;
        updates.labelKey = label;
      }
      updateSection(index, updates);
      setEditingField(null);
    },
    [sections, editingValue, locale, updateSection],
  );

  const commitSubLabel = useCallback(
    (parentIndex: number, subIndex: number) => {
      const label = editingValue.trim();
      if (!label) {
        setEditingField(null);
        return;
      }
      const parent = sections[parentIndex];
      const sub = (parent.subsections || [])[subIndex];
      if (!sub) {
        setEditingField(null);
        return;
      }
      const labels = { ...sub.labels, [locale]: label };
      const hasExistingLabel = sub.labels && Object.values(sub.labels).some(Boolean);
      const updates: Partial<Section> = { labels };
      if (!hasExistingLabel) {
        updates.id = slugify(label) || `${parent.id}_sub_${subIndex + 1}`;
        updates.labelKey = label;
      }
      const subs = (parent.subsections || []).map((s, i) =>
        i === subIndex ? { ...s, ...updates } : s,
      );
      updateSection(parentIndex, { subsections: subs });
      setEditingField(null);
    },
    [sections, editingValue, locale, updateSection],
  );

  // Handle top-level section reorder
  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex(
      (_, i) => `section-${i}` === active.id,
    );
    const newIndex = sections.findIndex((_, i) => `section-${i}` === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = [...sections];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onChange(next);
  }

  // Handle subsection reorder within a parent
  function handleSubDragEnd(parentIndex: number, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const parent = sections[parentIndex];
    const subs = [...(parent.subsections || [])];

    const oldIndex = subs.findIndex(
      (_, i) => `sub-${parentIndex}-${i}` === active.id,
    );
    const newIndex = subs.findIndex(
      (_, i) => `sub-${parentIndex}-${i}` === over.id,
    );
    if (oldIndex === -1 || newIndex === -1) return;

    const [moved] = subs.splice(oldIndex, 1);
    subs.splice(newIndex, 0, moved);
    updateSection(parentIndex, { subsections: subs });
    setActiveParent(null);
  }

  const sectionIds = sections.map((_, i) => `section-${i}`);

  return (
    <div className="space-y-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={sectionIds}
          strategy={verticalListSortingStrategy}
        >
          {sections.map((section, si) => {
            const localizedLabel = getLabel(section, locale);
            const subIds = (section.subsections || []).map(
              (_, i) => `sub-${si}-${i}`,
            );

            return (
              <div key={`section-${si}`}>
                {/* Top-level section (H2) */}
                <SortableRow id={`section-${si}`}>
                  <div className="flex flex-1 items-center gap-1.5 rounded-md border bg-card p-2">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      H2
                    </span>
                    <Input
                      autoComplete="off"
                      value={
                        editingField === `section-${si}`
                          ? editingValue
                          : localizedLabel
                      }
                      onFocus={() =>
                        startEditing(`section-${si}`, localizedLabel)
                      }
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => commitSectionLabel(si)}
                      placeholder="Section name"
                      className="h-7 flex-1 text-sm"
                    />
                    <span
                      className="shrink-0 max-w-32 truncate rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono"
                      title={section.id}
                    >
                      {section.id}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => addSubsection(si)}
                      >
                        <PlusIcon className="size-3.5" />
                        Add H3
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeSection(si)}
                        className="text-destructive hover:text-destructive"
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </SortableRow>

                {/* AI context hint */}
                <div className="ml-7 mt-0.5 pl-2">
                  <Input
                    value={section.context || ""}
                    onChange={(e) =>
                      updateSection(si, {
                        context: e.target.value || undefined,
                      })
                    }
                    placeholder="AI context (e.g. 'Personal medical history — past diagnoses, surgeries, hospitalizations')"
                    className="h-6 border-none bg-transparent px-1.5 text-xs text-muted-foreground italic placeholder:text-muted-foreground/50 focus-visible:ring-0"
                  />
                </div>

                {/* Subsections (H3) — separate DndContext per parent */}
                {section.subsections && section.subsections.length > 0 && (
                  <div className="ml-8 mt-1 space-y-1">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragStart={() => setActiveParent(si)}
                      onDragEnd={(e) => handleSubDragEnd(si, e)}
                    >
                      <SortableContext
                        items={subIds}
                        strategy={verticalListSortingStrategy}
                      >
                        {section.subsections.map((sub, subi) => {
                          const subLabel = getLabel(sub, locale);
                          return (
                            <SortableRow
                              key={`sub-${si}-${subi}`}
                              id={`sub-${si}-${subi}`}
                            >
                              <div className="flex flex-1 items-center gap-1.5 rounded-md border border-dashed bg-card p-2">
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                  H3
                                </span>
                                <Input
                                  autoComplete="off"
                                  value={
                                    editingField === `sub-${si}-${subi}`
                                      ? editingValue
                                      : subLabel
                                  }
                                  onFocus={() =>
                                    startEditing(
                                      `sub-${si}-${subi}`,
                                      subLabel,
                                    )
                                  }
                                  onChange={(e) =>
                                    setEditingValue(e.target.value)
                                  }
                                  onBlur={() => commitSubLabel(si, subi)}
                                  placeholder="Subsection name"
                                  className="h-7 flex-1 text-sm"
                                />
                                <span
                                  className="shrink-0 max-w-32 truncate rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono"
                                  title={sub.id}
                                >
                                  {sub.id}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => removeSubsection(si, subi)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <TrashIcon className="size-3.5" />
                                </Button>
                              </div>
                              <div className="ml-7 mt-0.5">
                                <Input
                                  value={sub.context || ""}
                                  onChange={(e) =>
                                    updateSubsection(si, subi, {
                                      context: e.target.value || undefined,
                                    })
                                  }
                                  placeholder="AI context..."
                                  className="h-6 border-none bg-transparent px-1.5 text-xs text-muted-foreground italic placeholder:text-muted-foreground/50 focus-visible:ring-0"
                                />
                              </div>
                            </SortableRow>
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </div>
            );
          })}
        </SortableContext>
      </DndContext>

      <Button
        variant="outline"
        size="sm"
        onClick={addSection}
        className="mt-2 w-full"
      >
        <PlusIcon className="mr-1.5 size-3.5" />
        Add section
      </Button>

    </div>
  );
}
