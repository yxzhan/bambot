"use client";

import React, { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import type { RosJointState } from "@/types/ros";
import type { ROS2ConnectionStatus } from "@/hooks/useROS2";

type ROS2PanelProps = {
  show?: boolean;
  onHide: () => void;
  status: ROS2ConnectionStatus;
  error: string | null;
  jointState: RosJointState | null;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  rosControlEnabled?: boolean;
  onRosControlToggle?: () => void;
  rosLeaderBroadcastEnabled?: boolean;
  onLeaderBroadcastToggle?: () => void;
  defaultUrl?: string;
};

const DEFAULT_URL = "ws://localhost:9090";

export function ROS2Panel({
  show = true,
  onHide,
  status,
  error,
  jointState,
  onConnect,
  onDisconnect,
  rosControlEnabled = false,
  onRosControlToggle,
  rosLeaderBroadcastEnabled = false,
  onLeaderBroadcastToggle,
  defaultUrl = DEFAULT_URL,
}: ROS2PanelProps) {
  const [ref, bounds] = useMeasure();
  const [url, setUrl] = useState(defaultUrl);
  const [position, setPosition] = useState({ x: 0, y: 70 });

  useEffect(() => {
    if (bounds.height > 0) {
      setPosition({ x: 20, y: 20 });
    }
  }, [bounds.height]);

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "text-green-400";
      case "connecting":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      default:
        return "text-zinc-400";
    }
  };

  const getStatusBgColor = () => {
    switch (status) {
      case "connected":
        return "bg-green-400";
      case "connecting":
        return "bg-yellow-400 animate-pulse";
      case "error":
        return "bg-red-400";
      default:
        return "bg-zinc-500";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "error":
        return "Connection Failed";
      default:
        return "Disconnected";
    }
  };

  const handleConnect = () => {
    if (url.trim()) {
      onConnect(url.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && status !== "connected" && status !== "connecting") {
      handleConnect();
    }
  };

  const formatTimestamp = (sec: number, nanosec: number) => {
    const date = new Date(sec * 1000 + nanosec / 1_000_000);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
    >
      <div ref={ref} className={`p-3 w-80 z-50 ${panelStyle}`}>
        <div className="mb-3 flex justify-between items-center shrink-0">
          <h4 className="font-bold text-lg">ROS 2 Bridge</h4>
          <button
            onClick={onHide}
            className="text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
          >
            ×
          </button>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <div className={`w-3 h-3 rounded-full ${getStatusBgColor()}`} />
          <span className={`text-sm font-medium ${getStatusColor()}`}>{getStatusText()}</span>
          
          {status === "connected" ? (
            <button
              onClick={onDisconnect}
              className="ml-auto text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-3 py-1 rounded"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={status === "connecting" || !url.trim()}
              className="ml-auto text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-300 px-3 py-1 rounded"
            >
              Connect
            </button>
          )}
        </div>

        <div className="mb-3">
          <label className="block text-xs text-zinc-400 mb-1">WebSocket URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={status === "connected" || status === "connecting"}
            placeholder="ws://localhost:9090"
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {status === "error" && error && (
          <div className="mb-3 p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        {status === "disconnected" && (
          <div className="mb-3 text-xs text-zinc-500">
            Start rosbridge server:
            <code className="block bg-zinc-800 p-2 rounded mt-1 text-zinc-400">
              ros2 launch rosbridge_server rosbridge_websocket_launch.xml
            </code>
          </div>
        )}

        {status === "connected" && (
          <div className="mb-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">Control robot:</label>
              <button
                onClick={onRosControlToggle}
                className={`text-xs px-2 py-1 rounded ${
                  rosControlEnabled
                    ? "bg-green-700 text-green-200"
                    : "bg-zinc-700 text-zinc-400"
                }`}
              >
                {rosControlEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">Broadcast leader:</label>
              <button
                onClick={onLeaderBroadcastToggle}
                className={`text-xs px-2 py-1 rounded ${
                  rosLeaderBroadcastEnabled
                    ? "bg-green-700 text-green-200"
                    : "bg-zinc-700 text-zinc-400"
                }`}
              >
                {rosLeaderBroadcastEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
        )}

        {jointState && (
          <div className="max-h-[40vh] overflow-y-auto">
            <h5 className="text-sm font-semibold mb-2 text-zinc-300">Joint States</h5>
            <div className="space-y-1">
              {jointState.name.map((name, i) => (
                <div key={name} className="flex justify-between text-xs">
                  <span className="text-zinc-400">{name}</span>
                  <span className="text-zinc-200 font-mono">
                    {jointState.position[i]?.toFixed(4) ?? "N/A"}
                  </span>
                </div>
              ))}
            </div>
            {jointState.header && (
              <div className="mt-3 pt-2 border-t border-zinc-700">
                <p className="text-xs text-zinc-500">
                  Time: {formatTimestamp(jointState.header.stamp.sec, jointState.header.stamp.nanosec)}
                </p>
              </div>
            )}
          </div>
        )}

        {status === "connected" && !jointState && (
          <p className="text-sm text-zinc-400">Waiting for joint state data...</p>
        )}
      </div>
    </Rnd>
  );
}
