"use client";

import React, { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { panelStyle } from "@/components/playground/panelStyle";

type WebcamPanelProps = {
  show?: boolean;
  onHide: () => void;
};

export function WebcamPanel({
  show = true,
  onHide,
}: WebcamPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const constraints = {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "environment"
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error) {
        console.error("Error accessing webcam:", error);
      }
    };

    if (show) {
      startCamera();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [show]);

  return (
    <Rnd
      position={{ x: 0, y: 70 }}
      size={{ width: 800, height: 450 }}
      onDragStop={(_, d) => {
        // Optionally update localStorage position
      }}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
    >
      <div className={`p-2 ${panelStyle}`}>
        <div className="mb-2 flex justify-between items-center">
          <h4 className="font-bold text-lg">Webcam View</h4>
          <div className="flex gap-2">
            <button
              onClick={onHide}
              className="text-xl hover:bg-zinc-800 px-2 rounded-full"
              title="Collapse"
            >
              ×
            </button>
          </div>
        </div>
        <div
          ref={videoRef}
          className="rounded-lg overflow-hidden w-full aspect-video bg-black"
        />
        {!videoRef.current && (
          <div className="flex items-center justify-center h-full text-zinc-400">
            Please allow camera access to see the webcam view
          </div>
        )}
      </div>
    </Rnd>
  );
}
