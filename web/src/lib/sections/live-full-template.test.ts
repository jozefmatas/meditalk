// @vitest-environment node
/**
 * Live end-to-end run against the Targeted Cardiology template from the
 * DB + the Kovačiková fixture — proves whether the current pipeline +
 * current contexts produce correctly-aligned section output.
 *
 * Gated behind LIVE_LLM=1.
 * Command:
 *   LIVE_LLM=1 npx vitest run src/lib/sections/live-full-template.test.ts --disable-console-intercept
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generateNote } from "./pipeline";
import type { RawSource } from "./section-agent";

const RAW_PATH =
  process.env.RAW_PATH ??
  "/Users/jozefmatas/conductor/workspaces/meditalk/wellington/.context/attachments/pasted_text_2026-04-21_08-55-39.txt";

function loadEnv(): Record<string, string> {
  const raw = readFileSync(
    "/Users/jozefmatas/conductor/workspaces/meditalk/wellington/web/.env.local",
    "utf-8",
  );
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    const i = l.indexOf("=");
    let v = l.substring(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[l.substring(0, i).trim()] = v;
  }
  return out;
}

function parseRaw(raw: string): RawSource {
  const transcriptIdx = raw.indexOf("Transcript:");
  const ocrIdx = raw.indexOf("OCR:");
  const transcript =
    transcriptIdx >= 0
      ? raw
          .substring(
            transcriptIdx + "Transcript:".length,
            ocrIdx > transcriptIdx ? ocrIdx : raw.length,
          )
          .trim()
      : undefined;
  const ocr =
    ocrIdx >= 0 ? raw.substring(ocrIdx + "OCR:".length).trim() : undefined;
  return {
    transcript,
    files: ocr ? [{ name: "referral.txt", text: ocr }] : undefined,
  };
}

describe.skipIf(process.env.LIVE_LLM !== "1")(
  "Targeted Cardiology template — full live run",
  () => {
    it("produces each section's content at its correct slot", async () => {
      const env = loadEnv();
      const sb = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );
      const { data, error } = await sb
        .from("templates")
        .select("id, name, sections, system_prompt")
        .eq("id", "t_KZPRXwjQye")
        .single();
      if (error || !data) throw error ?? new Error("no template");

      const template = {
        id: data.id,
        name: data.name,
        description: {},
        sections: data.sections,
        systemPrompt: data.system_prompt,
      };

      const source: RawSource = parseRaw(readFileSync(RAW_PATH, "utf-8"));

      const result = await generateNote({
        template: template,
        source,
        language: "sk",
        onSection: (s) =>
          console.log(
            `\n── ${s.title} (id=${s.id}) ${"─".repeat(Math.max(0, 40 - s.title.length))}`,
            `\n${s.content || "(empty)"}\n`,
          ),
      });

      // Print the mapping so we can confirm alignment.
      console.log("\n\n===== FINAL id → content preview =====");
      for (const s of result.sections) {
        const preview = (s.content || "(empty)")
          .slice(0, 80)
          .replace(/\n/g, " ");
        console.log(
          `  ${s.title.padEnd(28)} id=${s.id.padEnd(14)} → ${preview}`,
        );
      }

      expect(result.sections.length).toBeGreaterThan(5);
    }, 600_000);
  },
);
