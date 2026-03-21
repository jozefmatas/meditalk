"use client";

import { useMemo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
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

interface TemplateOption {
  id: string;
  name: Record<string, string>;
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
  const locale = useLocale();

  const [dbTemplates, setDbTemplates] = useState<TemplateOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TemplateOption[] | null) => {
        if (!cancelled && data) setDbTemplates(data);
      })
      .catch(() => {
        // API unavailable — keep using static fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = dbTemplates ?? [];

  const options = useMemo(
    () =>
      source.map((template) => ({
        value: template.id,
        label: template.name[locale] ?? template.name.sk ?? template.id,
      })),
    [source, locale],
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
