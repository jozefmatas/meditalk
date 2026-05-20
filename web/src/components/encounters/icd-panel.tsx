"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/shared/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupInput,
} from "@/components/shared/input-group";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import type { Encounter } from "@/lib/types";

interface IcdCode {
  code: string;
  description: string;
  confidence?: string;
}

interface IcdPanelProps {
  visit: Encounter;
}

/** Inner content of the ICD panel — reusable without the desktop sidebar wrapper. */
export function IcdPanelContent({ visit }: IcdPanelProps) {
  const t = useTranslations("encounters.detail");
  const locale = useLocale();

  // Suggested codes from clinical analysis — prefer the full pre-filter list
  // (suggestedIcdCodes) so the doctor sees all candidates, not just the
  // certain ones in the note. Falls back to candidateIcdCodes for older
  // encounters generated before this field existed.
  const suggestedCodesRaw: IcdCode[] = (() => {
    const analysis = visit.metadata.clinical_analysis;
    const source =
      analysis?.suggestedIcdCodes ??
      ((analysis as Record<string, unknown> | undefined)?.candidateIcdCodes as
        | IcdCode[]
        | undefined);
    if (!source) return [];
    // Dedupe by code — older encounters persisted duplicates before the
    // suggester learned to dedup, and React uses `code` as the list key.
    const seen = new Set<string>();
    const out: IcdCode[] = [];
    for (const c of source) {
      if (!c?.code || seen.has(c.code)) continue;
      seen.add(c.code);
      out.push({
        code: c.code,
        description: c.description,
        confidence: c.confidence,
      });
    }
    return out;
  })();

  const [searchQuery, setSearchQuery] = useState("");
  const [rawSearchResults, setRawSearchResults] = useState<IcdCode[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Empty/short query is purely derived — no effect needed to "clear" stale
  // results.
  const searchResults = searchQuery.length < 2 ? [] : rawSearchResults;
  // Maps inputCode → { code (WHO format), description (localized) }
  const [localizedMap, setLocalizedMap] = useState<
    Map<string, { code: string; description: string }>
  >(new Map());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Resolve codes + descriptions for suggested codes in the current locale
  useEffect(() => {
    const codes = suggestedCodesRaw.map((c) => c.code);
    if (codes.length === 0 || locale === "en") return;

    const unique = [...new Set(codes)];
    fetch("/api/icd-resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: unique, locale }),
    })
      .then((r) => r.json())
      .then((data) => {
        const map = new Map<string, { code: string; description: string }>();
        for (const entry of data.results || []) {
          if (entry.found && entry.description) {
            map.set(entry.inputCode, {
              code: entry.code,
              description: entry.description,
            });
          }
        }
        setLocalizedMap(map);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, visit.metadata]);

  /** Get localized code (WHO format) for a code, falling back to the original */
  const codeFor = useCallback(
    (c: IcdCode) => localizedMap.get(c.code)?.code || c.code,
    [localizedMap],
  );

  /** Get localized description for a code, falling back to the original */
  const descFor = useCallback(
    (c: IcdCode) => localizedMap.get(c.code)?.description || c.description,
    [localizedMap],
  );

  // Apply localized codes + descriptions to suggested codes.
  // Hide codes that don't exist in the current locale's database.
  const suggestedCodes =
    locale === "en"
      ? suggestedCodesRaw
      : suggestedCodesRaw
          .filter((c) => localizedMap.has(c.code))
          .map((c) => ({
            ...c,
            code: codeFor(c),
            description: descFor(c),
          }));

  const copyCodeToClipboard = useCallback(
    (code: IcdCode) => {
      const text = `${code.code} ${code.description}`;
      navigator.clipboard.writeText(text).then(() => {
        toast.success(t("icdCopied"));
      });
    },
    [t],
  );

  // Search ICD-10 database (debounced) — only runs for queries ≥ 2 chars.
  useEffect(() => {
    if (searchQuery.length < 2) return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/icd-search?q=${encodeURIComponent(searchQuery)}&locale=${locale}`,
        );
        if (res.ok) {
          const data = await res.json();
          setRawSearchResults(data.results || []);
        }
      } catch {
        // Silent fail
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, locale]);

  const listCodes: IcdCode[] =
    searchQuery.length >= 2 ? searchResults : suggestedCodes;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-foreground">{t("codes")}</h3>
        <Badge className="rounded-md bg-primary/10 text-xs font-medium text-primary">
          ICD 10
        </Badge>
      </div>

      {/* Search */}
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("icdSearchPlaceholder")}
        />
      </InputGroup>

      {/* Code list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {isSearching && (
          <p className="py-4 text-center text-xs text-foreground/65">
            {t("icdSearching")}
          </p>
        )}

        {!isSearching && listCodes.length === 0 && (
          <p className="py-4 text-center text-xs text-foreground/65">
            {searchQuery.length >= 2
              ? t("icdNoResults")
              : t("icdNoSuggestions")}
          </p>
        )}

        {!isSearching &&
          listCodes.map((code) => (
            <button
              key={code.code}
              onClick={() => copyCodeToClipboard(code)}
              className="group/code relative flex w-full flex-col gap-1 rounded-xl border border-border p-3 text-left transition-colors hover:border-ring"
            >
              <span className="absolute top-2 right-2 rounded-md p-1 text-foreground/65 opacity-0 transition-opacity group-hover/code:opacity-100">
                <HugeiconsIcon icon={Copy01Icon} size={14} />
              </span>
              <span className="text-sm text-foreground">{code.code}</span>
              <span className="text-xs leading-snug text-foreground/65">
                {code.description}
              </span>
            </button>
          ))}
      </div>
    </>
  );
}

/** Desktop sidebar wrapper for IcdPanelContent. */
export function IcdPanel({ visit }: IcdPanelProps) {
  return (
    <div className="hidden h-full w-70 shrink-0 flex-col gap-2 border-l bg-background p-4 desktop:flex">
      <IcdPanelContent visit={visit} />
    </div>
  );
}
