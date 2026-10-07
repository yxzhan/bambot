// Role and topic names for the ROS 2 bridge, persisted per browser.

/**
 * - commander: whatever moves this page's robot (leader arm, VR, keyboard...)
 *   is published as commands; the follower's state is shown for comparison.
 * - follower: commands from the network drive this page's robot (and its
 *   servos); its own joint state is published back.
 * - monitor: only listens to both topics.
 */
export type ROS2Role = "commander" | "follower" | "monitor";

export type ROS2Settings = {
  role: ROS2Role;
  /** Target joint positions, published by the commander. */
  commandTopic: string;
  /** The follower's joint state, published by the follower. */
  stateTopic: string;
};

export const DEFAULT_ROS2_SETTINGS: ROS2Settings = {
  role: "commander",
  commandTopic: "/joint_commands",
  stateTopic: "/joint_states",
};

export const ROS2_ROLES: ROS2Role[] = ["commander", "follower", "monitor"];

const SETTINGS_KEY = "ros2_settings";

export function getROS2SettingsFromLocalStorage(): ROS2Settings {
  if (typeof window === "undefined") return { ...DEFAULT_ROS2_SETTINGS };
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_ROS2_SETTINGS };
    return { ...DEFAULT_ROS2_SETTINGS, ...JSON.parse(stored) };
  } catch (error) {
    console.warn("Failed to read ROS 2 settings:", error);
    return { ...DEFAULT_ROS2_SETTINGS };
  }
}

export function setROS2SettingsToLocalStorage(settings: ROS2Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to persist ROS 2 settings:", error);
  }
}
