/**
 * Turns detected hand poses into robot motion.
 *
 * The flow is: hand pose -> marker pose in the 3D scene -> (once the marker
 * lines up with the gripper) inverse kinematics -> `updateJointsDegrees`, which
 * is the same path keyboard and leader control use, so the 3D robot, the real
 * servos and the ROS 2 broadcast all stay in sync.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { URDFRobot } from "urdf-loader";
import {
  HandControlSettings,
  TELEOP_INTERVAL,
} from "@/config/handControlConfig";
import { HandPose, normalize } from "@/lib/handPose";
import {
  createIKChain,
  getTcpPose,
  IKChain,
  quaternionAngle,
  solveIK,
} from "@/lib/ik";
import { radiansToDegrees } from "@/lib/utils";
import { UpdateJointsDegrees } from "@/hooks/useRobotControl";
import type { JointDetails } from "@/components/playground/RobotScene";
import type { RobotConfig } from "@/config/robotConfig";

export type MarkerPhase =
  | "hidden"
  | "free"
  | "near"
  | "attached"
  | "unreachable";

/** Mutable marker state, read every frame by `HandMarker`. */
export type MarkerState = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  visible: boolean;
  phase: MarkerPhase;
  /** 0..1 while the marker is lining up with the gripper. */
  attachProgress: number;
};

export type TeleopStatus = {
  phase: MarkerPhase;
  attachProgress: number;
  /** Distance between marker and gripper while detached, IK residual while attached. */
  posError: number;
  /** Orientation error between marker and gripper, degrees. */
  angError: number;
  /** 0 = pinched shut, 1 = wide open. */
  openness: number;
  detachReason: string | null;
};

type UseHandTeleopParams = {
  enabled: boolean;
  robotRef: React.RefObject<URDFRobot | null>;
  handPoseRef: React.RefObject<HandPose | null>;
  settings: HandControlSettings;
  ikConfig?: RobotConfig["ik"];
  jointDetails: JointDetails[];
  updateJointsDegrees: UpdateJointsDegrees;
  /** Called by `calibrateOrientation` with the new hand -> gripper offset. */
  onOrientationCalibrated?: (offset: [number, number, number, number]) => void;
};

export type UseHandTeleopResult = {
  markerRef: React.RefObject<MarkerState>;
  status: TeleopStatus;
  detach: () => void;
  /** Treats the current hand pose as "aligned with the gripper right now". */
  calibrateOrientation: () => void;
};

const STATUS_INTERVAL = 150;

export function useHandTeleop({
  enabled,
  robotRef,
  handPoseRef,
  settings,
  ikConfig,
  jointDetails,
  updateJointsDegrees,
  onOrientationCalibrated,
}: UseHandTeleopParams): UseHandTeleopResult {
  const markerRef = useRef<MarkerState>({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    visible: false,
    phase: "hidden",
    attachProgress: 0,
  });

  const [status, setStatus] = useState<TeleopStatus>({
    phase: "hidden",
    attachProgress: 0,
    posError: 0,
    angError: 0,
    openness: 0,
    detachReason: null,
  });

  // Everything the 30 Hz loop reads goes through a ref so the interval never
  // has to be torn down and restarted mid-motion.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ikConfigRef = useRef(ikConfig);
  ikConfigRef.current = ikConfig;
  const jointDetailsRef = useRef(jointDetails);
  jointDetailsRef.current = jointDetails;
  const updateJointsDegreesRef = useRef(updateJointsDegrees);
  updateJointsDegreesRef.current = updateJointsDegrees;
  const onCalibratedRef = useRef(onOrientationCalibrated);
  onCalibratedRef.current = onOrientationCalibrated;

  const chainRef = useRef<IKChain | null>(null);
  const chainRobotRef = useRef<URDFRobot | null>(null);

  const attachedRef = useRef(false);
  const alignedForRef = useRef(0);
  const unreachableForRef = useRef(0);
  const detachReasonRef = useRef<string | null>(null);
  const smoothedRef = useRef(false);

  const targetPosRef = useRef(new THREE.Vector3());
  const targetQuatRef = useRef(new THREE.Quaternion());
  const tcpPosRef = useRef(new THREE.Vector3());
  const tcpQuatRef = useRef(new THREE.Quaternion());
  const offsetQuatRef = useRef(new THREE.Quaternion());

  const detach = useCallback((reason: string | null = "detached manually") => {
    attachedRef.current = false;
    alignedForRef.current = 0;
    unreachableForRef.current = 0;
    detachReasonRef.current = reason;
  }, []);

  const calibrateOrientation = useCallback(() => {
    const chain = chainRef.current;
    const pose = handPoseRef.current;
    if (!chain || !pose) return;

    getTcpPose(chain, tcpPosRef.current, tcpQuatRef.current);
    // offset = handQuat^-1 * gripperQuat, so hand * offset lands on the gripper.
    const offset = pose.quaternion
      .clone()
      .invert()
      .multiply(tcpQuatRef.current);
    onCalibratedRef.current?.([offset.x, offset.y, offset.z, offset.w]);
  }, [handPoseRef]);

  // Esc detaches, mirroring the panel button.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") detach("detached with Esc");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, detach]);

  useEffect(() => {
    if (!enabled) {
      markerRef.current.visible = false;
      markerRef.current.phase = "hidden";
      attachedRef.current = false;
      smoothedRef.current = false;
      return;
    }

    let lastStatusAt = 0;
    const marker = markerRef.current;

    const publishStatus = (next: Omit<TeleopStatus, "detachReason">, force = false) => {
      const now = performance.now();
      if (!force && now - lastStatusAt < STATUS_INTERVAL) return;
      lastStatusAt = now;
      setStatus({ ...next, detachReason: detachReasonRef.current });
    };

    const tick = () => {
      const config = settingsRef.current;
      const robot = robotRef.current;
      const pose = handPoseRef.current;

      // (Re)build the IK chain whenever the loaded robot changes.
      if (robot && ikConfigRef.current && chainRobotRef.current !== robot) {
        chainRobotRef.current = robot;
        chainRef.current = createIKChain(
          robot as unknown as {
            joints: Record<string, unknown>;
            links: Record<string, unknown>;
          },
          ikConfigRef.current.chainJoints,
          ikConfigRef.current.tcpLinkName
        );
      }

      const now = performance.now();
      const handFresh = pose !== null && now - pose.timestamp < config.handLostMs;

      if (!handFresh) {
        marker.visible = false;
        marker.phase = "hidden";
        marker.attachProgress = 0;
        alignedForRef.current = 0;
        smoothedRef.current = false;
        if (attachedRef.current) detach("hand left the frame");
        publishStatus({
          phase: "hidden",
          attachProgress: 0,
          posError: 0,
          angError: 0,
          openness: 0,
        });
        return;
      }

      // --- hand pose -> marker pose in scene space -------------------------
      const depth = normalize(pose.handSize, config.depthFar, config.depthNear);
      let lateral = pose.u;
      let vertical = 1 - pose.v;
      let forward = depth;
      if (config.invert[0]) lateral = 1 - lateral;
      if (config.invert[1]) vertical = 1 - vertical;
      if (config.invert[2]) forward = 1 - forward;

      // The robot is rotated -90 deg about X in the scene, so URDF forward (+X)
      // stays scene +X, up becomes +Y and the base sweeps across scene Z.
      targetPosRef.current.set(
        config.workspaceCenter[0] + (forward - 0.5) * config.workspaceSize[0],
        config.workspaceCenter[1] + (vertical - 0.5) * config.workspaceSize[1],
        config.workspaceCenter[2] + (lateral - 0.5) * config.workspaceSize[2]
      );

      offsetQuatRef.current.set(
        config.orientationOffset[0],
        config.orientationOffset[1],
        config.orientationOffset[2],
        config.orientationOffset[3]
      );
      targetQuatRef.current
        .copy(pose.quaternion)
        .multiply(offsetQuatRef.current);

      if (!smoothedRef.current) {
        marker.position.copy(targetPosRef.current);
        marker.quaternion.copy(targetQuatRef.current);
        smoothedRef.current = true;
      } else {
        marker.position.lerp(targetPosRef.current, config.posSmoothing);
        marker.quaternion.slerp(targetQuatRef.current, config.rotSmoothing);
      }
      marker.visible = true;

      const openness = normalize(
        pose.openness,
        config.opennessMin,
        config.opennessMax
      );

      const chain = chainRef.current;
      if (!chain) {
        marker.phase = "free";
        marker.attachProgress = 0;
        publishStatus({
          phase: "free",
          attachProgress: 0,
          posError: 0,
          angError: 0,
          openness,
        });
        return;
      }

      getTcpPose(chain, tcpPosRef.current, tcpQuatRef.current);
      const gripperDistance = marker.position.distanceTo(tcpPosRef.current);
      const gripperAngle = quaternionAngle(
        marker.quaternion,
        tcpQuatRef.current
      );

      // --- attach ----------------------------------------------------------
      if (!attachedRef.current) {
        const aligned =
          gripperDistance <= config.attachPosTol &&
          gripperAngle <= THREE.MathUtils.degToRad(config.attachAngTol);

        alignedForRef.current = aligned
          ? alignedForRef.current + TELEOP_INTERVAL
          : 0;
        marker.attachProgress = THREE.MathUtils.clamp(
          alignedForRef.current / config.attachHoldMs,
          0,
          1
        );
        marker.phase = aligned ? "near" : "free";

        if (alignedForRef.current >= config.attachHoldMs) {
          attachedRef.current = true;
          alignedForRef.current = 0;
          unreachableForRef.current = 0;
          detachReasonRef.current = null;
          marker.phase = "attached";
          marker.attachProgress = 1;
        } else {
          publishStatus({
            phase: marker.phase,
            attachProgress: marker.attachProgress,
            posError: gripperDistance,
            angError: THREE.MathUtils.radToDeg(gripperAngle),
            openness,
          });
          return;
        }
      }

      // --- attached: follow the marker -------------------------------------
      const result = solveIK(chain, marker.position, marker.quaternion, {
        positionTolerance: config.detachPosTol,
      });

      if (result.reachable) {
        unreachableForRef.current = 0;
        marker.phase = "attached";
      } else {
        unreachableForRef.current += TELEOP_INTERVAL;
        marker.phase = "unreachable";
        if (unreachableForRef.current >= config.detachHoldMs) {
          detach("target out of reach");
          publishStatus(
            {
              phase: "free",
              attachProgress: 0,
              posError: result.posError,
              angError: THREE.MathUtils.radToDeg(result.rotError),
              openness,
            },
            true
          );
          return;
        }
      }

      // Command the best-effort solution, even inside the out-of-reach grace
      // window - the arm then visibly stretches towards the marker.
      const details = jointDetailsRef.current;
      const updates: { servoId: number; value: number }[] = [];
      const chainJoints = ikConfigRef.current?.chainJoints ?? [];
      for (let i = 0; i < chainJoints.length; i++) {
        const detail = details.find((d) => d.name === chainJoints[i]);
        if (!detail) continue;
        updates.push({
          servoId: detail.servoId,
          value: radiansToDegrees(result.angles[i]),
        });
      }

      const gripperName = ikConfigRef.current?.gripperJoint;
      if (gripperName) {
        const detail = details.find((d) => d.name === gripperName);
        if (detail) {
          const lower = Number(detail.limit?.lower ?? 0);
          const upper = Number(detail.limit?.upper ?? Math.PI / 2);
          updates.push({
            servoId: detail.servoId,
            value: radiansToDegrees(lower + openness * (upper - lower)),
          });
        }
      }

      if (updates.length > 0) {
        updateJointsDegreesRef.current(updates);
      }

      publishStatus({
        phase: marker.phase,
        attachProgress: 1,
        posError: result.posError,
        angError: THREE.MathUtils.radToDeg(result.rotError),
        openness,
      });
    };

    const timer = setInterval(tick, TELEOP_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, robotRef, handPoseRef, detach]);

  return { markerRef, status, detach, calibrateOrientation };
}
