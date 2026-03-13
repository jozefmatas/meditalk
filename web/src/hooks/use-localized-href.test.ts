import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLocalizedHref } from "./use-localized-href";

const mockLocale = vi.fn(() => "sk");
vi.mock("next-intl", () => ({
  useLocale: () => mockLocale(),
}));

describe("useLocalizedHref", () => {
  it("returns path without prefix for default locale (sk)", () => {
    mockLocale.mockReturnValue("sk");
    const { result } = renderHook(() => useLocalizedHref());

    expect(result.current("/encounters/new")).toBe("/encounters/new");
    expect(result.current("/settings")).toBe("/settings");
  });

  it("returns path with /cs prefix for cs locale", () => {
    mockLocale.mockReturnValue("cs");
    const { result } = renderHook(() => useLocalizedHref());

    expect(result.current("/encounters/new")).toBe("/cs/encounters/new");
    expect(result.current("/settings")).toBe("/cs/settings");
  });

  it("returns path with /en prefix for en locale", () => {
    mockLocale.mockReturnValue("en");
    const { result } = renderHook(() => useLocalizedHref());

    expect(result.current("/encounters/new")).toBe("/en/encounters/new");
  });

  it("returns / for empty href on default locale", () => {
    mockLocale.mockReturnValue("sk");
    const { result } = renderHook(() => useLocalizedHref());

    expect(result.current("")).toBe("/");
  });

  it("returns /cs for empty href on cs locale", () => {
    mockLocale.mockReturnValue("cs");
    const { result } = renderHook(() => useLocalizedHref());

    expect(result.current("")).toBe("/cs");
  });
});
