// @vitest-environment node
/**
 * LA section — end-to-end proof of the section-agent pattern.
 *
 * Runs the *real* Claude call against the Kovačiková raw source (a
 * transcript + OCR discharge note). Lives behind `LIVE_LLM=1` so it
 * doesn't fire in the normal test suite.
 *
 * Command:
 *   LIVE_LLM=1 npx vitest run src/lib/sections/la-proof.test.ts
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  renderSection,
  type RawSource,
  type SectionConfig,
} from "./section-agent";

const RAW_PATH =
  "/Users/jozefmatas/conductor/workspaces/meditalk/wellington/.context/attachments/pasted_text_2026-04-21_08-55-39.txt";

const LA_CONTRACT = `ALL medications — both chronic home medications AND medications administered during this encounter (Heparin, Aspirin, morphine, etc. given by ambulance or in ED).

List ALL medications ONLY here, NEVER in OA, HPI, or any other section.

Format:
- One medication per line.
- Include dose and frequency whenever the source provides them.
- Preserve Slovak dose-frequency notation verbatim ("1-0-1", "1-0-0", "ráno a večer", "podľa potreby").
- Use the brand name the doctor actually wrote. Do NOT rename, translate, or normalize.
- Drop any negated or discontinued medication ("vysadené", "neberie", "prestala").
- Do not invent doses or frequencies that the source does not explicitly state.`;

const OA_CONTRACT = `Personal medical history — all chronic conditions, past diagnoses, past surgeries/procedures ("stav po"), long-standing comorbidities the patient already has coming INTO this encounter.

List ALL personal history ONLY here, NEVER in LA, AA, RA, SA, PA, Abúzy, HPI (TO), or Záver.

EXCLUDE:
- The current encounter's acute diagnosis / differential (it belongs to Záver).
- Current medications (they belong to LA).
- Allergies (they belong to AA).
- Family history — parents, siblings, spouse, children (belongs to RA).
- Social / living situation (belongs to SA).
- Occupational history (belongs to PA).
- Tobacco / alcohol / drugs (belongs to Abúzy).
- Present-illness narrative of today's complaint (belongs to TO).

Format:
- Single comma-separated sentence in Slovak prose, ending with a period.
- Use the doctor's canonical clinical wording exactly as written in the source ("stav po strumektómii", "hypertenzia III. stupňa", "paroxyzmálna fibrilácia predsiení", "stredne závažná mitrálna regurgitácia", "kŕčové žily").
- Preserve Slovak abbreviations verbatim (st.p., ICHS, Mi. regurg., AV blok 1. stupňa).
- Preserve staging / severity qualifiers (III. stupňa, kompenzovaná, paroxyzmálna, stredne závažná).
- No ICD codes here — codes belong to Záver.
- Do NOT include conditions the patient explicitly denied or corrected.`;

describe.skipIf(process.env.LIVE_LLM !== "1")(
  "Section-agent — live end-to-end",
  () => {
    it("renders LA, then OA with LA as prior context", async () => {
      const raw = readFileSync(RAW_PATH, "utf-8");
      const source = parseRawFixture(raw);

      const la: SectionConfig = {
        id: "la",
        title: "LA",
        model: "haiku",
        context: LA_CONTRACT,
      };
      const oa: SectionConfig = {
        id: "oa",
        title: "OA",
        model: "haiku",
        context: OA_CONTRACT,
      };

      const laResult = await renderSection(source, la, "sk");
      console.log("\n================= LA section =================\n");
      console.log(laResult.content);
      console.log("\n==============================================\n");

      const oaResult = await renderSection(source, oa, "sk");
      console.log("\n================= OA section =================\n");
      console.log(oaResult.content);
      console.log("\n==============================================\n");

      expect(laResult.content.length).toBeGreaterThan(20);
      expect(oaResult.content.length).toBeGreaterThan(20);
    }, 180_000);
  },
);

function parseRawFixture(raw: string): RawSource {
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
