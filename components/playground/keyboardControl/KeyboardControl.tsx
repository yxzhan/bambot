"use client";

import React, { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import { usePanelZ } from "../panelStack";
import {
  JointState,
  UpdateJointDegrees,
  UpdateJointsDegrees,
  UpdateJointSpeed,
  UpdateJointsSpeed, // Add UpdateJointsSpeed type
} from "../../../hooks/useRobotControl"; // Adjusted import path
import { RevoluteJointsTable } from "./RevoluteJointsTable"; // Updated import path
import { ContinuousJointsTable } from "./ContinuousJointsTable"; // Updated import path
import { RobotConfig } from "@/config/robotConfig";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { RobotConnectionHelpDialog } from "./RobotConnectionHelpDialog";
import { ControlBadge } from "../ControlBadge";
import type { ControlAuthority } from "@/hooks/useControlAuthority";
import { MAX_SERVO_ACCELERATION, MIN_SERVO_ACCELERATION } from "@/lib/servoSettings";

// const baudRate = 1000000; // Define baud rate for serial communication - Keep if needed elsewhere, remove if only for UI

// --- Control Panel Component ---
type ControlPanelProps = {
  jointStates: JointState[]; // Use JointState type from useRobotControl
  updateJointDegrees: UpdateJointDegrees; // Updated type
  updateJointsDegrees: UpdateJointsDegrees; // Updated type
  updateJointSpeed: UpdateJointSpeed; // Updated type
  updateJointsSpeed: UpdateJointsSpeed; // Add updateJointsSpeed

  isConnected: boolean;

  connectRobot: () => void;
  disconnectRobot: () => void;
  keyboardControlMap: RobotConfig["keyboardControlMap"]; // New prop for keyboard control
  compoundMovements?: RobotConfig["compoundMovements"]; // Use type from robotConfig
  onHide?: () => void; // 新增 onHide 属性
  show?: boolean; // 新增 show 属性
  /** Keys, sliders and chat only reach the arm while manual control holds it. */
  control?: ControlAuthority;
  /** Follower servo acceleration (register 41); written on connect. */
  acceleration: number;
  onAccelerationChange: (value: number) => void;
};

export function ControlPanel({
  show = true,
  onHide,
  jointStates,
  updateJointDegrees,
  updateJointsDegrees,
  updateJointSpeed,
  updateJointsSpeed, // Pass updateJointsSpeed
  isConnected,
  connectRobot,
  disconnectRobot,
  keyboardControlMap, // Destructure new prop
  compoundMovements, // Destructure new prop
  control,
  acceleration,
  onAccelerationChange,
}: ControlPanelProps) {
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "disconnecting"
  >("idle");
  const [ref, bounds] = useMeasure();
  const { zIndex, bringToFront } = usePanelZ("keyboard");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);

  useEffect(() => {
    if (bounds.height > 0 && !hasDragged) {
      setPosition((pos) => ({
        ...pos,
        x: window.innerWidth - bounds.width - 20,
        y: window.innerHeight - bounds.height - 20,
      }));
    }
  }, [bounds.height, hasDragged]);

  const handleConnect = async () => {
    setConnectionStatus("connecting");
    try {
      await connectRobot();
    } finally {
      setConnectionStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    setConnectionStatus("disconnecting");
    try {
      await disconnectRobot();
    } finally {
      setConnectionStatus("idle");
    }
  };

  // Separate jointStates into revolute and continuous categories
  const revoluteJoints = jointStates.filter(
    (state) => state.jointType === "revolute"
  );
  const continuousJoints = jointStates.filter(
    (state) => state.jointType === "continuous"
  );

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => {
        setPosition({ x: d.x, y: d.y });
        setHasDragged(true);
      }}
      bounds="window"
      cancel="input, select, textarea, button"
      className="z-50"
      style={{ display: show ? undefined : "none", zIndex }}
    >
      <div onPointerDownCapture={bringToFront}
        ref={ref}
        className={"max-h-[80vh] overflow-y-auto text-sm " + panelStyle}
      >
        <h3 className="mt-0 mb-4 border-b border-white/50  pb-1 font-bold text-base flex justify-between items-center">
          <span>Joint Controls</span>
          <button
            onClick={onHide} // 优先调用 onHide
            onTouchEnd={onHide}
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
          >
            ×
          </button>
        </h3>

        {control && (
          <div className="mb-3">
            <ControlBadge source="manual" control={control} />
          </div>
        )}

        {/* Revolute Joints Table */}
        {revoluteJoints.length > 0 && (
          <RevoluteJointsTable
            joints={revoluteJoints}
            updateJointDegrees={updateJointDegrees}
            updateJointsDegrees={updateJointsDegrees}
            keyboardControlMap={keyboardControlMap}
            compoundMovements={compoundMovements}
          />
        )}

        {/* Continuous Joints Table */}
        {continuousJoints.length > 0 && (
          <ContinuousJointsTable
            joints={continuousJoints}
            updateJointSpeed={updateJointSpeed}
            updateJointsSpeed={updateJointsSpeed} // Pass updateJointsSpeed to ContinuousJointsTable
          />
        )}

        {/* Follower servo acceleration: whatever drives the arm, this shapes how it moves */}
        <label
          className={`mt-4 flex items-center gap-2 text-sm ${isConnected ? "opacity-50" : ""}`}
          title={
            "Servo acceleration limit (x100 steps/s², ~8.8°/s² per unit). Lower is smoother but lags more; 0 is no limit. " +
            (isConnected ? "Disconnect to change it." : "Written to the servos on connect.")
          }
        >
          <span className="shrink-0 text-zinc-400">Acceleration</span>
          <input
            type="range"
            min={MIN_SERVO_ACCELERATION}
            max={MAX_SERVO_ACCELERATION}
            step={1}
            value={acceleration}
            onChange={(e) => onAccelerationChange(parseInt(e.target.value, 10))}
            disabled={isConnected || connectionStatus !== "idle"}
            className="flex-1 accent-sky-400 disabled:cursor-not-allowed"
          />
          <span className="w-16 shrink-0 text-right tabular-nums text-zinc-300">
            {acceleration === 0 ? "no limit" : acceleration}
          </span>
        </label>

        {/* Connection Controls */}
        <div className="mt-4 flex justify-between items-center gap-2">
          <button
            onClick={isConnected ? handleDisconnect : handleConnect}
            disabled={connectionStatus !== "idle"}
            className={`text-white text-sm px-3 py-1.5 rounded flex-1 ${
              isConnected
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            } ${
              connectionStatus !== "idle" ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {connectionStatus === "connecting"
              ? "Connecting..."
              : connectionStatus === "disconnecting"
              ? "Disconnecting..."
              : isConnected
              ? "Disconnect Robot"
              : "Connect Follower Robot"}
          </button>
          <RobotConnectionHelpDialog />
        </div>
      </div>
    </Rnd>
  );
}
