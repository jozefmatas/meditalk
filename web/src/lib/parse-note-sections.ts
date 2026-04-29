import type { Template } from "./templates/types";

/** Values the AI uses for sections with no relevant information — treat as empty. */
export const NOT_STATED_VALUES = new Set([
  "Not stated",
  "Neuvedené",
  "Neuvedeno",
]);

export interface NoteSection {
  id: string;
  title: string;
  content: string;
}

/**
 * Parse generated note HTML into individual sections.
 * The HTML structure from buildTemplateHtml is:
 *   <h2>Section Title</h2><p>Content...</p>
 *   <h3>Subsection Title</h3><p>Content...</p>
 * We split on <h2> tags to get top-level sections,
 * preserving any <h3> subsections within them.
 */
export function parseNoteSections(html: string): NoteSection[] {
  if (!html) return [];

  const sections: NoteSection[] = [];

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
 * Numbered (1. / 2.) and bullet (- / •) lists get each item on its own line.
 */
export function sectionToPlainText(section: NoteSection): string {
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
    // Ensure numbered items (1. / 2.) start on a new line
    .replace(/([^\n])(\d+\.\s)/g, "$1\n$2")
    // Ensure bullet items (- or •) start on a new line
    .replace(/([^\n])([-•]\s)/g, "$1\n$2")
    .trim();

  return `**${section.title}**\n${text}`;
}

/**
 * Check if a section's content is a "not stated" placeholder.
 */
function isSectionNotStated(section: NoteSection): boolean {
  const text = section.content
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
  return !text || NOT_STATED_VALUES.has(text);
}

/**
 * Convert all sections to a single markdown-style string for clipboard.
 * Sections with "Not stated" content are excluded.
 */
export function allSectionsToPlainText(sections: NoteSection[]): string {
  return sections
    .filter((s) => !isSectionNotStated(s))
    .map(sectionToPlainText)
    .join("\n\n");
}

/**
 * Extract inline content from HTML, preserving formatting tags (<strong>, <em>, <br>).
 * Strips structural tags (<p>) and decodes entities.
 * If the plain-text result is a NOT_STATED placeholder, returns empty string.
 */
function htmlToInlineContent(html: string): string {
  const text = html
    // Convert list items to "- " prefix (handles <li>text</li> and <li><p>text</p></li>)
    .replace(/<li[^>]*>(?:<p[^>]*>)?([\s\S]*?)(?:<\/p>)?<\/li>/gi, "- $1\n")
    // Strip list wrappers
    .replace(/<\/?[uo]l[^>]*>/gi, "")
    // Convert </p> to newlines, strip opening <p>
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    // Strip all tags EXCEPT <strong>, </strong>, <em>, </em>, <br>
    .replace(/<(?!\/?(?:strong|em)\b)(?!br\s*\/?>)[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Check NOT_STATED against plain text (strip formatting + <br> tags for check)
  const plainText = text
    .replace(/<\/?(?:strong|em)>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .trim();
  if (NOT_STATED_VALUES.has(plainText)) return "";

  return text;
}

/**
 * Filter out empty / "Not stated" sections and subsections from generated HTML.
 * Removes both <h2> sections and <h3> subsections whose content is empty or "Neuvedené".
 */
export function filterEmptySectionsHtml(html: string): string {
  if (!html) return "";

  // First pass: remove <h3> subsections with "Not stated" content
  // Each subsection is <h3>...</h3> followed by content until the next <h2>/<h3> or end
  const filtered = html.replace(
    /<h3[^>]*>.*?<\/h3>[\s\S]*?(?=<h[23][^>]*>|$)/gi,
    (match) => {
      const contentStart = match.indexOf("</h3>");
      if (contentStart === -1) return match;
      const content = match.slice(contentStart + 5);
      const text = content
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim();
      if (!text || NOT_STATED_VALUES.has(text)) return "";
      return match;
    },
  );

  // Second pass: remove <h2> sections that are now entirely empty
  const parts = filtered.split(/(?=<h2[^>]*>)/i);
  return parts
    .filter((part) => {
      const trimmed = part.trim();
      if (!trimmed || !/<h2[^>]*>/i.test(trimmed)) return false;
      const contentStart = trimmed.indexOf("</h2>");
      if (contentStart === -1) return false;
      const content = trimmed.slice(contentStart + 5);
      const text = content
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim();
      return text.length > 0 && !NOT_STATED_VALUES.has(text);
    })
    .join("");
}

/**
 * Parse generated note HTML into a map of { sectionId → inline content }
 * keyed by template section/subsection IDs.
 *
 * Content preserves inline formatting tags (<strong>, <em>) but strips
 * structural tags (<p>, <br>). Newlines separate paragraphs.
 *
 * The HTML from buildTemplateHtml has:
 *   <h2>Title</h2><p>content</p><h3>Sub</h3><p>sub content</p>...
 *
 * Matching is done by LABEL (case-insensitive, diacritic-stripped),
 * NOT by position. When buildTemplateHtml was called with skipEmpty:true,
 * empty sections are omitted from the HTML — positional matching would
 * then pair <h3>Pulz</h3> with template.subsections[0] (Krvný tlak) and
 * cascade-shift everything after. Label matching is resilient to that.
 */
export function parseNoteToSectionMap(
  html: string,
  template: Template,
): Record<string, string> {
  if (!html) return {};

  const map: Record<string, string> = {};
  const h2Parts = html.split(/(?=<h2[^>]*>)/i).filter((p) => p.trim());

  // Build a label → template-section index for O(1) lookups. Every label
  // (across all locales stored on the section) is indexed, so the parser
  // matches regardless of which locale the HTML was rendered in.
  const sectionByLabel = buildLabelIndex(template.sections);

  for (const part of h2Parts) {
    const titleMatch = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!titleMatch) continue;
    const title = decodeEntities(titleMatch[1]);
    const templateSection = sectionByLabel.get(normalizeLabel(title));
    if (!templateSection) continue;

    const bodyStart = part.indexOf("</h2>");
    if (bodyStart === -1) continue;
    const body = part.slice(bodyStart + 5).trim();

    if (!templateSection.subsections?.length) {
      map[templateSection.id] = htmlToInlineContent(body);
      continue;
    }

    const subByLabel = buildLabelIndex(templateSection.subsections);

    // Split body on <h3> to separate parent content from subsection content.
    const h3Parts = body.split(/(?=<h3[^>]*>)/i);

    // First chunk (before any <h3>) is the parent section's own content.
    if (h3Parts[0] && !h3Parts[0].startsWith("<h3")) {
      map[templateSection.id] = htmlToInlineContent(h3Parts[0]);
    } else {
      map[templateSection.id] = "";
    }

    for (const h3Part of h3Parts) {
      if (!h3Part.startsWith("<h3")) continue;
      const subTitleMatch = h3Part.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (!subTitleMatch) continue;
      const subTitle = decodeEntities(subTitleMatch[1]);
      const sub = subByLabel.get(normalizeLabel(subTitle));
      if (!sub) continue;

      const subBodyStart = h3Part.indexOf("</h3>");
      if (subBodyStart === -1) continue;
      map[sub.id] = htmlToInlineContent(h3Part.slice(subBodyStart + 5));
    }
  }

  return map;
}

/**
 * Build a Map<normalizedLabel, section> for a single level of template
 * sections. Indexes every locale-label stored on each section so that a
 * heading rendered in any language resolves back to the right section.id.
 */
export function buildLabelIndex(
  sections: import("./templates/types").TemplateSection[],
): Map<string, import("./templates/types").TemplateSection> {
  const byLabel = new Map<
    string,
    import("./templates/types").TemplateSection
  >();
  for (const s of sections) {
    for (const label of Object.values(s.labels ?? {})) {
      if (typeof label !== "string") continue;
      const key = normalizeLabel(label);
      if (!key) continue;
      // First-write wins — language-specific labels might collide rarely
      // (e.g. "EKG" in every locale), but they all point at the same
      // section, so collision is harmless.
      if (!byLabel.has(key)) byLabel.set(key, s);
    }
  }
  return byLabel;
}

/**
 * Recursive flat index covering every section AND subsection. Used when
 * parsing a reference note that writes all sections at one level (doctors
 * don't wrap subsections under their parent heading — they write "RA …
 * OA … Krvný tlak …" flat).
 */
export function buildFlatLabelIndex(
  sections: import("./templates/types").TemplateSection[],
): Map<string, import("./templates/types").TemplateSection> {
  const out = new Map<string, import("./templates/types").TemplateSection>();
  const walk = (list: import("./templates/types").TemplateSection[]) => {
    for (const s of list) {
      for (const label of Object.values(s.labels ?? {})) {
        if (typeof label !== "string") continue;
        const key = normalizeLabel(label);
        if (!key) continue;
        if (!out.has(key)) out.set(key, s);
      }
      if (s.subsections?.length) walk(s.subsections);
    }
  };
  walk(sections);
  return out;
}

export function normalizeLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
