/**
 * Guided calibration for hand control.
 *
 * Without it the operator has to reach the literal edges of the camera image to
 * reach the edge of the workspace, the forward/back range covers a sliver of
 * the arm's depth, and the orientation offset is whatever the defaults happen
 * to be - which makes latching onto the gripper needlessly fiddly.
 *
 * The wizard measures the operator instead of assuming:
 * 1. four corners  -> the part of the frame the hand actually sweeps (the
 *    lateral and vertical range)
 * 2. near and far  -> how big the hand looks at each end of a comfortable
 *    reach (the forward/back range)
 * 3. centre hold   -> the pose that should line up with the gripper, which
 *    fixes both the orientation offset and the workspace centre, so the arm is
 *    latched on the moment calibration ends.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  CALIBRATION_DWELL,
  CALIBRATION_POSE_DWELL,
  CALIBRATION_REARM_DISTANCE,
  CALIBRATION_REARM_SIZE_RATIO,
  CALIBRATION_STILL_EPSILON,
  HandControlSettings,
  TELEOP_INTERVAL,
} from "@/config/handControlConfig";
import type { HandPose } from "@/lib/handPose";
import { buildCalibrationPatch } from "@/lib/handCalibration";
import type { CalibrationSample, CalibrationSamples } from "@/lib/handCalibration";

export type CalibrationStep =
  | "idle"
  | "top-left"
  | "top-right"
  | "bottom-right"
  | "bottom-left"
  | "near"
  | "far"
  | "center"
  | "done";

/** The ordered steps, with where the on-screen target sits, 0..1 of the preview. */
export const CALIBRATION_STEPS: {
  step: CalibrationStep;
  target: [number, number] | null;
  dwell: number;
  title: string;
  detail: string;
}[] = [
  {
    step: "top-left",
    target: [0.12, 0.15],
    dwell: CALIBRATION_DWELL,
    title: "Top left",
    detail: "Palm towards the camera. Put your wrist on the marker and hold still.",
  },
  {
    step: "top-right",
    target: [0.88, 0.15],
    dwell: CALIBRATION_DWELL,
    title: "Top right",
    detail: "Same again, top right corner.",
  },
  {
    step: "bottom-right",
    target: [0.88, 0.85],
    dwell: CALIBRATION_DWELL,
    title: "Bottom right",
    detail: "Same again, bottom right corner.",
  },
  {
    step: "bottom-left",
    target: [0.12, 0.85],
    dwell: CALIBRATION_DWELL,
    title: "Bottom left",
    detail: "Last corner - that sets how far the arm moves left/right and up/down.",
  },
  {
    step: "near",
    target: [0.5, 0.5],
    dwell: CALIBRATION_DWELL,
    title: "Reach forward",
    detail:
      "Move your hand towards the camera, as close as is comfortable, and hold. This is the arm fully forward.",
  },
  {
    step: "far",
    target: [0.5, 0.5],
    dwell: CALIBRATION_DWELL,
    title: "Pull back",
    detail:
      "Now pull your hand back, as far as is comfortable, and hold. This is the arm fully back.",
  },
  {
    step: "center",
    target: [0.5, 0.5],
    dwell: CALIBRATION_POSE_DWELL,
    title: "Hold the gripper pose",
    detail:
      "Centre your hand and hold the pose that should match the gripper for 3 seconds.",
  },
];

export type CalibrationState = {
  step: CalibrationStep;
  /** 0..1 dwell progress for the current step. */
  progress: number;
  /** Where the current step's target sits in the preview, or null when idle. */
  target: [number, number] | null;
  title: string;
  detail: string;
  /** 1-based index of the current step, for "step 3 of 7". */
  index: number;
  total: number;
  /** Live hand size, so the near/far steps can show what is being measured. */
  handSize: number;
  /** Captured near/far hand sizes, shown as reference rings once known. */
  capturedNear: number | null;
  capturedFar: number | null;
  waitingForHand: boolean;
  /** True while the hand still has to move away from the previous sample. */
  waitingToMove: boolean;
};

type Sample = CalibrationSample;

type UseHandCalibrationParams = {
  enabled: boolean;
  handPoseRef: React.RefObject<HandPose | null>;
  /** Live gripper pose, written by the teleop loop. */
  gripperRef: React.RefObject<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    valid: boolean;
  }>;
  settings: HandControlSettings;
  /** Mirrors `state.step !== "idle"`; the teleop loop reads it to stay out of the way. */
  activeRef: React.RefObject<boolean>;
  onComplete: (patch: Partial<HandControlSettings>) => void;
};

export type UseHandCalibrationResult = {
  state: CalibrationState;
  active: boolean;
  start: () => void;
  cancel: () => void;
  /** Skips the dwell and takes the sample immediately. */
  captureNow: () => void;
};

const IDLE_STATE: CalibrationState = {
  step: "idle",
  progress: 0,
  target: null,
  title: "",
  detail: "",
  index: 0,
  total: CALIBRATION_STEPS.length,
  handSize: 0,
  capturedNear: null,
  capturedFar: null,
  waitingForHand: false,
  waitingToMove: false,
};

export function useHandCalibration({
  enabled,
  handPoseRef,
  gripperRef,
  settings,
  activeRef,
  onComplete,
}: UseHandCalibrationParams): UseHandCalibrationResult {
  const [state, setState] = useState<CalibrationState>(IDLE_STATE);

  const stepIndexRef = useRef(-1);
  const dwellStartRef = useRef(0);
  const dwellAnchorRef = useRef<Sample | null>(null);
  const samplesRef = useRef<CalibrationSamples>({});
  const poseQuatRef = useRef(new THREE.Quaternion());
  const captureNowRef = useRef(false);
  /** Previous step's sample; the hand must leave it before the next capture. */
  const lastCaptureRef = useRef<Sample | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const reset = useCallback(() => {
    stepIndexRef.current = -1;
    dwellStartRef.current = 0;
    dwellAnchorRef.current = null;
    lastCaptureRef.current = null;
    samplesRef.current = {};
    captureNowRef.current = false;
    if (activeRef) activeRef.current = false;
    setState(IDLE_STATE);
  }, [activeRef]);

  const start = useCallback(() => {
    samplesRef.current = {};
    dwellAnchorRef.current = null;
    lastCaptureRef.current = null;
    dwellStartRef.current = 0;
    captureNowRef.current = false;
    stepIndexRef.current = 0;
    if (activeRef) activeRef.current = true;
    const first = CALIBRATION_STEPS[0];
    setState({
      ...IDLE_STATE,
      step: first.step,
      target: first.target,
      title: first.title,
      detail: first.detail,
      index: 1,
      waitingForHand: true,
    });
  }, [activeRef]);

  const cancel = useCallback(() => reset(), [reset]);

  const captureNow = useCallback(() => {
    captureNowRef.current = true;
  }, []);

  /** Turns the collected samples into a settings patch. */
  const finish = useCallback(() => {
    const gripper = gripperRef.current;
    const patch = buildCalibrationPatch(
      samplesRef.current,
      settingsRef.current,
      gripper?.valid
        ? {
            position: gripper.position,
            quaternion: gripper.quaternion,
            handQuaternion: poseQuatRef.current,
          }
        : null
    );

    onCompleteRef.current(patch);
    if (activeRef) activeRef.current = false;
    stepIndexRef.current = -1;
    setState((prev) => ({ ...prev, step: "done", progress: 1, target: null }));
  }, [activeRef, gripperRef]);

  // Stop cleanly if hand tracking is switched off mid-wizard.
  useEffect(() => {
    if (!enabled && stepIndexRef.current >= 0) reset();
  }, [enabled, reset]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      const index = stepIndexRef.current;
      if (index < 0 || index >= CALIBRATION_STEPS.length) return;

      const current = CALIBRATION_STEPS[index];
      const pose = handPoseRef.current;
      const now = performance.now();
      const fresh =
        pose !== null && now - pose.timestamp < settingsRef.current.handLostMs;

      if (!fresh) {
        dwellAnchorRef.current = null;
        setState((prev) =>
          prev.progress === 0 && prev.waitingForHand
            ? prev
            : { ...prev, progress: 0, waitingForHand: true }
        );
        return;
      }

      const sample: Sample = {
        u: pose.u,
        v: pose.v,
        handSize: pose.handSize,
      };

      // Make the operator actually move between samples.
      const previous = lastCaptureRef.current;
      if (previous && !captureNowRef.current) {
        const travelled = Math.hypot(
          sample.u - previous.u,
          sample.v - previous.v
        );
        const resized =
          Math.abs(sample.handSize - previous.handSize) /
          Math.max(previous.handSize, 1e-6);
        if (
          travelled < CALIBRATION_REARM_DISTANCE &&
          resized < CALIBRATION_REARM_SIZE_RATIO
        ) {
          dwellAnchorRef.current = null;
          setState((prev) =>
            prev.waitingToMove && prev.progress === 0
              ? prev
              : { ...prev, progress: 0, waitingToMove: true, waitingForHand: false }
          );
          return;
        }
        lastCaptureRef.current = null;
      }

      // Restart the dwell whenever the hand drifts: the sample should be a
      // deliberately held position, not something caught in passing.
      const anchor = dwellAnchorRef.current;
      const moved =
        !anchor ||
        Math.abs(sample.u - anchor.u) > CALIBRATION_STILL_EPSILON ||
        Math.abs(sample.v - anchor.v) > CALIBRATION_STILL_EPSILON ||
        Math.abs(sample.handSize - anchor.handSize) >
          CALIBRATION_STILL_EPSILON * anchor.handSize * 4;

      if (moved) {
        dwellAnchorRef.current = sample;
        dwellStartRef.current = now;
      }

      const held = now - dwellStartRef.current;
      const progress = THREE.MathUtils.clamp(held / current.dwell, 0, 1);

      if (progress >= 1 || captureNowRef.current) {
        captureNowRef.current = false;
        samplesRef.current[current.step as keyof CalibrationSamples] = sample;
        lastCaptureRef.current = sample;
        if (current.step === "center") poseQuatRef.current.copy(pose.quaternion);

        const nextIndex = index + 1;
        dwellAnchorRef.current = null;
        dwellStartRef.current = now;

        if (nextIndex >= CALIBRATION_STEPS.length) {
          finish();
          return;
        }

        stepIndexRef.current = nextIndex;
        const next = CALIBRATION_STEPS[nextIndex];
        setState((prev) => ({
          ...prev,
          step: next.step,
          target: next.target,
          title: next.title,
          detail: next.detail,
          index: nextIndex + 1,
          progress: 0,
          waitingForHand: false,
          waitingToMove: true,
          handSize: sample.handSize,
          capturedNear: samplesRef.current.near?.handSize ?? null,
          capturedFar: samplesRef.current.far?.handSize ?? null,
        }));
        return;
      }

      setState((prev) =>
        Math.abs(prev.progress - progress) < 0.01 &&
        Math.abs(prev.handSize - sample.handSize) < 0.002 &&
        !prev.waitingForHand &&
        !prev.waitingToMove
          ? prev
          : {
              ...prev,
              progress,
              handSize: sample.handSize,
              waitingForHand: false,
              waitingToMove: false,
            }
      );
    };

    const timer = setInterval(tick, TELEOP_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, handPoseRef, finish]);

  return {
    state,
    active: state.step !== "idle" && state.step !== "done",
    start,
    cancel,
    captureNow,
  };
}
