/**
 * Eval harness types.
 *
 * A fixture pairs a real encounter source with a list of assertions
 * about the generated note. The runner loads a fixture, runs the
 * current production pipeline against its source, then applies every
 * scorer — each returning `{ ok, message }`. Output is a pass/fail
 * matrix printed to the console.
 *
 * Style: assertions, not full expected outputs. "Záver must contain
 * I34.0" instead of "Záver must equal '<long canonical string>'".
 * Prompt changes that don't break our clinical guarantees should
 * still pass.
 */
import type { RawSource } from "../sections/section-agent";

export type EvalLanguage = "sk" | "cs" | "en";

export interface EvalFixture {
  /** Stable id — used in log output and as the test name. */
  id: string;
  /** Human-readable description ("Kovačiková chest pain, paroxysmal AF"). */
  description: string;
  /** Template id used for generation (e.g. the default cardiology template). */
  templateId: string;
  language: EvalLanguage;
  source: RawSource;
  expectations: Expectation[];
}

/**
 * Sum type — every assertion we can make against a generated note.
 * Keep this list small and composable; complex assertions should
 * decompose into multiple simple ones rather than a new kind.
 */
export type Expectation =
  | ContainsExpectation
  | NotContainsExpectation
  | SectionContainsExpectation
  | SectionNotContainsExpectation
  | SectionPresentExpectation
  | SectionEmptyExpectation
  | IcdInZaverExpectation
  | IcdNotInZaverExpectation;

interface BaseExpectation {
  /** Short human-readable rationale for the assertion. Printed on failure. */
  reason: string;
}

export interface ContainsExpectation extends BaseExpectation {
  kind: "contains";
  /** Substring that must appear anywhere in the final HTML note. */
  value: string;
  /** When `caseSensitive: false`, both sides are lowercased before comparing. */
  caseSensitive?: boolean;
}

export interface NotContainsExpectation extends BaseExpectation {
  kind: "not-contains";
  value: string;
  caseSensitive?: boolean;
}

export interface SectionContainsExpectation extends BaseExpectation {
  kind: "section-contains";
  /** Template section label (case-insensitive, diacritic-insensitive match). */
  section: string;
  value: string;
  caseSensitive?: boolean;
}

export interface SectionNotContainsExpectation extends BaseExpectation {
  kind: "section-not-contains";
  section: string;
  value: string;
  caseSensitive?: boolean;
}

export interface SectionPresentExpectation extends BaseExpectation {
  kind: "section-present";
  section: string;
}

export interface SectionEmptyExpectation extends BaseExpectation {
  kind: "section-empty";
  section: string;
}

export interface IcdInZaverExpectation extends BaseExpectation {
  kind: "icd-in-zaver";
  /** ICD-10 code exactly as it should appear in Záver. */
  code: string;
}

export interface IcdNotInZaverExpectation extends BaseExpectation {
  kind: "icd-not-in-zaver";
  code: string;
}

/**
 * Output per assertion. `ok: false` produces a one-line failure report
 * in the runner's summary.
 */
export interface ScoreResult {
  ok: boolean;
  kind: Expectation["kind"];
  reason: string;
  /** Extra context on failure — e.g. where we actually looked. */
  detail?: string;
}

export interface FixtureResult {
  fixtureId: string;
  description: string;
  scores: ScoreResult[];
  /** True when every score is ok. */
  passed: boolean;
  /** Wall-clock generation time for this fixture. */
  elapsedMs: number;
  /** The generated HTML note — saved for post-run inspection. */
  generatedNote: string;
}

export interface EvalSuiteResult {
  fixtures: FixtureResult[];
  totalPassed: number;
  totalFailed: number;
  elapsedMs: number;
}
