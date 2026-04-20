import { describe, it, expect } from "vitest";
import { enforceContentRouting } from "./section-routing-validator";

describe("enforceContentRouting", () => {
  const labels: Record<string, string> = {
    s_oa: "OA",
    s_la: "LA",
    s_sa: "SA",
    s_ab: "Ab",
    s_ra: "RA",
    s_plan: "Plán",
  };
  const contexts: Record<string, string> = {
    s_oa: "Osobná anamnéza (Past medical history). Vlastné ochorenia.",
    s_la: "Lieková anamnéza (Current medications). Všetky lieky.",
    s_sa: "Sociálna anamnéza (Social history). Rodinný stav, bývanie.",
    s_ab: "Abúzy (Substance use). Fajčenie, alkohol, drogy.",
    s_ra: "Rodinná anamnéza (Family history).",
    s_plan: "Plán liečby. Odporúčania.",
  };

  // -----------------------------------------------------------------------
  // Rule 1: Medication blocks stripped from non-medication sections
  // -----------------------------------------------------------------------

  it("strips medication list block from OA section", () => {
    const contents: Record<string, string> = {
      s_oa: [
        "Hypertenzia od roku 2010.",
        "Chronická medikácia:",
        "Bisoprolol 5 mg 1-0-0",
        "Ramipril 10 mg 1-0-0",
        "Atorvastatin 20 mg 0-0-1",
      ].join("\n"),
      s_la: "Bisoprolol 5 mg 1-0-0\nRamipril 10 mg 1-0-0",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result.s_oa).not.toContain("Bisoprolol");
    expect(result.s_oa).not.toContain("Ramipril");
    expect(result.s_oa).not.toContain("Atorvastatin");
    expect(result.s_oa).toContain("Hypertenzia od roku 2010");
  });

  it("preserves medication list in LA section", () => {
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: [
        "Bisoprolol 5 mg 1-0-0",
        "Ramipril 10 mg 1-0-0",
        "Atorvastatin 20 mg 0-0-1",
        "Eliquis 5 mg 1-0-1",
      ].join("\n"),
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result.s_la).toContain("Bisoprolol 5 mg");
    expect(result.s_la).toContain("Ramipril 10 mg");
    expect(result.s_la).toContain("Atorvastatin 20 mg");
    expect(result.s_la).toContain("Eliquis 5 mg");
  });

  it("preserves medication references in plan sections", () => {
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: [
        "Ordinujem Aspirin 100 mg 1-0-0",
        "Heparin 5000 IU s.c. 2x denne",
        "Kontrola o 2 týždne",
        "Bisoprolol 5 mg 1-0-0 ponechať",
      ].join("\n"),
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result.s_plan).toContain("Aspirin 100 mg");
    expect(result.s_plan).toContain("Heparin 5000 IU");
    expect(result.s_plan).toContain("Bisoprolol 5 mg");
  });

  it("preserves historical medication mentions in OA with narrative context", () => {
    const contents: Record<string, string> = {
      s_oa: [
        "Hypertenzia od roku 2010.",
        "V minulosti užíval Warfarin 5 mg, vysadený pre krvácanie.",
        "DM 2. typu liečený Metforminom od roku 2015.",
      ].join("\n"),
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // These have narrative context, should be preserved
    expect(result.s_oa).toContain("Warfarin 5 mg");
    expect(result.s_oa).toContain("Metforminom");
  });

  // -----------------------------------------------------------------------
  // Rule 2: Substance use stripped from non-Ab sections
  // -----------------------------------------------------------------------

  it("strips substance use content from SA section", () => {
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: [
        "Ženatý, žije s manželkou.",
        "Fajčí 15 cigariet denne.",
        "Alkohol príležitostne.",
      ].join("\n"),
      s_ab: "Fajčí 15 cigariet denne. Alkohol príležitostne.",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result.s_sa).not.toContain("Fajčí");
    expect(result.s_sa).not.toContain("Alkohol");
    expect(result.s_sa).toContain("Ženatý");
  });

  it("preserves substance use content in Ab section", () => {
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: "",
      s_ab: "Fajčí 15 cigariet denne od 20 rokov.\nAlkohol príležitostne, pivo 2-3x týždenne.",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result.s_ab).toContain("Fajčí 15 cigariet denne");
    expect(result.s_ab).toContain("Alkohol príležitostne");
  });

  // -----------------------------------------------------------------------
  // Rule 3: Allergy content stripped from non-AA sections
  // -----------------------------------------------------------------------

  it("strips allergy content from EA section", () => {
    const labelsWithEaAa: Record<string, string> = {
      ...labels,
      s_ea: "EA",
      s_aa: "AA",
    };
    const contextsWithEaAa: Record<string, string> = {
      ...contexts,
      s_ea: "Epidemiologická anamnéza. Cestovanie, kontakt s infekciami.",
      s_aa: "Alergická anamnéza. Liekové, potravinové a environmentálne alergie.",
    };
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
      s_ea: [
        "Cestovanie do Talianska v roku 2024.",
        "Bez známych alergií.",
        "Očkovanie proti COVID-19.",
      ].join("\n"),
      s_aa: "Bez známych alergií.",
    };

    const result = enforceContentRouting(
      contents,
      labelsWithEaAa,
      contextsWithEaAa,
    );
    expect(result.s_ea).not.toContain("alergií");
    expect(result.s_ea).toContain("Cestovanie do Talianska");
    expect(result.s_ea).toContain("Očkovanie proti COVID-19");
  });

  it("preserves allergy content in AA section", () => {
    const labelsWithAa: Record<string, string> = {
      ...labels,
      s_aa: "AA",
    };
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
      s_aa: "Alergia na penicilin. Bez precitlivenosti na jód.",
    };

    const result = enforceContentRouting(contents, labelsWithAa);
    expect(result.s_aa).toContain("Alergia na penicilin");
    expect(result.s_aa).toContain("precitlivenosti");
  });

  it("strips allergy content from OA section", () => {
    const labelsWithAa: Record<string, string> = {
      ...labels,
      s_aa: "AA",
    };
    const contents: Record<string, string> = {
      s_oa: [
        "Hypertenzia od roku 2010.",
        "Neguje alergie na lieky.",
        "DM 2. typu od roku 2015.",
      ].join("\n"),
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
      s_aa: "Neguje alergie na lieky.",
    };

    const result = enforceContentRouting(contents, labelsWithAa);
    expect(result.s_oa).not.toContain("alergie");
    expect(result.s_oa).toContain("Hypertenzia od roku 2010");
    expect(result.s_oa).toContain("DM 2. typu");
  });

  // -----------------------------------------------------------------------
  // Rule 4: Cross-section dedup OA↔LA
  // -----------------------------------------------------------------------

  it("deduplicates identical lines between OA and LA (keeps in LA)", () => {
    const sharedLine =
      "Chronická hypertenzia, DM 2. typu, ischemická choroba srdca.";
    const contents: Record<string, string> = {
      s_oa: `Hypertenzia od roku 2010.\n${sharedLine}`,
      s_la: `Bisoprolol 5 mg 1-0-0\n${sharedLine}`,
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // Stripped from OA, preserved in LA
    expect(result.s_oa).not.toContain(sharedLine);
    expect(result.s_la).toContain(sharedLine);
    // OA-specific content preserved
    expect(result.s_oa).toContain("Hypertenzia od roku 2010");
  });

  // -----------------------------------------------------------------------
  // Rule 5: Cross-section dedup SA↔Ab
  // -----------------------------------------------------------------------

  it("deduplicates identical lines between SA and Ab (keeps in Ab)", () => {
    const sharedLine = "Nefajčí, alkohol príležitostne, drogy neguje.";
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: `Ženatý, žije s manželkou.\n${sharedLine}`,
      s_ab: sharedLine,
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // The shared line will be stripped from SA by both Rule 2 (substance keywords)
    // and Rule 4 (dedup). Either way, it should not be in SA.
    expect(result.s_sa).not.toContain(sharedLine);
    expect(result.s_ab).toContain(sharedLine);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("does not modify empty sections", () => {
    const contents: Record<string, string> = {
      s_oa: "",
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result).toEqual(contents);
  });

  it("does not modify clean sections (no misrouted content)", () => {
    const contents: Record<string, string> = {
      s_oa: "Hypertenzia od roku 2010. DM 2. typu od roku 2015.",
      s_la: "Bisoprolol 5 mg 1-0-0\nRamipril 10 mg 1-0-0",
      s_sa: "Ženatý, žije s manželkou, 2 deti.",
      s_ab: "Nefajčí, alkohol príležitostne.",
      s_ra: "Otec DM, matka hypertenzia.",
      s_plan: "Kontrola o 2 týždne. Diéta.",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // OA should be unchanged (no med blocks, no substance use)
    expect(result.s_oa).toBe(contents.s_oa);
    // LA unchanged
    expect(result.s_la).toBe(contents.s_la);
    // SA unchanged (no substance keywords in "Ženatý, žije s manželkou, 2 deti.")
    expect(result.s_sa).toBe(contents.s_sa);
    // Ab unchanged
    expect(result.s_ab).toBe(contents.s_ab);
  });

  it("does not strip fewer than 3 medication lines (not a block)", () => {
    const contents: Record<string, string> = {
      s_oa: [
        "Hypertenzia od roku 2010.",
        "Bisoprolol 5 mg 1-0-0",
        "Ramipril 10 mg 1-0-0",
      ].join("\n"),
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // Only 2 med lines — below threshold, not stripped
    expect(result.s_oa).toContain("Bisoprolol");
    expect(result.s_oa).toContain("Ramipril");
  });

  it("strips med block with header + 2 medication lines", () => {
    const contents: Record<string, string> = {
      s_oa: [
        "Hypertenzia od roku 2010.",
        "Chronická medikácia:",
        "Bisoprolol 5 mg 1-0-0",
        "Ramipril 10 mg 1-0-0",
      ].join("\n"),
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    // Header + 2 med lines = block (threshold 2 with header)
    expect(result.s_oa).not.toContain("Bisoprolol");
    expect(result.s_oa).not.toContain("Ramipril");
    expect(result.s_oa).not.toContain("Chronická medikácia");
    expect(result.s_oa).toContain("Hypertenzia od roku 2010");
  });

  it("returns a new object (does not mutate input)", () => {
    const contents: Record<string, string> = {
      s_oa: "Bisoprolol 5 mg 1-0-0\nRamipril 10 mg 1-0-0\nAtorvastatin 20 mg 0-0-1",
      s_la: "",
      s_sa: "",
      s_ab: "",
      s_ra: "",
      s_plan: "",
    };

    const result = enforceContentRouting(contents, labels, contexts);
    expect(result).not.toBe(contents);
    // Original should be unchanged
    expect(contents.s_oa).toContain("Bisoprolol");
  });
});
