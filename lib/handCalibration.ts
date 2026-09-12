/**
 * Turns the samples collected by the calibration wizard into settings.
 *
 * Kept free of React so the mapping can be reasoned about (and tested) on its
 * own: the whole point of the wizard is that afterwards the operator's held
 * pose maps exactly onto the gripper.
 */

import * as THREE from "three";
import type { HandControlSettings } from "@/config/handControlConfig";
import { normalize } from "@/lib/handPose";

export type CalibrationSample = {
  u: number;
  v: number;
  handSize: number;
};

export type CalibrationSamples = {
  "top-left"?: CalibrationSample;
  "top-right"?: CalibrationSample;
  "bottom-right"?: CalibrationSample;
  "bottom-left"?: CalibrationSample;
  near?: CalibrationSample;
  far?: CalibrationSample;
  center?: CalibrationSample;
};

export type CalibrationReference = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Hand orientation held during the centre step. */
  handQuaternion: THREE.Quaternion;
};

const CORNER_STEPS = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
] as const;

/** Keeps the very edge of the swept area reachable rather than knife-edge. */
const FRAME_PADDING = 0.02;
/** Below this ratio the near/far samples are too close together to be useful. */
const MIN_DEPTH_RATIO = 1.05;

export function buildCalibrationPatch(
  samples: CalibrationSamples,
  settings: HandControlSettings,
  reference: CalibrationReference | null
): Partial<HandControlSettings> {
  const patch: Partial<HandControlSettings> = {};

  const corners = CORNER_STEPS.map((step) => samples[step]).filter(
    (sample): sample is CalibrationSample => sample !== undefined
  );

  if (corners.length === CORNER_STEPS.length) {
    const us = corners.map((c) => c.u);
    const vs = corners.map((c) => c.v);
    const minU = Math.min(...us);
    const maxU = Math.max(...us);
    const minV = Math.min(...vs);
    const maxV = Math.max(...vs);
    // Degenerate sweeps (all four samples on top of each other) are ignored.
    if (maxU - minU > 0.1 && maxV - minV > 0.1) {
      patch.frameMinU = minU + FRAME_PADDING;
      patch.frameMaxU = maxU - FRAME_PADDING;
      patch.frameMinV = minV + FRAME_PADDING;
      patch.frameMaxV = maxV - FRAME_PADDING;
    }
  }

  const { near, far } = samples;
  if (near && far && near.handSize > far.handSize * MIN_DEPTH_RATIO) {
    patch.depthNear = near.handSize;
    patch.depthFar = far.handSize;
  }

  const center = samples.center;
  if (center && reference) {
    const merged = { ...settings, ...patch };

    let lateral = normalize(center.u, merged.frameMinU, merged.frameMaxU);
    let vertical = 1 - normalize(center.v, merged.frameMinV, merged.frameMaxV);
    let forward = normalize(center.handSize, merged.depthFar, merged.depthNear);
    if (merged.invert[0]) lateral = 1 - lateral;
    if (merged.invert[1]) vertical = 1 - vertical;
    if (merged.invert[2]) forward = 1 - forward;

    // Slide the workspace so the held hand sits exactly on the gripper: the
    // marker is then already latched when calibration ends.
    patch.workspaceCenter = [
      reference.position.x - (forward - 0.5) * merged.workspaceSize[0],
      reference.position.y - (vertical - 0.5) * merged.workspaceSize[1],
      reference.position.z - (lateral - 0.5) * merged.workspaceSize[2],
    ];

    // offset = hand^-1 * gripper, so hand * offset lands on the gripper.
    const offset = reference.handQuaternion
      .clone()
      .invert()
      .multiply(reference.quaternion);
    patch.orientationOffset = [offset.x, offset.y, offset.z, offset.w];
  }

  return patch;
}
