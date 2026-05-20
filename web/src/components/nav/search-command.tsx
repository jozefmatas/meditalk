"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import type { Encounter, EncounterListResponse } from "@/lib/types";
import type { Template } from "@/lib/templates/types";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/shared/command";

interface SearchCommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchCommand({ open, onOpenChange }: SearchCommandProps) {
  const t = useTranslations("encounters");
  const tTemplates = useTranslations("templates");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const getHref = useLocalizedHref();

  const [query, setQuery] = useState("");
  const [encounterResults, setEncounterResults] = useState<Encounter[]>([]);
  const [recentEncounters, setRecentEncounters] = useState<Encounter[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Fetch templates and recent encounters once when dialog opens
  useEffect(() => {
    if (!open) return;

    if (templates.length === 0) {
      fetch("/api/templates")
        .then((res) => (res.ok ? res.json() : []))
        .then((data: Template[]) => setTemplates(data))
        .catch(() => {});
    }

    fetch("/api/encounters?limit=5&sortBy=visit_date&sortOrder=desc")
      .then((res) => (res.ok ? res.json() : { encounters: [] }))
      .then((data: EncounterListResponse) =>
        setRecentEncounters(data.encounters),
      )
      .catch(() => {});
  }, [open, templates.length]);

  // Debounced encounter search — network-driven results are the legitimate
  // external-source use of useEffect.
  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEncounterResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams({
          search: query,
          limit: "10",
        });
        const res = await fetch(`/api/encounters?${params}`);
        if (res.ok) {
          const data: EncounterListResponse = await res.json();
          setEncounterResults(data.encounters);
        }
      } catch {
        // Silently fail
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  // Filter templates client-side
  const filteredTemplates = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return templates.filter((tmpl) => {
      const name = (tmpl.name[locale] ?? tmpl.name.sk ?? "").toLowerCase();
      const desc = (
        tmpl.description[locale] ??
        tmpl.description.sk ??
        ""
      ).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [query, templates, locale]);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      setQuery("");
      router.push(href);
    },
    [router, onOpenChange],
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const hasQuery = query.trim().length > 0;
  const hasResults =
    encounterResults.length > 0 || filteredTemplates.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="top-16">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {hasQuery && !hasResults && (
            <CommandEmpty>
              {isSearching ? tCommon("loading") : t("empty.title")}
            </CommandEmpty>
          )}

          {encounterResults.length > 0 && (
            <CommandGroup heading={t("title")}>
              {encounterResults.map((visit) => (
                <CommandItem
                  key={visit.id}
                  value={visit.id}
                  onSelect={() => navigate(getHref(`/encounters/${visit.id}`))}
                >
                  <span className="flex-1 truncate">
                    {visit.title || t("untitled")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {visit.patient_name && `${visit.patient_name} · `}
                    {formatDate(visit.visit_date)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {filteredTemplates.length > 0 && (
            <CommandGroup heading={tTemplates("title")}>
              {filteredTemplates.map((tmpl) => (
                <CommandItem
                  key={tmpl.id}
                  value={tmpl.id}
                  onSelect={() => navigate(getHref(`/templates/${tmpl.id}`))}
                >
                  <span className="flex-1 truncate">
                    {tmpl.name[locale] ?? tmpl.name.sk ?? tmpl.id}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!hasQuery && recentEncounters.length > 0 && (
            <CommandGroup heading={t("title")}>
              {recentEncounters.map((visit) => (
                <CommandItem
                  key={visit.id}
                  value={visit.id}
                  onSelect={() => navigate(getHref(`/encounters/${visit.id}`))}
                >
                  <span className="flex-1 truncate">
                    {visit.title || t("untitled")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {visit.patient_name && `${visit.patient_name} · `}
                    {formatDate(visit.visit_date)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
