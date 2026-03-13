"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { TEMPLATES } from "@/lib/templates";
import { Combobox } from "@/components/shared/combobox";

interface TemplateSelectorProps {
  value: string;
  onChange: (templateId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function TemplateSelector({
  value,
  onChange,
  disabled,
  className,
}: TemplateSelectorProps) {
  const t = useTranslations("templates");

  const options = useMemo(
    () =>
      TEMPLATES.map((template) => ({
        value: template.id,
        label: t(template.nameKey),
      })),
    [t],
  );

  return (
    <Combobox
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={t("selectTemplate")}
      searchPlaceholder={t("selectTemplate")}
      emptyText={t("noResults")}
      disabled={disabled}
      className={className ?? "w-full"}
    />
  );
}
