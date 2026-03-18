"use client";

import React, { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { panelStyle } from "@/components/playground/panelStyle";

type WebcamDevice = {
  deviceId: string;
  label: string;
};

type WebcamPanelProps = {
  show?: boolean;
  onHide: () => void;
};

export function WebcamPanel({
  show = true,
  onHide,
}: WebcamPanelProps) {
  const [devices, setDevices] = useState<WebcamDevice[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(null);
  const streamRefs = useRef<Map<string, MediaStream>>(new Map());

  useEffect(() => {
    const getDevices = async () => {
      setLoading(true);
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices
          .filter((d) => d.kind === "videoinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 8)}` }));

        stream.getTracks().forEach((t) => t.stop());
        setDevices(videoDevices);

        for (const device of videoDevices) {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: device.deviceId } },
            audio: false,
          });
          streamRefs.current.set(device.deviceId, s);
          if (videoRefs.current?.get(device.deviceId)) {
            videoRefs.current.get(device.deviceId)!.srcObject = s;
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to access cameras");
      } finally {
        setLoading(false);
      }
    };

    if (show) {
      getDevices();
    }

    return () => {
      streamRefs.current.forEach((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      streamRefs.current.clear();
    };
  }, [show]);

  const closeCamera = (deviceId: string) => {
    const stream = streamRefs.current.get(deviceId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRefs.current.delete(deviceId);
    }
    setClosed((prev) => new Set([...prev, deviceId]));
  };

  const activeDevices = devices.filter((d) => !closed.has(d.deviceId));

  return (
    <Rnd
      position={{ x: 0, y: 70 }}
      size={{ width: 400, height: 320 }}
      bounds="window"
      className="z-40"
      style={{ display: show ? undefined : "none" }}
    >
      <div className={`flex flex-col h-full ${panelStyle} p-2`}>
        <div className="mb-2 flex justify-between items-center shrink-0">
          <h4 className="font-bold text-lg">Webcam ({activeDevices.length})</h4>
          <button
            onClick={onHide}
            className="text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
          >
            ×
          </button>
        </div>
        {loading && (
          <div className="flex items-center justify-center flex-1 text-zinc-400">
            Scanning for cameras...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center flex-1 text-red-400">
            {error}
          </div>
        )}
        {!loading && !error && devices.length === 0 && (
          <div className="flex items-center justify-center flex-1 text-zinc-400">
            No cameras found
          </div>
        )}
        {!loading && !error && activeDevices.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2 h-full">
              {activeDevices.map((device) => (
                <div key={device.deviceId} className="relative">
                  <video
                    ref={(el) => {
                      if (!videoRefs.current) videoRefs.current = new Map();
                      if (el) videoRefs.current.set(device.deviceId, el);
                      else videoRefs.current.delete(device.deviceId);
                      if (el && streamRefs.current.has(device.deviceId)) {
                        el.srcObject = streamRefs.current.get(device.deviceId) ?? null;
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="rounded-lg w-full h-full object-cover bg-black"
                    style={{ aspectRatio: "16/9" }}
                  />
                  <button
                    onClick={() => closeCamera(device.deviceId)}
                    className="absolute top-1 right-1 text-white bg-black/60 hover:bg-black/80 rounded-full w-6 h-6 flex items-center justify-center text-sm"
                    title="Close"
                  >
                    ×
                  </button>
                  <span className="block text-xs text-zinc-400 mt-1 truncate" title={device.label}>
                    {device.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && !error && activeDevices.length === 0 && devices.length > 0 && (
          <div className="flex items-center justify-center flex-1 text-zinc-400">
            All cameras closed
          </div>
        )}
      </div>
    </Rnd>
  );
}
