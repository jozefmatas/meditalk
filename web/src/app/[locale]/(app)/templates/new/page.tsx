"use client";

import { AppShell } from "@/components/nav/app-shell";
import { TemplateEditor } from "@/components/templates/template-editor";

export default function NewTemplatePage() {
  return (
    <AppShell>
      <TemplateEditor />
    </AppShell>
  );
}
