// Leader arm sync settings, persisted per browser.

/**
 * - direct: the leader drives the follower arm connected to this browser.
 * - ros: each leader reading is published on the ROS command topic, for a
 *   follower on another machine (this page takes the ROS leader role).
 */
export type LeaderMode = "direct" | "ros";

export type LeaderSettings = {
  mode: LeaderMode;
  /** How often the leader arm is read, Hz. */
  hz: number;
};

export const MIN_LEADER_HZ = 5;
export const MAX_LEADER_HZ = 60;

export const DEFAULT_LEADER_SETTINGS: LeaderSettings = {
  mode: "direct",
  hz: 30,
};

const SETTINGS_KEY = "leader_settings";

export function getLeaderSettingsFromLocalStorage(): LeaderSettings {
  if (typeof window === "undefined") return { ...DEFAULT_LEADER_SETTINGS };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    const hz = Number(stored.hz);
    return {
      mode: stored.mode === "ros" ? "ros" : "direct",
      hz: Number.isFinite(hz)
        ? Math.min(MAX_LEADER_HZ, Math.max(MIN_LEADER_HZ, hz))
        : DEFAULT_LEADER_SETTINGS.hz,
    };
  } catch {
    return { ...DEFAULT_LEADER_SETTINGS };
  }
}

export function setLeaderSettingsToLocalStorage(settings: LeaderSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to persist leader settings:", error);
  }
}
