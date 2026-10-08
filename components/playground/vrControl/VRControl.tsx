"use client";

import React, { useState } from "react";
import { Rnd } from "react-rnd";
import { panelStyle } from "@/components/playground/panelStyle";
import { VRControlSettings } from "@/config/vrControlConfig";
import type { UseVRSessionResult, VRMode } from "@/hooks/useVRSession";
import type { VRTeleopPhase, VRTeleopStatus } from "@/hooks/useVRTeleop";
import { HeadsetShare } from "./HeadsetShare";
import { ControlBadge } from "../ControlBadge";
import type { ControlAuthority } from "@/hooks/useControlAuthority";

type VRControlProps = {
  show?: boolean;
  onHide: () => void;
  session: UseVRSessionResult;
  status: VRTeleopStatus;
  settings: VRControlSettings;
  onSettingsChange: (settings: VRControlSettings) => void;
  onResetSettings: () => void;
  control?: ControlAuthority;
};

const PHASE_TEXT: Record<VRTeleopPhase, string> = {
  off: "Not in VR",
  idle: "Ready — hold grip to move the arm",
  engaged: "Engaged — arm follows the controller",
  unreachable: "Out of reach — arm holds, bring your hand back",
};

const PHASE_COLOR: Record<VRTeleopPhase, string> = {
  off: "text-zinc-400",
  idle: "text-sky-400",
  engaged: "text-green-400",
  unreachable: "text-red-400",
};

const MODE_LABEL: Record<VRMode, string> = {
  "immersive-vr": "Enter VR",
  "immersive-ar": "Enter AR (passthrough)",
};

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  onChange: (value: number) => void;
};

function Slider({ label, value, min, max, step, digits = 2, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-zinc-300">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="flex-1 accent-sky-400"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-zinc-400">
        {value.toFixed(digits)}
      </span>
    </label>
  );
}

function SupportNotice({ session }: { session: UseVRSessionResult }) {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return (
      <div className="rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
        WebXR only works over HTTPS (or on localhost). Serve the app with{" "}
        <code>pnpm dev --experimental-https</code> or use the deployed site.
      </div>
    );
  }
  if (!session.checked) {
    return <div className="text-xs text-zinc-400">Checking for a headset…</div>;
  }
  if (session.supported.length === 0) {
    return (
      <div className="rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
        No WebXR headset found. Open this page in the Meta Quest Browser, or in
        desktop Chrome with a PC VR runtime running (Quest Link / Air Link /
        SteamVR).
      </div>
    );
  }
  return null;
}

export function VRControl({
  show = true,
  onHide,
  session,
  status,
  settings,
  onSettingsChange,
  onResetSettings,
  control,
}: VRControlProps) {
  const [position, setPosition] = useState({ x: 20, y: 70 });
  const [size, setSize] = useState({ width: 360, height: 520 });
  const [showTuning, setShowTuning] = useState(false);

  const update = <K extends keyof VRControlSettings>(
    key: K,
    value: VRControlSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      size={size}
      onResizeStop={(_event, _direction, ref) =>
        setSize({ width: ref.offsetWidth, height: ref.offsetHeight })
      }
      minWidth={300}
      minHeight={260}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
      cancel="input, select, button"
    >
      <div className={`flex h-full flex-col overflow-hidden ${panelStyle} p-3`}>
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h4 className="text-lg font-bold">VR Control</h4>
          <button
            onClick={onHide}
            className="rounded-full px-2 text-xl hover:bg-zinc-800"
            title="Collapse"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <SupportNotice session={session} />

          {/* Pairing is for getting this page onto a headset, so it only shows
              where WebXR is missing - never on the headset itself. */}
          {session.checked && session.supported.length === 0 && <HeadsetShare />}

          <div className="flex flex-wrap gap-2">
            {session.activeMode ? (
              <button
                onClick={session.exit}
                className="rounded bg-red-500/80 px-3 py-1 text-sm hover:bg-red-500"
              >
                Exit {session.activeMode === "immersive-ar" ? "AR" : "VR"}
              </button>
            ) : (
              session.supported.map((mode) => (
                <button
                  key={mode}
                  onClick={() => session.enter(mode)}
                  className="rounded bg-sky-500/80 px-3 py-1 text-sm hover:bg-sky-500"
                >
                  {MODE_LABEL[mode]}
                </button>
              ))
            )}
          </div>

          {control && session.activeMode && <ControlBadge source="vr" control={control} />}

          {session.error && (
            <div className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
              {session.error}
            </div>
          )}

          <div className="space-y-1 text-sm">
            <div className={PHASE_COLOR[status.phase]}>
              {PHASE_TEXT[status.phase]}
              {status.activeHand && ` (${status.activeHand} hand)`}
            </div>
            {status.phase !== "off" && (
              <div className="text-xs text-zinc-400">
                Controllers: {status.controllers.join(", ") || "none"} · gripper{" "}
                {Math.round(status.gripperOpenness * 100)}% open
                {status.phase !== "idle" &&
                  ` · residual ${status.posError.toFixed(2)}`}
              </div>
            )}
            {status.activeHand && !status.gripperFollowing && (
              <div className="text-xs text-yellow-300">
                Gripper held — move the trigger to match it to take over.
              </div>
            )}
          </div>

          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-300">
            <li>
              <b>Grip</b> (hold): the gripper follows your hand. Release to
              reposition your hand without moving the arm.
            </li>
            <li>
              <b>Trigger</b>: closes the gripper while gripping. After you
              engage, it takes over once it matches the gripper's current
              opening, so re-gripping never drops what is held.
            </li>
            <li>
              <b>A / X</b>: put the robot back in front of you, facing where you
              look.
            </li>
            <li>
              <b>Thumbstick</b> up / down: raise or lower the robot.
            </li>
          </ul>

          <div className="rounded bg-white/5 px-2 py-1 text-xs text-zinc-400">
            Servos are driven from the browser running the session over Web
            Serial. The Quest Browser has no Web Serial, so to move the real arm
            use desktop Chrome with Quest Link / Air Link, or relay the joint
            states through ROS 2.
          </div>

          <button
            onClick={() => setShowTuning((v) => !v)}
            className="text-xs text-sky-400 hover:underline"
          >
            {showTuning ? "Hide tuning" : "Tuning"}
          </button>

          {showTuning && (
            <div className="space-y-2">
              <Slider
                label="Motion scale"
                value={settings.motionScale}
                min={0.25}
                max={3}
                step={0.05}
                onChange={(v) => update("motionScale", v)}
              />
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={settings.followRotation}
                  onChange={(event) =>
                    update("followRotation", event.target.checked)
                  }
                  className="accent-sky-400"
                />
                Follow controller rotation
              </label>
              <Slider
                label="Base below eyes (m)"
                value={settings.baseBelowEyes}
                min={0}
                max={1.2}
                step={0.01}
                onChange={(v) => update("baseBelowEyes", v)}
              />
              <Slider
                label="Base distance (m)"
                value={settings.baseDistance}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => update("baseDistance", v)}
              />
              <Slider
                label="Reach tolerance"
                value={settings.reachTolerance}
                min={0.05}
                max={1.5}
                step={0.05}
                onChange={(v) => update("reachTolerance", v)}
              />
              <Slider
                label="Max joint speed (°/s)"
                value={settings.maxJointSpeed}
                min={30}
                max={720}
                step={10}
                digits={0}
                onChange={(v) => update("maxJointSpeed", v)}
              />
              <button
                onClick={onResetSettings}
                className="rounded bg-zinc-700/80 px-2 py-1 text-xs hover:bg-zinc-600"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>
      </div>
    </Rnd>
  );
}
