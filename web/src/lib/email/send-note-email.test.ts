import { describe, it, expect, vi } from "vitest";

vi.mock("resend", () => ({
  Resend: vi.fn(),
}));

import { buildSubject } from "./send-note-email";

describe("buildSubject", () => {
  it("builds English subject with prefix", () => {
    expect(buildSubject("en", "Patient Visit")).toBe(
      "MediTalk Note — Patient Visit",
    );
  });

  it("builds Slovak subject with prefix", () => {
    expect(buildSubject("sk", "Návšteva")).toBe("MediTalk Správa — Návšteva");
  });

  it("builds Czech subject with prefix", () => {
    expect(buildSubject("cs", "Návštěva")).toBe("MediTalk Zpráva — Návštěva");
  });

  it("falls back to English for unknown language", () => {
    expect(buildSubject("de", "Besuch")).toBe("MediTalk Note — Besuch");
  });

  it("handles empty title", () => {
    const result = buildSubject("en", "");
    expect(result).toBe("MediTalk Note — ");
  });
});
