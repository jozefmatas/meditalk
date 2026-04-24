/**
 * Eval runner.
 *
 * Loads fixtures, runs the real generation pipeline against each, scores
 * every expectation, and prints a pass/fail matrix. Mirrors what the
 * generate route does (extract sources → render sections → critic →
 * reconcilers → Záver suggester + critic + validator → HTML).
 *
 * Not a Vitest suite — this is a standalone script so we can run it ad
 * hoc (`npm run eval`) and during prompt / model iteration without
 * going through the full test stack or the HTTP route.
 */
import { createClient } from "@supabase/supabase-js";
import {
  generateNote,
  findZaverSection,
  runCriticAndReconcilers,
} from "../sections/pipeline";
import { suggestIcdCodes } from "../sections/suggest-icd";
import { extractSkeleton } from "../sections/note-skeleton";
import { formatZaverFromSuggestions } from "../sections/format-zaver";
import { buildTemplateHtml, flattenSectionIds } from "../templates/html";
import { buildSectionLabelsFromTemplate } from "../templates";
import type { Template, TemplateSection } from "../templates/types";
import type { RenderedSection } from "../sections/section-agent";
import { scoreExpectation } from "./scorers";
import type {
  EvalFixture,
  EvalSuiteResult,
  FixtureResult,
  ScoreResult,
} from "./types";

/**
 * Load a template from Supabase by id. The eval harness uses real
 * production templates so the assertions apply to the same prompts
 * and section contracts users see.
 */
async function loadTemplate(templateId: string): Promise<Template> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Run evals with .env.local loaded (see scripts/run-evals.mjs).",
    );
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (error || !data) {
    throw new Error(
      `Template ${templateId} not found: ${error?.message ?? "unknown"}`,
    );
  }
  return {
    id: data.id,
    name: data.name as Record<string, string>,
    description: (data.description as Record<string, string>) ?? {},
    sections: data.sections as TemplateSection[],
    systemPrompt: (data.system_prompt as string) ?? undefined,
    styleExamples:
      (data.style_examples as { name: string; text: string }[]) ?? undefined,
    specialties: (data.specialties as string[]) ?? undefined,
    locales: (data.locales as string[]) ?? undefined,
    isSystem: data.is_system as boolean,
    sourceTemplateId: (data.source_template_id as string) ?? undefined,
  };
}

/** Run the production pipeline on a fixture, return the final HTML note. */
async function generateForFixture(fixture: EvalFixture): Promise<string> {
  const template = await loadTemplate(fixture.templateId);
  const allIds = flattenSectionIds(template);
  const sectionLabels = buildSectionLabelsFromTemplate(
    template,
    fixture.language,
  );
  void allIds; // reserved for future per-section assertions

  const sectionContentsMap: Record<string, string> = {};

  // Skeleton + ICD suggester kick off in parallel; skeleton must land
  // before section rendering starts so renderers see it.
  const skeletonPromise = extractSkeleton(fixture.source, fixture.language);
  const suggesterPromise = suggestIcdCodes(fixture.source, fixture.language);
  const skeleton = await skeletonPromise;

  const sectionsPromise = generateNote({
    template,
    source: fixture.source,
    language: fixture.language,
    skeleton,
    onSection: (section: RenderedSection) => {
      sectionContentsMap[section.id] = section.content;
    },
  });

  const [, suggestedIcdCodes] = await Promise.all([
    sectionsPromise,
    suggesterPromise,
  ]);

  const zaver = findZaverSection(
    template,
    fixture.language as "sk" | "cs" | "en",
  );
  if (zaver) {
    const draft = formatZaverFromSuggestions(suggestedIcdCodes);
    const finalZaver = draft
      ? await runCriticAndReconcilers({
          draftContent: draft,
          source: fixture.source,
          config: {
            id: zaver.id,
            title: zaver.title,
            context: zaver.context,
            model: "haiku",
            reconcilers: zaver.reconcilers,
            critic: zaver.critic,
            kind: zaver.kind,
          },
          language: fixture.language as "sk" | "cs" | "en",
          templateSystemPrompt: template.systemPrompt,
          skeleton,
        })
      : draft;
    sectionContentsMap[zaver.id] = finalZaver;
  }

  return buildTemplateHtml(template, sectionContentsMap, sectionLabels, {
    skipEmpty: true,
  });
}

/**
 * Run every expectation against a fixture. Returns the pass/fail
 * breakdown; caller prints.
 */
export async function runFixture(fixture: EvalFixture): Promise<FixtureResult> {
  const t0 = Date.now();
  let generatedNote: string;
  try {
    generatedNote = await generateForFixture(fixture);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      fixtureId: fixture.id,
      description: fixture.description,
      scores: [
        {
          ok: false,
          kind: "contains",
          reason: "pipeline ran without throwing",
          detail: `generation failed: ${msg}`,
        },
      ],
      passed: false,
      elapsedMs: Date.now() - t0,
      generatedNote: "",
    };
  }

  const scores: ScoreResult[] = fixture.expectations.map((e) =>
    scoreExpectation(generatedNote, e),
  );
  const passed = scores.every((s) => s.ok);

  return {
    fixtureId: fixture.id,
    description: fixture.description,
    scores,
    passed,
    elapsedMs: Date.now() - t0,
    generatedNote,
  };
}

export async function runSuite(
  fixtures: EvalFixture[],
): Promise<EvalSuiteResult> {
  const t0 = Date.now();
  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    const r = await runFixture(fixture);
    results.push(r);
  }
  return {
    fixtures: results,
    totalPassed: results.filter((r) => r.passed).length,
    totalFailed: results.filter((r) => !r.passed).length,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * Human-readable console report. Each fixture gets a status line,
 * each failing expectation gets one detail line.
 */
export function printSuiteReport(result: EvalSuiteResult): void {
  const bar = "─".repeat(70);
  console.log(`\n${bar}\n EVAL SUITE\n${bar}`);

  for (const f of result.fixtures) {
    const status = f.passed ? "✓ PASS" : "✗ FAIL";
    const passCount = f.scores.filter((s) => s.ok).length;
    const failCount = f.scores.length - passCount;
    console.log(
      `\n${status}  ${f.fixtureId} — ${f.description}  [${passCount}/${f.scores.length} ok, ${(f.elapsedMs / 1000).toFixed(1)}s]`,
    );
    for (const s of f.scores) {
      if (s.ok) continue;
      const indent = "    ";
      console.log(`${indent}- ${s.reason}`);
      if (s.detail) console.log(`${indent}  ${s.detail}`);
    }
    void failCount;
    if (process.env.EVAL_VERBOSE === "1") {
      console.log(`\n    --- Generated note (${f.fixtureId}) ---`);
      console.log(f.generatedNote);
      console.log(`    --- end ---\n`);
    }
  }

  console.log(`\n${bar}`);
  console.log(
    ` Total: ${result.totalPassed}/${result.fixtures.length} fixtures passed in ${(result.elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(`${bar}\n`);
}
