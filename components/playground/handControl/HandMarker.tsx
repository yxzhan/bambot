"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { MarkerPhase, MarkerState } from "@/hooks/useHandTeleop";

const PHASE_COLORS: Record<MarkerPhase, string> = {
  hidden: "#38bdf8",
  free: "#38bdf8", // sky - tracking, not latched
  near: "#facc15", // amber - lining up with the gripper
  attached: "#22c55e", // green - driving the arm
  unreachable: "#ef4444", // red - target outside the workspace
};

type HandMarkerProps = {
  markerRef: React.RefObject<MarkerState>;
};

/**
 * The hand proxy drawn in the 3D scene.
 *
 * It reads the marker pose straight from a ref every frame, so hand tracking
 * never re-renders the React tree.
 */
export function HandMarker({ markerRef }: HandMarkerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const lastPhase = useRef<MarkerPhase | null>(null);

  useFrame(() => {
    const group = groupRef.current;
    const marker = markerRef.current;
    if (!group || !marker) return;

    group.visible = marker.visible;
    if (!marker.visible) return;

    group.position.copy(marker.position);
    group.quaternion.copy(marker.quaternion);

    if (lastPhase.current !== marker.phase) {
      lastPhase.current = marker.phase;
      const color = PHASE_COLORS[marker.phase];
      bodyMaterialRef.current?.color.set(color);
      ringMaterialRef.current?.color.set(color);
    }

    // The ring closes in on the marker as the attach timer fills up.
    const ring = ringRef.current;
    if (ring) {
      ring.visible = marker.phase === "near";
      const scale = 2.2 - 1.2 * marker.attachProgress;
      ring.scale.setScalar(scale);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Frame axes: red = along the fingers, blue = out of the back of the hand */}
      <axesHelper args={[1.1]} />

      <mesh>
        <sphereGeometry args={[0.3, 20, 16]} />
        <meshStandardMaterial
          ref={bodyMaterialRef}
          color={PHASE_COLORS.free}
          transparent
          opacity={0.55}
        />
      </mesh>

      {/* Two stubs standing in for the jaws, along the marker's local X axis */}
      <mesh position={[0.45, 0.18, 0]}>
        <boxGeometry args={[0.7, 0.08, 0.24]} />
        <meshStandardMaterial
          color={PHASE_COLORS.free}
          transparent
          opacity={0.35}
        />
      </mesh>
      <mesh position={[0.45, -0.18, 0]}>
        <boxGeometry args={[0.7, 0.08, 0.24]} />
        <meshStandardMaterial
          color={PHASE_COLORS.free}
          transparent
          opacity={0.35}
        />
      </mesh>

      <mesh ref={ringRef} visible={false}>
        <torusGeometry args={[0.55, 0.045, 8, 32]} />
        <meshBasicMaterial ref={ringMaterialRef} color={PHASE_COLORS.near} />
      </mesh>
    </group>
  );
}
