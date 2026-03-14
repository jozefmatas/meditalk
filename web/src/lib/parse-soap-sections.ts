import type { Template } from "./templates/types";

/** Values the AI uses for sections with no relevant information — treat as empty. */
const NOT_STATED_VALUES = new Set(["Not stated", "Neuvedené", "Neuvedeno"]);

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
 * Convert a section's HTML content to markdown-style text for clipboard copy.
 * h2 titles are **bold**, h3 subheaders are *italic*.
 */
export function sectionToPlainText(section: SoapSection): string {
  const text = section.content
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n*$1*\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "  - $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

  return `**${section.title}**\n${text}`;
}

/**
 * Convert all sections to a single markdown-style string for clipboard.
 * Sections are separated by blank lines.
 */
export function allSectionsToPlainText(sections: SoapSection[]): string {
  return sections.map(sectionToPlainText).join("\n\n");
}

/**
 * Strip HTML tags and decode entities, returning plain text.
 * If the result is a NOT_STATED placeholder, returns empty string.
 */
function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
  // Treat AI "not stated" placeholders as empty
  if (NOT_STATED_VALUES.has(text)) return "";
  return text;
}

/**
 * Parse generated note HTML into a map of { sectionId → text content }
 * keyed by template section/subsection IDs.
 *
 * The HTML from buildTemplateHtml has:
 *   <h2>Title</h2><p>content</p><h3>Sub</h3><p>sub content</p>...
 *
 * We split on <h2> to get top-level sections (mapped by index to template),
 * then split each section's content on <h3> to get subsection content.
 */
export function parseNoteToSectionMap(
  html: string,
  template: Template,
): Record<string, string> {
  if (!html) return {};

  const map: Record<string, string> = {};
  const h2Parts = html.split(/(?=<h2[^>]*>)/i).filter((p) => p.trim());

  for (let i = 0; i < h2Parts.length; i++) {
    const templateSection = template.sections[i];
    if (!templateSection) break;

    const part = h2Parts[i];

    // Strip the <h2>...</h2> tag to get the body
    const bodyStart = part.indexOf("</h2>");
    if (bodyStart === -1) continue;
    const body = part.slice(bodyStart + 5).trim();

    if (!templateSection.subsections?.length) {
      // No subsections — entire body is this section's content
      map[templateSection.id] = htmlToText(body);
    } else {
      // Split body on <h3> to separate parent content from subsection content
      const h3Parts = body.split(/(?=<h3[^>]*>)/i);

      // First chunk (before any <h3>) is the parent section content
      if (h3Parts[0] && !h3Parts[0].startsWith("<h3")) {
        map[templateSection.id] = htmlToText(h3Parts[0]);
      } else {
        map[templateSection.id] = "";
      }

      // Remaining chunks are subsections, mapped by index
      let subIdx = 0;
      for (const h3Part of h3Parts) {
        if (!h3Part.startsWith("<h3")) continue;
        const sub = templateSection.subsections[subIdx];
        if (!sub) break;

        const subBodyStart = h3Part.indexOf("</h3>");
        if (subBodyStart === -1) {
          subIdx++;
          continue;
        }
        map[sub.id] = htmlToText(h3Part.slice(subBodyStart + 5));
        subIdx++;
      }
    }
  }

  return map;
}
