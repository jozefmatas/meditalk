import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSaveStatus } from "./use-save-status";

describe("useSaveStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts as idle", () => {
    const { result } = renderHook(() => useSaveStatus());
    expect(result.current.status).toBe("idle");
  });

  it("transitions idle → saving → saved → idle (auto-reset)", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.markSaving());
    expect(result.current.status).toBe("saving");

    act(() => result.current.markSaved());
    expect(result.current.status).toBe("saved");

    // Before timeout — still "saved"
    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.status).toBe("saved");

    // After 2 s timeout — resets to "idle"
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.status).toBe("idle");
  });

  it("transitions saving → error", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.markSaving());
    act(() => result.current.markError());
    expect(result.current.status).toBe("error");
  });

  it("cancels saved auto-reset when markSaving is called again", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.markSaving());
    act(() => result.current.markSaved());
    expect(result.current.status).toBe("saved");

    // Start a new save before the 2 s timeout
    act(() => {
      vi.advanceTimersByTime(500);
      result.current.markSaving();
    });
    expect(result.current.status).toBe("saving");

    // Original timer should NOT reset to idle
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.status).toBe("saving");
  });

  it("does not auto-reset from error state", () => {
    const { result } = renderHook(() => useSaveStatus());

    act(() => result.current.markSaving());
    act(() => result.current.markError());

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.status).toBe("error");
  });
});
