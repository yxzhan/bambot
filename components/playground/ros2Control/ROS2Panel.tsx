"use client";

import React, { useEffect, useState } from "react";
import { Rnd } from "react-rnd";
import { panelStyle } from "@/components/playground/panelStyle";
import type { ROS2ConnectionStatus } from "@/hooks/useROS2";
import type { TopicFeed, UseROS2BridgeResult } from "@/hooks/useROS2Bridge";
import {
  MAX_PUBLISH_HZ,
  MIN_PUBLISH_HZ,
  ROS2_ROLES,
  ROS2Role,
  ROS2Settings,
} from "@/lib/ros2Settings";
import { radiansToDegrees } from "@/lib/utils";

type ROS2PanelProps = {
  show?: boolean;
  onHide: () => void;
  status: ROS2ConnectionStatus;
  error: string | null;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  defaultUrl?: string;
  settings: ROS2Settings;
  onSettingsChange: (settings: ROS2Settings) => void;
  bridge: UseROS2BridgeResult;
};

const DEFAULT_URL = "ws://localhost:9090";

/** A topic counts as live if a message arrived this recently, ms. */
const STALE_AFTER_MS = 1000;

const ROLE_LABEL: Record<ROS2Role, string> = {
  leader: "Leader",
  follower: "Follower",
  monitor: "Monitor",
};

const STATUS_STYLE: Record<ROS2ConnectionStatus, { dot: string; text: string; label: string }> = {
  connected: { dot: "bg-green-400", text: "text-green-400", label: "Connected" },
  connecting: { dot: "bg-yellow-400 animate-pulse", text: "text-yellow-400", label: "Connecting..." },
  error: { dot: "bg-red-400", text: "text-red-400", label: "Connection Failed" },
  disconnected: { dot: "bg-zinc-500", text: "text-zinc-400", label: "Disconnected" },
};

function roleDescription(role: ROS2Role, settings: ROS2Settings) {
  switch (role) {
    case "leader":
      return (
        <>
          Publishes this robot&apos;s joints (moved by leader arm, VR, keyboard…) to{" "}
          <code>{settings.commandTopic}</code> and shows the follower&apos;s{" "}
          <code>{settings.stateTopic}</code>.
        </>
      );
    case "follower":
      return (
        <>
          Drives this robot (and its servos, if connected) from{" "}
          <code>{settings.commandTopic}</code> and publishes its state to{" "}
          <code>{settings.stateTopic}</code>.
        </>
      );
    case "monitor":
      return <>Only listens to both topics.</>;
  }
}

function TopicBadge({ label, topic, feed, publishing }: {
  label: string;
  topic: string;
  feed: TopicFeed;
  publishing: boolean;
}) {
  const live = feed.receivedAt !== null && performance.now() - feed.receivedAt < STALE_AFTER_MS;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-zinc-400">
        {label} <code className="text-zinc-300">{topic}</code>
      </span>
      {publishing ? (
        <span className="text-sky-400">publishing</span>
      ) : (
        <span className={live ? "text-green-400" : "text-zinc-500"}>
          {live ? `${Math.round(feed.hz)} Hz` : "no messages"}
        </span>
      )}
    </div>
  );
}

function positionOf(feed: TopicFeed, name: string): number | null {
  const message = feed.message;
  if (!message) return null;
  const i = message.name.indexOf(name);
  const value = i >= 0 ? message.position[i] : undefined;
  return typeof value === "number" ? radiansToDegrees(value) : null;
}

export function ROS2Panel({
  show = true,
  onHide,
  status,
  error,
  onConnect,
  onDisconnect,
  defaultUrl = DEFAULT_URL,
  settings,
  onSettingsChange,
  bridge,
}: ROS2PanelProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [showTopics, setShowTopics] = useState(false);
  const [topicDraft, setTopicDraft] = useState({
    commandTopic: settings.commandTopic,
    stateTopic: settings.stateTopic,
  });

  useEffect(() => {
    setTopicDraft({ commandTopic: settings.commandTopic, stateTopic: settings.stateTopic });
  }, [settings.commandTopic, settings.stateTopic]);

  const statusStyle = STATUS_STYLE[status];
  const busy = status === "connected" || status === "connecting";
  const { role } = settings;

  const handleConnect = () => {
    if (url.trim()) onConnect(url.trim());
  };

  const commitTopics = () => {
    const commandTopic = topicDraft.commandTopic.trim();
    const stateTopic = topicDraft.stateTopic.trim();
    if (!commandTopic || !stateTopic || commandTopic === stateTopic) {
      setTopicDraft({ commandTopic: settings.commandTopic, stateTopic: settings.stateTopic });
      return;
    }
    onSettingsChange({ ...settings, commandTopic, stateTopic });
  };

  // Rows: union of joint names seen on either topic, in arrival order.
  const names: string[] = [];
  for (const message of [bridge.command.message, bridge.state.message]) {
    for (const name of message?.name ?? []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  const showCommand = role !== "leader";
  const showState = role !== "follower";

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
      cancel="input, select, button"
    >
      <div className={`p-3 w-80 z-50 ${panelStyle}`}>
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
          <div className={`w-3 h-3 rounded-full ${statusStyle.dot}`} />
          <span className={`text-sm font-medium ${statusStyle.text}`}>{statusStyle.label}</span>

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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) handleConnect();
            }}
            disabled={busy}
            placeholder={DEFAULT_URL}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {status === "error" && error && (
          <div className="mb-3 p-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mb-2">
          <label className="block text-xs text-zinc-400 mb-1">Role</label>
          <div className="flex rounded bg-zinc-800 p-0.5">
            {ROS2_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => onSettingsChange({ ...settings, role: r })}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  role === r ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-400">{roleDescription(role, settings)}</p>
        </div>

        {role !== "monitor" && (
          <label className="mb-2 flex items-center gap-2 text-xs">
            <span className="shrink-0 text-zinc-400">Publish rate</span>
            <input
              type="range"
              min={MIN_PUBLISH_HZ}
              max={MAX_PUBLISH_HZ}
              step={1}
              value={settings.publishHz}
              onChange={(e) =>
                onSettingsChange({ ...settings, publishHz: parseInt(e.target.value, 10) })
              }
              className="flex-1 accent-sky-400"
            />
            <span className="w-12 shrink-0 text-right tabular-nums text-zinc-300">
              {settings.publishHz} Hz
            </span>
          </label>
        )}

        <button
          onClick={() => setShowTopics((v) => !v)}
          className="mb-2 text-xs text-sky-400 hover:underline"
        >
          {showTopics ? "Hide topics" : "Topics"}
        </button>
        {showTopics && (
          <div className="mb-3 space-y-1">
            {(["commandTopic", "stateTopic"] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-zinc-400">
                  {key === "commandTopic" ? "Command" : "State"}
                </span>
                <input
                  type="text"
                  value={topicDraft[key]}
                  onChange={(e) => setTopicDraft({ ...topicDraft, [key]: e.target.value })}
                  onBlur={commitTopics}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTopics();
                  }}
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-400"
                />
              </label>
            ))}
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
          <div className="space-y-1 border-t border-zinc-700 pt-2">
            <TopicBadge
              label="Command"
              topic={settings.commandTopic}
              feed={bridge.command}
              publishing={role === "leader"}
            />
            <TopicBadge
              label="State"
              topic={settings.stateTopic}
              feed={bridge.state}
              publishing={role === "follower"}
            />

            {names.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="text-left font-normal">joint (deg)</th>
                    {showCommand && <th className="text-right font-normal">command</th>}
                    {showState && <th className="text-right font-normal">state</th>}
                  </tr>
                </thead>
                <tbody>
                  {names.map((name) => {
                    const cmd = positionOf(bridge.command, name);
                    const st = positionOf(bridge.state, name);
                    return (
                      <tr key={name}>
                        <td className="text-zinc-400">{name}</td>
                        {showCommand && (
                          <td className="text-right font-mono text-zinc-200">
                            {cmd === null ? "—" : cmd.toFixed(1)}
                          </td>
                        )}
                        {showState && (
                          <td className="text-right font-mono text-zinc-200">
                            {st === null ? "—" : st.toFixed(1)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </Rnd>
  );
}
