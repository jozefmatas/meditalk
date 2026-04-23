#!/usr/bin/env tsx
/**
 * Eval runner entry point.
 *
 * Loads .env.local BEFORE importing anything from src/ (env.ts modules
 * throw on import when NEXT_PUBLIC_SUPABASE_URL is missing), then
 * dynamically imports the runner + fixtures and runs the suite.
 *
 * Usage:
 *   npm run eval              # all fixtures
 *   npm run eval <id>         # single fixture by id
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Module from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shim `server-only` — its default export unconditionally throws
// outside a Next.js client/server boundary. The eval runner legitimately
// uses server-side code from a Node CLI, so we alias the module to a
// no-op before any transitive import can trigger the throw.
(function shimServerOnly() {
  // tsx transpiles this file to CJS; Module._load is the intercept point.
  const originalLoad = (
    Module as unknown as {
      _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    }
  )._load;
  (
    Module as unknown as {
      _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    }
  )._load = function (
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
})();

function loadEnv(): void {
  const envRaw = readFileSync(join(__dirname, "..", ".env.local"), "utf-8");
  for (const line of envRaw.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    const k = l.substring(0, i).trim();
    let v = l.substring(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main(): Promise<void> {
  try {
    loadEnv();
  } catch (err) {
    console.error("Failed to load .env.local:", err);
    process.exit(1);
  }

  // Dynamic imports — the env modules in src/lib/env/* throw on module
  // load when the expected vars are missing. Keep these AFTER loadEnv.
  const { runSuite, printSuiteReport } =
    await import("../src/lib/evals/runner");
  const { EvalFixture } = await import("../src/lib/evals/types").then((m) => ({
    EvalFixture: null as unknown,
    ...m,
  }));
  void EvalFixture;

  // Fixtures registry — real encounters with doctor-corrected gold notes.
  const { mordavskaNstemi } =
    await import("../src/lib/evals/fixtures/mordavska-nstemi");
  const { kovacikovaReal } =
    await import("../src/lib/evals/fixtures/kovacikova-real");
  const { gozoraStemi } =
    await import("../src/lib/evals/fixtures/gozora-stemi");
  const ALL_FIXTURES: Array<import("../src/lib/evals/types").EvalFixture> = [
    mordavskaNstemi,
    kovacikovaReal,
    gozoraStemi,
  ];

  const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const fixtures = filter
    ? ALL_FIXTURES.filter((f) => f.id === filter)
    : ALL_FIXTURES;

  if (fixtures.length === 0) {
    if (ALL_FIXTURES.length === 0) {
      console.error(
        "No fixtures registered yet. Add one under src/lib/evals/fixtures/ and import it here.",
      );
    } else {
      console.error(`No fixture matched id=${filter ?? "(none)"}`);
      console.error(`Available: ${ALL_FIXTURES.map((f) => f.id).join(", ")}`);
    }
    process.exit(1);
  }

  console.log(`Running ${fixtures.length} fixture(s)…`);
  const result = await runSuite(fixtures);
  printSuiteReport(result);
  process.exit(result.totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Eval runner crashed:", err);
  process.exit(1);
});
