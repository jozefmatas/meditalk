export interface SoapSection {
  id: string;
  title: string;
  content: string;
}

/**
 * Parse generated SOAP note HTML into individual sections.
 * The HTML structure from buildTemplateHtml is:
 *   <h2>Section Title</h2><p>Content...</p>
 *   <h3>Subsection Title</h3><p>Content...</p>
 * We split on <h2> tags to get top-level sections,
 * preserving any <h3> subsections within them.
 */
export function parseSoapSections(html: string): SoapSection[] {
  if (!html) return [];

  const sections: SoapSection[] = [];

  // Split by <h2> keeping the tag
  const parts = html.split(/(?=<h2[^>]*>)/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Extract the h2 title
    const titleMatch = trimmed.match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (!titleMatch) continue;

    const title = titleMatch[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');

    // Everything after the closing </h2> is the section content
    const contentStart = trimmed.indexOf("</h2>") + 5;
    const content = trimmed.slice(contentStart).trim();

    const id = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    sections.push({ id, title, content });
  }

  return sections;
}

/**
 * Extract plain text from a section's HTML content (for clipboard copy).
 */
export function sectionToPlainText(section: SoapSection): string {
  const text = section.content
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n$1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "  - $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

  return `${section.title}\n${text}`;
}

/**
 * Convert all sections to a single plain text string for clipboard.
 */
export function allSectionsToPlainText(sections: SoapSection[]): string {
  return sections.map(sectionToPlainText).join("\n\n");
}
