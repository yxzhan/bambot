/**
 * Which input is allowed to drive the arm.
 *
 * Every control mode writes joints through `updateJoints*`, and without a
 * referee they fight: a follower applying ROS commands while someone presses
 * a key, a leader arm still syncing while VR is in use. Exactly one source owns
 * the arm at a time, and writes from any other source are dropped.
 *
 * Ownership only moves on an explicit action - connecting the leader arm,
 * starting a replay, entering VR, connecting as a ROS follower, or pressing
 * "Take control" - never because some input happened to arrive. When the
 * owner finishes, control falls back to manual (keyboard / sliders / chat).
 */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  UpdateJointDegrees,
  UpdateJointsDegrees,
  UpdateJointSpeed,
  UpdateJointsSpeed,
} from "@/hooks/useRobotControl";

export type ControlSource = "manual" | "leader" | "replay" | "vr" | "ros" | "hand";

export const CONTROL_SOURCE_LABEL: Record<ControlSource, string> = {
  manual: "Keyboard",
  leader: "Leader arm",
  replay: "Replay",
  vr: "VR",
  ros: "ROS follower",
  hand: "Hand tracking",
};

const CONTROL_SOURCES = Object.keys(CONTROL_SOURCE_LABEL) as ControlSource[];

/** Joint writers that only reach the arm while their source owns it. */
export type GatedWriters = {
  updateJointDegrees: UpdateJointDegrees;
  updateJointsDegrees: UpdateJointsDegrees;
  updateJointSpeed: UpdateJointSpeed;
  updateJointsSpeed: UpdateJointsSpeed;
};

export type ControlAuthority = {
  owner: ControlSource;
  /** Makes `source` the owner. Call it on an explicit user action only. */
  claim: (source: ControlSource) => void;
  /** Hands control back to manual, if `source` still owns it. */
  release: (source: ControlSource) => void;
  /** The writers each source must use instead of the raw ones. */
  writers: Record<ControlSource, GatedWriters>;
};

export function useControlAuthority(raw: GatedWriters): ControlAuthority {
  const [owner, setOwner] = useState<ControlSource>("manual");
  // Read by the writers, which must see a claim immediately - not on the
  // next render - or the first frames after a switch would still go through.
  const ownerRef = useRef<ControlSource>("manual");
  const rawRef = useRef(raw);
  rawRef.current = raw;

  const claim = useCallback((source: ControlSource) => {
    ownerRef.current = source;
    setOwner(source);
  }, []);

  const release = useCallback((source: ControlSource) => {
    if (ownerRef.current !== source) return;
    ownerRef.current = "manual";
    setOwner("manual");
  }, []);

  const writers = useMemo(() => {
    const gate = (source: ControlSource): GatedWriters => ({
      updateJointDegrees: (servoId, value) =>
        ownerRef.current === source
          ? rawRef.current.updateJointDegrees(servoId, value)
          : Promise.resolve(),
      updateJointsDegrees: (updates) =>
        ownerRef.current === source
          ? rawRef.current.updateJointsDegrees(updates)
          : Promise.resolve(),
      updateJointSpeed: (servoId, speed) =>
        ownerRef.current === source
          ? rawRef.current.updateJointSpeed(servoId, speed)
          : Promise.resolve(),
      updateJointsSpeed: (updates) =>
        ownerRef.current === source
          ? rawRef.current.updateJointsSpeed(updates)
          : Promise.resolve(),
    });
    return Object.fromEntries(CONTROL_SOURCES.map((s) => [s, gate(s)])) as Record<
      ControlSource,
      GatedWriters
    >;
  }, []);

  return { owner, claim, release, writers };
}
