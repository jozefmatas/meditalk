"use client";

import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { getTemplateById } from "@/lib/templates";
import { TemplateSelector } from "@/components/templates/template-selector";
import { cn } from "@/lib/utils";

interface TemplateSidebarProps {
  templateId: string;
  onTemplateChange: (id: string) => void;
  disabled?: boolean;
  /** Set of section IDs that have generated content (review mode). */
  documentedSections?: Set<string>;
}

export function TemplateSidebar({
  templateId,
  onTemplateChange,
  disabled,
  documentedSections,
}: TemplateSidebarProps) {
  const tTemplates = useTranslations("templates");
  const t = useTranslations("encounters.detail");
  const template = getTemplateById(templateId);
  const isReview = !!documentedSections;

  const documented = template?.sections.filter((s) =>
    documentedSections?.has(s.id)
  );
  const remaining = template?.sections.filter(
    (s) => !documentedSections?.has(s.id)
  );

  return (
    <div className="flex w-60 shrink-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          {tTemplates("selectTemplate")}
        </span>
        <TemplateSelector
          value={templateId}
          onChange={onTemplateChange}
          disabled={disabled}
        />
      </div>

      {template && !isReview && (
        <nav className="flex flex-col">
          {template.sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-muted-foreground",
                "hover:bg-accent hover:text-foreground transition-colors"
              )}
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
      )}

      {template && isReview && (
        <div className="flex flex-col gap-3">
          {/* Documented sections */}
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

          {/* Separator */}
          {documented && documented.length > 0 && remaining && remaining.length > 0 && (
            <div className="h-px bg-border" />
          )}

          {/* Remaining sections */}
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
