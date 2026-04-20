import { describe, it, expect } from "vitest";
import { scrubPhi } from "./phi-scrubber";

describe("scrubPhi", () => {
  describe("patient name scrubbing", () => {
    it("scrubs patient name in both orderings", () => {
      const { scrubbed, audit } = scrubPhi(
        "Pacient Jozef Nováček sa dostavil na vyšetrenie. Nováček Jozef uvádza bolesti.",
        "Jozef Nováček",
      );
      expect(scrubbed).toContain("[PATIENT_NAME]");
      expect(scrubbed).not.toContain("Jozef");
      expect(scrubbed).not.toContain("Nováček");
      expect(audit.counts.name).toBe(2);
    });

    it("matches name case-insensitively", () => {
      const { scrubbed } = scrubPhi(
        "JOZEF NOVÁČEK bol prijatý.",
        "Jozef Nováček",
      );
      expect(scrubbed).toContain("[PATIENT_NAME]");
      expect(scrubbed).not.toContain("JOZEF");
    });

    it("does not scrub when name is not provided", () => {
      const { scrubbed, audit } = scrubPhi("Jozef prišiel na kontrolu.");
      expect(scrubbed).toBe("Jozef prišiel na kontrolu.");
      expect(audit.counts.name).toBe(0);
    });
  });

  describe("birth number (rodné číslo) scrubbing", () => {
    it("scrubs male birth number with slash", () => {
      const { scrubbed, audit } = scrubPhi("Rodné číslo: 850615/1234");
      expect(scrubbed).toContain("[PATIENT_ID]");
      expect(scrubbed).not.toContain("850615");
      expect(audit.counts.birthNumber).toBe(1);
    });

    it("scrubs male birth number without slash", () => {
      const { scrubbed } = scrubPhi("RČ 8506151234");
      expect(scrubbed).toContain("[PATIENT_ID]");
      expect(scrubbed).not.toContain("8506151234");
    });

    it("scrubs female birth number (month +50)", () => {
      const { scrubbed } = scrubPhi("RČ: 855615/1234");
      expect(scrubbed).toContain("[PATIENT_ID]");
      expect(scrubbed).not.toContain("855615");
    });
  });

  describe("phone number scrubbing", () => {
    it("scrubs Slovak phone +421", () => {
      const { scrubbed, audit } = scrubPhi("Tel: +421 905 123 456");
      expect(scrubbed).toContain("[PHONE]");
      expect(scrubbed).not.toContain("905 123 456");
      expect(audit.counts.phone).toBe(1);
    });

    it("scrubs Czech phone +420", () => {
      const { scrubbed } = scrubPhi("Kontakt: +420 605 123 456");
      expect(scrubbed).toContain("[PHONE]");
      expect(scrubbed).not.toContain("605 123 456");
    });

    it("scrubs local phone format", () => {
      const { scrubbed } = scrubPhi("Volať na 0905 123 456");
      expect(scrubbed).toContain("[PHONE]");
      expect(scrubbed).not.toContain("0905");
    });
  });

  describe("email scrubbing", () => {
    it("scrubs email addresses", () => {
      const { scrubbed, audit } = scrubPhi(
        "Email pacienta: jan.novak@gmail.com",
      );
      expect(scrubbed).toContain("[EMAIL]");
      expect(scrubbed).not.toContain("jan.novak@gmail.com");
      expect(audit.counts.email).toBe(1);
    });
  });

  describe("preservation of clinical values", () => {
    it("preserves clinical dates", () => {
      const { scrubbed } = scrubPhi("Hospitalizovaný od 14.4.2025");
      expect(scrubbed).toContain("14.4.2025");
    });

    it("preserves age values", () => {
      const { scrubbed } = scrubPhi("72-ročný pacient");
      expect(scrubbed).toContain("72-ročný");
    });

    it("preserves ICD codes", () => {
      const { scrubbed } = scrubPhi("Diagnóza: I21.0 – STEMI");
      expect(scrubbed).toContain("I21.0");
    });

    it("preserves blood pressure", () => {
      const { scrubbed } = scrubPhi("TK 150/95 mmHg");
      expect(scrubbed).toContain("150/95");
    });

    it("preserves medication dosages", () => {
      const { scrubbed } = scrubPhi("Eliquis 2,5 mg 2x denne");
      expect(scrubbed).toContain("2,5 mg");
    });
  });

  describe("known patient ID scrubbing", () => {
    it("scrubs exact patient ID string", () => {
      const { scrubbed } = scrubPhi(
        "Číslo poistenca: ABC123456",
        undefined,
        "ABC123456",
      );
      expect(scrubbed).toContain("[PATIENT_ID]");
      expect(scrubbed).not.toContain("ABC123456");
    });
  });

  describe("address scrubbing", () => {
    it("scrubs PSČ + city pattern", () => {
      const { scrubbed, audit } = scrubPhi(
        "Bydlisko: 821 03 Bratislava-Ružinov",
      );
      expect(scrubbed).toContain("[ADDRESS]");
      expect(scrubbed).not.toContain("821 03");
      expect(scrubbed).not.toContain("Bratislava");
      expect(audit.counts.address).toBeGreaterThanOrEqual(1);
    });

    it("scrubs Czech PSČ + city", () => {
      const { scrubbed } = scrubPhi("Adresa: 110 00 Praha 1");
      expect(scrubbed).toContain("[ADDRESS]");
      expect(scrubbed).not.toContain("110 00");
      expect(scrubbed).not.toContain("Praha");
    });

    it("scrubs street with keyword prefix", () => {
      const { scrubbed } = scrubPhi("Adresa: ul. Hlavná 15");
      expect(scrubbed).toContain("[ADDRESS]");
      expect(scrubbed).not.toContain("Hlavná 15");
    });

    it("scrubs street with slash house number", () => {
      const { scrubbed } = scrubPhi("Bydlisko: Exnárova 3121/3");
      expect(scrubbed).toContain("[ADDRESS]");
      expect(scrubbed).not.toContain("Exnárova");
      expect(scrubbed).not.toContain("3121/3");
    });

    it("scrubs full address line", () => {
      const { scrubbed } = scrubPhi(
        "Adresa: Exnárova 3121/3, 821 03 Bratislava-Ružinov",
      );
      expect(scrubbed).not.toContain("Exnárova");
      expect(scrubbed).not.toContain("821 03");
      expect(scrubbed).not.toContain("Bratislava");
    });

    it("scrubs námestie prefix", () => {
      const { scrubbed } = scrubPhi("námestie SNP 10");
      expect(scrubbed).toContain("[ADDRESS]");
      expect(scrubbed).not.toContain("SNP 10");
    });

    it("does NOT scrub blood pressure", () => {
      const original = "TK 150/95 mmHg";
      const { scrubbed } = scrubPhi(original);
      expect(scrubbed).toContain("150/95");
    });

    it("does NOT scrub blood pressure with longer prefix word", () => {
      // "Tlak" is 4 chars — would match STREET_SLASH_HOUSE_REGEX without protection
      const original = "Tlak 138/84 mmHg";
      const { scrubbed } = scrubPhi(original);
      expect(scrubbed).toBe(original);
    });

    it("does NOT scrub BP in clinical context with krvný keyword", () => {
      const original = "Krvný tlak 165/75 mmHg";
      const { scrubbed } = scrubPhi(original);
      expect(scrubbed).toContain("165/75");
    });

    it("does NOT scrub medication dosages", () => {
      const original = "Eliquis 2,5 mg 2x denne";
      const { scrubbed } = scrubPhi(original);
      expect(scrubbed).toBe(original);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const { scrubbed, audit } = scrubPhi("");
      expect(scrubbed).toBe("");
      expect(audit.totalRedactions).toBe(0);
    });

    it("handles multiple occurrences", () => {
      const { scrubbed, audit } = scrubPhi(
        "Tel: +421 905 123 456, email: jan@test.com. Opakujem tel: +421 905 123 456",
      );
      expect(audit.counts.phone).toBe(2);
      expect(audit.counts.email).toBe(1);
      expect(scrubbed).not.toContain("905 123 456");
    });

    it("handles text with no PHI", () => {
      const original =
        "Pacient udáva bolesti na hrudníku od rána. TK 150/95 mmHg, P 78/min.";
      const { scrubbed, audit } = scrubPhi(original);
      expect(scrubbed).toBe(original);
      expect(audit.totalRedactions).toBe(0);
    });
  });
});
