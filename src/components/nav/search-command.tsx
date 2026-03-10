"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon, Add01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { useLocalizedHref } from "@/hooks/use-localized-href";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import type { Visit, VisitListResponse } from "@/lib/types";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/shared/command";

interface SearchCommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchCommand({ open, onOpenChange }: SearchCommandProps) {
  const t = useTranslations("encounters");
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const getHref = useLocalizedHref();

  const { createEncounter } = useCreateEncounter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Visit[]>([]);
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

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
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
          const data: VisitListResponse = await res.json();
          setResults(data.visits);
        }
      } catch {
        // Silently fail
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false);
      setQuery("");
      router.push(href);
    },
    [router, onOpenChange]
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={t("searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {isSearching ? tCommon("loading") : t("empty.title")}
          </CommandEmpty>

          {results.length > 0 && (
            <CommandGroup heading={t("title")}>
              {results.map((visit) => (
                <CommandItem
                  key={visit.id}
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

          <CommandSeparator />

          <CommandGroup heading={tNav("dashboard")}>
            <CommandItem onSelect={() => navigate(getHref(""))}>
              <HugeiconsIcon icon={Home01Icon} size={16} />
              <span>{tNav("dashboard")}</span>
            </CommandItem>
            <CommandItem onSelect={() => { onOpenChange(false); createEncounter(); }}>
              <HugeiconsIcon icon={Add01Icon} size={16} />
              <span>{tNav("newEncounter")}</span>
            </CommandItem>
            <CommandItem onSelect={() => navigate(getHref("/settings"))}>
              <HugeiconsIcon icon={Settings01Icon} size={16} />
              <span>{tNav("settings")}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
