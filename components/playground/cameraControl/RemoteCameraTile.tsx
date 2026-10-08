"use client";

import React, { useEffect, useState } from "react";

/** Preview rate for another device's camera; rosbridge drops the frames in between. */
const REMOTE_PREVIEW_INTERVAL_MS = 100;
/** No frame for this long and the tile says so. */
const STALE_AFTER_MS = 2000;

type RemoteCameraTileProps = {
  topic: string;
  /** Preview size as a fraction of the image size, like local cameras. */
  scale: number;
  subscribe: (
    topicName: string,
    callback: (base64Data: string, format: string) => void,
    throttleMs?: number
  ) => (() => void) | null;
};

/** The camera namespace of an image topic: /wrist_cam/image_raw/compressed -> wrist_cam. */
export function remoteCameraName(topic: string): string {
  return topic.replace(/^\//, "").replace(/\/image_raw\/compressed$/, "");
}

/**
 * Another device's camera, read back from its ROS topic. Only the image is
 * shared - the camera itself is attached to the other device, which is where
 * it has to be added and published from.
 */
export function RemoteCameraTile({ topic, scale, subscribe }: RemoteCameraTileProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribe = subscribe(
      topic,
      (data, format) => {
        const type = format.includes("png") ? "png" : "jpeg";
        setSrc(`data:image/${type};base64,${data}`);
        setLastAt(Date.now());
      },
      REMOTE_PREVIEW_INTERVAL_MS
    );
    return () => unsubscribe?.();
  }, [topic, subscribe]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stale = lastAt === null || now - lastAt > STALE_AFTER_MS;
  const shown = size
    ? { width: size.width * scale, height: size.height * scale }
    : { width: 256 * scale, height: 256 * scale };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-mono text-zinc-200" title={topic}>
          {remoteCameraName(topic)}
        </span>
        <span className="text-zinc-500">{size ? `${size.width}×${size.height}` : ""}</span>
      </div>
      <div className="relative overflow-hidden rounded bg-black" style={shown}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={topic}
            style={shown}
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              if (!size || size.width !== width || size.height !== height) {
                setSize({ width, height });
              }
            }}
          />
        )}
        {stale && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-2 text-center text-xs text-zinc-400">
            {lastAt === null ? "waiting for frames…" : "no frames"}
          </div>
        )}
      </div>
    </div>
  );
}
