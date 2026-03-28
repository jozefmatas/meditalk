"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/shared/input-group";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shared/select";
import { TemplateIcon } from "@/components/templates/template-icon";
import { flattenSectionIds } from "@/lib/templates/html";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import type { Template } from "@/lib/templates/types";

interface TemplatesListProps {
  templates: Template[];
}

interface SpecialtyGroup {
  specialty: string;
  templates: Template[];
}

function groupBySpecialty(templates: Template[]): SpecialtyGroup[] {
  const map = new Map<string, Template[]>();

  for (const t of templates) {
    const specialty = t.specialties?.[0] ?? "general";
    const group = map.get(specialty);
    if (group) {
      group.push(t);
    } else {
      map.set(specialty, [t]);
    }
  }

  return Array.from(map.entries()).map(([specialty, templates]) => ({
    specialty,
    templates,
  }));
}

export function TemplatesList({ templates }: TemplatesListProps) {
  const t = useTranslations("templates");
  const tHome = useTranslations("home");
  const locale = useLocale();
  const getHref = useLocalizedHref();

  const [search, setSearch] = useState("");
  const [specialty, setSpecialty] = useState("all");

  // Collect unique specialties for the filter dropdown
  const specialties = useMemo(() => {
    const set = new Set<string>();
    for (const tmpl of templates) {
      set.add(tmpl.specialties?.[0] ?? "general");
    }
    return Array.from(set);
  }, [templates]);

  // Filter templates by search and specialty
  const filtered = useMemo(() => {
    return templates.filter((tmpl) => {
      // Specialty filter
      if (specialty !== "all") {
        const tmplSpecialty = tmpl.specialties?.[0] ?? "general";
        if (tmplSpecialty !== specialty) return false;
      }

      // Search filter — matches template name OR specialty label
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name = (
          tmpl.name[locale] ??
          tmpl.name.sk ??
          tmpl.id
        ).toLowerCase();
        const specialtyKey = tmpl.specialties?.[0] ?? "general";
        const specialtyLabel = tHome
          .raw(`specialties.${specialtyKey}`)
          ?.toLowerCase();
        if (!name.includes(q) && !specialtyLabel?.includes(q)) return false;
      }

      return true;
    });
  }, [templates, specialty, search, locale, tHome]);

  // Group filtered templates by specialty
  const groups = useMemo(() => groupBySpecialty(filtered), [filtered]);

  return (
    <div className="flex flex-1 items-start justify-center">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {/* Filter bar */}
        <div className="sticky top-0 z-10 flex gap-4 border-b border-border bg-background py-6 md:px-4">
          <Select value={specialty} onValueChange={setSpecialty}>
            <SelectTrigger label={t("specialty")} className="hidden md:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("specialtyAll")}</SelectItem>
              {specialties.map((s) => (
                <SelectItem key={s} value={s}>
                  {tHome(`specialties.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <InputGroup variant="ghost" className="flex-1">
            <InputGroupAddon>
              <InputGroupText>
                <HugeiconsIcon icon={Search01Icon} size={16} />
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>

        {/* Specialty groups */}
        {groups.length === 0 ? (
          <p className="text-center text-sm text-foreground/65">
            {t("noResults")}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group, groupIndex) => {
              const sectionCounts = group.templates.map(
                (tmpl) => flattenSectionIds(tmpl).length,
              );

              return (
                <div key={group.specialty} className="flex flex-col gap-4">
                  {/* Divider between groups (not before first) */}
                  {groupIndex > 0 && <div className="border-t border-border" />}

                  {/* Specialty header */}
                  <div className="flex items-center gap-3 md:px-4">
                    <TemplateIcon specialty={group.specialty} size={56} />
                    <div className="flex flex-col gap-1">
                      <h2 className="text-2xl leading-none">
                        {tHome(`specialties.${group.specialty}`)}
                      </h2>
                      <p className="text-xs leading-none text-foreground/65">
                        {t("templatesCount", {
                          count: group.templates.length,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Template rows */}
                  <div className="flex flex-col gap-2">
                    {group.templates.map((tmpl, i) => (
                      <div
                        key={tmpl.id}
                        className="flex items-center gap-4 rounded-xl border bg-accent/50 px-4 py-3"
                      >
                        <div className="flex flex-1 flex-wrap items-start gap-1 md:gap-2">
                          <span className="text-sm font-medium leading-tight">
                            {tmpl.name[locale] ?? tmpl.name.sk ?? tmpl.id}
                          </span>
                          <Badge variant="status-started" className="shrink-0">
                            {t("sectionCount", { count: sectionCounts[i] })}
                          </Badge>
                        </div>
                        <Button variant="outline" size="lg" asChild>
                          <Link href={getHref(`/templates/${tmpl.id}`)}>
                            {t("open")}
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
