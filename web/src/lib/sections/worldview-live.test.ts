// @vitest-environment node
/**
 * Live end-to-end check that `template.systemPrompt` actually reaches
 * Claude and changes its output. Runs a section render twice against
 * the same fixture — once with NO template prompt, once with a sharp
 * worldview instruction — and prints both outputs so we can see the
 * difference.
 *
 * Gated behind `LIVE_LLM=1`.
 *
 * Command:
 *   LIVE_LLM=1 npx vitest run src/lib/sections/worldview-live.test.ts --disable-console-intercept
 */
import { describe, it, expect } from "vitest";
import {
  renderSection,
  type RawSource,
  type SectionConfig,
} from "./section-agent";

const RAW = `Transcript: Tá pacientka má hypertenziu a fibriláciu predsiení, bola jej urobená strumektomia v roku 2018. Lieky: Rytmonorm 1-0-1, Eliquis 5mg ráno a večer.`;

const OA_CONTRACT = `Personal medical history — chronic conditions, past surgeries, comorbidities.

Comma-separated list in Slovak. Preserve verbatim clinical wording.`;

describe.skipIf(process.env.LIVE_LLM !== "1")(
  "Worldview reaches Claude — live",
  () => {
    const source: RawSource = { transcript: RAW };
    const config: SectionConfig = {
      id: "oa",
      title: "OA",
      model: "haiku",
      context: OA_CONTRACT,
    };

    it("baseline (no worldview) vs with-worldview produce different outputs", async () => {
      const baseline = await renderSection(source, config, [], "sk");

      const worldview = `CRITICAL FORMATTING RULE: Prefix every diagnosis with "DX:" (e.g. "DX: Hypertenzia, DX: Fibrilácia…"). This must appear on every item.`;

      const withWorldview = await renderSection(
        source,
        config,
        [],
        "sk",
        undefined,
        worldview,
      );

      console.log("\n===== OA (baseline, no worldview) =====");
      console.log(baseline.content);
      console.log("\n===== OA (with worldview: DX: prefix) =====");
      console.log(withWorldview.content);
      console.log("========================================\n");

      // Strong assertion: when the worldview demanded "DX:" on every item,
      // at least some items in the output must carry it.
      expect(withWorldview.content).toMatch(/DX:/i);
      // And baseline should NOT contain "DX:" (nothing asked for it).
      expect(baseline.content).not.toMatch(/DX:/i);
    }, 120_000);
  },
);
