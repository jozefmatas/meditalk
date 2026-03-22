import Link from "next/link";
import { getTemplates } from "@/lib/queries";
import { VisibilityToggle } from "@/components/visibility-toggle";

export const dynamic = "force-dynamic";

/** Count leaf sections (including nested subsections). */
function countSections(sections: unknown[]): number {
  let count = 0;
  for (const s of sections) {
    const section = s as { subsections?: unknown[] };
    count++;
    if (section.subsections) {
      count += countSections(section.subsections);
    }
  }
  return count;
}

export default async function TemplatesPage() {
  const templates = await getTemplates();

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Templates</h1>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Sections
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Specialties
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Visible
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                Sort
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr
                key={t.id}
                className="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/templates/${t.id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t.name.sk || t.name.en || t.id}
                  </Link>
                  {t.description.sk && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.description.sk}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {countSections(t.sections)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t.specialties.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {t.specialties.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-muted px-2 py-0.5 text-xs font-medium"
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      General
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <VisibilityToggle
                    templateId={t.id}
                    initialVisible={t.visible}
                  />
                </td>
                <td className="px-4 py-3 text-right">{t.sort_order}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No templates found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
