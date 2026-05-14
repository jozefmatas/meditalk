// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PREFIX_RE,
  splitEntries,
  extractDrugPrefixes,
} from "./drug-text-parsing";

describe("drug-text-parsing", () => {
  describe("splitEntries", () => {
    it("splits comma-separated medication entries", () => {
      const entries = splitEntries(
        "ANOPYRIN 100 mg, Paretic 1-0-0, Rytmonorm 1-0-1",
      );
      expect(entries).toHaveLength(3);
      expect(entries[0]).toBe("ANOPYRIN 100 mg");
      expect(entries[1]).toContain("Paretic");
      expect(entries[2]).toContain("Rytmonorm");
    });

    it("does NOT split on decimal commas (Arixtra 2,5 mg)", () => {
      const entries = splitEntries("Arixtra 2,5 mg sc à 24h");
      expect(entries).toHaveLength(1);
    });
  });

  describe("PREFIX_RE", () => {
    it("extracts drug name prefix before dose info", () => {
      const m = "Betaloc ZOK 25 mg".match(PREFIX_RE);
      expect(m?.[1].trim()).toBe("Betaloc ZOK");
    });

    it("extracts dashed brand names", () => {
      const m = "Co-Prenessa 4 mg/1,25 mg".match(PREFIX_RE);
      expect(m?.[1].trim()).toBe("Co-Prenessa");
    });
  });

  describe("extractDrugPrefixes", () => {
    it("extracts prefixes from multi-line medication text", () => {
      const prefixes = extractDrugPrefixes(
        "TRITACE 1/3-0-0\nNolpaza 1-0-0\nXarelto 20 mg 1-0-0",
      );
      expect(prefixes.has("tritace")).toBe(true);
      expect(prefixes.has("nolpaza")).toBe(true);
      expect(prefixes.has("xarelto")).toBe(true);
      expect(prefixes.size).toBe(3);
    });

    it("extracts prefixes from comma-separated single line", () => {
      const prefixes = extractDrugPrefixes("ANOPYRIN 100 mg, Rytmonorm 1-0-1");
      expect(prefixes.has("anopyrin")).toBe(true);
      expect(prefixes.has("rytmonorm")).toBe(true);
    });

    it("preserves original casing in map values", () => {
      const prefixes = extractDrugPrefixes("TRITACE 1/3-0-0");
      expect(prefixes.get("tritace")).toBe("TRITACE");
    });

    it("skips prefixes shorter than 3 characters", () => {
      const prefixes = extractDrugPrefixes("AB 10 mg");
      expect(prefixes.size).toBe(0);
    });
  });
});
