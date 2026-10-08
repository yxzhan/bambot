/**
 * Constants and default tunables for VR controller teleoperation.
 *
 * Lengths here are in metres - real-world units in the headset - unless they
 * say "scene units". The scene scales the robot by 15 (see `RobotScene`), and
 * the XR rig applies the same scale to the headset, so the robot appears life
 * size and one centimetre of controller motion is one centimetre at the gripper.
 */

export type VRControlSettings = {
  /** Gripper travel per unit of controller travel while engaged. */
  motionScale: number;
  /** Whether turning the controller turns the gripper, or only position follows. */
  followRotation: boolean;
  /** How far below eye level the robot's base sits after recentring, metres. */
  baseBelowEyes: number;
  /** Horizontal distance from the eyes to the robot's base after recentring, metres. */
  baseDistance: number;
  /**
   * IK position residual above which the target counts as out of reach and
   * the arm stops following, scene units (0.15 is about 1 cm).
   */
  reachTolerance: number;
  /** Fastest any arm joint may be commanded to move, degrees per second. */
  maxJointSpeed: number;
};

export const DEFAULT_VR_CONTROL_SETTINGS: VRControlSettings = {
  motionScale: 1,
  followRotation: true,
  baseBelowEyes: 0.55,
  baseDistance: 0.3,
  reachTolerance: 0.15,
  maxJointSpeed: 240,
};

/** How often the teleoperation loop solves IK and commands the arm, in ms (~30 Hz). */
export const VR_TELEOP_INTERVAL = 33;

/** Squeeze/trigger value above which a button counts as pressed... */
export const BUTTON_PRESS = 0.6;
/** ...and below which it counts as released again (hysteresis against chatter). */
export const BUTTON_RELEASE = 0.4;

/** Thumbstick deflection ignored as drift. */
export const THUMBSTICK_DEADZONE = 0.2;
/** How fast a full thumbstick deflection raises or lowers the robot, metres per second. */
export const THUMBSTICK_HEIGHT_SPEED = 0.25;

/**
 * Seeded IK retries per solve. None: the hand control default (6) ends in
 * random seeds, which is fine for latching on, but a continuously tracked arm
 * held at the edge of its reach then wobbles between near-equal solutions from
 * one tick to the next. Solving only from the current pose is deterministic,
 * and the target moves little between ticks.
 */
export const VR_IK_RESTARTS = 0;

/**
 * Orientation weight and tolerance for the IK refinement pass. Much tighter
 * than hand control's defaults, because a controller's orientation is exact:
 * with the defaults (~8.6 deg tolerance) a 30 deg tilt was left 15 deg short.
 * These track attainable rotations to ~1 deg; an unattainable one (SO-ARM101
 * has five joints) costs the fingertip only a few millimetres of position.
 */
export const VR_IK_ROT_WEIGHT = 0.5;
export const VR_IK_ROT_TOLERANCE = 0.02;

/** Light buzz on the engaged controller while the target is out of reach. */
export const UNREACHABLE_HAPTIC = { intensity: 0.3, durationMs: 40, intervalMs: 200 };

/**
 * How close the trigger has to come to the gripper's current opening (0..1)
 * before it takes the gripper over after engaging.
 */
export const GRIPPER_TAKEOVER_TOLERANCE = 0.1;
