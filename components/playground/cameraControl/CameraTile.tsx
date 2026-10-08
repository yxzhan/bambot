"use client";

import React, { useEffect, useRef, useState } from "react";
import type { CameraConfig } from "@/lib/cameraSettings";

type CameraTileProps = {
  camera: CameraConfig;
  /** Whether the camera should be streaming at all. */
  active: boolean;
  /** Preview size as a fraction of the output size. */
  scale: number;
  /** Hands the output canvas to the panel, which publishes from it. */
  registerCanvas: (id: string, canvas: HTMLCanvasElement | null) => void;
  onRemove: (id: string) => void;
  /** Shown under the preview, e.g. a name clash with another device. */
  warning?: string | null;
};

/**
 * One camera: its stream is centre-cropped to the configured aspect and drawn
 * at exactly width x height onto a canvas. That canvas is both the preview
 * (shown at a fixed scale) and what gets published, so what you see is what
 * ROS receives.
 */
export function CameraTile({
  camera,
  active,
  scale,
  registerCanvas,
  onRemove,
  warning,
}: CameraTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { id, deviceId, width, height } = camera;

  useEffect(() => {
    registerCanvas(id, canvasRef.current);
    return () => registerCanvas(id, null);
  }, [id, registerCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;

    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    // Kept in CPU memory: frames are read back for JPEG encoding, which would
    // otherwise force a GPU readback on every publish.
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const draw = () => {
      if (stopped) return;
      if (context && video.readyState >= 2 && video.videoWidth > 0) {
        // Centre-crop the source to the output aspect, then scale to fit.
        const sourceAspect = video.videoWidth / video.videoHeight;
        const targetAspect = width / height;
        let sw = video.videoWidth;
        let sh = video.videoHeight;
        if (sourceAspect > targetAspect) sw = sh * targetAspect;
        else sh = sw / targetAspect;
        const sx = (video.videoWidth - sw) / 2;
        const sy = (video.videoHeight - sh) / 2;
        context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        canvas.dataset.ready = "1";
      }
      frame = requestAnimationFrame(draw);
    };

    (async () => {
      try {
        setError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          // Ask for roughly the output size, so the camera does not deliver
          // far more pixels than end up being used.
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: width },
            height: { ideal: height },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(draw);
      } catch (err) {
        if (stopped) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "OverconstrainedError" || name === "NotFoundError"
            ? "Camera not found"
            : err instanceof Error
              ? err.message
              : "Failed to open camera"
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      delete canvas.dataset.ready;
    };
  }, [active, deviceId, width, height]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono text-zinc-200" title={camera.label}>
          {camera.name}
        </span>
        <span className="flex items-center gap-1 text-zinc-500">
          {width}×{height}
          <button
            onClick={() => onRemove(id)}
            className="rounded-full px-1 text-sm text-zinc-300 hover:bg-zinc-800"
            title="Remove camera"
          >
            ×
          </button>
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded bg-black"
        style={{ width: width * scale, height: height * scale }}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: width * scale, height: height * scale }}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-red-400">
            {error}
          </div>
        )}
        {!active && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
            paused
          </div>
        )}
      </div>
      {warning && (
        <div className="text-xs text-yellow-300" style={{ maxWidth: width * scale }}>
          {warning}
        </div>
      )}
    </div>
  );
}
