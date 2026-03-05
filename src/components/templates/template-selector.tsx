"use client";

import { useTranslations } from "next-intl";
import { TEMPLATES } from "@/lib/templates";
import { flattenSectionIds } from "@/lib/templates/html";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TemplateSelectorProps {
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
}

export function TemplateSelector({
  value,
  onChange,
  disabled,
}: TemplateSelectorProps) {
  const t = useTranslations("templates");

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={t("selectTemplate")} />
      </SelectTrigger>
      <SelectContent>
        {TEMPLATES.map((template) => {
          const sectionCount = flattenSectionIds(template).length;
          return (
            <SelectItem key={template.id} value={template.id}>
              <div className="flex items-center justify-between gap-4">
                <span>{t(template.nameKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {t("sectionCount", { count: sectionCount })}
                </span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
