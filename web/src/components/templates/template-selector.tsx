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
  variant?: "default" | "ghost";
  size?: "default" | "sm" | "lg";
  label?: string;
}

export function TemplateSelector({
  value,
  onChange,
  disabled,
  className,
  variant,
  size,
  label,
}: TemplateSelectorProps) {
  const t = useTranslations("templates");

  const options = useMemo(
    () =>
      TEMPLATES.map((template) => ({
        value: template.id,
        label: template.name || t(template.nameKey ?? template.id),
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
      variant={variant}
      size={size}
      label={label}
    />
  );
}
