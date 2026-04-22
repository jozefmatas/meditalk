/**
 * Scorers — one function per `Expectation.kind`. Pure TypeScript,
 * deterministic. Each takes the generated HTML note + the expectation
 * and returns a `ScoreResult`. All failures carry a `detail` field so
 * the runner can print where the check looked and what it found.
 */
import type { Expectation, ScoreResult } from "./types";

export function scoreExpectation(
  html: string,
  expectation: Expectation,
): ScoreResult {
  switch (expectation.kind) {
    case "contains":
      return scoreContains(html, expectation.value, expectation.caseSensitive, {
        kind: "contains",
        reason: expectation.reason,
      });
    case "not-contains":
      return scoreNotContains(
        html,
        expectation.value,
        expectation.caseSensitive,
        { kind: "not-contains", reason: expectation.reason },
      );
    case "section-contains":
      return scoreSectionContains(html, expectation);
    case "section-not-contains":
      return scoreSectionNotContains(html, expectation);
    case "section-present":
      return scoreSectionPresent(html, expectation);
    case "section-empty":
      return scoreSectionEmpty(html, expectation);
    case "icd-in-zaver":
      return scoreIcdInZaver(html, expectation.code, {
        kind: "icd-in-zaver",
        reason: expectation.reason,
      });
    case "icd-not-in-zaver":
      return scoreIcdNotInZaver(html, expectation.code, {
        kind: "icd-not-in-zaver",
        reason: expectation.reason,
      });
  }
}

// ─── primitive scorers ────────────────────────────────────────────────

function scoreContains(
  html: string,
  value: string,
  caseSensitive = false,
  meta: { kind: Expectation["kind"]; reason: string },
): ScoreResult {
  const hay = caseSensitive ? html : html.toLowerCase();
  const needle = caseSensitive ? value : value.toLowerCase();
  const ok = hay.includes(needle);
  return ok
    ? { ok: true, kind: meta.kind, reason: meta.reason }
    : {
        ok: false,
        kind: meta.kind,
        reason: meta.reason,
        detail: `"${truncate(value, 60)}" not found in the generated note`,
      };
}

function scoreNotContains(
  html: string,
  value: string,
  caseSensitive = false,
  meta: { kind: Expectation["kind"]; reason: string },
): ScoreResult {
  const hay = caseSensitive ? html : html.toLowerCase();
  const needle = caseSensitive ? value : value.toLowerCase();
  const present = hay.includes(needle);
  return present
    ? {
        ok: false,
        kind: meta.kind,
        reason: meta.reason,
        detail: `"${truncate(value, 60)}" should NOT appear but does`,
      }
    : { ok: true, kind: meta.kind, reason: meta.reason };
}

function scoreSectionContains(
  html: string,
  expectation: {
    kind: "section-contains";
    section: string;
    value: string;
    caseSensitive?: boolean;
    reason: string;
  },
): ScoreResult {
  const section = findSectionContent(html, expectation.section);
  if (section === null) {
    return {
      ok: false,
      kind: expectation.kind,
      reason: expectation.reason,
      detail: `section "${expectation.section}" not found in the note`,
    };
  }
  const hay = expectation.caseSensitive ? section : section.toLowerCase();
  const needle = expectation.caseSensitive
    ? expectation.value
    : expectation.value.toLowerCase();
  return hay.includes(needle)
    ? { ok: true, kind: expectation.kind, reason: expectation.reason }
    : {
        ok: false,
        kind: expectation.kind,
        reason: expectation.reason,
        detail: `"${truncate(expectation.value, 60)}" not in section "${expectation.section}"`,
      };
}

function scoreSectionNotContains(
  html: string,
  expectation: {
    kind: "section-not-contains";
    section: string;
    value: string;
    caseSensitive?: boolean;
    reason: string;
  },
): ScoreResult {
  const section = findSectionContent(html, expectation.section);
  if (section === null) {
    // When the section is absent the "must not contain" passes vacuously —
    // the value isn't in a section that doesn't exist.
    return { ok: true, kind: expectation.kind, reason: expectation.reason };
  }
  const hay = expectation.caseSensitive ? section : section.toLowerCase();
  const needle = expectation.caseSensitive
    ? expectation.value
    : expectation.value.toLowerCase();
  return hay.includes(needle)
    ? {
        ok: false,
        kind: expectation.kind,
        reason: expectation.reason,
        detail: `"${truncate(expectation.value, 60)}" should NOT appear in "${expectation.section}" but does`,
      }
    : { ok: true, kind: expectation.kind, reason: expectation.reason };
}

function scoreSectionPresent(
  html: string,
  expectation: { kind: "section-present"; section: string; reason: string },
): ScoreResult {
  const section = findSectionContent(html, expectation.section);
  if (section === null) {
    return {
      ok: false,
      kind: expectation.kind,
      reason: expectation.reason,
      detail: `section "${expectation.section}" not found`,
    };
  }
  const stripped = stripTags(section).trim();
  return stripped.length > 0
    ? { ok: true, kind: expectation.kind, reason: expectation.reason }
    : {
        ok: false,
        kind: expectation.kind,
        reason: expectation.reason,
        detail: `section "${expectation.section}" is empty`,
      };
}

function scoreSectionEmpty(
  html: string,
  expectation: { kind: "section-empty"; section: string; reason: string },
): ScoreResult {
  const section = findSectionContent(html, expectation.section);
  if (section === null) {
    // Absent counts as empty.
    return { ok: true, kind: expectation.kind, reason: expectation.reason };
  }
  const stripped = stripTags(section).trim();
  return stripped.length === 0
    ? { ok: true, kind: expectation.kind, reason: expectation.reason }
    : {
        ok: false,
        kind: expectation.kind,
        reason: expectation.reason,
        detail: `section "${expectation.section}" should be empty but has: "${truncate(stripped, 80)}"`,
      };
}

function scoreIcdInZaver(
  html: string,
  code: string,
  meta: { kind: Expectation["kind"]; reason: string },
): ScoreResult {
  const zaver = findSectionContent(html, "Záver") ?? findSectionContent(html, "Zaver") ?? findSectionContent(html, "Závěr");
  if (zaver === null) {
    return {
      ok: false,
      kind: meta.kind,
      reason: meta.reason,
      detail: `Záver section not found`,
    };
  }
  // ICD codes are matched as whole tokens — match "I34.0" but not
  // "I34.01" when looking for "I34.0", unless the needle IS "I34".
  const pattern = new RegExp(`\\b${escapeRegex(code)}\\b`);
  return pattern.test(stripTags(zaver))
    ? { ok: true, kind: meta.kind, reason: meta.reason }
    : {
        ok: false,
        kind: meta.kind,
        reason: meta.reason,
        detail: `ICD code ${code} not in Záver`,
      };
}

function scoreIcdNotInZaver(
  html: string,
  code: string,
  meta: { kind: Expectation["kind"]; reason: string },
): ScoreResult {
  const zaver = findSectionContent(html, "Záver") ?? findSectionContent(html, "Zaver") ?? findSectionContent(html, "Závěr");
  if (zaver === null) {
    return { ok: true, kind: meta.kind, reason: meta.reason };
  }
  const pattern = new RegExp(`\\b${escapeRegex(code)}\\b`);
  return pattern.test(stripTags(zaver))
    ? {
        ok: false,
        kind: meta.kind,
        reason: meta.reason,
        detail: `ICD code ${code} should NOT be in Záver but is`,
      }
    : { ok: true, kind: meta.kind, reason: meta.reason };
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Locate a section's body in the generated HTML by its heading label.
 * Matches at ANY heading level (h1–h4) so `h3` subsections nested under
 * an `h2` parent (LA under Anamnézy) are findable by their subsection
 * label. Returns the section body HTML up to the next heading of equal
 * or higher level, or end-of-document. Null on miss.
 *
 * Comparison is case-insensitive + diacritic-stripped. Trailing colons
 * / punctuation on the label ("LA:", "LA: ") are tolerated.
 */
function findSectionContent(html: string, label: string): string | null {
  const target = normalize(label);
  // Match every heading tag anywhere in the HTML, capturing level + text.
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(html)) !== null) {
    const level = Number(match[1]);
    const title = decodeEntities(match[2]);
    if (normalize(title) !== target) continue;
    // Section body starts after this heading and ends before the next
    // heading of level <= this one.
    const bodyStart = match.index + match[0].length;
    const stopRe = new RegExp(
      `<h([1-${level}])[^>]*>`,
      "gi",
    );
    stopRe.lastIndex = bodyStart;
    const stop = stopRe.exec(html);
    const bodyEnd = stop ? stop.index : html.length;
    return html.slice(bodyStart, bodyEnd);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    // Tolerate trailing colon/punctuation on section labels ("LA:", "LA: ").
    .replace(/[:\s]+$/, "");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
