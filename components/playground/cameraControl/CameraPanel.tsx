"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { usePanelZ } from "../panelStack";
import { usePanelPosition } from "../usePanelPosition";
import { panelStyle } from "@/components/playground/panelStyle";
import {
  CameraConfig,
  cameraNameError,
  cameraSizeError,
  cameraTopic,
  DEFAULT_CAMERA_SIZE,
  DEFAULT_PREVIEW_SCALE,
  defaultCameraName,
  getCameraPublishHzFromLocalStorage,
  getCamerasFromLocalStorage,
  MAX_CAMERA_PUBLISH_HZ,
  MIN_CAMERA_PUBLISH_HZ,
  setCameraPublishHzToLocalStorage,
  PREVIEW_SCALES,
  setCamerasToLocalStorage,
} from "@/lib/cameraSettings";
import { CameraTile } from "./CameraTile";
import { remoteCameraName, RemoteCameraTile } from "./RemoteCameraTile";

const JPEG_QUALITY = 0.8;
/** How often the ROS graph is asked for other devices' camera topics, ms. */
const DISCOVERY_INTERVAL_MS = 3000;
const IMAGE_TYPE = "sensor_msgs/msg/CompressedImage";
const CAMERA_TOPIC_PATTERN = /^\/.+\/image_raw\/compressed$/;

type VideoDevice = { deviceId: string; label: string };

type AddForm = {
  devices: VideoDevice[] | null;
  deviceId: string;
  name: string;
  width: string;
  height: string;
  error: string | null;
};

type CameraPanelProps = {
  show?: boolean;
  onHide: () => void;
  /** Whether the ROS 2 bridge is connected; publishing waits for it. */
  rosConnected: boolean;
  publishCompressedImage: (
    topicName: string,
    frameId: string,
    format: string,
    base64Data: string
  ) => void;
  subscribeCompressedImage: (
    topicName: string,
    callback: (base64Data: string, format: string) => void,
    throttleMs?: number
  ) => (() => void) | null;
  listTopicsForType: (messageType: string) => Promise<string[]>;
};

/** Lists the video inputs, asking for camera permission first so they have labels. */
async function listVideoDevices(): Promise<VideoDevice[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  probe.getTracks().forEach((track) => track.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function CameraPanel({
  show = true,
  onHide,
  rosConnected,
  publishCompressedImage,
  subscribeCompressedImage,
  listTopicsForType,
}: CameraPanelProps) {
  const { zIndex, bringToFront } = usePanelZ("webcam");
  const [position, setPosition] = usePanelPosition(show, { x: 20, y: 70 });
  const [cameras, setCameras] = useState<CameraConfig[]>(() => getCamerasFromLocalStorage());
  const [form, setForm] = useState<AddForm | null>(null);
  const [scale, setScale] = useState(DEFAULT_PREVIEW_SCALE);
  const [publishing, setPublishing] = useState(false);
  const [publishHz, setPublishHz] = useState(() => getCameraPublishHzFromLocalStorage());
  const canvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  /** Camera image topics on the ROS graph that this page is not publishing. */
  const [remoteTopics, setRemoteTopics] = useState<string[]>([]);

  const updateCameras = (next: CameraConfig[]) => {
    setCameras(next);
    setCamerasToLocalStorage(next);
  };

  const registerCanvas = useCallback((id: string, canvas: HTMLCanvasElement | null) => {
    if (canvas) canvasesRef.current.set(id, canvas);
    else canvasesRef.current.delete(id);
  }, []);

  const removeCamera = useCallback((id: string) => {
    setCameras((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setCamerasToLocalStorage(next);
      return next;
    });
  }, []);

  // --- adding a camera ------------------------------------------------------
  const openForm = async () => {
    const taken = [...cameras.map((c) => c.name), ...remoteNames];
    setForm({
      devices: null,
      deviceId: "",
      name: defaultCameraName(taken),
      width: String(DEFAULT_CAMERA_SIZE.width),
      height: String(DEFAULT_CAMERA_SIZE.height),
      error: null,
    });
    try {
      const devices = await listVideoDevices();
      const used = new Set(cameras.map((c) => c.deviceId));
      const preferred = devices.find((d) => !used.has(d.deviceId)) ?? devices[0];
      setForm((prev) =>
        prev && {
          ...prev,
          devices,
          deviceId: preferred?.deviceId ?? "",
          error: devices.length === 0 ? "No cameras found" : null,
        }
      );
    } catch (err) {
      setForm((prev) =>
        prev && {
          ...prev,
          devices: [],
          error: err instanceof Error ? err.message : "Failed to access cameras",
        }
      );
    }
  };

  const submitForm = () => {
    if (!form) return;
    const name = form.name.trim();
    const width = Number(form.width);
    const height = Number(form.height);
    const device = form.devices?.find((d) => d.deviceId === form.deviceId);
    const error =
      (!device ? "Choose a camera" : null) ??
      cameraNameError(name, [...cameras.map((c) => c.name), ...remoteNames]) ??
      cameraSizeError(width) ??
      cameraSizeError(height);
    if (error || !device) {
      setForm({ ...form, error });
      return;
    }
    updateCameras([
      ...cameras,
      {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        deviceId: device.deviceId,
        label: device.label,
        width,
        height,
      },
    ]);
    setForm(null);
  };

  // --- publishing -------------------------------------------------------------
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;
  const publishRef = useRef(publishCompressedImage);
  publishRef.current = publishCompressedImage;

  useEffect(() => {
    if (!publishing || !rosConnected) return;
    const timer = setInterval(() => {
      for (const camera of camerasRef.current) {
        const canvas = canvasesRef.current.get(camera.id);
        if (!canvas || canvas.dataset.ready !== "1") continue;
        // Synchronous, but cheap: the canvas lives in CPU memory (see
        // CameraTile), so there is no GPU readback. toBlob was tried and
        // rejected - Chrome encodes it in idle time, which a busy page (a VR
        // session, say) barely has, and frames then trickle out.
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        publishRef.current(cameraTopic(camera.name), camera.name, "jpeg", base64);
      }
    }, 1000 / publishHz);
    return () => clearInterval(timer);
  }, [publishing, rosConnected, publishHz]);

  // Cameras run while they are on screen or being published, and are
  // released otherwise.
  const active = show || publishing;

  // --- other devices' cameras -------------------------------------------------
  // A camera only exists on the device it is plugged into, so other devices'
  // cameras are found through what they publish. Topics this page publishes
  // itself are left out.
  const publishingRef = useRef(publishing);
  publishingRef.current = publishing;
  const listTopicsRef = useRef(listTopicsForType);
  listTopicsRef.current = listTopicsForType;

  useEffect(() => {
    if (!show || !rosConnected) {
      setRemoteTopics([]);
      return;
    }
    let cancelled = false;
    const discover = async () => {
      try {
        const topics = await listTopicsRef.current(IMAGE_TYPE);
        if (cancelled) return;
        const own = publishingRef.current
          ? new Set(camerasRef.current.map((c) => cameraTopic(c.name)))
          : new Set<string>();
        const next = topics.filter((t) => CAMERA_TOPIC_PATTERN.test(t) && !own.has(t)).sort();
        setRemoteTopics((prev) => (prev.join() === next.join() ? prev : next));
      } catch {
        // rosapi missing or busy: keep the last list.
      }
    };
    discover();
    const timer = setInterval(discover, DISCOVERY_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [show, rosConnected, publishing]);

  const remoteNames = remoteTopics.map(remoteCameraName);

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none", zIndex }}
      cancel="input, select, button"
      enableResizing={false}
    >
      <div onPointerDownCapture={bringToFront}
        className={`flex max-h-[85vh] min-w-72 max-w-[90vw] flex-col ${panelStyle} p-3`}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h4 className="text-lg font-bold">Webcam ({cameras.length})</h4>
          <button
            onClick={onHide}
            className="rounded-full px-2 text-xl hover:bg-zinc-800"
            title="Collapse"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              onClick={openForm}
              disabled={form !== null}
              className="rounded bg-sky-500/80 px-3 py-1 hover:bg-sky-500 disabled:opacity-50"
            >
              + Add camera
            </button>
            <span className="ml-auto text-zinc-400">Preview</span>
            <div className="flex rounded bg-zinc-800 p-0.5">
              {PREVIEW_SCALES.map((s) => (
                <button
                  key={s}
                  onClick={() => setScale(s)}
                  className={`rounded px-2 py-0.5 ${
                    scale === s ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {Math.round(s * 100)}%
                </button>
              ))}
            </div>
          </div>

          {form && (
            <div className="space-y-2 rounded bg-white/5 p-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-zinc-400">Device</span>
                <select
                  value={form.deviceId}
                  onChange={(e) => setForm({ ...form, deviceId: e.target.value, error: null })}
                  disabled={!form.devices || form.devices.length === 0}
                  className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-white"
                >
                  {!form.devices && <option>Looking for cameras…</option>}
                  {form.devices?.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-zinc-400">Name</span>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value.toLowerCase(), error: null })
                  }
                  onKeyDown={(e) => e.key === "Enter" && submitForm()}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 font-mono text-white"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-zinc-400">Size</span>
                <input
                  type="number"
                  value={form.width}
                  onChange={(e) => setForm({ ...form, width: e.target.value, error: null })}
                  className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-white"
                />
                <span className="text-zinc-500">×</span>
                <input
                  type="number"
                  value={form.height}
                  onChange={(e) => setForm({ ...form, height: e.target.value, error: null })}
                  className="w-20 rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-white"
                />
              </label>
              <div className="font-mono text-zinc-500">{cameraTopic(form.name || "…")}</div>
              {form.error && <div className="text-red-400">{form.error}</div>}
              <div className="flex gap-2">
                <button
                  onClick={submitForm}
                  disabled={!form.devices || form.devices.length === 0}
                  className="rounded bg-sky-500/80 px-3 py-1 hover:bg-sky-500 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => setForm(null)}
                  className="rounded bg-zinc-700/80 px-3 py-1 hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={publishing}
                onChange={(e) => setPublishing(e.target.checked)}
                disabled={cameras.length === 0}
                className="accent-sky-400"
              />
              <span className="text-zinc-300">Publish to ROS 2 (JPEG)</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-zinc-400">Rate</span>
              <input
                type="range"
                min={MIN_CAMERA_PUBLISH_HZ}
                max={MAX_CAMERA_PUBLISH_HZ}
                step={1}
                value={publishHz}
                onChange={(e) => {
                  const hz = parseInt(e.target.value, 10);
                  setPublishHz(hz);
                  setCameraPublishHzToLocalStorage(hz);
                }}
                className="flex-1 accent-sky-400"
              />
              <span className="w-12 shrink-0 text-right tabular-nums text-zinc-300">
                {publishHz} Hz
              </span>
            </label>
            {publishing && !rosConnected && (
              <div className="text-yellow-300">
                Waiting for the ROS 2 bridge — connect it in the ROS 2 panel.
              </div>
            )}
            {publishing && rosConnected && (
              <div className="font-mono text-zinc-500">
                {cameras.map((c) => cameraTopic(c.name)).join("  ")}
              </div>
            )}
          </div>

          {cameras.length === 0 && !form && (
            <div className="text-xs text-zinc-400">No cameras yet — add one.</div>
          )}

          <div className="flex flex-wrap gap-3">
            {cameras.map((camera) => (
              <CameraTile
                key={camera.id}
                camera={camera}
                active={active}
                scale={scale}
                registerCanvas={registerCanvas}
                onRemove={removeCamera}
                warning={
                  !publishing && remoteNames.includes(camera.name)
                    ? "Another device already publishes this name - rename before publishing"
                    : null
                }
              />
            ))}
          </div>

          {rosConnected && (
            <div className="space-y-2 border-t border-zinc-700 pt-2">
              <div className="text-xs font-semibold text-zinc-300">
                Other devices ({remoteTopics.length})
              </div>
              {remoteTopics.length === 0 ? (
                <div className="text-xs text-zinc-500">
                  Cameras another device publishes to ROS show up here.
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {remoteTopics.map((topic) => (
                    <RemoteCameraTile
                      key={topic}
                      topic={topic}
                      scale={scale}
                      subscribe={subscribeCompressedImage}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Rnd>
  );
}
