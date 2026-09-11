// Persistence for the hand control tunables and calibration, per robot.

import {
  DEFAULT_HAND_CONTROL_SETTINGS,
  HandControlSettings,
} from "@/config/handControlConfig";

function settingsKey(robotName: string) {
  return `hand_control_settings_${robotName}`;
}

/**
 * Reads the stored settings, falling back to the defaults for anything missing
 * so older stored blobs keep working when new tunables are added.
 */
export function getHandSettingsFromLocalStorage(
  robotName: string,
  defaults: HandControlSettings = DEFAULT_HAND_CONTROL_SETTINGS
): HandControlSettings {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const stored = localStorage.getItem(settingsKey(robotName));
    if (!stored) return { ...defaults };
    return { ...defaults, ...JSON.parse(stored) };
  } catch (error) {
    console.warn("Failed to read hand control settings:", error);
    return { ...defaults };
  }
}

export function setHandSettingsToLocalStorage(
  robotName: string,
  settings: HandControlSettings
) {
  try {
    localStorage.setItem(settingsKey(robotName), JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to persist hand control settings:", error);
  }
}

export function clearHandSettingsFromLocalStorage(robotName: string) {
  try {
    localStorage.removeItem(settingsKey(robotName));
  } catch (error) {
    console.warn("Failed to clear hand control settings:", error);
  }
}
