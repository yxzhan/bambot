"use client";

import React, { useState } from "react";
import { Rnd } from "react-rnd";
import { panelStyle } from "@/components/playground/panelStyle";
import { HandControlSettings } from "@/config/handControlConfig";
import { UseHandLandmarkerResult } from "@/hooks/useHandLandmarker";
import { MarkerPhase, UseHandTeleopResult } from "@/hooks/useHandTeleop";
import { HandGuideOverlay } from "./HandGuideOverlay";
import { CalibrationOverlay } from "./CalibrationOverlay";
import type { UseHandCalibrationResult } from "@/hooks/useHandCalibration";

type HandControlProps = {
  show?: boolean;
  onHide: () => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  landmarker: UseHandLandmarkerResult;
  teleop: UseHandTeleopResult;
  calibration: UseHandCalibrationResult;
  settings: HandControlSettings;
  onSettingsChange: (settings: HandControlSettings) => void;
  onResetSettings: () => void;
};

const PHASE_TEXT: Record<MarkerPhase, string> = {
  hidden: "No hand detected",
  free: "Tracking — move the marker onto the gripper",
  near: "Aligning",
  attached: "Attached — following your hand",
  unreachable: "Out of reach",
};

const PHASE_COLOR: Record<MarkerPhase, string> = {
  hidden: "text-zinc-400",
  free: "text-sky-400",
  near: "text-yellow-400",
  attached: "text-green-400",
  unreachable: "text-red-400",
};

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-zinc-300">{label}</span>
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
        {value.toFixed(2)}
      </span>
    </label>
  );
}

export function HandControl({
  show = true,
  onHide,
  enabled,
  onEnabledChange,
  landmarker,
  teleop,
  calibration,
  settings,
  onSettingsChange,
  onResetSettings,
}: HandControlProps) {
  const [position, setPosition] = useState({ x: 20, y: 70 });
  const [size, setSize] = useState({ width: 380, height: 540 });
  const [showTuning, setShowTuning] = useState(false);

  const { status } = teleop;

  const update = <K extends keyof HandControlSettings>(
    key: K,
    value: HandControlSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const updateTriple = (
    key: "workspaceCenter" | "workspaceSize",
    index: number,
    value: number
  ) => {
    const next = [...settings[key]] as [number, number, number];
    next[index] = value;
    update(key, next);
  };

  const toggleInvert = (index: number) => {
    const next = [...settings.invert] as [boolean, boolean, boolean];
    next[index] = !next[index];
    update("invert", next);
  };

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      size={size}
      onResizeStop={(_event, _direction, ref) =>
        setSize({ width: ref.offsetWidth, height: ref.offsetHeight })
      }
      minWidth={320}
      minHeight={300}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
      cancel="input, select, button"
    >
      <div className={`flex h-full flex-col overflow-hidden ${panelStyle} p-3`}>
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h4 className="text-lg font-bold">Hand Control</h4>
          <button
            onClick={onHide}
            className="rounded-full px-2 text-xl hover:bg-zinc-800"
            title="Collapse"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => onEnabledChange(event.target.checked)}
                className="accent-sky-400"
              />
              Enable camera
            </label>
            {landmarker.status === "loading" && (
              <span className="text-xs text-zinc-400">loading model…</span>
            )}
            {landmarker.status === "running" && (
              <span className="text-xs text-zinc-400">{landmarker.fps} fps</span>
            )}
          </div>

          {landmarker.devices.length > 1 && (
            <select
              value={landmarker.deviceId}
              onChange={(event) => landmarker.setDeviceId(event.target.value)}
              className="w-full rounded bg-zinc-800/80 px-2 py-1 text-xs text-white"
            >
              <option value="">Default camera</option>
              {landmarker.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          )}

          {landmarker.error && (
            <div className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
              {landmarker.error}
            </div>
          )}

          <div className="relative w-full overflow-hidden rounded-lg bg-black">
            <video
              ref={landmarker.videoRef}
              autoPlay
              playsInline
              muted
              className="w-full"
              style={{ transform: "scaleX(-1)", aspectRatio: "4/3" }}
            />
            <HandGuideOverlay
              guideRef={teleop.guideRef}
              videoRef={landmarker.videoRef}
              phase={status.phase}
              active={
                enabled && landmarker.status === "running" && !calibration.active
              }
            />
            <CalibrationOverlay
              state={calibration.state}
              videoRef={landmarker.videoRef}
              active={calibration.active}
            />
            <canvas
              ref={landmarker.overlayRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          </div>
          {calibration.active ? (
            <div className="space-y-2 rounded border border-sky-400/40 bg-sky-400/10 p-2">
              <div className="text-xs font-semibold text-sky-300">
                Step {calibration.state.index} of {calibration.state.total} —{" "}
                {calibration.state.title}
              </div>
              <p className="text-xs text-zinc-300">{calibration.state.detail}</p>
              <div className="flex gap-2">
                <button
                  onClick={calibration.captureNow}
                  className="rounded bg-sky-500/70 px-2 py-1 text-xs hover:bg-sky-500"
                >
                  Capture now
                </button>
                <button
                  onClick={calibration.cancel}
                  className="rounded bg-zinc-700/70 px-2 py-1 text-xs hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : calibration.state.step === "done" ? (
            <p className="rounded border border-green-400/40 bg-green-400/10 p-2 text-xs text-green-300">
              Calibrated. Your held pose is now the gripper pose, so the marker
              should latch on straight away.
            </p>
          ) : (
            <p className="text-xs text-zinc-400">
              Match the dashed hand to latch onto the gripper — its position,
              size and tilt all have to line up. Run the calibration first so
              your natural range of movement covers the whole workspace.
            </p>
          )}

          <div className="space-y-1 text-xs">
            <div className={PHASE_COLOR[status.phase]}>
              {PHASE_TEXT[status.phase]}
              {status.phase === "near" &&
                ` ${Math.round(status.attachProgress * 100)}%`}
            </div>
            <div className="flex gap-3 text-zinc-400">
              <span>
                {status.phase === "attached" || status.phase === "unreachable"
                  ? "IK residual"
                  : "distance"}
                : {status.posError.toFixed(2)}
              </span>
              <span>angle: {status.angError.toFixed(0)}°</span>
              <span>grip: {Math.round(status.openness * 100)}%</span>
            </div>
            {status.detachReason && status.phase !== "attached" && (
              <div className="text-zinc-500">Last detach: {status.detachReason}</div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => teleop.detach()}
              className="rounded bg-zinc-700/70 px-2 py-1 text-xs hover:bg-zinc-600"
            >
              Detach (Esc)
            </button>
            <button
              onClick={calibration.start}
              disabled={!enabled || calibration.active}
              className="rounded bg-sky-600/80 px-2 py-1 text-xs hover:bg-sky-600 disabled:opacity-40"
            >
              Calibrate
            </button>
            <button
              onClick={() => teleop.calibrateOrientation()}
              title="Hold your hand the way it should line up with the gripper, then press this"
              className="rounded bg-zinc-700/70 px-2 py-1 text-xs hover:bg-zinc-600"
            >
              Pose only
            </button>
            <button
              onClick={() => setShowTuning((prev) => !prev)}
              className="rounded bg-zinc-700/70 px-2 py-1 text-xs hover:bg-zinc-600"
            >
              {showTuning ? "Hide tuning" : "Tuning"}
            </button>
          </div>

          {showTuning && (
            <div className="space-y-2 border-t border-white/20 pt-2">
              <div className="text-xs font-semibold text-zinc-300">
                Workspace centre (scene units)
              </div>
              <Slider
                label="forward X"
                min={-6}
                max={8}
                step={0.1}
                value={settings.workspaceCenter[0]}
                onChange={(v) => updateTriple("workspaceCenter", 0, v)}
              />
              <Slider
                label="up Y"
                min={0}
                max={8}
                step={0.1}
                value={settings.workspaceCenter[1]}
                onChange={(v) => updateTriple("workspaceCenter", 1, v)}
              />
              <Slider
                label="lateral Z"
                min={-6}
                max={6}
                step={0.1}
                value={settings.workspaceCenter[2]}
                onChange={(v) => updateTriple("workspaceCenter", 2, v)}
              />

              <div className="text-xs font-semibold text-zinc-300">
                Workspace size
              </div>
              <Slider
                label="depth"
                min={1}
                max={14}
                step={0.1}
                value={settings.workspaceSize[0]}
                onChange={(v) => updateTriple("workspaceSize", 0, v)}
              />
              <Slider
                label="height"
                min={1}
                max={12}
                step={0.1}
                value={settings.workspaceSize[1]}
                onChange={(v) => updateTriple("workspaceSize", 1, v)}
              />
              <Slider
                label="width"
                min={1}
                max={14}
                step={0.1}
                value={settings.workspaceSize[2]}
                onChange={(v) => updateTriple("workspaceSize", 2, v)}
              />

              <div className="flex gap-3 text-xs text-zinc-300">
                {["lateral", "vertical", "depth"].map((name, index) => (
                  <label key={name} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={settings.invert[index]}
                      onChange={() => toggleInvert(index)}
                      className="accent-sky-400"
                    />
                    flip {name}
                  </label>
                ))}
              </div>

              <div className="text-xs font-semibold text-zinc-300">
                Depth calibration (hand size in frame)
              </div>
              <Slider
                label="far"
                min={0.02}
                max={0.3}
                step={0.005}
                value={settings.depthFar}
                onChange={(v) => update("depthFar", v)}
              />
              <Slider
                label="near"
                min={0.1}
                max={0.8}
                step={0.005}
                value={settings.depthNear}
                onChange={(v) => update("depthNear", v)}
              />

              <div className="text-xs font-semibold text-zinc-300">Response</div>
              <Slider
                label="pos smooth"
                min={0.05}
                max={1}
                step={0.05}
                value={settings.posSmoothing}
                onChange={(v) => update("posSmoothing", v)}
              />
              <Slider
                label="rot smooth"
                min={0.05}
                max={1}
                step={0.05}
                value={settings.rotSmoothing}
                onChange={(v) => update("rotSmoothing", v)}
              />

              <div className="text-xs font-semibold text-zinc-300">
                Attach / detach
              </div>
              <Slider
                label="pos tol"
                min={0.2}
                max={3}
                step={0.05}
                value={settings.attachPosTol}
                onChange={(v) => update("attachPosTol", v)}
              />
              <Slider
                label="angle tol°"
                min={10}
                max={180}
                step={5}
                value={settings.attachAngTol}
                onChange={(v) => update("attachAngTol", v)}
              />
              <Slider
                label="reach tol"
                min={0.3}
                max={4}
                step={0.05}
                value={settings.detachPosTol}
                onChange={(v) => update("detachPosTol", v)}
              />

              <div className="text-xs font-semibold text-zinc-300">
                Gripper open/close
              </div>
              <Slider
                label="closed at"
                min={0.05}
                max={1}
                step={0.05}
                value={settings.opennessMin}
                onChange={(v) => update("opennessMin", v)}
              />
              <Slider
                label="open at"
                min={0.5}
                max={3}
                step={0.05}
                value={settings.opennessMax}
                onChange={(v) => update("opennessMax", v)}
              />

              <button
                onClick={onResetSettings}
                className="rounded bg-zinc-700/70 px-2 py-1 text-xs hover:bg-zinc-600"
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
