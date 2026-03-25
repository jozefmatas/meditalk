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

/** Module-level cache keyed by locale. */
const cachedByLocale = new Map<string, TemplateOption[]>();
const inflightByLocale = new Map<string, Promise<TemplateOption[] | null>>();

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
    cachedByLocale.get(locale) ?? null,
  );

  // Fallback: fetch the selected template individually so we can show its
  // name even before the full list loads (first visit only)
  const { template: selectedTemplate } = useTemplate(value || undefined);

  // Stale-while-revalidate: always fetch from API, but show cached data
  // immediately if available
  useEffect(() => {
    let cancelled = false;

    let request = inflightByLocale.get(locale);
    if (!request) {
      request = fetch("/api/templates")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Template[] | null) => {
          if (data) {
            cachedByLocale.set(locale, data);
            // Pre-populate the individual template cache so useTemplate()
            // resolves instantly for any template in the list
            populateTemplateCache(data);
          }
          inflightByLocale.delete(locale);
          return data as TemplateOption[] | null;
        })
        .catch(() => {
          inflightByLocale.delete(locale);
          return null;
        });
      inflightByLocale.set(locale, request);
    }

    request.then((data) => {
      if (!cancelled && data) setDbTemplates(data);
    });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const options = useMemo(() => {
    const source = dbTemplates ?? [];
    const items = source.map((template) => ({
      value: template.id,
      label: template.name[locale] ?? template.name.sk ?? template.id,
    }));

    // While list is loading, ensure the selected value appears as an option
    // so the Combobox shows its name instead of the placeholder.
    // Only add it back if it matches the current locale (or has no locale restriction).
    if (value && !items.find((o) => o.value === value)) {
      if (
        selectedTemplate &&
        (!selectedTemplate.locales || selectedTemplate.locales.includes(locale))
      ) {
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
