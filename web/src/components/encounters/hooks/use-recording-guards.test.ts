// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecordingGuards } from "./use-recording-guards";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      recordingNotificationTitle: "Recording in progress",
      recordingNotificationBody: "Keep this tab open",
    };
    return translations[key] || key;
  },
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock platform detection — default to web
vi.mock("@/lib/platform", () => ({
  isNative: false,
  isIOS: false,
  isAndroid: false,
  isWeb: true,
}));

// Mock native guards
const mockStartRecordingService = vi.fn().mockResolvedValue(undefined);
const mockStopRecordingService = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/native-guards", () => ({
  nativeStartRecordingService: (...args: unknown[]) =>
    mockStartRecordingService(...args),
  nativeStopRecordingService: (...args: unknown[]) =>
    mockStopRecordingService(...args),
}));

describe("useRecordingGuards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("Navigation guard", () => {
    it("should initialize with dialog closed", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(result.current.navDialogOpen).toBe(false);
    });

    it("should open dialog when isRecording is true and link is clicked", async () => {
      const { result } = renderHook(() => useRecordingGuards(true));

      const link = document.createElement("a");
      link.href = "/encounters/new";
      document.body.appendChild(link);

      act(() => {
        link.click();
      });

      await waitFor(() => {
        expect(result.current.navDialogOpen).toBe(true);
      });
    });

    it("should close dialog when closeNavDialog is called", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      act(() => {
        result.current.closeNavDialog();
      });

      expect(result.current.navDialogOpen).toBe(false);
    });

    it("should navigate when confirmLeave is called", async () => {
      const { result } = renderHook(() => useRecordingGuards(true));

      const link = document.createElement("a");
      link.href = "/settings";
      document.body.appendChild(link);

      act(() => {
        link.click();
      });

      await waitFor(() => {
        expect(result.current.navDialogOpen).toBe(true);
      });

      act(() => {
        result.current.confirmLeave();
      });

      expect(result.current.navDialogOpen).toBe(false);
      expect(mockPush).toHaveBeenCalledWith("/settings");
    });

    it("should NOT prevent navigation when isRecording is false", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      const link = document.createElement("a");
      link.href = "/encounters/new";
      document.body.appendChild(link);

      act(() => {
        link.click();
      });

      expect(result.current.navDialogOpen).toBe(false);
    });

    it("should prevent tab close when isRecording is true", () => {
      renderHook(() => useRecordingGuards(true));

      const event = new Event("beforeunload", { cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe("Wake lock (web)", () => {
    it("should provide acquireWakeLock function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.acquireWakeLock).toBe("function");
    });

    it("should provide releaseWakeLock function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.releaseWakeLock).toBe("function");
    });

    it("should handle missing wakeLock API gracefully", async () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      await act(async () => {
        await result.current.acquireWakeLock();
      });

      expect(true).toBe(true);
    });

    it("should re-acquire wake lock when page becomes visible during recording", async () => {
      const mockWakeLock = {
        request: vi.fn().mockResolvedValue({
          addEventListener: vi.fn(),
          release: vi.fn(),
        }),
      };

      Object.defineProperty(navigator, "wakeLock", {
        value: mockWakeLock,
        writable: true,
        configurable: true,
      });

      renderHook(() => useRecordingGuards(true));

      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });

      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(mockWakeLock.request).toHaveBeenCalled();
    });

    it("should not call native guards on web", async () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      await act(async () => {
        await result.current.acquireWakeLock();
      });

      expect(mockStartRecordingService).not.toHaveBeenCalled();

      act(() => {
        result.current.releaseWakeLock();
      });

      expect(mockStopRecordingService).not.toHaveBeenCalled();
    });
  });

  describe("Notifications (web)", () => {
    it("should provide showRecordingNotification function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.showRecordingNotification).toBe("function");
    });

    it("should handle missing Notification API gracefully", async () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      await act(async () => {
        await result.current.showRecordingNotification();
      });

      expect(true).toBe(true);
    });
  });

  describe("Audio interruption", () => {
    it("should initialize audioInterrupted as false", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(result.current.audioInterrupted).toBe(false);
    });

    it("should provide setAudioContext function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.setAudioContext).toBe("function");
    });

    it("should detect interrupted AudioContext state", async () => {
      // Create a mock AudioContext with event support
      const listeners: Record<string, (() => void)[]> = {};
      const mockCtx = {
        state: "running" as string,
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
        }),
        removeEventListener: vi.fn(),
      };

      // Start with isRecording=false, set audioContext, then switch to recording
      let isRecording = false;
      const { result, rerender } = renderHook(() =>
        useRecordingGuards(isRecording),
      );

      // Set the AudioContext while not recording
      act(() => {
        result.current.setAudioContext(mockCtx as unknown as AudioContext);
      });

      // Switch to recording — triggers the effect that attaches statechange listener
      isRecording = true;
      rerender();

      // Simulate phone call interruption
      mockCtx.state = "interrupted";
      act(() => {
        listeners["statechange"]?.forEach((cb) => cb());
      });

      await waitFor(() => {
        expect(result.current.audioInterrupted).toBe(true);
      });
    });
  });

  describe("Cleanup", () => {
    it("should remove event listeners on unmount", () => {
      const { unmount } = renderHook(() => useRecordingGuards(true));

      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
      const documentRemoveSpy = vi.spyOn(document, "removeEventListener");

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
      expect(documentRemoveSpy).toHaveBeenCalled();
    });
  });
});
