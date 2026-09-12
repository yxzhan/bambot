/**
 * The "hold your hand like this" overlay.
 *
 * Latching the marker onto the gripper means matching its position, distance
 * and orientation at the same time, which is hard to do blind. The guide runs
 * the hand -> marker mapping backwards: it takes the gripper's current pose and
 * works out where in the camera frame the hand has to be, how big it has to
 * appear (i.e. how far from the camera) and how it has to be oriented, then
 * draws that hand over the preview.
 */

import * as THREE from "three";
import type { HandControlSettings } from "@/config/handControlConfig";
import { mapWorkspaceToHand } from "@/lib/handPose";
import type { WorkspaceHand } from "@/lib/handPose";

export type HandGuide = {
  visible: boolean;
  /** Display-space position of the middle knuckle, 0..1 across the preview. */
  u: number;
  v: number;
  /** Wrist-to-middle-knuckle length in image units - the apparent hand size. */
  handSize: number;
  /** Hand orientation, in the same camera frame `extractHandPose` reports. */
  quaternion: THREE.Quaternion;
  /** "Left" or "Right"; the skeleton is mirrored to match. */
  handedness: string;
  /** True when the gripper falls outside the mapped frame and u/v were clamped. */
  clamped: boolean;
  /**
   * Fraction of the wrist-to-knuckle segment that survives projection, 0..1.
   * Near zero the hand points at the camera, apparent size stops carrying any
   * depth information, and the guide cannot be matched in depth.
   */
  foreshortening: number;
};

/** Below this, the depth channel is degenerate and the guide says so. */
export const MIN_FORESHORTENING = 0.3;

/**
 * A stylised right hand, flat and fingers extended, in the same local frame
 * `handOrientation` builds: +X runs along the fingers, +Y across the palm from
 * index to pinky, +Z out of the back of the hand. Distances are in units of the
 * wrist-to-middle-knuckle length, so the skeleton scales by `handSize` directly.
 */
export const GUIDE_LANDMARKS: [number, number, number][] = [
  [0.0, 0.0, 0.0], // 0  wrist
  [0.22, -0.22, 0.04], // 1  thumb CMC
  [0.52, -0.42, 0.08], // 2  thumb MCP
  [0.74, -0.56, 0.1], // 3  thumb IP
  [0.92, -0.66, 0.11], // 4  thumb tip
  [0.97, -0.26, 0.0], // 5  index MCP
  [1.36, -0.3, 0.0], // 6  index PIP
  [1.6, -0.32, 0.0], // 7  index DIP
  [1.8, -0.33, 0.0], // 8  index tip
  [1.0, 0.0, 0.0], // 9  middle MCP
  [1.42, -0.01, 0.0], // 10 middle PIP
  [1.69, -0.02, 0.0], // 11 middle DIP
  [1.91, -0.02, 0.0], // 12 middle tip
  [0.95, 0.25, 0.0], // 13 ring MCP
  [1.33, 0.28, 0.0], // 14 ring PIP
  [1.57, 0.3, 0.0], // 15 ring DIP
  [1.77, 0.31, 0.0], // 16 ring tip
  [0.88, 0.48, 0.0], // 17 pinky MCP
  [1.18, 0.54, 0.0], // 18 pinky PIP
  [1.38, 0.57, 0.0], // 19 pinky DIP
  [1.55, 0.58, 0.0], // 20 pinky tip
];

/** Same topology as MediaPipe's HAND_CONNECTIONS. */
export const GUIDE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Knuckle line plus wrist, filled to make the palm readable. */
export const GUIDE_PALM = [0, 5, 9, 13, 17];

const _point = new THREE.Vector3();
const _segment = new THREE.Vector3();
/** The pose is anchored at the wrist, matching `extractHandPose`. */
const _anchor = new THREE.Vector3(...GUIDE_LANDMARKS[0]);
/** Wrist to middle knuckle - the segment `handSize` measures, length 1. */
const _handSpan = new THREE.Vector3(
  GUIDE_LANDMARKS[9][0] - GUIDE_LANDMARKS[0][0],
  GUIDE_LANDMARKS[9][1] - GUIDE_LANDMARKS[0][1],
  GUIDE_LANDMARKS[9][2] - GUIDE_LANDMARKS[0][2]
);
const _hand: WorkspaceHand = { u: 0.5, v: 0.5, handSize: 0.2, clamped: false };

/**
 * Turns the gripper's world pose into the hand pose that would line up with it.
 *
 * @param gripperPos - Tool frame position, scene units.
 * @param gripperQuat - Tool frame orientation, scene space.
 * @param settings - The same workspace mapping the teleop loop applies forwards.
 * @param target - Mutated in place to avoid per-tick allocation.
 */
export function computeHandGuide(
  gripperPos: THREE.Vector3,
  gripperQuat: THREE.Quaternion,
  settings: HandControlSettings,
  handedness: string,
  target: HandGuide
): HandGuide {
  mapWorkspaceToHand(gripperPos, settings, _hand);

  target.clamped = _hand.clamped;
  // Keep the skeleton on screen even when the gripper maps off the edge.
  target.u = THREE.MathUtils.clamp(_hand.u, 0.05, 0.95);
  target.v = THREE.MathUtils.clamp(_hand.v, 0.05, 0.95);
  target.handSize = _hand.handSize;

  // Forwards the marker is `hand * offset`, so the hand has to be
  // `gripper * offset^-1`.
  target.quaternion
    .set(
      settings.orientationOffset[0],
      settings.orientationOffset[1],
      settings.orientationOffset[2],
      settings.orientationOffset[3]
    )
    .invert()
    .premultiply(gripperQuat);

  // How much of the wrist-to-knuckle segment is left once projected.
  const mirrorY = handedness === "Left" ? -1 : 1;
  _segment
    .set(_handSpan.x, _handSpan.y * mirrorY, _handSpan.z)
    .applyQuaternion(target.quaternion);
  target.foreshortening = Math.hypot(_segment.x, _segment.y);

  target.handedness = handedness;
  target.visible = true;
  return target;
}

/**
 * Projects the guide skeleton into display-space fractions (0..1 across the
 * preview, origin top-left).
 *
 * The preview is mirrored, so image-space x is negated on the way out: the
 * result lines up with the operator's own hand as they see it.
 *
 * A tilted hand is foreshortened, and `extractHandPose` measures the projected
 * wrist-to-knuckle length - so the skeleton is scaled up by exactly that
 * foreshortening. Matching the drawing then reports the apparent size the guide
 * asked for, instead of one that reads as "further away".
 *
 * @param aspect - Video height / width, undoing the anisotropic normalisation.
 * @param out - 21 points, mutated in place.
 */
export function projectHandGuide(
  guide: HandGuide,
  aspect: number,
  out: { x: number; y: number; z: number }[]
) {
  const mirrorY = guide.handedness === "Left" ? -1 : 1;
  // Pointing straight at the camera leaves nothing to measure; cap the blow-up.
  const scale =
    guide.handSize / Math.max(guide.foreshortening, MIN_FORESHORTENING);

  for (let i = 0; i < GUIDE_LANDMARKS.length; i++) {
    const [lx, ly, lz] = GUIDE_LANDMARKS[i];
    _point
      .set(lx - _anchor.x, (ly - _anchor.y) * mirrorY, lz - _anchor.z)
      .applyQuaternion(guide.quaternion);

    out[i].x = guide.u - _point.x * scale;
    out[i].y = guide.v + (_point.y * scale) / aspect;
    // Kept for depth shading: positive is away from the camera.
    out[i].z = _point.z;
  }
}
