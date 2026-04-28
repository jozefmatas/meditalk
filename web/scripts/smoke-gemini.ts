/**
 * Smoke test for the Gemini provider. Runs one free-text call and one
 * forced-tool-use call so we know the wiring — auth, tool translation,
 * thinking level, usage metadata — is correct.
 *
 * Usage:
 *   pnpm exec tsx scripts/smoke-gemini.ts
 *   MODEL=gemini-3.1-pro pnpm exec tsx scripts/smoke-gemini.ts
 *   MODEL=gemini-2.5-flash pnpm exec tsx scripts/smoke-gemini.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env.local manually — matches the pattern in run-evals.ts and
// avoids adding `dotenv` as a dependency for one script.
function loadEnv(): void {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
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
  } catch {
    // .env.local optional — script can also be run with env vars in the shell.
  }
}
loadEnv();

import { VertexGeminiProvider } from "../src/lib/models/providers/vertex-gemini";

async function main() {
  const model = (process.env.MODEL ?? "gemini-3.1-pro") as
    | "gemini-3.1-pro"
    | "gemini-3.1-flash"
    | "gemini-3.1-flash-lite"
    | "gemini-2.5-pro"
    | "gemini-2.5-flash";

  console.log(`\n=== Smoke test — ${model} ===\n`);

  // Gemini 3.x supports thinkingLevel; 2.5 does not. Pass it only on 3-series.
  const thinkingLevel = /^gemini-3/.test(model) ? "LOW" : undefined;
  const provider = new VertexGeminiProvider({ model, thinkingLevel });

  // 1) Free-text Slovak prompt.
  console.log("1) Free-text call...");
  const t0 = Date.now();
  const free = await provider.generate({
    system: [
      {
        text: "You are a Slovak clinical scribe. Respond in Slovak.",
      },
    ],
    user: "Napíš jednu vetu o infarkte myokardu.",
    maxTokens: 200,
  });
  console.log(`  text: ${free.text}`);
  console.log(
    `  usage: in=${free.usage.inputTokens} out=${free.usage.outputTokens} cacheRead=${free.usage.cacheReadTokens ?? 0} — ${Date.now() - t0}ms`,
  );

  // 2) Forced tool-use (mirrors the critic's shape).
  console.log("\n2) Forced tool-use call...");
  const t1 = Date.now();
  const tool = await provider.generate({
    system: [
      {
        text: "You audit a Slovak clinical note for invention. Return only what the source supports.",
      },
    ],
    user: "# Raw source\nPacient berie Anopyrin 100 mg 1-0-0.\n\n# Draft\nAnopyrin 100 mg 1-0-0, Warfarin 5 mg",
    maxTokens: 500,
    tool: {
      name: "submit_corrected_section",
      description: "Return the corrected section text.",
      schema: {
        type: "object",
        properties: {
          corrected: {
            type: "string",
            description: "Corrected section body.",
          },
        },
        required: ["corrected"],
      },
    },
  });
  console.log(`  toolInput: ${JSON.stringify(tool.toolInput)}`);
  console.log(
    `  usage: in=${tool.usage.inputTokens} out=${tool.usage.outputTokens} cacheRead=${tool.usage.cacheReadTokens ?? 0} — ${Date.now() - t1}ms`,
  );

  console.log("\n=== OK ===\n");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
