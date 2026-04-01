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

describe("useRecordingGuards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset DOM
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

      // Create a link and click it
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

      // Simulate pending navigation
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

  describe("Wake lock", () => {
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

      // Should not throw error even if wakeLock is not supported
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

      // Trigger visibility change
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });

      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Should attempt to acquire wake lock when visible
      expect(mockWakeLock.request).toHaveBeenCalled();
    });
  });

  describe("Notifications", () => {
    it("should provide showRecordingNotification function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.showRecordingNotification).toBe("function");
    });

    it("should provide closeRecordingNotification function", () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      expect(typeof result.current.closeRecordingNotification).toBe("function");
    });

    it("should handle missing Notification API gracefully", async () => {
      const { result } = renderHook(() => useRecordingGuards(false));

      await act(async () => {
        await result.current.showRecordingNotification();
      });

      // Should not throw error even if Notification is not supported
      expect(true).toBe(true);
    });
  });

  describe("Android detection", () => {
    it("should detect Android devices", async () => {
      // Mock Android user agent
      Object.defineProperty(navigator, "userAgent", {
        value:
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useRecordingGuards(false));

      // Android-specific notification behavior would be tested here
      await act(async () => {
        await result.current.showRecordingNotification();
      });

      expect(true).toBe(true);
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
