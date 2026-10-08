// Role and topic names for the ROS 2 bridge, persisted per browser.

/**
 * - leader: whatever moves this page's robot (leader arm, VR, keyboard...) is
 *   published as commands; the follower's state is shown for comparison.
 * - follower: commands from the network drive this page's robot (and its
 *   servos); its own joint state is published back.
 * - monitor: only listens to both topics.
 */
export type ROS2Role = "leader" | "follower" | "monitor";

export type ROS2Settings = {
  role: ROS2Role;
  /** Target joint positions, published by the leader. */
  commandTopic: string;
  /** The follower's joint state, published by the follower. */
  stateTopic: string;
  /** How often this page publishes (commands as leader, state as follower), Hz. */
  publishHz: number;
};

export const MIN_PUBLISH_HZ = 1;
export const MAX_PUBLISH_HZ = 60;

export const DEFAULT_ROS2_SETTINGS: ROS2Settings = {
  role: "leader",
  commandTopic: "/joint_commands",
  stateTopic: "/joint_states",
  publishHz: 30,
};

export const ROS2_ROLES: ROS2Role[] = ["leader", "follower", "monitor"];

/**
 * Reads a role from a URL parameter or stored settings. "commander" is the
 * leader role's earlier name, still accepted so old links and settings work.
 */
export function parseROS2Role(value: unknown): ROS2Role | null {
  if (value === "commander") return "leader";
  return ROS2_ROLES.includes(value as ROS2Role) ? (value as ROS2Role) : null;
}

const SETTINGS_KEY = "ros2_settings";

export function getROS2SettingsFromLocalStorage(): ROS2Settings {
  if (typeof window === "undefined") return { ...DEFAULT_ROS2_SETTINGS };
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_ROS2_SETTINGS };
    const settings = { ...DEFAULT_ROS2_SETTINGS, ...JSON.parse(stored) };
    const hz = Number(settings.publishHz);
    return {
      ...settings,
      role: parseROS2Role(settings.role) ?? DEFAULT_ROS2_SETTINGS.role,
      publishHz: Number.isFinite(hz)
        ? Math.min(MAX_PUBLISH_HZ, Math.max(MIN_PUBLISH_HZ, hz))
        : DEFAULT_ROS2_SETTINGS.publishHz,
    };
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
