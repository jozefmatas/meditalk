// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isAbsenceDescription } from "./section-agent";

describe("isAbsenceDescription", () => {
  it("catches the exact failure modes we've seen in production", () => {
    // Observed in live runs:
    expect(isAbsenceDescription("(empty)")).toBe(true);
    expect(isAbsenceDescription("(empty string)")).toBe(true);
    expect(
      isAbsenceDescription("(No weight value found in source material)"),
    ).toBe(true);
    expect(
      isAbsenceDescription(
        "(No height value is explicitly stated in centimetres in the source documents)",
      ),
    ).toBe(true);
    expect(
      isAbsenceDescription(
        "(prázdne - výška a hmotnosť nie sú v zdroji uvedené)",
      ),
    ).toBe(true);
    expect(
      isAbsenceDescription(
        "V surových zdrojoch nie je explicitne uvedená hmotnosť pacienta v kilogramoch.",
      ),
    ).toBe(true);
    expect(
      isAbsenceDescription(
        "V dostupných zdrojoch nie je uvedená výška pacienta v centimetroch.",
      ),
    ).toBe(true);
    expect(
      isAbsenceDescription("Žiadne údaje o cestovaní neboli uvedené."),
    ).toBe(true);
    expect(
      isAbsenceDescription("BMI nie je možné vypočítať bez výšky a hmotnosti."),
    ).toBe(true);
    expect(isAbsenceDescription("Žiadna hmotnosť uvedená v zdroji.")).toBe(
      true,
    );
    expect(isAbsenceDescription("Žiadna výška uvedená v zdroji.")).toBe(true);
    expect(
      isAbsenceDescription("Žiadny údaj o hmotnosti nie je v zdroji."),
    ).toBe(true);
  });

  it("catches bare absence tokens", () => {
    expect(isAbsenceDescription("N/A")).toBe(true);
    expect(isAbsenceDescription("—")).toBe(true);
    expect(isAbsenceDescription("None")).toBe(true);
    expect(isAbsenceDescription("Not stated")).toBe(true);
    expect(isAbsenceDescription("Neuvedené")).toBe(true);
  });

  it("recognizes genuinely empty input", () => {
    expect(isAbsenceDescription("")).toBe(true);
    expect(isAbsenceDescription("   ")).toBe(true);
    expect(isAbsenceDescription("\n\n")).toBe(true);
  });

  it("preserves real clinical content — height/weight with value", () => {
    expect(isAbsenceDescription("175 cm")).toBe(false);
    expect(isAbsenceDescription("78 kg")).toBe(false);
    expect(isAbsenceDescription("BMI 24,8")).toBe(false);
  });

  it("preserves long narrative that happens to mention 'N/A' mid-sentence", () => {
    const narrative =
      "Pacient sa lieči na hypertenziu, fajčiar. V auguste 2025 mal úraz na rebrá. Aktuálny stav bez dyspnoe, bez edémov DK. Hodnoty boli N/A pri prvom meraní, ale pri druhom meraní 150/80 mmHg. Liečba pokračuje.";
    expect(isAbsenceDescription(narrative)).toBe(false);
  });

  it("preserves parentheticals that are actual clinical qualifiers", () => {
    // e.g. ".  (II. st)" or " (pri vyšetrení)" are valid qualifiers inside
    // real content — but as the WHOLE response, we only strip if the
    // parenthetical is describing absence. These short ones should stay.
    expect(isAbsenceDescription("(II. stupeň)")).toBe(false);
    expect(isAbsenceDescription("(pri vyšetrení)")).toBe(false);
  });

  it("strips English absence descriptions even in a Slovak context", () => {
    expect(
      isAbsenceDescription("No weight value found in the source material."),
    ).toBe(true);
    expect(isAbsenceDescription("Not available in the source.")).toBe(true);
    expect(
      isAbsenceDescription(
        "The source does not contain explicit height information.",
      ),
    ).toBe(true);
    expect(isAbsenceDescription("There is no mention of weight.")).toBe(true);
  });

  it("does NOT strip responses longer than the cap", () => {
    // Very-long outputs are assumed to be real content, not "describing absence".
    // Cap was raised 600 → 1500 when Haiku started producing multi-paragraph
    // reasoning essays. Use a long enough string to exceed the new cap.
    const long = "V surových zdrojoch " + "text ".repeat(500);
    expect(long.length).toBeGreaterThan(1500);
    expect(isAbsenceDescription(long)).toBe(false);
  });

  it("catches absence prose prefixed by the section label", () => {
    // Observed: "Hmotnosť nie je v zdrojoch uvedená."
    expect(isAbsenceDescription("Hmotnosť nie je v zdrojoch uvedená.")).toBe(
      true,
    );
    expect(isAbsenceDescription("Výška nie je uvedená.")).toBe(true);
    expect(
      isAbsenceDescription("BMI nie je možné vypočítať bez výšky a hmotnosti."),
    ).toBe(true);
  });

  it("strips HTML comment prefixes before checking", () => {
    // Observed: "<!-- BMI Section -->\nBez výšky a hmotnosti…"
    expect(
      isAbsenceDescription(
        "<!-- BMI Section -->\nBez výšky a hmotnosti v zdrojoch nie je možné vypočítať BMI.",
      ),
    ).toBe(true);
    expect(isAbsenceDescription("<!-- comment -->")).toBe(true);
  });

  it("catches cleanup-pass meta-commentary essays (EA)", () => {
    // Observed in production: the cleanup Haiku wrote an explanation of
    // why the section should be empty instead of returning empty.
    const essay = `(empty — zero characters)
The current output contains no valid epidemiological content. The verified facts list contains no infectious exposures, vaccinations, travel, or vector-borne contacts. The phrase "akútne negat." does not belong in EA (it is a clinical negation unrelated to infectious epidemiology) and should be removed. Per the section contract, EA owns ONLY infectious exposures, vaccinations, and travel — none of which are present in this case.`;
    expect(isAbsenceDescription(essay)).toBe(true);
  });

  it("catches the literal 'ZERO CHARACTERS' cleanup leak", () => {
    // Observed in production: cleanup emitted the literal placeholder.
    expect(isAbsenceDescription("ZERO CHARACTERS")).toBe(true);
    expect(isAbsenceDescription("zero characters")).toBe(true);
    expect(isAbsenceDescription("(zero characters)")).toBe(true);
  });

  it("catches '(empty — zero characters)' parenthetical alone", () => {
    expect(isAbsenceDescription("(empty — zero characters)")).toBe(true);
    expect(isAbsenceDescription("(empty, zero chars)")).toBe(true);
  });

  it("catches the EA reasoning-essay failure mode", () => {
    // Observed: Haiku wrote a numbered essay explaining why EA is empty,
    // including the sentence "vrátim prázdny reťazec" at the bottom.
    const essay = `Zbahňme všetko, čo sa týka epidemiologickej histórie z tohto textu:
1. Ani v prepise, ani v OCR texte nie sú spomenuté: cestovanie, pobyt v endemických oblastiach, kliešťové kúsky, insektí expozície, kontakty s infekčnými chorými, ani informácie o očkovaniach.
2. Pacientka spomína "pokašľávam, ale ja to mám stále" – to je chronický symptóm, nie epidemiologická expozícia.
3. Peľová alergia a roztoče sú allerény, ktoré patria do AA.
Podľa pravidiel: Ak žiadne zo štyroch kategórií EA nie sú explicitne spomenuté, vrátim prázdny reťazec.`;
    expect(essay.length).toBeLessThan(700);
    expect(isAbsenceDescription(essay)).toBe(true);
  });
});
