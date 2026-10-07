/**
 * Drives the arm from VR controllers. Runs inside the react-three-fiber
 * canvas, because controller poses only exist on the XRFrame handed to
 * `useFrame`.
 *
 * The control scheme is a clutch: hold the grip button and the gripper follows
 * the controller's motion *relative to where it was when you squeezed*;
 * release it and the arm stays put while you move your hand. There is nothing
 * to line up first, so the arm never jumps on engage. The trigger closes the
 * gripper while engaged (once it has been brought to the gripper's current
 * opening, so re-engaging never drops what is held), A / X recentres the robot in front of you and the
 * thumbstick raises or lowers it.
 *
 * While the target is out of reach the arm holds still rather than stretching
 * after it.
 *
 * IK and joint commands go through `lib/ik.ts` and `updateJointsDegrees`, the
 * same path hand control uses, so the 3D robot, the servos and the ROS 2
 * broadcast stay in sync.
 */

"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { URDFRobot } from "urdf-loader";
import {
  BUTTON_PRESS,
  BUTTON_RELEASE,
  GRIPPER_TAKEOVER_TOLERANCE,
  THUMBSTICK_DEADZONE,
  THUMBSTICK_HEIGHT_SPEED,
  VR_IK_RESTARTS,
  VR_IK_ROT_TOLERANCE,
  VR_IK_ROT_WEIGHT,
  VR_TELEOP_INTERVAL,
  VRControlSettings,
} from "@/config/vrControlConfig";
import {
  createIKChain,
  getTcpPose,
  IKChain,
  readChainAngles,
  solveIK,
} from "@/lib/ik";
import { buildJointUpdates } from "@/lib/ikCommands";
import {
  applyRigPlacement,
  computeClutchTarget,
  computeRigPlacement,
  limitJointStep,
  RigPlacement,
} from "@/lib/vrTeleop";
import type { MarkerState } from "@/hooks/useHandTeleop";
import type { UpdateJointsDegrees } from "@/hooks/useRobotControl";
import type { JointDetails } from "@/components/playground/RobotScene";
import type { RobotConfig } from "@/config/robotConfig";

export type Hand = "left" | "right";

export type VRTeleopPhase = "off" | "idle" | "engaged" | "unreachable";

export type VRTeleopStatus = {
  phase: VRTeleopPhase;
  /** Hand holding the clutch, if any. */
  activeHand: Hand | null;
  /** Controllers currently tracked. */
  controllers: Hand[];
  /** IK position residual while engaged, scene units. */
  posError: number;
  /** 0 = closed, 1 = open. */
  gripperOpenness: number;
  /**
   * False while engaged but the trigger has not yet been brought to the
   * gripper's current opening - until then the gripper holds still.
   */
  gripperFollowing: boolean;
};

/** Mutable per-controller state, read every frame by the controller visuals. */
export type ControllerState = {
  connected: boolean;
  /** Grip pose in the XR reference space, metres. Rendered under the rig. */
  localPosition: THREE.Vector3;
  localQuaternion: THREE.Quaternion;
  /** Grip pose in scene space. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  squeeze: number;
  trigger: number;
  /** A on the right controller, X on the left. */
  primaryPressed: boolean;
  thumbstickY: number;
  /** Squeeze state after hysteresis. */
  gripHeld: boolean;
};

type UseVRTeleopParams = {
  robotRef: React.RefObject<URDFRobot | null>;
  settings: VRControlSettings;
  ikConfig?: RobotConfig["ik"];
  jointDetails: JointDetails[];
  updateJointsDegrees: UpdateJointsDegrees;
  onStatus: (status: VRTeleopStatus) => void;
};

export type UseVRTeleopResult = {
  /**
   * Parents the XR camera and the controller visuals; maps XR space into the
   * scene. Mount it at the scene root (e.g. `<primitive object={rig} />`) - its
   * local transform is treated as its world transform.
   */
  rig: THREE.Group;
  controllersRef: React.RefObject<Record<Hand, ControllerState>>;
  /** Gripper target while engaged, drawn by `HandMarker`. */
  markerRef: React.RefObject<MarkerState>;
};

const STATUS_INTERVAL = 150;

function createControllerState(): ControllerState {
  return {
    connected: false,
    localPosition: new THREE.Vector3(),
    localQuaternion: new THREE.Quaternion(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    squeeze: 0,
    trigger: 0,
    primaryPressed: false,
    thumbstickY: 0,
    gripHeld: false,
  };
}

export function useVRTeleop({
  robotRef,
  settings,
  ikConfig,
  jointDetails,
  updateJointsDegrees,
  onStatus,
}: UseVRTeleopParams): UseVRTeleopResult {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);

  const rig = useMemo(() => new THREE.Group(), []);

  const controllersRef = useRef<Record<Hand, ControllerState>>({
    left: createControllerState(),
    right: createControllerState(),
  });
  const markerRef = useRef<MarkerState>({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    visible: false,
    phase: "hidden",
    attachProgress: 0,
  });

  // Everything the frame loop reads goes through a ref, so a settings change
  // never re-subscribes anything mid-motion.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ikConfigRef = useRef(ikConfig);
  ikConfigRef.current = ikConfig;
  const jointDetailsRef = useRef(jointDetails);
  jointDetailsRef.current = jointDetails;
  const updateJointsDegreesRef = useRef(updateJointsDegrees);
  updateJointsDegreesRef.current = updateJointsDegrees;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const chainRef = useRef<IKChain | null>(null);
  const chainRobotRef = useRef<URDFRobot | null>(null);

  const placementRef = useRef<RigPlacement>({
    base: new THREE.Vector3(),
    yaw: 0,
  });
  const needsRecenterRef = useRef(false);

  const activeHandRef = useRef<Hand | null>(null);
  const anchorControllerPos = useRef(new THREE.Vector3());
  const anchorControllerQuat = useRef(new THREE.Quaternion());
  const anchorTcpPos = useRef(new THREE.Vector3());
  const anchorTcpQuat = useRef(new THREE.Quaternion());
  const gripperOpennessRef = useRef(1);
  const gripperFollowingRef = useRef(false);
  /** Which side of the gripper's opening the trigger started on, at engage. */
  const takeoverSideRef = useRef(0);

  const sinceTickRef = useRef(0);
  const lastStatusAtRef = useRef(0);
  const statusRef = useRef<VRTeleopStatus>({
    phase: "off",
    activeHand: null,
    controllers: [],
    posError: 0,
    gripperOpenness: 1,
    gripperFollowing: false,
  });

  // Scratch objects for the frame loop.
  const scratch = useMemo(
    () => ({
      tcpPos: new THREE.Vector3(),
      tcpQuat: new THREE.Quaternion(),
      basePos: new THREE.Vector3(),
      headPos: new THREE.Vector3(),
      headQuat: new THREE.Quaternion(),
      targetPos: new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
    }),
    []
  );

  // Enter / leave XR: the camera moves under the rig for the session, so the
  // headset sees the scene through the rig's scale and placement.
  useEffect(() => {
    const xr = gl.xr;
    let saved: {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      scale: THREE.Vector3;
      near: number;
      background: THREE.Scene["background"];
    } | null = null;

    const onSessionStart = () => {
      const session = xr.getSession();
      saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        scale: camera.scale.clone(),
        near: camera.near,
        background: scene.background,
      };
      rig.add(camera);
      // Near is in metres here; the default would clip the gripper when you lean in.
      camera.near = 0.01;
      // Passthrough (AR) sessions need a transparent background to see the room.
      if (session && session.environmentBlendMode !== "opaque") {
        scene.background = null;
      }
      needsRecenterRef.current = true;
      activeHandRef.current = null;
    };

    const onSessionEnd = () => {
      rig.remove(camera);
      if (saved) {
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.scale.copy(saved.scale);
        camera.near = saved.near;
        scene.background = saved.background;
      }
      // XR overwrote the projection matrix with the headset's.
      if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      activeHandRef.current = null;
      markerRef.current.visible = false;
      markerRef.current.phase = "hidden";
      for (const hand of ["left", "right"] as Hand[]) {
        controllersRef.current[hand].connected = false;
        controllersRef.current[hand].gripHeld = false;
      }
      statusRef.current = {
        phase: "off",
        activeHand: null,
        controllers: [],
        posError: 0,
        gripperOpenness: gripperOpennessRef.current,
        gripperFollowing: false,
      };
      onStatusRef.current(statusRef.current);
    };

    xr.addEventListener("sessionstart", onSessionStart);
    xr.addEventListener("sessionend", onSessionEnd);
    return () => {
      xr.removeEventListener("sessionstart", onSessionStart);
      xr.removeEventListener("sessionend", onSessionEnd);
    };
  }, [gl, camera, scene, rig]);

  useFrame((state, delta, frame?: XRFrame) => {
    if (!frame || !gl.xr.isPresenting) return;
    const refSpace = gl.xr.getReferenceSpace();
    const robot = robotRef.current;
    if (!refSpace || !robot) return;

    // (Re)build the IK chain whenever the loaded robot changes.
    if (ikConfigRef.current && chainRobotRef.current !== robot) {
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
    const chain = chainRef.current;
    const config = settingsRef.current;
    const scale = robot.scale.x;

    if (chain) getTcpPose(chain, scratch.tcpPos, scratch.tcpQuat);

    // --- place the robot in front of the operator ---------------------------
    const recenter = () => {
      const viewer = frame.getViewerPose(refSpace);
      if (!viewer) return false;
      const { position, orientation } = viewer.transform;
      scratch.headPos.set(position.x, position.y, position.z);
      scratch.headQuat.set(orientation.x, orientation.y, orientation.z, orientation.w);
      robot.getWorldPosition(scratch.basePos);
      const reach = chain
        ? scratch.tcpPos.clone().sub(scratch.basePos)
        : new THREE.Vector3(0, 0, 1);
      computeRigPlacement(
        scratch.headPos,
        scratch.headQuat,
        reach,
        config.baseDistance,
        config.baseBelowEyes,
        placementRef.current
      );
      applyRigPlacement(rig, placementRef.current, scale);
      return true;
    };
    if (needsRecenterRef.current && recenter()) {
      needsRecenterRef.current = false;
    }

    // --- read the controllers -----------------------------------------------
    const controllers = controllersRef.current;
    const seen: Record<Hand, boolean> = { left: false, right: false };
    let raise = 0;
    let recenterPressed = false;

    for (const source of frame.session.inputSources) {
      const hand = source.handedness;
      if ((hand !== "left" && hand !== "right") || !source.gamepad || !source.gripSpace) {
        continue;
      }
      const pose = frame.getPose(source.gripSpace, refSpace);
      if (!pose) continue;

      const c = controllers[hand];
      const { position, orientation } = pose.transform;
      c.localPosition.set(position.x, position.y, position.z);
      c.localQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
      c.position.copy(c.localPosition).applyMatrix4(rig.matrixWorld);
      c.quaternion.copy(rig.quaternion).multiply(c.localQuaternion);

      // xr-standard mapping: 0 trigger, 1 squeeze, 4 A/X, axes 2/3 thumbstick.
      const buttons = source.gamepad.buttons;
      const axes = source.gamepad.axes;
      c.trigger = buttons[0]?.value ?? 0;
      c.squeeze = buttons[1]?.value ?? (buttons[1]?.pressed ? 1 : 0);
      const primary = buttons[4]?.pressed ?? false;
      if (primary && !c.primaryPressed) recenterPressed = true;
      c.primaryPressed = primary;
      c.thumbstickY = axes[3] ?? 0;
      if (Math.abs(c.thumbstickY) > THUMBSTICK_DEADZONE) raise -= c.thumbstickY;

      c.gripHeld = c.gripHeld ? c.squeeze > BUTTON_RELEASE : c.squeeze > BUTTON_PRESS;
      c.connected = true;
      seen[hand] = true;
    }
    for (const hand of ["left", "right"] as Hand[]) {
      if (!seen[hand]) {
        controllers[hand].connected = false;
        controllers[hand].gripHeld = false;
      }
    }

    // --- clutch -------------------------------------------------------------
    let active = activeHandRef.current;
    if (active && !controllers[active].gripHeld) {
      active = null;
    }
    if (!active && chain) {
      const hand = (["right", "left"] as Hand[]).find((h) => controllers[h].gripHeld);
      if (hand) {
        active = hand;
        anchorControllerPos.current.copy(controllers[hand].position);
        anchorControllerQuat.current.copy(controllers[hand].quaternion);
        anchorTcpPos.current.copy(scratch.tcpPos);
        anchorTcpQuat.current.copy(scratch.tcpQuat);
        sinceTickRef.current = VR_TELEOP_INTERVAL; // command on this very frame
        gripperFollowingRef.current = false;
        takeoverSideRef.current = 0;
      }
    }
    activeHandRef.current = active;

    // Re-placing the robot under an engaged hand would yank the arm along, so
    // recentring and height changes wait until the clutch is released.
    if (!active) {
      if (recenterPressed) recenter();
      if (raise !== 0) {
        placementRef.current.base.y -=
          raise * THUMBSTICK_HEIGHT_SPEED * Math.min(delta, 0.1);
        applyRigPlacement(rig, placementRef.current, scale);
      }
    }

    // --- follow ---------------------------------------------------------------
    const marker = markerRef.current;
    const connected = (["left", "right"] as Hand[]).filter((h) => controllers[h].connected);

    if (!active || !chain) {
      marker.visible = false;
      marker.phase = "hidden";
      publishStatus("idle", null, connected, 0);
      return;
    }

    sinceTickRef.current += delta * 1000;
    if (sinceTickRef.current < VR_TELEOP_INTERVAL) return;
    const dt = Math.min(sinceTickRef.current, 100) / 1000;
    sinceTickRef.current = 0;

    const c = controllers[active];
    computeClutchTarget(
      anchorControllerPos.current,
      anchorControllerQuat.current,
      c.position,
      c.quaternion,
      anchorTcpPos.current,
      anchorTcpQuat.current,
      config.motionScale,
      config.followRotation,
      scratch.targetPos,
      scratch.targetQuat
    );

    const result = solveIK(chain, scratch.targetPos, scratch.targetQuat, {
      positionTolerance: config.reachTolerance,
      restarts: VR_IK_RESTARTS,
      rotWeight: config.followRotation ? VR_IK_ROT_WEIGHT : 0,
      rotationTolerance: VR_IK_ROT_TOLERANCE,
    });
    // Out of reach, the best-effort solution is the arm stretched towards a
    // point it cannot get to, and it jitters with every tremor of the hand. So
    // the arm holds its last reachable pose instead, and picks the target up
    // again as soon as the hand brings it back within reach.
    const angles = result.reachable
      ? limitJointStep(
          readChainAngles(chain),
          result.angles,
          THREE.MathUtils.degToRad(config.maxJointSpeed) * dt
        )
      : null;

    // Trigger pulled = jaws closed. The trigger only takes the gripper over
    // once it matches (or sweeps past) the gripper's current opening, so
    // engaging with a loose trigger never snaps the jaws open.
    const gripperJoint = ikConfigRef.current?.gripperJoint;
    const triggerOpenness = 1 - THREE.MathUtils.clamp(c.trigger, 0, 1);
    const currentOpenness = gripperJoint
      ? readGripperOpenness(robot, gripperJoint)
      : null;
    if (currentOpenness === null) {
      gripperFollowingRef.current = false;
    } else if (!gripperFollowingRef.current) {
      const gap = triggerOpenness - currentOpenness;
      const side = Math.sign(gap);
      if (
        Math.abs(gap) <= GRIPPER_TAKEOVER_TOLERANCE ||
        (takeoverSideRef.current !== 0 && side !== takeoverSideRef.current)
      ) {
        gripperFollowingRef.current = true;
      } else if (takeoverSideRef.current === 0) {
        takeoverSideRef.current = side;
      }
    }
    gripperOpennessRef.current = gripperFollowingRef.current
      ? triggerOpenness
      : currentOpenness ?? triggerOpenness;

    // The gripper keeps following the trigger even while the arm holds, so
    // whatever is held can still be let go.
    const updates = buildJointUpdates(
      angles ? ikConfigRef.current?.chainJoints ?? [] : [],
      angles ?? [],
      jointDetailsRef.current,
      gripperJoint && gripperFollowingRef.current
        ? { joint: gripperJoint, openness: triggerOpenness }
        : undefined
    );
    if (updates.length > 0) updateJointsDegreesRef.current(updates);

    marker.position.copy(scratch.targetPos);
    marker.quaternion.copy(scratch.targetQuat);
    marker.visible = true;
    marker.phase = result.reachable ? "attached" : "unreachable";
    marker.attachProgress = 1;

    publishStatus(
      result.reachable ? "engaged" : "unreachable",
      active,
      connected,
      result.posError
    );

    function publishStatus(
      phase: VRTeleopPhase,
      activeHand: Hand | null,
      tracked: Hand[],
      posError: number
    ) {
      const now = performance.now();
      const previous = statusRef.current;
      const changed =
        previous.phase !== phase ||
        previous.activeHand !== activeHand ||
        previous.controllers.join() !== tracked.join();
      if (!changed && now - lastStatusAtRef.current < STATUS_INTERVAL) return;
      lastStatusAtRef.current = now;
      statusRef.current = {
        phase,
        activeHand,
        controllers: tracked,
        posError,
        gripperOpenness: gripperOpennessRef.current,
        gripperFollowing: activeHand !== null && gripperFollowingRef.current,
      };
      onStatusRef.current(statusRef.current);
    }
  });

  return { rig, controllersRef, markerRef };
}

/** Current gripper opening, 0 = closed, 1 = open, or null if the joint is missing. */
function readGripperOpenness(robot: URDFRobot, jointName: string): number | null {
  const joint = robot.joints[jointName];
  if (!joint) return null;
  const lower = Number(joint.limit?.lower ?? 0);
  const upper = Number(joint.limit?.upper ?? Math.PI / 2);
  if (upper === lower) return null;
  return THREE.MathUtils.clamp(
    (Number(joint.angle) - lower) / (upper - lower),
    0,
    1
  );
}
