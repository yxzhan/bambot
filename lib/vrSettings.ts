// Persistence for the VR control tunables, per robot.

import {
  DEFAULT_VR_CONTROL_SETTINGS,
  VRControlSettings,
} from "@/config/vrControlConfig";

function settingsKey(robotName: string) {
  return `vr_control_settings_${robotName}`;
}

/**
 * Reads the stored settings, falling back to the defaults for anything missing
 * so older stored blobs keep working when new tunables are added.
 */
export function getVRSettingsFromLocalStorage(
  robotName: string
): VRControlSettings {
  if (typeof window === "undefined") return { ...DEFAULT_VR_CONTROL_SETTINGS };
  try {
    const stored = localStorage.getItem(settingsKey(robotName));
    if (!stored) return { ...DEFAULT_VR_CONTROL_SETTINGS };
    return { ...DEFAULT_VR_CONTROL_SETTINGS, ...JSON.parse(stored) };
  } catch (error) {
    console.warn("Failed to read VR control settings:", error);
    return { ...DEFAULT_VR_CONTROL_SETTINGS };
  }
}

export function setVRSettingsToLocalStorage(
  robotName: string,
  settings: VRControlSettings
) {
  try {
    localStorage.setItem(settingsKey(robotName), JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to persist VR control settings:", error);
  }
}

export function clearVRSettingsFromLocalStorage(robotName: string) {
  try {
    localStorage.removeItem(settingsKey(robotName));
  } catch (error) {
    console.warn("Failed to clear VR control settings:", error);
  }
}
