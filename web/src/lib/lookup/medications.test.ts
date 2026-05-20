import { describe, expect, it } from "vitest";
import {
  getActiveIngredient,
  isValidMedication,
} from "./medications";

describe("medications lookup", () => {
  // Regression: csvFileForLocale + loadIndex were inconsistent — the cs/
  // directory had no CSV, so cs callers tried to open
  // `public/medicines/cs/medicines_sk.csv` (missing) and threw ENOENT,
  // which the pipeline caught and logged but silently disabled the
  // drug-substitution guard for every CS-locale generation.
  it("falls back to the SK CSV when the CS file isn't shipped", () => {
    // Known entry from medicines_sk.csv — TRITACE 5 → ramipril.
    expect(() => getActiveIngredient("TRITACE", "cs")).not.toThrow();
    expect(getActiveIngredient("TRITACE", "cs")).toBe("ramipril");
  });

  it("loads the SK CSV for the SK locale", () => {
    expect(isValidMedication("TRITACE 5", "sk")).toBe(true);
  });
});
