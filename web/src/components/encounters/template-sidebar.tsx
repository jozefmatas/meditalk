"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  ArrowRight01Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import { getTemplateById } from "@/lib/templates";
import type { TemplateSection } from "@/lib/templates";
import { TemplateSelector } from "@/components/templates/template-selector";
import { Button } from "@/components/shared/button";
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
  /** Callback when clicking an already-inserted section to scroll to it. */
  onScrollToSection?: (label: string) => void;
  /** Callback to re-add a removed section (review mode). */
  onAddSection?: (sectionId: string) => void;
  /** Pixel offset from the top of the scroll container for sticky positioning. */
  stickyTop?: number;
}

const itemClass =
  "flex h-8 shrink-0 w-full items-center gap-1.5 rounded-lg px-1.5 text-sm transition-colors";

/* ── Section item (no subsections) ── */

function SectionItem({
  label,
  isUsed,
  onClick,
  onScrollTo,
}: {
  label: string;
  isUsed: boolean;
  onClick: () => void;
  onScrollTo?: () => void;
}) {
  if (isUsed) {
    return (
      <button
        type="button"
        onClick={onScrollTo}
        className={cn(
          itemClass,
          "cursor-pointer text-foreground",
          "[&:hover>span.section-label]:underline [&:hover>span.section-label]:underline-offset-2",
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <HugeiconsIcon
            icon={CheckmarkCircle01Icon}
            size={16}
            className="text-status-completed"
          />
        </span>
        <span className="section-label truncate">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        itemClass,
        "cursor-pointer text-foreground/65 hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <HugeiconsIcon icon={Add01Icon} size={16} />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/* ── Section with subsections ── */

function SectionWithSubs({
  section,
  sectionLabel,
  isSectionUsed,
  usedSectionIds,
  onInsertSection,
  onScrollToSection,
  tTemplates,
}: {
  section: TemplateSection;
  sectionLabel: string;
  isSectionUsed: boolean;
  usedSectionIds?: Set<string>;
  onInsertSection?: (sectionId: string, label: string, level: 2 | 3) => void;
  onScrollToSection?: (label: string) => void;
  tTemplates: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);

  const subCount = section.subsections?.length ?? 0;
  const allSubsUsed =
    isSectionUsed &&
    section.subsections?.every((sub) => usedSectionIds?.has(sub.id));

  // Main item: clicking the text inserts the h2 heading, clicking the chevron toggles subsections
  return (
    <div>
      <div className="flex items-center">
        {/* Clickable label area — inserts heading or scrolls to it */}
        {isSectionUsed ? (
          <button
            type="button"
            onClick={() => onScrollToSection?.(sectionLabel)}
            className={cn(
              itemClass,
              "min-w-0 flex-1 cursor-pointer",
              allSubsUsed ? "text-foreground/30" : "text-foreground",
              "[&:hover>span.section-label]:underline [&:hover>span.section-label]:underline-offset-2",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                size={16}
                className="text-status-completed"
              />
            </span>
            <span className="section-label truncate">{sectionLabel}</span>
            <span className="ml-auto shrink-0 text-xs text-foreground/40">
              {subCount}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onInsertSection?.(section.id, sectionLabel, 2)}
            className={cn(
              itemClass,
              "min-w-0 flex-1 cursor-pointer text-foreground/65 hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <HugeiconsIcon icon={Add01Icon} size={16} />
            </span>
            <span className="truncate">{sectionLabel}</span>
            <span className="ml-auto shrink-0 text-xs text-foreground/40">
              {subCount}
            </span>
          </button>
        )}

        {/* Chevron button — toggles subsections */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen((prev) => !prev)}
          className="shrink-0 text-foreground/40"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            className={cn(
              "transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </Button>
      </div>

      {/* Subsections */}
      {open && (
        <div className="flex flex-col">
          {section.subsections?.map((sub) => {
            const subLabel = tTemplates(`sections.${sub.labelKey}`);
            const isSubUsed = usedSectionIds?.has(sub.id) ?? false;

            if (isSubUsed) {
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onScrollToSection?.(subLabel)}
                  className={cn(
                    itemClass,
                    "cursor-pointer pl-7 text-foreground",
                    "[&:hover>span.section-label]:underline [&:hover>span.section-label]:underline-offset-2",
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      size={16}
                      className="text-status-completed"
                    />
                  </span>
                  <span className="section-label truncate">{subLabel}</span>
                </button>
              );
            }

            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onInsertSection?.(sub.id, subLabel, 3)}
                className={cn(
                  itemClass,
                  "cursor-pointer pl-7 text-foreground/65 hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <HugeiconsIcon icon={Add01Icon} size={16} />
                </span>
                <span className="truncate">{subLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Review-mode section with subsections (passes IDs, not labels) ── */

function ReviewSectionWithSubs({
  section,
  sectionLabel,
  documentedSections,
  onAddSection,
  onScrollToSection,
  tTemplates,
}: {
  section: TemplateSection;
  sectionLabel: string;
  documentedSections?: Set<string>;
  onAddSection?: (sectionId: string) => void;
  onScrollToSection?: (sectionId: string) => void;
  tTemplates: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);

  const isDocumented = documentedSections?.has(section.id) ?? false;
  const subCount = section.subsections?.length ?? 0;
  const documentedSubCount =
    section.subsections?.filter((sub) => documentedSections?.has(sub.id))
      .length ?? 0;
  const allSubsDocumented = isDocumented && documentedSubCount === subCount;

  return (
    <div>
      <div className="flex items-center">
        {isDocumented ? (
          <button
            type="button"
            onClick={() => onScrollToSection?.(section.id)}
            className={cn(
              itemClass,
              "min-w-0 flex-1 cursor-pointer",
              allSubsDocumented ? "text-foreground/30" : "text-foreground",
              "[&:hover>span.section-label]:underline [&:hover>span.section-label]:underline-offset-2",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <HugeiconsIcon
                icon={CheckmarkCircle01Icon}
                size={16}
                className="text-status-completed"
              />
            </span>
            <span className="section-label truncate">{sectionLabel}</span>
            <span className="ml-auto shrink-0 text-xs text-foreground/40">
              {documentedSubCount}/{subCount}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAddSection?.(section.id)}
            className={cn(
              itemClass,
              "min-w-0 flex-1 cursor-pointer text-foreground/65 hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <HugeiconsIcon icon={Add01Icon} size={16} />
            </span>
            <span className="truncate">{sectionLabel}</span>
            <span className="ml-auto shrink-0 text-xs text-foreground/40">
              {documentedSubCount}/{subCount}
            </span>
          </button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen((prev) => !prev)}
          className="shrink-0 text-foreground/40"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={16}
            className={cn(
              "transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col">
          {section.subsections?.map((sub) => {
            const subLabel = tTemplates(`sections.${sub.labelKey}`);
            const isSubDocumented = documentedSections?.has(sub.id) ?? false;

            if (isSubDocumented) {
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onScrollToSection?.(sub.id)}
                  className={cn(
                    itemClass,
                    "cursor-pointer pl-7 text-foreground",
                    "[&:hover>span.section-label]:underline [&:hover>span.section-label]:underline-offset-2",
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <HugeiconsIcon
                      icon={CheckmarkCircle01Icon}
                      size={16}
                      className="text-status-completed"
                    />
                  </span>
                  <span className="section-label truncate">{subLabel}</span>
                </button>
              );
            }

            return (
              <button
                key={sub.id}
                type="button"
                onClick={() => onAddSection?.(sub.id)}
                className={cn(
                  itemClass,
                  "cursor-pointer pl-7 text-foreground/65 hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <HugeiconsIcon icon={Add01Icon} size={16} />
                </span>
                <span className="truncate">{subLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TemplateSidebar({
  templateId,
  onTemplateChange,
  disabled,
  documentedSections,
  onInsertSection,
  usedSectionIds,
  onScrollToSection,
  onAddSection,
  stickyTop = 0,
}: TemplateSidebarProps) {
  const tTemplates = useTranslations("templates");
  const t = useTranslations("encounters.detail");
  const template = getTemplateById(templateId);
  const isReview = !!documentedSections;
  const isDraft = !isReview;

  return (
    <div
      className={cn(
        "flex w-60 shrink-0 flex-col gap-3 overflow-hidden",
        isDraft ? "min-h-0" : "sticky self-start",
      )}
      style={
        isDraft
          ? undefined
          : { top: stickyTop, maxHeight: `calc(100svh - ${stickyTop + 52}px)` }
      }
    >
      {/* Review mode: template selector header */}
      {isReview && (
        <TemplateSelector
          value={templateId}
          onChange={onTemplateChange}
          disabled={disabled}
          size="lg"
          label={t("templateLabel")}
        />
      )}

      {/* Draft mode: sections with plus icons */}
      {template && isDraft && (
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {template.sections.map((section) => {
            const sectionLabel = tTemplates(`sections.${section.labelKey}`);
            const isSectionUsed = usedSectionIds?.has(section.id) ?? false;
            const hasSubsections =
              section.subsections && section.subsections.length > 0;

            if (!hasSubsections) {
              return (
                <SectionItem
                  key={section.id}
                  label={sectionLabel}
                  isUsed={isSectionUsed}
                  onClick={() => onInsertSection?.(section.id, sectionLabel, 2)}
                  onScrollTo={() => onScrollToSection?.(sectionLabel)}
                />
              );
            }

            return (
              <SectionWithSubs
                key={section.id}
                section={section}
                sectionLabel={sectionLabel}
                isSectionUsed={isSectionUsed}
                usedSectionIds={usedSectionIds}
                onInsertSection={onInsertSection}
                onScrollToSection={onScrollToSection}
                tTemplates={tTemplates}
              />
            );
          })}
        </nav>
      )}

      {/* Review mode: same layout as draft — checkmarks for documented, + for remaining */}
      {template && isReview && (
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {template.sections.map((section) => {
            const sectionLabel = tTemplates(`sections.${section.labelKey}`);
            const isDocumented = documentedSections?.has(section.id) ?? false;
            const hasSubsections =
              section.subsections && section.subsections.length > 0;

            if (!hasSubsections) {
              return (
                <SectionItem
                  key={section.id}
                  label={sectionLabel}
                  isUsed={isDocumented}
                  onClick={() => onAddSection?.(section.id)}
                  onScrollTo={() => onScrollToSection?.(section.id)}
                />
              );
            }

            return (
              <ReviewSectionWithSubs
                key={section.id}
                section={section}
                sectionLabel={sectionLabel}
                documentedSections={documentedSections}
                onAddSection={onAddSection}
                onScrollToSection={onScrollToSection}
                tTemplates={tTemplates}
              />
            );
          })}
        </nav>
      )}
    </div>
  );
}
