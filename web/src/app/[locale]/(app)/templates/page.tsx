import { AppShell } from "@/components/nav/app-shell";
import { resolveAllTemplates } from "@/lib/templates/server";
import { TemplatesList } from "@/components/templates/templates-list";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const templates = await resolveAllTemplates(locale);

  return (
    <AppShell contentClassName="flex-1 overflow-y-auto p-6 pt-0 pb-32">
      <TemplatesList templates={templates} />
    </AppShell>
  );
}
