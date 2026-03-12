"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { getTemplateById } from "@/lib/templates";
import type { TemplateSection } from "@/lib/templates";
import { TemplateSelector } from "@/components/templates/template-selector";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/shared/collapsible";
import { cn } from "@/lib/utils";

interface TemplateSidebarProps {
  templateId: string;
  onTemplateChange: (id: string) => void;
  disabled?: boolean;
  /** Set of section IDs that have generated content (review mode). */
  documentedSections?: Set<string>;
  /** Callback when a section heading should be inserted into the editor (draft mode). */
  onInsertSection?: (sectionId: string, label: string, level: 2 | 3) => void;
  /** Section IDs whose headings already exist in the editor (draft mode). */
  usedSectionIds?: Set<string>;
}

const itemClass =
  "flex h-8 w-full items-center gap-1.5 rounded-lg px-1.5 text-sm transition-colors";

function SectionButton({
  level,
  label,
  isUsed,
  onClick,
}: {
  level: 2 | 3;
  label: string;
  isUsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={isUsed}
      onClick={onClick}
      className={cn(
        itemClass,
        level === 3 && "pl-7",
        isUsed
          ? "text-foreground/30 cursor-default"
          : "text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {isUsed ? (
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            size={14}
            className="text-foreground/30"
          />
        ) : (
          <span className="size-1.5 rounded-full bg-foreground/20" />
        )}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function TemplateSidebar({
  templateId,
  onTemplateChange,
  disabled,
  documentedSections,
  onInsertSection,
  usedSectionIds,
}: TemplateSidebarProps) {
  const tTemplates = useTranslations("templates");
  const t = useTranslations("encounters.detail");
  const template = getTemplateById(templateId);
  const isReview = !!documentedSections;
  const isDraft = !isReview;

  const documented = template?.sections.filter((s) =>
    documentedSections?.has(s.id),
  );
  const remaining = template?.sections.filter(
    (s) => !documentedSections?.has(s.id),
  );

  return (
    <div className="flex w-60 shrink-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-foreground/65">
          {tTemplates("selectTemplate")}
        </span>
        <TemplateSelector
          value={templateId}
          onChange={onTemplateChange}
          disabled={disabled}
        />
      </div>

      {/* Draft mode: sections + collapsible subsections */}
      {template && isDraft && (
        <nav className="flex flex-col">
          {template.sections.map((section) => {
            const sectionLabel = tTemplates(`sections.${section.labelKey}`);
            const isSectionUsed = usedSectionIds?.has(section.id) ?? false;
            const hasSubsections =
              section.subsections && section.subsections.length > 0;

            if (!hasSubsections) {
              return (
                <SectionButton
                  key={section.id}
                  level={2}
                  label={sectionLabel}
                  isUsed={isSectionUsed}
                  onClick={() =>
                    onInsertSection?.(section.id, sectionLabel, 2)
                  }
                />
              );
            }

            return (
              <CollapsibleSection
                key={section.id}
                section={section}
                sectionLabel={sectionLabel}
                isSectionUsed={isSectionUsed}
                usedSectionIds={usedSectionIds}
                onInsertSection={onInsertSection}
                tTemplates={tTemplates}
              />
            );
          })}
        </nav>
      )}

      {/* Review mode: documented + remaining */}
      {template && isReview && (
        <div className="flex flex-col gap-3">
          {documented && documented.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                {t("documented")}
              </span>
              <nav className="flex flex-col">
                {documented.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      size={20}
                      className="shrink-0 text-status-completed"
                    />
                    <span className="truncate">
                      {tTemplates(`sections.${section.labelKey}`)}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          )}

          {documented &&
            documented.length > 0 &&
            remaining &&
            remaining.length > 0 && <div className="h-px bg-border" />}

          {remaining && remaining.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                {t("remaining")}
              </span>
              <nav className="flex flex-col">
                {remaining.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      <span className="size-3.5 rounded-full border border-muted-foreground/30" />
                    </span>
                    <span className="truncate">
                      {tTemplates(`sections.${section.labelKey}`)}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  section,
  sectionLabel,
  isSectionUsed,
  usedSectionIds,
  onInsertSection,
  tTemplates,
}: {
  section: TemplateSection;
  sectionLabel: string;
  isSectionUsed: boolean;
  usedSectionIds?: Set<string>;
  onInsertSection?: (sectionId: string, label: string, level: 2 | 3) => void;
  tTemplates: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);

  // Check if all subsections are used
  const allSubsUsed =
    isSectionUsed &&
    section.subsections?.every((sub) => usedSectionIds?.has(sub.id));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center">
        <CollapsibleTrigger
          className={cn(
            itemClass,
            "group cursor-pointer",
            allSubsUsed
              ? "text-foreground/30"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={14}
              className={cn(
                "transition-transform duration-200",
                open && "rotate-90",
              )}
            />
          </span>
          <span className="truncate">{sectionLabel}</span>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="flex flex-col">
          {/* Section heading button (h2) */}
          <SectionButton
            level={3}
            label={sectionLabel}
            isUsed={isSectionUsed}
            onClick={() => onInsertSection?.(section.id, sectionLabel, 2)}
          />
          {/* Subsection buttons (h3) */}
          {section.subsections?.map((sub) => {
            const subLabel = tTemplates(`sections.${sub.labelKey}`);
            const isSubUsed = usedSectionIds?.has(sub.id) ?? false;
            return (
              <SectionButton
                key={sub.id}
                level={3}
                label={subLabel}
                isUsed={isSubUsed}
                onClick={() => onInsertSection?.(sub.id, subLabel, 3)}
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
