import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/shared/accordion";
import { Badge } from "@/components/shared/badge";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Mic01Icon,
  Note01Icon,
  File01Icon,
  Image01Icon,
} from "@hugeicons/core-free-icons";
import type { Encounter } from "@/lib/types";
import { getTranscript } from "@/lib/encounters/sources";
import { useIsAdmin } from "@/hooks/use-is-admin";

interface ResourcesPanelProps {
  visit: Encounter;
  t: (key: string) => string;
}

interface EncounterFile {
  name: string;
  type: string;
  extracted_text?: string | null;
  source?: string;
}

function iconForFileType(type: string) {
  if (type.startsWith("audio/")) return Mic01Icon;
  if (type.startsWith("image/")) return Image01Icon;
  return File01Icon;
}

function resourceTypeLabelKey(file: EncounterFile): string {
  if (file.source === "recording") return "detail.resourceTypeRecording";
  if (file.type.startsWith("audio/")) return "detail.resourceTypeAudio";
  if (file.type.startsWith("image/")) return "detail.resourceTypeImage";
  return "detail.resourceTypeFile";
}

export function ResourcesPanel({ visit, t }: ResourcesPanelProps) {
  const isAdmin = useIsAdmin();
  const meta = visit.metadata;
  const doctorNotes = (meta?.doctor_notes as string) || "";
  const files = ((meta?.files as EncounterFile[]) || []).filter((f) =>
    f.extracted_text?.trim(),
  );
  const transcript = getTranscript(meta ?? null) || "";

  const hasTranscript = transcript.trim().length > 0;
  const hasDoctorNotes = doctorNotes.trim().length > 0;
  const hasFiles = files.length > 0;
  const hasAnything = hasTranscript || hasDoctorNotes || hasFiles;

  if (!hasAnything) {
    return (
      <p className="text-sm text-muted-foreground">{t("detail.noResources")}</p>
    );
  }

  // Non-admin: plain labels, no expandable content
  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-3">
        {hasTranscript && (
          <ResourceLabel icon={Mic01Icon}>
            {t("detail.recordingTranscript")}
          </ResourceLabel>
        )}
        {hasDoctorNotes && (
          <ResourceLabel icon={Note01Icon}>
            {t("detail.doctorNotes")}
          </ResourceLabel>
        )}
        {files.map((file, i) => (
          <ResourceLabel key={file.name + i} icon={iconForFileType(file.type)}>
            <span className="truncate">{file.name}</span>
            <Badge variant="status-started" className="ml-2 shrink-0">
              {t(resourceTypeLabelKey(file))}
            </Badge>
          </ResourceLabel>
        ))}
      </div>
    );
  }

  // Admin: expandable accordions with content
  const defaultOpen = hasTranscript
    ? ["transcript"]
    : hasDoctorNotes
      ? ["notes"]
      : hasFiles
        ? ["file-0"]
        : [];

  return (
    <Accordion
      type="multiple"
      defaultValue={defaultOpen}
      className="flex flex-col gap-3"
    >
      {hasTranscript && (
        <AccordionItem value="transcript" variant="bordered">
          <AccordionTrigger icon={Mic01Icon}>
            {t("detail.recordingTranscript")}
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80">
              {transcript}
            </pre>
          </AccordionContent>
        </AccordionItem>
      )}
      {hasDoctorNotes && (
        <AccordionItem value="notes" variant="bordered">
          <AccordionTrigger icon={Note01Icon}>
            {t("detail.doctorNotes")}
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80">
              {doctorNotes}
            </pre>
          </AccordionContent>
        </AccordionItem>
      )}
      {files.map((file, i) => (
        <AccordionItem
          key={file.name + i}
          value={`file-${i}`}
          variant="bordered"
        >
          <AccordionTrigger icon={iconForFileType(file.type)}>
            <span className="truncate">{file.name}</span>
            <Badge variant="status-started" className="ml-2 shrink-0">
              {t(resourceTypeLabelKey(file))}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80">
              {file.extracted_text}
            </pre>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Plain resource label — no chevron, no expandable content */
function ResourceLabel({
  icon,
  children,
}: {
  icon: IconSvgElement;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium">
      <HugeiconsIcon icon={icon} size={16} className="shrink-0" />
      {children}
    </div>
  );
}
