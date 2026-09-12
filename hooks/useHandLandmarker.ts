/**
 * Runs the MediaPipe Hand Landmarker over a webcam stream.
 *
 * The detection result is written into a ref rather than React state: it
 * updates at camera frame rate and is consumed by `useHandTeleop` and by the
 * 3D marker, neither of which should trigger a re-render per frame.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DrawingUtils as DrawingUtilsType,
  HandLandmarker as HandLandmarkerType,
} from "@mediapipe/tasks-vision";
import {
  HAND_MODEL_CDN,
  HAND_MODEL_PATH,
  MEDIAPIPE_BUNDLE_CDN,
  MEDIAPIPE_BUNDLE_PATH,
  MEDIAPIPE_WASM_CDN,
  MEDIAPIPE_WASM_PATH,
} from "@/config/handControlConfig";
import { extractHandPose } from "@/lib/handPose";
import type { HandPose } from "@/lib/handPose";

type VisionModule = typeof import("@mediapipe/tasks-vision");

/** Resolves an asset path against the page URL rather than the bundle chunk. */
function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/**
 * Loads the MediaPipe library at runtime.
 *
 * The magic comments keep webpack and Turbopack from following this import:
 * the library dynamically imports its own wasm loader, which neither bundler
 * can resolve statically.
 */
function importVision(url: string): Promise<VisionModule> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

export type HandLandmarkerStatus = "idle" | "loading" | "running" | "error";

export type CameraDevice = {
  deviceId: string;
  label: string;
};

export type UseHandLandmarkerResult = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  /** Latest detected hand pose, or null when no hand is in frame. */
  handPoseRef: React.RefObject<HandPose | null>;
  status: HandLandmarkerStatus;
  error: string | null;
  devices: CameraDevice[];
  deviceId: string;
  setDeviceId: (deviceId: string) => void;
  /** Smoothed detections per second, for the panel readout. */
  fps: number;
  handDetected: boolean;
};

/**
 * @param enabled - Whether the camera and detector should be running.
 */
export function useHandLandmarker(enabled: boolean): UseHandLandmarkerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const handPoseRef = useRef<HandPose | null>(null);

  const [status, setStatus] = useState<HandLandmarkerStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [fps, setFps] = useState(0);
  const [handDetected, setHandDetected] = useState(false);

  // Mirrors `handDetected` so the render loop can avoid redundant setState.
  const handDetectedRef = useRef(false);

  const setDetected = useCallback((detected: boolean) => {
    if (handDetectedRef.current !== detected) {
      handDetectedRef.current = detected;
      setHandDetected(detected);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      handPoseRef.current = null;
      setStatus("idle");
      setDetected(false);
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarkerType | null = null;
    let rafId: number | null = null;

    const start = async () => {
      setStatus("loading");
      setError(null);

      try {
        // Prefer the self-hosted assets, fall back to the CDN so the panel
        // still works if `scripts/fetch-mediapipe-assets.mjs` never ran.
        let vision: VisionModule;
        try {
          vision = await importVision(assetUrl(MEDIAPIPE_BUNDLE_PATH));
        } catch (localBundleError) {
          console.warn(
            "Failed to load the MediaPipe library from public/mediapipe, falling back to the CDN:",
            localBundleError
          );
          vision = await importVision(MEDIAPIPE_BUNDLE_CDN);
        }
        if (cancelled) return;

        const { FilesetResolver, HandLandmarker, DrawingUtils } = vision;

        const createLandmarker = async (wasmPath: string, modelPath: string) => {
          const fileset = await FilesetResolver.forVisionTasks(assetUrl(wasmPath));
          return HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: assetUrl(modelPath),
              delegate: "GPU",
            },
            numHands: 1,
            runningMode: "VIDEO",
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        };

        try {
          landmarker = await createLandmarker(
            MEDIAPIPE_WASM_PATH,
            HAND_MODEL_PATH
          );
        } catch (localError) {
          console.warn(
            "Failed to load MediaPipe assets from public/mediapipe, falling back to the CDN:",
            localError
          );
          landmarker = await createLandmarker(
            MEDIAPIPE_WASM_CDN,
            HAND_MODEL_CDN
          );
        }
        if (cancelled) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) return;

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices(
            allDevices
              .filter((d) => d.kind === "videoinput")
              .map((d) => ({
                deviceId: d.deviceId,
                label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
              }))
          );
        }

        const video = videoRef.current;
        if (!video) {
          throw new Error("Video element is not mounted");
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        setStatus("running");

        let drawingUtils: DrawingUtilsType | null = null;
        let lastVideoTime = -1;
        let frames = 0;
        let fpsWindowStart = performance.now();

        const loop = () => {
          rafId = requestAnimationFrame(loop);

          if (!landmarker || video.readyState < 2) return;
          if (video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;

          let result;
          try {
            result = landmarker.detectForVideo(video, performance.now());
          } catch (detectionError) {
            console.error("Hand detection failed:", detectionError);
            return;
          }

          const aspect = video.videoWidth
            ? video.videoHeight / video.videoWidth
            : 0.75;
          const pose = extractHandPose(result, aspect);
          handPoseRef.current = pose;
          setDetected(pose !== null);

          frames++;
          const now = performance.now();
          if (now - fpsWindowStart >= 500) {
            setFps(Math.round((frames * 1000) / (now - fpsWindowStart)));
            frames = 0;
            fpsWindowStart = now;
          }

          const canvas = overlayRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          if (
            canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight
          ) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            drawingUtils = null;
          }
          if (!drawingUtils) drawingUtils = new DrawingUtils(ctx);

          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          // The preview is mirrored via CSS, so mirror the overlay too.
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          for (const landmarks of result.landmarks ?? []) {
            drawingUtils.drawConnectors(
              landmarks,
              HandLandmarker.HAND_CONNECTIONS,
              { color: "#22c55e", lineWidth: 3 }
            );
            drawingUtils.drawLandmarks(landmarks, {
              color: "#f97316",
              lineWidth: 1,
              radius: 3,
            });
          }
          ctx.restore();
        };

        loop();
      } catch (startError) {
        if (cancelled) return;
        console.error("Failed to start hand tracking:", startError);
        setError(
          startError instanceof Error
            ? startError.message
            : "Failed to start hand tracking"
        );
        setStatus("error");
      }
    };

    start();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      landmarker?.close();
      handPoseRef.current = null;
      handDetectedRef.current = false;
      setHandDetected(false);
    };
  }, [enabled, deviceId, setDetected]);

  return {
    videoRef,
    overlayRef,
    handPoseRef,
    status,
    error,
    devices,
    deviceId,
    setDeviceId,
    fps,
    handDetected,
  };
}
