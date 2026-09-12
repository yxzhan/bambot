"use client";

import { useEffect, useRef } from "react";
import type { CalibrationState } from "@/hooks/useHandCalibration";

type CalibrationOverlayProps = {
  state: CalibrationState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  active: boolean;
};

const ACCENT = "#38bdf8";
const DONE = "#22c55e";

/**
 * Draws the calibration targets over the preview: a ring to put the wrist on
 * with a dwell arc that fills as the hand is held still, plus reference squares
 * for the reach steps so "closer" and "further" are something to aim at rather
 * than guess.
 */
export function CalibrationOverlay({
  state,
  videoRef,
  active,
}: CalibrationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active) {
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let rafId: number | null = null;

    const draw = () => {
      rafId = requestAnimationFrame(draw);

      const element = canvasRef.current;
      const video = videoRef.current;
      const current = stateRef.current;
      if (!element || !video || !current.target) return;

      const width = video.videoWidth || element.clientWidth;
      const height = video.videoHeight || element.clientHeight;
      if (!width || !height) return;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }

      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const scale = Math.min(width, height) / 480;
      const [tx, ty] = current.target;
      const cx = tx * width;
      const cy = ty * height;
      const isReachStep = current.step === "near" || current.step === "far";

      ctx.save();

      // Dim everything but the target, so the eye goes to the right place.
      ctx.fillStyle = "rgba(9,14,20,0.45)";
      ctx.fillRect(0, 0, width, height);

      // Reference squares: the hand should roughly fill the big one when
      // reaching forward and the small one when pulled back. The live square
      // shows what is actually being measured.
      if (isReachStep) {
        const drawSquare = (size: number, style: string, dashed: boolean) => {
          const half = (size * width) / 2;
          ctx.strokeStyle = style;
          ctx.lineWidth = 2 * scale;
          ctx.setLineDash(dashed ? [8 * scale, 6 * scale] : []);
          ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
        };
        drawSquare(0.42, "rgba(148,163,184,0.55)", true);
        drawSquare(0.16, "rgba(148,163,184,0.55)", true);
        if (current.handSize > 0) {
          drawSquare(current.handSize * 2, ACCENT, false);
        }
        ctx.setLineDash([]);
      }

      const radius = (isReachStep ? 26 : 34) * scale;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2 * scale;
      ctx.stroke();

      // Dwell arc.
      if (current.progress > 0) {
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          radius,
          -Math.PI / 2,
          -Math.PI / 2 + current.progress * Math.PI * 2
        );
        ctx.strokeStyle = current.progress >= 0.999 ? DONE : ACCENT;
        ctx.lineWidth = 6 * scale;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 4 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `600 ${Math.round(19 * scale)}px system-ui, sans-serif`;
      ctx.fillText(
        `${current.index}/${current.total}  ${current.title}`,
        width / 2,
        26 * scale
      );

      ctx.fillStyle = current.waitingForHand
        ? "rgba(248,113,113,0.95)"
        : current.waitingToMove
          ? "rgba(250,204,21,0.95)"
          : "rgba(226,232,240,0.9)";
      ctx.font = `${Math.round(14 * scale)}px system-ui, sans-serif`;
      const message = current.waitingForHand
        ? "No hand detected — show your hand to the camera"
        : current.waitingToMove
          ? "Move to the next position"
          : "Hold still";
      ctx.fillText(message, width / 2, height - 14 * scale);

      ctx.restore();
    };

    draw();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [active, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
