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
import {
  Search01Icon,
  Cancel01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import type { Encounter } from "@/lib/types";

interface IcdCode {
  code: string;
  description: string;
  confidence?: string;
}

interface IcdPanelProps {
  visit: Encounter;
  setVisit: React.Dispatch<React.SetStateAction<Encounter | null>>;
}

/** Inner content of the ICD panel — reusable without the desktop sidebar wrapper. */
export function IcdPanelContent({ visit, setVisit }: IcdPanelProps) {
  const t = useTranslations("encounters.detail");
  const locale = useLocale();

  // Selected codes from visit metadata
  const [selectedCodes, setSelectedCodes] = useState<IcdCode[]>(() => {
    const meta = visit.metadata as Record<string, unknown>;
    return (meta?.selected_icd_codes as IcdCode[]) || [];
  });

  // Suggested codes from clinical analysis (raw, may have English descriptions)
  const suggestedCodesRaw: IcdCode[] = (() => {
    const meta = visit.metadata as Record<string, unknown>;
    const analysis = meta?.clinical_analysis as
      | Record<string, unknown>
      | undefined;
    if (!analysis?.candidateIcdCodes) return [];
    return (analysis.candidateIcdCodes as IcdCode[]).map((c) => ({
      code: c.code,
      description: c.description,
      confidence: c.confidence,
    }));
  })();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<IcdCode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Maps inputCode → { code (WHO format), description (localized) }
  const [localizedMap, setLocalizedMap] = useState<
    Map<string, { code: string; description: string }>
  >(new Map());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync selected codes when visit metadata changes externally
  useEffect(() => {
    const meta = visit.metadata as Record<string, unknown>;
    const stored = (meta?.selected_icd_codes as IcdCode[]) || [];
    setSelectedCodes(stored);
  }, [visit.metadata]);

  // Resolve codes + descriptions for selected + suggested codes in the current locale
  useEffect(() => {
    const allCodes = [
      ...selectedCodes.map((c) => c.code),
      ...suggestedCodesRaw.map((c) => c.code),
    ];
    if (allCodes.length === 0 || locale === "en") return;

    const unique = [...new Set(allCodes)];
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

  // Persist selected codes to visit metadata (debounced)
  const persistCodes = useCallback(
    (codes: IcdCode[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const partial = { selected_icd_codes: codes };

        try {
          await fetch(`/api/encounters/${visit.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata: partial }),
          });
          setVisit((prev) => {
            if (!prev) return prev;
            const current = (prev.metadata || {}) as Record<string, unknown>;
            return {
              ...prev,
              metadata: { ...current, ...partial },
            } as typeof prev;
          });
        } catch {
          // Silent fail
        }
      }, 500);
    },
    [visit.id, setVisit],
  );

  const removeCode = useCallback(
    (code: string) => {
      setSelectedCodes((prev) => {
        const next = prev.filter((c) => c.code !== code);
        persistCodes(next);
        return next;
      });
    },
    [persistCodes],
  );

  const copyCodeToClipboard = useCallback(
    (code: IcdCode) => {
      const text = `${code.code} ${code.description}`;
      navigator.clipboard.writeText(text).then(() => {
        toast.success(t("icdCopied"));
      });
    },
    [t],
  );

  // Search ICD-10 database (debounced)
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (searchQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/icd-search?q=${encodeURIComponent(searchQuery)}&locale=${locale}`,
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
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

  // Determine which codes to show in the list
  const selectedSet = new Set(selectedCodes.map((c) => c.code));
  const listCodes: IcdCode[] =
    searchQuery.length >= 2
      ? searchResults.filter((c) => !selectedSet.has(c.code))
      : suggestedCodes.filter((c) => !selectedSet.has(c.code));

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-foreground">{t("codes")}</h3>
        <Badge className="rounded-md bg-primary/10 text-xs font-medium text-primary">
          ICD 10
        </Badge>
      </div>

      {/* Selected codes — hide unresolved codes for non-EN locales */}
      {selectedCodes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-foreground/65">{t("icdSelected")}</p>
          {selectedCodes
            .filter((c) => locale === "en" || localizedMap.has(c.code))
            .map((code) => (
              <div
                key={code.code}
                className="group flex items-center justify-between rounded-xl bg-accent p-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-normal text-primary">
                    {codeFor(code)}
                  </span>
                  <span className="line-clamp-2 text-xs text-foreground">
                    {descFor(code)}
                  </span>
                </div>
                <button
                  onClick={() => removeCode(code.code)}
                  className="flex shrink-0 items-center justify-center rounded-lg opacity-0 transition-opacity size-8 hover:bg-background/50 group-hover:opacity-100"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="size-4 text-muted-foreground"
                  />
                </button>
              </div>
            ))}
        </div>
      )}

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
              : suggestedCodes.length === 0
                ? t("icdNoSuggestions")
                : t("icdAllSelected")}
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
export function IcdPanel({ visit, setVisit }: IcdPanelProps) {
  return (
    <div className="hidden h-full w-70 shrink-0 flex-col gap-2 border-l bg-background p-4 desktop:flex">
      <IcdPanelContent visit={visit} setVisit={setVisit} />
    </div>
  );
}
