"use client";

import { useState, useEffect, use } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/nav/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Loading03Icon,
  AlertCircleIcon,
  MagicWand01Icon,
  Note01Icon,
  Delete01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import type { Visit, ChunkMatch } from "@/lib/types";

interface PageProps {
  params: Promise<{ visitId: string }>;
}

export default function VisitDetailPage({ params }: PageProps) {
  const { visitId } = use(params);
  const t = useTranslations("visits");
  const tPoc = useTranslations("poc");
  const locale = useLocale();
  const router = useRouter();

  // Visit state
  const [visit, setVisit] = useState<Visit | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ChunkMatch[]>([]);

  // Generate state
  const [isGenerating, setIsGenerating] = useState(false);

  const getLocalizedHref = (href: string) => {
    const base = locale === "sk" ? "" : `/${locale}`;
    return `${base}${href}`;
  };

  useEffect(() => {
    const fetchVisit = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/visits/${visitId}`);
        if (!res.ok) throw new Error("Visit not found");

        const data = await res.json();
        setVisit(data);
      } catch {
        setError("Failed to load visit");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVisit();
  }, [visitId]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !visitId) return;
    setIsSearching(true);
    setError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          visitId,
          k: 10,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tPoc("errorSearch"));
      }

      const data = await res.json();
      setSearchResults(data.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : tPoc("errorSearch"));
    } finally {
      setIsSearching(false);
    }
  };

  const handleGenerate = async () => {
    if (!visitId) return;
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || tPoc("errorGenerate"));
      }

      const data = await res.json();
      setVisit((prev) =>
        prev ? { ...prev, soap_note: data.soap, patient_letter: data.letter } : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : tPoc("errorGenerate"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!visitId) return;

    try {
      const res = await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      setVisit((prev) => (prev ? { ...prev, status: "completed" } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleDelete = async () => {
    if (!visitId) return;
    if (!confirm(t("delete.message"))) return;

    try {
      const res = await fetch(`/api/visits/${visitId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete visit");

      router.push(getLocalizedHref(""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete visit");
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-4xl space-y-6">
          <Skeleton className="h-8 w-64" />
          <Card>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (error && !visit) {
    return (
      <AppShell>
        <Alert variant="destructive">
          <HugeiconsIcon icon={AlertCircleIcon} size={16} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (!visit) return null;

  return (
    <AppShell>
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {visit.title || t("untitled")}
            </h1>
            {visit.patient_name && (
              <p className="text-muted-foreground">{visit.patient_name}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {visit.status === "draft" && (
              <Button variant="outline" size="sm" onClick={handleMarkComplete}>
                <HugeiconsIcon icon={Tick01Icon} size={16} />
                Mark Complete
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDelete}>
              <HugeiconsIcon icon={Delete01Icon} size={16} className="text-destructive" />
            </Button>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <HugeiconsIcon icon={AlertCircleIcon} size={16} />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Transcript */}
        {visit.raw_text ? (
          <div className="space-y-6">
            {/* Transcript viewer */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HugeiconsIcon icon={Note01Icon} size={18} />
                  {t("detail.transcript")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {visit.raw_text}
                  </p>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Search */}
            <Card>
              <CardContent>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSearch();
                  }}
                >
                  <div className="relative flex-1">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t("detail.searchPlaceholder")}
                      disabled={isSearching}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={!searchQuery.trim() || isSearching}
                    variant="outline"
                  >
                    {isSearching ? (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        size={16}
                        className="animate-spin"
                      />
                    ) : (
                      <HugeiconsIcon icon={Search01Icon} size={16} />
                    )}
                    {t("detail.search")}
                  </Button>
                </form>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {searchResults.map((match) => (
                      <div key={match.id} className="rounded-lg border p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-medium text-muted-foreground">
                            {tPoc("chunk")} #{match.chunk_index + 1}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tPoc("similarity")}: {(match.similarity * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="leading-relaxed">{match.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Separator />

            {/* Generate SOAP + Letter */}
            <div className="space-y-4">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      size={16}
                      className="animate-spin"
                    />
                    {t("detail.generating")}
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={MagicWand01Icon} size={16} />
                    {t("detail.generate")}
                  </>
                )}
              </Button>

              {/* Generation skeleton */}
              {isGenerating && (
                <div className="space-y-4">
                  <Card>
                    <CardContent className="space-y-3">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* SOAP note */}
              {visit.soap_note && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HugeiconsIcon icon={Note01Icon} size={18} />
                      {t("detail.soapNote")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-96">
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {visit.soap_note}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Patient letter */}
              {visit.patient_letter && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <HugeiconsIcon icon={Note01Icon} size={18} />
                      {t("detail.patientLetter")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {visit.patient_letter}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t("detail.noTranscript")}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
