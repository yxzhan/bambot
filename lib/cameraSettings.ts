// Cameras added in the webcam panel, persisted per browser.

export type CameraConfig = {
  /** Stable key for React and the frame registry; not shown. */
  id: string;
  /** Also the ROS topic namespace: /<name>/image_raw/compressed. */
  name: string;
  deviceId: string;
  /** Device label when it was added, for display when the device is missing. */
  label: string;
  /** Output size in pixels; the camera is centre-cropped to this aspect. */
  width: number;
  height: number;
};

export const DEFAULT_CAMERA_SIZE = { width: 256, height: 256 };
export const MIN_CAMERA_SIZE = 16;
export const MAX_CAMERA_SIZE = 1920;

/** Preview scales offered in the panel, as fractions of the output size. */
export const PREVIEW_SCALES = [0.25, 0.5, 1];
export const DEFAULT_PREVIEW_SCALE = 0.5;

/**
 * A valid ROS name segment: lowercase letters, digits and underscores,
 * starting with a letter (the default names are camera_1, camera_2, ...).
 */
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Why `name` cannot be used, or null if it can. */
export function cameraNameError(name: string, taken: string[]): string | null {
  if (!name) return "Name is required";
  if (!NAME_PATTERN.test(name)) {
    return "Lowercase letters, digits and underscores, starting with a letter";
  }
  if (taken.includes(name)) return `"${name}" is already used`;
  return null;
}

/** Why a width or height is unusable, or null. */
export function cameraSizeError(value: number): string | null {
  if (!Number.isInteger(value) || value < MIN_CAMERA_SIZE || value > MAX_CAMERA_SIZE) {
    return `Size must be a whole number from ${MIN_CAMERA_SIZE} to ${MAX_CAMERA_SIZE}`;
  }
  return null;
}

/** The first of camera_1, camera_2, ... that is not taken. */
export function defaultCameraName(taken: string[]): string {
  for (let i = 1; ; i++) {
    const name = `camera_${i}`;
    if (!taken.includes(name)) return name;
  }
}

/** The compressed image topic a camera publishes on. */
export function cameraTopic(name: string): string {
  return `/${name}/image_raw/compressed`;
}

/** Frames per second published per camera, the panel's slider range. */
export const MIN_CAMERA_PUBLISH_HZ = 10;
export const MAX_CAMERA_PUBLISH_HZ = 60;
export const DEFAULT_CAMERA_PUBLISH_HZ = 15;

const CAMERAS_KEY = "webcam_cameras";
const PUBLISH_HZ_KEY = "webcam_publish_hz";

export function getCameraPublishHzFromLocalStorage(): number {
  if (typeof window === "undefined") return DEFAULT_CAMERA_PUBLISH_HZ;
  try {
    const hz = Number(localStorage.getItem(PUBLISH_HZ_KEY));
    return Number.isFinite(hz) && hz >= MIN_CAMERA_PUBLISH_HZ && hz <= MAX_CAMERA_PUBLISH_HZ
      ? hz
      : DEFAULT_CAMERA_PUBLISH_HZ;
  } catch {
    return DEFAULT_CAMERA_PUBLISH_HZ;
  }
}

export function setCameraPublishHzToLocalStorage(hz: number) {
  try {
    localStorage.setItem(PUBLISH_HZ_KEY, String(hz));
  } catch (error) {
    console.warn("Failed to persist camera publish rate:", error);
  }
}

export function getCamerasFromLocalStorage(): CameraConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CAMERAS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to read cameras:", error);
    return [];
  }
}

export function setCamerasToLocalStorage(cameras: CameraConfig[]) {
  try {
    localStorage.setItem(CAMERAS_KEY, JSON.stringify(cameras));
  } catch (error) {
    console.warn("Failed to persist cameras:", error);
  }
}
