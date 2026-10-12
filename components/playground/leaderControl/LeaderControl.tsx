import React, { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import { usePanelZ } from "../panelStack";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { LeaderConnectionHelpDialog } from "./LeaderConnectionHelpDialog";
import { ControlBadge } from "../ControlBadge";
import type { ControlAuthority } from "@/hooks/useControlAuthority";
import type { LeaderAngle } from "@/hooks/useLeaderSync";
import type { ROS2ConnectionStatus } from "@/hooks/useROS2";
import type { TopicFeed } from "@/hooks/useROS2Bridge";
import {
  LeaderMode,
  LeaderSettings,
  MAX_LEADER_HZ,
  MIN_LEADER_HZ,
} from "@/lib/leaderSettings";
import type { ROS2Role } from "@/lib/ros2Settings";

/** What the panel needs to know about the ROS side in ROS mode. */
type LeaderRosInfo = {
  status: ROS2ConnectionStatus;
  role: ROS2Role;
  commandTopic: string;
  /** The follower's state as it comes back, to show the link is alive. */
  followerState: TopicFeed;
  /** Takes the ROS leader role and connects to rosbridge if needed. */
  connectAsLeader: () => void;
};

const MODE_LABEL: Record<LeaderMode, string> = { direct: "Direct", ros: "ROS" };

/**
 * Leader arm panel. The sync loop itself runs in `useLeaderSync`, outside the
 * panel, so hiding or re-rendering the panel never disturbs it.
 */
const LeaderControl = ({
  leaderControl,
  jointDetails,
  angles,
  measuredHz,
  settings,
  onSettingsChange,
  followerConnected,
  ros,
  show = true,
  onHide,
  control,
}: {
  leaderControl: { isConnected: boolean; connectLeader: () => Promise<void>; disconnectLeader: () => Promise<void> };
  jointDetails: { servoId: number; name: string; jointType: string }[];
  /** Latest leader reading, degrees. */
  angles: LeaderAngle[];
  measuredHz: number;
  settings: LeaderSettings;
  onSettingsChange: (settings: LeaderSettings) => void;
  /** Whether a follower arm is connected to this browser (direct mode). */
  followerConnected: boolean;
  ros: LeaderRosInfo;
  show?: boolean;
  onHide: () => void;
  /** The leader only drives the arm while it holds control. */
  control?: ControlAuthority;
}) => {
  const revoluteJoints = jointDetails.filter((j) => j.jointType === "revolute");
  const { isConnected, connectLeader, disconnectLeader } = leaderControl;
  const { zIndex, bringToFront } = usePanelZ("leader");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "disconnecting"
  >("idle");
  const [ref, bounds] = useMeasure();

  // Initially position to bottom left corner
  useEffect(() => {
    if (bounds.height > 0) {
      setPosition({ x: 20, y: window.innerHeight - bounds.height - 20 });
    }
  }, [bounds.height]);

  const handleConnect = async () => {
    setConnectionStatus("connecting");
    try {
      await connectLeader();
    } finally {
      setConnectionStatus("idle");
    }
  };

  const handleDisconnect = async () => {
    setConnectionStatus("disconnecting");
    try {
      await disconnectLeader();
    } finally {
      setConnectionStatus("idle");
    }
  };

  if (!show) return null;

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      cancel="input, select, textarea, button"
      className="z-50"
      style={{ display: show ? undefined : "none", zIndex }}
    >
      <div onPointerDownCapture={bringToFront}
        ref={ref}
        className={"max-h-[90vh] overflow-y-auto text-sm " + panelStyle}
      >
        <h3 className="mt-0 mb-4 border-b border-white/50 pb-1 font-bold text-base flex justify-between items-center">
          <span>Control via Leader Robot</span>
          <button
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
            onClick={onHide}
            onTouchEnd={onHide}
          >
            ×
          </button>
        </h3>

        {control && isConnected && (
          <div className="mb-3">
            <ControlBadge source="leader" control={control} />
          </div>
        )}

        <div className="mb-3 space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Mode</span>
            <div className="flex rounded bg-zinc-800 p-0.5">
              {(["direct", "ros"] as LeaderMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onSettingsChange({ ...settings, mode: m })}
                  className={`rounded px-3 py-0.5 ${
                    settings.mode === m ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {settings.mode === "direct" ? (
            followerConnected ? (
              <div className="text-green-400">Driving the follower arm connected to this computer.</div>
            ) : (
              <div className="text-yellow-300">
                No follower arm connected here — connect it in the Joint Controls panel
                (only the 3D model moves until then).
              </div>
            )
          ) : ros.status === "connected" && ros.role === "leader" ? (
            <div className="space-y-0.5">
              <div className="text-green-400">
                Publishing every reading on <code>{ros.commandTopic}</code>.
              </div>
              <div className="text-zinc-400">
                Follower state:{" "}
                {ros.followerState.receivedAt !== null &&
                performance.now() - ros.followerState.receivedAt < 1000 ? (
                  <span className="text-green-400">{Math.round(ros.followerState.hz)} Hz</span>
                ) : (
                  <span className="text-zinc-500">no follower answering</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-yellow-300">
                {ros.status === "connected"
                  ? `ROS is connected as ${ros.role}, not leader.`
                  : "Not connected to ROS."}
              </span>
              <button
                onClick={ros.connectAsLeader}
                disabled={ros.status === "connecting"}
                className="shrink-0 rounded bg-sky-500/80 px-2 py-0.5 hover:bg-sky-500 disabled:opacity-50"
              >
                Connect ROS as leader
              </button>
            </div>
          )}

          <label className="flex items-center gap-2">
            <span className="shrink-0 text-zinc-400">Rate</span>
            <input
              type="range"
              min={MIN_LEADER_HZ}
              max={MAX_LEADER_HZ}
              step={1}
              value={settings.hz}
              onChange={(e) => onSettingsChange({ ...settings, hz: parseInt(e.target.value, 10) })}
              className="flex-1 accent-sky-400"
            />
            <span className="w-28 shrink-0 text-right tabular-nums text-zinc-300">
              {settings.hz} Hz
              {isConnected && (
                <span className="text-zinc-500"> · {measuredHz.toFixed(1)} real</span>
              )}
            </span>
          </label>
        </div>

        {revoluteJoints.length === 0 ? (
          <div className="mt-4 text-center text-gray-400">
            No joints available for leader control.
          </div>
        ) : (
          <>
            <div className="mt-4">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="border-b border-gray-600 pb-1">Joint</th>
                    <th className="border-b border-gray-600 pb-1 text-center pl-4">
                      Angle
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revoluteJoints.map((j) => (
                    <tr key={j.servoId}>
                      <td className="py-1">{j.name}</td>
                      <td className="py-1  text-center ">
                        {(() => {
                          const angle =
                            angles.find((a) => a.servoId === j.servoId)
                              ?.angle ?? 0;
                          const fixed = angle.toFixed(1);
                          return fixed + "°";
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-between items-center gap-2">
              {isConnected ? (
                <button
                  className={`bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded flex-1 ${
                    connectionStatus !== "idle"
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                  onClick={handleDisconnect}
                  disabled={connectionStatus !== "idle"}
                >
                  {connectionStatus === "disconnecting"
                    ? "Disconnecting..."
                    : "Disconnect Leader Robot"}
                </button>
              ) : (
                <button
                  className={`bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded flex-1 ${
                    connectionStatus !== "idle"
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                  onClick={handleConnect}
                  disabled={connectionStatus !== "idle"}
                >
                  {connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Connect Leader Robot"}
                </button>
              )}
              <LeaderConnectionHelpDialog />
            </div>
          </>
        )}
      </div>
    </Rnd>
  );
};

export default LeaderControl;
