/**
 * Turns a MediaPipe hand landmarker result into a compact pose we can map into
 * the 3D scene: a normalised position, an orientation and how open the hand is.
 *
 * Two different landmark sets are used on purpose:
 * - `landmarks` (normalised image coordinates) give the position on screen and,
 *   via the apparent size of the hand, a usable depth proxy.
 * - `worldLandmarks` (metric, hand-centred) give a stable orientation and a
 *   scale-invariant openness ratio.
 */

import * as THREE from "three";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { LANDMARK } from "@/config/handControlConfig";
import type { HandControlSettings } from "@/config/handControlConfig";

export type HandPose = {
  /** Horizontal position in the frame, 0 (left) to 1 (right), already un-mirrored. */
  u: number;
  /** Vertical position in the frame, 0 (top) to 1 (bottom). */
  v: number;
  /** Apparent hand size, used as a proxy for distance to the camera. */
  handSize: number;
  /** Hand orientation expressed in the camera frame. */
  quaternion: THREE.Quaternion;
  /** thumb-tip to index-tip distance over hand length; small = pinched. */
  openness: number;
  /** "Left" or "Right" as reported by MediaPipe, or "" when unknown. */
  handedness: string;
  /** performance.now() of the detection this pose came from. */
  timestamp: number;
};

type Point = { x: number; y: number; z: number };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _across = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _side = new THREE.Vector3();
const _basis = new THREE.Matrix4();

function toVector(point: Point, target: THREE.Vector3): THREE.Vector3 {
  return target.set(point.x, point.y, point.z);
}

/**
 * Builds a right-handed frame from the palm:
 * local X points along the fingers, local Y across the palm, local Z out of the
 * back of the hand. The across-palm vector is flipped for left hands so both
 * hands produce the same frame.
 */
function handOrientation(
  world: Point[],
  handedness: string,
  target: THREE.Quaternion
): boolean {
  _forward
    .subVectors(
      toVector(world[LANDMARK.MIDDLE_MCP], _a),
      toVector(world[LANDMARK.WRIST], _b)
    )
    .normalize();
  _across
    .subVectors(
      toVector(world[LANDMARK.PINKY_MCP], _a),
      toVector(world[LANDMARK.INDEX_MCP], _b)
    )
    .normalize();

  if (handedness === "Left") {
    _across.negate();
  }

  _normal.crossVectors(_forward, _across);
  if (_normal.lengthSq() < 1e-8) {
    // Fingers and palm axis are collinear - the frame is undefined this tick.
    return false;
  }
  _normal.normalize();
  _side.crossVectors(_normal, _forward).normalize();

  _basis.makeBasis(_forward, _side, _normal);
  target.setFromRotationMatrix(_basis);
  return true;
}

/**
 * Extracts the pose of the first detected hand.
 *
 * @param result - Raw MediaPipe result.
 * @param aspect - Video height / width, used to undo the anisotropic
 *   normalisation of the image landmarks so the hand size is isotropic.
 * @returns The pose, or null when no usable hand was detected.
 */
export function extractHandPose(
  result: HandLandmarkerResult,
  aspect: number
): HandPose | null {
  const landmarks = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];
  if (!landmarks || landmarks.length < 21 || !world || world.length < 21) {
    return null;
  }

  const handedness = result.handedness?.[0]?.[0]?.categoryName ?? "";

  const quaternion = new THREE.Quaternion();
  if (!handOrientation(world, handedness, quaternion)) {
    return null;
  }

  const wrist = landmarks[LANDMARK.WRIST];
  const middleMcp = landmarks[LANDMARK.MIDDLE_MCP];
  const dx = middleMcp.x - wrist.x;
  const dy = (middleMcp.y - wrist.y) * aspect;
  const handSize = Math.hypot(dx, dy);

  const handLength = toVector(world[LANDMARK.MIDDLE_MCP], _a).distanceTo(
    toVector(world[LANDMARK.WRIST], _b)
  );
  const pinch = toVector(world[LANDMARK.THUMB_TIP], _a).distanceTo(
    toVector(world[LANDMARK.INDEX_TIP], _b)
  );
  const openness = handLength > 1e-6 ? pinch / handLength : 0;

  return {
    // The preview is mirrored, so the raw x already reads as "mirror image".
    // Flip it back so moving the hand right moves the marker right on screen.
    u: 1 - middleMcp.x,
    v: middleMcp.y,
    handSize,
    quaternion,
    openness,
    handedness,
    timestamp: performance.now(),
  };
}

/** Maps a value from one range to 0..1, clamped. */
export function normalize(value: number, min: number, max: number): number {
  if (Math.abs(max - min) < 1e-9) return 0;
  return THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
}

/**
 * Places a hand position inside the mapped workspace box.
 *
 * The robot is rotated -90 deg about X in the scene, so URDF forward (+X) stays
 * scene +X, up becomes +Y and the base sweeps across scene Z. Apparent hand size
 * stands in for distance from the camera: a bigger hand reaches further forward.
 *
 * `mapWorkspaceToHand` is the exact inverse - keep the two together.
 */
export function mapHandToWorkspace(
  u: number,
  v: number,
  handSize: number,
  settings: HandControlSettings,
  out: THREE.Vector3
): THREE.Vector3 {
  const { workspaceCenter: center, workspaceSize: size, invert } = settings;

  let lateral = u;
  let vertical = 1 - v;
  let forward = normalize(handSize, settings.depthFar, settings.depthNear);
  if (invert[0]) lateral = 1 - lateral;
  if (invert[1]) vertical = 1 - vertical;
  if (invert[2]) forward = 1 - forward;

  return out.set(
    center[0] + (forward - 0.5) * size[0],
    center[1] + (vertical - 0.5) * size[1],
    center[2] + (lateral - 0.5) * size[2]
  );
}

export type WorkspaceHand = {
  u: number;
  v: number;
  handSize: number;
  /** True when the position falls outside the frame and u/v were clamped. */
  clamped: boolean;
};

/** Inverse of `mapHandToWorkspace`: where the hand must be to land on `position`. */
export function mapWorkspaceToHand(
  position: THREE.Vector3,
  settings: HandControlSettings,
  out: WorkspaceHand
): WorkspaceHand {
  const { workspaceCenter: center, workspaceSize: size, invert } = settings;

  let forward = (position.x - center[0]) / size[0] + 0.5;
  let vertical = (position.y - center[1]) / size[1] + 0.5;
  let lateral = (position.z - center[2]) / size[2] + 0.5;

  if (invert[0]) lateral = 1 - lateral;
  if (invert[1]) vertical = 1 - vertical;
  if (invert[2]) forward = 1 - forward;

  const u = lateral;
  const v = 1 - vertical;
  const depth = THREE.MathUtils.clamp(forward, 0, 1);

  out.clamped = u < 0 || u > 1 || v < 0 || v > 1 || forward !== depth;
  out.u = THREE.MathUtils.clamp(u, 0, 1);
  out.v = THREE.MathUtils.clamp(v, 0, 1);
  out.handSize =
    settings.depthFar + depth * (settings.depthNear - settings.depthFar);
  return out;
}
