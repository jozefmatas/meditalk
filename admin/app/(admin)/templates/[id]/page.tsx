import Link from "next/link";
import { getTemplateById } from "@/lib/queries";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await getTemplateById(id);

  if (!template) {
    return (
      <div className="max-w-6xl space-y-6">
        <Link
          href="/templates"
          className="inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to templates
        </Link>
        <p className="text-muted-foreground">Template not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <Link
        href="/templates"
        className="inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to templates
      </Link>
      <TemplateEditor initialData={template} />
    </div>
  );
}
