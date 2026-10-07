"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { URDFRobot } from "urdf-loader";
import { VRControlSettings } from "@/config/vrControlConfig";
import {
  ControllerState,
  Hand,
  useVRTeleop,
  VRTeleopStatus,
} from "@/hooks/useVRTeleop";
import { HandMarker } from "../handControl/HandMarker";
import type { UpdateJointsDegrees } from "@/hooks/useRobotControl";
import type { JointDetails } from "../RobotScene";
import type { RobotConfig } from "@/config/robotConfig";

const COLOR_IDLE = "#a1a1aa";
const COLOR_GRIP = "#22c55e";
const COLOR_UNREACHABLE = "#ef4444";

type ControllerModelProps = {
  hand: Hand;
  controllersRef: React.RefObject<Record<Hand, ControllerState>>;
  activeHandRef: React.RefObject<Hand | null>;
  unreachableRef: React.RefObject<boolean>;
};

/**
 * A plain stand-in for a controller, posed in XR space under the rig (so its
 * sizes are in metres). Green while it holds the clutch, red when the arm
 * cannot reach where it is being asked to go.
 */
function ControllerModel({
  hand,
  controllersRef,
  activeHandRef,
  unreachableRef,
}: ControllerModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const triggerRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const group = groupRef.current;
    const state = controllersRef.current?.[hand];
    if (!group || !state) return;
    group.visible = state.connected;
    if (!state.connected) return;
    group.position.copy(state.localPosition);
    group.quaternion.copy(state.localQuaternion);

    const active = activeHandRef.current === hand;
    materialRef.current?.color.set(
      active ? (unreachableRef.current ? COLOR_UNREACHABLE : COLOR_GRIP) : COLOR_IDLE
    );
    // The jaw indicator closes as the trigger is pulled.
    if (triggerRef.current) {
      triggerRef.current.scale.x = 1 - 0.8 * state.trigger;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh>
        <boxGeometry args={[0.035, 0.035, 0.11]} />
        <meshStandardMaterial ref={materialRef} color={COLOR_IDLE} />
      </mesh>
      <mesh ref={triggerRef} position={[0, -0.025, -0.07]}>
        <boxGeometry args={[0.04, 0.008, 0.03]} />
        <meshStandardMaterial color="#facc15" />
      </mesh>
      <axesHelper args={[0.06]} />
    </group>
  );
}

type VRTeleopProps = {
  robotRef: React.RefObject<URDFRobot | null>;
  settings: VRControlSettings;
  ikConfig?: RobotConfig["ik"];
  jointDetails: JointDetails[];
  updateJointsDegrees: UpdateJointsDegrees;
  onStatus: (status: VRTeleopStatus) => void;
};

/**
 * Scene-side half of VR control: owns the XR rig, the controller visuals and
 * the gripper target marker. Inert until a WebXR session starts.
 */
export function VRTeleop({ onStatus, ...params }: VRTeleopProps) {
  const activeHandRef = useRef<Hand | null>(null);
  const unreachableRef = useRef(false);

  const { rig, controllersRef, markerRef } = useVRTeleop({
    ...params,
    onStatus: (status) => {
      activeHandRef.current = status.activeHand;
      unreachableRef.current = status.phase === "unreachable";
      onStatus(status);
    },
  });

  return (
    <>
      <primitive object={rig}>
        <ControllerModel
          hand="left"
          controllersRef={controllersRef}
          activeHandRef={activeHandRef}
          unreachableRef={unreachableRef}
        />
        <ControllerModel
          hand="right"
          controllersRef={controllersRef}
          activeHandRef={activeHandRef}
          unreachableRef={unreachableRef}
        />
      </primitive>
      <HandMarker markerRef={markerRef} />
    </>
  );
}
