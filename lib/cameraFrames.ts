"use client";

// Camera frames for panels other than the camera panel - the AI chat sends
// snapshots to the model. Local cameras are read straight off the canvases the
// camera panel draws into; other devices' cameras come from their ROS topics.

import { useEffect, useSyncExternalStore } from "react";

export type CameraSnapshot = {
  name: string;
  /** JPEG or PNG, base64 without the data: prefix. */
  base64: string;
  mimeType: "image/jpeg" | "image/png";
};

const SNAPSHOT_JPEG_QUALITY = 0.85;
/** How long to wait for a frame on another device's camera topic, ms. */
const REMOTE_FRAME_TIMEOUT_MS = 2000;

// --- local cameras -------------------------------------------------------------

/** Canvases of this page's cameras, by camera id. */
const localCameras = new Map<string, { name: string; canvas: HTMLCanvasElement }>();

export function registerLocalCamera(id: string, name: string, canvas: HTMLCanvasElement | null) {
  if (canvas) localCameras.set(id, { name, canvas });
  else localCameras.delete(id);
}

/** Names of the cameras added on this page, streaming or not. */
export function localCameraNames(): string[] {
  return [...localCameras.values()].map((c) => c.name);
}

/** The current frame of one of this page's cameras, or null if it is not streaming. */
export function captureLocalCamera(name: string): CameraSnapshot | null {
  for (const camera of localCameras.values()) {
    if (camera.name !== name) continue;
    if (camera.canvas.dataset.ready !== "1") return null;
    const dataUrl = camera.canvas.toDataURL("image/jpeg", SNAPSHOT_JPEG_QUALITY);
    return { name, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  }
  return null;
}

// --- keeping local cameras on ----------------------------------------------------
// The camera panel only runs its cameras while it is shown or publishing. Other
// panels that want frames say so here, so a snapshot does not have to wait for
// a camera to start up.

let demand = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changeDemand(delta: number) {
  demand += delta;
  for (const listener of listeners) listener();
}

/** Keeps this page's cameras streaming while `want` is true. */
export function useKeepCamerasActive(want: boolean) {
  useEffect(() => {
    if (!want) return;
    changeDemand(1);
    return () => changeDemand(-1);
  }, [want]);
}

/** Whether some panel wants this page's cameras streaming. */
export function useCamerasDemanded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => demand > 0,
    () => false
  );
}

// --- other devices' cameras ------------------------------------------------------

type SubscribeCompressedImage = (
  topicName: string,
  callback: (base64Data: string, format: string) => void,
  throttleMs?: number
) => (() => void) | null;

/** The next frame published on a camera topic, or null if none arrives in time. */
export function captureRemoteCamera(
  subscribe: SubscribeCompressedImage,
  topic: string,
  name: string
): Promise<CameraSnapshot | null> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let done = false;
    const finish = (snapshot: CameraSnapshot | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(snapshot);
    };
    const timer = setTimeout(() => finish(null), REMOTE_FRAME_TIMEOUT_MS);
    unsubscribe = subscribe(topic, (base64, format) =>
      finish({
        name,
        base64,
        mimeType: format.includes("png") ? "image/png" : "image/jpeg",
      })
    );
    if (!unsubscribe) finish(null);
    // A frame may have arrived synchronously, before unsubscribe was set.
    else if (done) unsubscribe();
  });
}
