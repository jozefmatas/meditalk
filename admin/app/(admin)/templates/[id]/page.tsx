"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  SaveIcon,
  LoaderIcon,
  GlobeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SectionEditor } from "../_components/section-editor";
import { SpecialtyCombobox } from "../_components/specialty-combobox";
import type { SectionLocale } from "@/lib/constants/section-labels";

interface Section {
  id: string;
  labelKey: string;
  labels?: Partial<Record<"sk" | "cs" | "en", string>>;
  context?: string;
  subsections?: Section[];
}

interface TemplateData {
  id: string;
  name: string;
  description: string | null;
  specialties: string[];
  sections: Section[];
  is_system: boolean;
  visible: boolean;
  sort_order: number;
  system_prompt: string | null;
  style_examples: { name: string; text: string }[];
}

const LOCALES: { value: SectionLocale; label: string }[] = [
  { value: "sk", label: "SK" },
  { value: "cs", label: "CS" },
  { value: "en", label: "EN" },
];

export default function TemplateBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [locale, setLocale] = useState<SectionLocale>("sk");

  // Editable fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  // ── Load template ───────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/templates/${id}`);
        if (!res.ok) {
          router.push("/templates");
          return;
        }
        const data: TemplateData = await res.json();
        setTemplate(data);
        setName(data.name);
        setDescription(data.description || "");
        setSpecialties(data.specialties);
        setSections(data.sections);
      } catch {
        router.push("/templates");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [id, router]);

  // ── Unsaved changes guard ───────────────────────────────────────

  useEffect(() => {
    if (!hasChanges) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  // ── Change handlers ─────────────────────────────────────────────

  const markChanged = useCallback(() => setHasChanges(true), []);

  const handleNameChange = useCallback(
    (v: string) => {
      setName(v);
      markChanged();
    },
    [markChanged],
  );

  const handleDescriptionChange = useCallback(
    (v: string) => {
      setDescription(v);
      markChanged();
    },
    [markChanged],
  );

  const handleSpecialtiesChange = useCallback(
    (v: string[]) => {
      setSpecialties(v);
      markChanged();
    },
    [markChanged],
  );

  const handleSectionsChange = useCallback(
    (s: Section[]) => {
      setSections(s);
      markChanged();
    },
    [markChanged],
  );

  // ── Save ────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!template) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          specialties,
          sections,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setTemplate(updated);
        setHasChanges(false);
      }
    } catch {
      // Silently fail for now
    } finally {
      setIsSaving(false);
    }
  }, [template, name, description, specialties, sections]);

  // ── Render ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="max-w-4xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.push("/templates")}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{template.name}</h1>
              <Badge variant={template.is_system ? "default" : "secondary"}>
                {template.is_system ? "System" : "Custom"}
              </Badge>
            </div>
            {template.description && (
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Locale switcher */}
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <GlobeIcon className="ml-1.5 size-3.5 text-muted-foreground" />
            {LOCALES.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLocale(l.value)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  locale === l.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Save with confirmation dialog */}
          <Dialog>
            <DialogTrigger
              render={
                <Button disabled={!hasChanges || isSaving} size="sm" />
              }
            >
              {isSaving ? (
                <LoaderIcon className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <SaveIcon className="mr-1.5 size-3.5" />
              )}
              Save
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Save template changes?</DialogTitle>
                <DialogDescription>
                  These changes will affect production immediately. Users will
                  see the updated template on their next visit.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <DialogClose render={<Button onClick={save} />}>
                  Save to production
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={0}>
        <TabsList>
          <TabsTrigger value={0}>Metadata</TabsTrigger>
          <TabsTrigger value={1}>
            Sections ({countAll(sections)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={0} className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Template Info</CardTitle>
              <CardDescription>
                Basic metadata for this template.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Specialties</Label>
                <SpecialtyCombobox
                  value={specialties}
                  onChange={handleSpecialtiesChange}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value={1} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Section Structure</CardTitle>
              <CardDescription>
                Drag to reorder. The label preview on the right shows how
                section headers appear in the selected locale (
                {locale.toUpperCase()}).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SectionEditor
                sections={sections}
                onChange={handleSectionsChange}
                locale={locale}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function countAll(sections: Section[]): number {
  let count = 0;
  for (const s of sections) {
    count++;
    if (s.subsections) count += s.subsections.length;
  }
  return count;
}
