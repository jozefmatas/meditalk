import { useState, useEffect } from "react";

export interface UseAudioDevicesReturn {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  selectDevice: (deviceId: string) => void;
}

/**
 * Hook for enumerating and selecting audio input devices.
 *
 * Automatically enumerates devices on mount and selects the first available
 * device if no device is currently selected.
 *
 * @returns devices - List of available audio input devices
 * @returns selectedDeviceId - Currently selected device ID
 * @returns selectDevice - Function to change the selected device
 */
export function useAudioDevices(): UseAudioDevicesReturn {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  // Enumerate audio devices on mount
  // Note: Labels may be empty until microphone permission is granted
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    navigator.mediaDevices
      .enumerateDevices()
      .then((allDevices) => {
        const audioInputs = allDevices.filter(
          (d) => d.kind === "audioinput" && d.deviceId !== "",
        );
        setDevices(audioInputs);

        // Auto-select first device if none selected
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      })
      .catch(() => {
        // Silent fail - device enumeration is best-effort
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    devices,
    selectedDeviceId,
    selectDevice: setSelectedDeviceId,
  };
}
