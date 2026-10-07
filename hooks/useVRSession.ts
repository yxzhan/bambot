/**
 * Starts and stops the WebXR session the VR teleoperation runs in.
 *
 * It lives outside the canvas so the panel can offer "Enter VR" / "Enter AR",
 * and it only needs the renderer, which `RobotLoader` captures on creation.
 * Rendering itself needs no help: react-three-fiber switches to the XR
 * animation loop on its own when the renderer starts presenting.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";

export type VRMode = "immersive-vr" | "immersive-ar";

export type UseVRSessionResult = {
  /** Session modes this browser and headset can run. Empty while still checking. */
  supported: VRMode[];
  /** True once support has been checked. */
  checked: boolean;
  /** Mode of the running session, or null when not in XR. */
  activeMode: VRMode | null;
  error: string | null;
  enter: (mode: VRMode) => Promise<void>;
  exit: () => void;
};

export function useVRSession(
  glRef: React.RefObject<THREE.WebGLRenderer | null>
): UseVRSessionResult {
  const [supported, setSupported] = useState<VRMode[]>([]);
  const [checked, setChecked] = useState(false);
  const [activeMode, setActiveMode] = useState<VRMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<XRSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const xr = typeof navigator !== "undefined" ? navigator.xr : undefined;
      if (!xr) {
        if (!cancelled) setChecked(true);
        return;
      }
      const modes: VRMode[] = [];
      for (const mode of ["immersive-vr", "immersive-ar"] as VRMode[]) {
        try {
          if (await xr.isSessionSupported(mode)) modes.push(mode);
        } catch {
          // A browser may throw for a mode it does not know; treat it as unsupported.
        }
      }
      if (!cancelled) {
        setSupported(modes);
        setChecked(true);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const enter = useCallback(
    async (mode: VRMode) => {
      const gl = glRef.current;
      const xr = navigator.xr;
      if (!gl || !xr || sessionRef.current) return;
      setError(null);
      try {
        const session = await xr.requestSession(mode, {
          optionalFeatures: ["local-floor"],
        });
        sessionRef.current = session;
        session.addEventListener("end", () => {
          sessionRef.current = null;
          setActiveMode(null);
        });

        // Where the floor is does not matter - the robot is placed relative to
        // the headset - but local-floor keeps the room's vertical axis honest.
        const floor = session.enabledFeatures?.includes("local-floor") ?? false;
        gl.xr.enabled = true;
        gl.xr.setReferenceSpaceType(floor ? "local-floor" : "local");
        await gl.xr.setSession(session);
        setActiveMode(mode);
      } catch (err) {
        sessionRef.current = null;
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [glRef]
  );

  const exit = useCallback(() => {
    sessionRef.current?.end().catch(() => undefined);
  }, []);

  // Leave XR when the page unmounts the playground.
  useEffect(() => () => {
    sessionRef.current?.end().catch(() => undefined);
  }, []);

  return { supported, checked, activeMode, error, enter, exit };
}
