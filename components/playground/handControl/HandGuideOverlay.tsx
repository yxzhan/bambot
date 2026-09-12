"use client";

import { useEffect, useRef } from "react";
import {
  GUIDE_CONNECTIONS,
  GUIDE_LANDMARKS,
  GUIDE_PALM,
  projectHandGuide,
} from "@/lib/handGuide";
import { MIN_FORESHORTENING } from "@/lib/handGuide";
import type { HandGuide } from "@/lib/handGuide";
import type { MarkerPhase } from "@/hooks/useHandTeleop";

type HandGuideOverlayProps = {
  guideRef: React.RefObject<HandGuide>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  phase: MarkerPhase;
  active: boolean;
};

const projected = GUIDE_LANDMARKS.map(() => ({ x: 0, y: 0, z: 0 }));

/**
 * Draws the target hand pose over the camera preview.
 *
 * Runs its own animation frame loop off the guide ref so the panel never
 * re-renders for it.
 */
export function HandGuideOverlay({
  guideRef,
  videoRef,
  phase,
  active,
}: HandGuideOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!active) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let rafId: number | null = null;

    const draw = () => {
      rafId = requestAnimationFrame(draw);

      const canvas = canvasRef.current;
      const video = videoRef.current;
      const guide = guideRef.current;
      if (!canvas || !video) return;

      const width = video.videoWidth || canvas.clientWidth;
      const height = video.videoHeight || canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (!guide.visible) return;

      projectHandGuide(guide, height / width, projected);

      // Amber while lining up, green the moment the pose is close enough.
      const aligning = phaseRef.current === "near";
      const stroke = aligning ? "rgba(34,197,94,0.95)" : "rgba(250,204,21,0.8)";
      const fill = aligning ? "rgba(34,197,94,0.18)" : "rgba(250,204,21,0.12)";
      const scale = Math.min(width, height) / 480;

      ctx.save();

      // Palm, so the hand reads as a surface rather than a wire tangle.
      ctx.beginPath();
      GUIDE_PALM.forEach((index, i) => {
        const point = projected[index];
        const x = point.x * width;
        const y = point.y * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3 * scale;
      ctx.lineCap = "round";
      ctx.setLineDash([9 * scale, 6 * scale]);
      ctx.beginPath();
      for (const [a, b] of GUIDE_CONNECTIONS) {
        ctx.moveTo(projected[a].x * width, projected[a].y * height);
        ctx.lineTo(projected[b].x * width, projected[b].y * height);
      }
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = stroke;
      for (const point of projected) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      const hint = guide.clamped
        ? "gripper is outside the mapped workspace"
        : guide.foreshortening < MIN_FORESHORTENING
          ? "wrist points at the camera — distance is guesswork here"
          : null;

      if (hint) {
        ctx.fillStyle = "rgba(248,113,113,0.95)";
        ctx.font = `${Math.round(15 * scale)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(hint, width / 2, height - 12 * scale);
      }

      ctx.restore();
    };

    draw();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [active, guideRef, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
