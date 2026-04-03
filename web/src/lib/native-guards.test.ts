import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock platform — web by default
vi.mock("@/lib/platform", () => ({
  isNative: false,
  isAndroid: false,
  isIOS: false,
  isWeb: true,
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("native-guards (web context)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("nativeStartRecordingService is a no-op on web", async () => {
    const { nativeStartRecordingService } = await import("./native-guards");
    await expect(
      nativeStartRecordingService("Title", "Body"),
    ).resolves.toBeUndefined();
  });

  it("nativeStopRecordingService is a no-op on web", async () => {
    const { nativeStopRecordingService } = await import("./native-guards");
    await expect(nativeStopRecordingService()).resolves.toBeUndefined();
  });

  it("does not import ForegroundService plugin on web", async () => {
    const importSpy = vi.fn();
    vi.doMock(
      "@capawesome-team/capacitor-android-foreground-service",
      importSpy,
    );

    const { nativeStartRecordingService } = await import("./native-guards");
    await nativeStartRecordingService("Title", "Body");

    // The dynamic import should never be reached because isNative is false
    expect(importSpy).not.toHaveBeenCalled();
  });
});
