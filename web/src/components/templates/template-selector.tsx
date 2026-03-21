"use client";

import { useMemo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Combobox } from "@/components/shared/combobox";
import { useTemplate, populateTemplateCache } from "@/hooks/use-template";
import type { Template } from "@/lib/templates";

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

/** Module-level cache — shared across all TemplateSelector instances, survives unmount. */
let cachedTemplates: TemplateOption[] | null = null;
let inflightList: Promise<TemplateOption[] | null> | null = null;

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

  // Initialise from module-level cache (instant on subsequent renders)
  const [dbTemplates, setDbTemplates] = useState<TemplateOption[] | null>(
    cachedTemplates,
  );

  // Fallback: fetch the selected template individually so we can show its
  // name even before the full list loads (first visit only)
  const { template: selectedTemplate } = useTemplate(value || undefined);

  // Stale-while-revalidate: always fetch from API, but show cached data
  // immediately if available
  useEffect(() => {
    let cancelled = false;

    let request = inflightList;
    if (!request) {
      request = fetch("/api/templates")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Template[] | null) => {
          if (data) {
            cachedTemplates = data;
            // Pre-populate the individual template cache so useTemplate()
            // resolves instantly for any template in the list
            populateTemplateCache(data);
          }
          inflightList = null;
          return data as TemplateOption[] | null;
        })
        .catch(() => {
          inflightList = null;
          return null;
        });
      inflightList = request;
    }

    request.then((data) => {
      if (!cancelled && data) setDbTemplates(data);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const source = dbTemplates ?? [];
    const items = source.map((template) => ({
      value: template.id,
      label: template.name[locale] ?? template.name.sk ?? template.id,
    }));

    // While list is loading, ensure the selected value appears as an option
    // so the Combobox shows its name instead of the placeholder
    if (value && !items.find((o) => o.value === value)) {
      if (selectedTemplate) {
        items.unshift({
          value: selectedTemplate.id,
          label:
            selectedTemplate.name[locale] ??
            selectedTemplate.name.sk ??
            selectedTemplate.id,
        });
      }
    }

    return items;
  }, [dbTemplates, locale, selectedTemplate, value]);

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
