/**
 * Constants and default tunables for webcam hand control.
 *
 * The MediaPipe library, its wasm bundle and the hand landmarker model are all
 * self-hosted under `public/mediapipe/` (see `scripts/fetch-mediapipe-assets.mjs`).
 * The CDN entries are only used as a runtime fallback when the local copies are
 * missing.
 *
 * The library is fetched at runtime instead of being bundled: it dynamically
 * imports its own wasm loader, which Turbopack cannot resolve and which makes
 * `next dev` fail to compile the page.
 */

// Keep in sync with the @mediapipe/tasks-vision version in package.json.
const MEDIAPIPE_VERSION = "1.0.1";

export const MEDIAPIPE_BUNDLE_PATH = "./mediapipe/vision_bundle.mjs";
export const MEDIAPIPE_BUNDLE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;

export const MEDIAPIPE_WASM_PATH = "./mediapipe/wasm";
export const MEDIAPIPE_WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

export const HAND_MODEL_PATH = "./mediapipe/models/hand_landmarker.task";
export const HAND_MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Indices into the 21 MediaPipe hand landmarks we actually use. */
export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
} as const;

/** How often the teleoperation state machine runs, in ms (~30 Hz). */
export const TELEOP_INTERVAL = 33;

/** How long the hand must be held still to confirm a calibration sample, in ms. */
export const CALIBRATION_DWELL = 1200;
/** ...and for the final pose sample, which doubles as the orientation reference. */
export const CALIBRATION_POSE_DWELL = 3000;
/** How much the hand may drift while dwelling before the timer restarts. */
export const CALIBRATION_STILL_EPSILON = 0.05;
/**
 * How far the hand has to travel after a capture before the next step will
 * start counting. Consecutive steps can share a target - "reach forward" and
 * "pull back" are both centred - so without this the next sample would be
 * taken from a hand that never moved.
 */
export const CALIBRATION_REARM_DISTANCE = 0.09;
/** ...or this much change in apparent size, for the reach steps. */
export const CALIBRATION_REARM_SIZE_RATIO = 0.15;

export type HandControlSettings = {
  /** Centre of the mapped workspace box, in scene units. */
  workspaceCenter: [number, number, number];
  /** Extent of the mapped workspace box, in scene units. */
  workspaceSize: [number, number, number];
  /** Flip the lateral / vertical / depth axes respectively. */
  invert: [boolean, boolean, boolean];
  /**
   * The part of the frame the hand actually sweeps, as fractions of the preview.
   * Set by the corner step of the calibration: without it the operator has to
   * reach the literal edges of the image to reach the edge of the workspace.
   */
  frameMinU: number;
  frameMaxU: number;
  frameMinV: number;
  frameMaxV: number;
  /** Normalised image size of the hand (wrist -> middle MCP) at the far end of the workspace. */
  depthFar: number;
  /** ...and at the near end (hand closer to the camera => arm reaches forward). */
  depthNear: number;
  /** EMA factor for marker position, 0..1 (higher = more responsive, more jitter). */
  posSmoothing: number;
  /** Slerp factor for marker orientation, 0..1. */
  rotSmoothing: number;
  /** Position error below which the marker can latch onto the gripper, scene units. */
  attachPosTol: number;
  /** Orientation error below which the marker can latch on, degrees. */
  attachAngTol: number;
  /** How long the marker has to stay aligned before latching, ms. */
  attachHoldMs: number;
  /** IK position residual above which the target counts as out of reach, scene units. */
  detachPosTol: number;
  /** How long the target has to stay out of reach before detaching, ms. */
  detachHoldMs: number;
  /** How long the hand may be missing from the frame before detaching, ms. */
  handLostMs: number;
  /** thumb-tip/index-tip distance ratio treated as a fully closed hand. */
  opennessMin: number;
  /** ...and as a fully open hand. */
  opennessMax: number;
  /** Hand frame -> gripper frame correction quaternion (x, y, z, w). */
  orientationOffset: [number, number, number, number];
};

/**
 * Defaults tuned for the so-arm101 scene, where the robot is scaled by 15, so
 * one scene unit is roughly 6.7 cm and the arm reaches about 5 units.
 */
export const DEFAULT_HAND_CONTROL_SETTINGS: HandControlSettings = {
  workspaceCenter: [2, 2.2, 0],
  workspaceSize: [5, 3.6, 5],
  invert: [false, false, false],
  frameMinU: 0.15,
  frameMaxU: 0.85,
  frameMinV: 0.15,
  frameMaxV: 0.85,
  depthFar: 0.12,
  depthNear: 0.3,
  posSmoothing: 0.35,
  rotSmoothing: 0.3,
  attachPosTol: 1.1,
  attachAngTol: 55,
  attachHoldMs: 300,
  // Generous on purpose: the arm stretches towards an unreachable target and
  // only lets go once it has clearly been abandoned there.
  detachPosTol: 2.2,
  detachHoldMs: 900,
  handLostMs: 900,
  opennessMin: 0.25,
  opennessMax: 1.3,
  orientationOffset: [0, 0, 0, 1],
};
