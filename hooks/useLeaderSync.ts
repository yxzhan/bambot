/**
 * Reads the leader arm at a steady rate and hands each reading on.
 *
 * It is a read-then-wait loop rather than a setInterval: a reading that takes
 * longer than the period delays the next one instead of overlapping it on the
 * same serial port. Everything the loop reads goes through refs, so it is not
 * restarted by re-renders - which every reading causes - and its rate is the
 * configured one, not "the period plus however long a render took".
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { servoPositionToAngle } from "@/lib/utils";

export type LeaderAngle = { servoId: number; angle: number };

/** How often the angles shown in the panel and the measured rate refresh, ms. */
const DISPLAY_INTERVAL_MS = 250;

type UseLeaderSyncParams = {
  isConnected: boolean;
  getPositions: () => Promise<Map<number, number>>;
  /** Servo IDs to read, in display order. */
  servoIds: number[];
  hz: number;
  /** Called with every successful reading, in degrees. */
  onReading: (angles: LeaderAngle[]) => void;
};

export type UseLeaderSyncResult = {
  /** Latest reading, refreshed for display a few times a second. */
  angles: LeaderAngle[];
  /** Readings per second actually achieved, over the last display interval. */
  measuredHz: number;
};

export function useLeaderSync({
  isConnected,
  getPositions,
  servoIds,
  hz,
  onReading,
}: UseLeaderSyncParams): UseLeaderSyncResult {
  const [angles, setAngles] = useState<LeaderAngle[]>([]);
  const [measuredHz, setMeasuredHz] = useState(0);

  const getPositionsRef = useRef(getPositions);
  getPositionsRef.current = getPositions;
  const servoIdsRef = useRef(servoIds);
  servoIdsRef.current = servoIds;
  const hzRef = useRef(hz);
  hzRef.current = hz;
  const onReadingRef = useRef(onReading);
  onReadingRef.current = onReading;

  const latestRef = useRef<LeaderAngle[]>([]);
  const countRef = useRef(0);

  useEffect(() => {
    if (!isConnected) {
      setMeasuredHz(0);
      return;
    }
    let cancelled = false;

    const loop = async () => {
      let next = performance.now();
      while (!cancelled) {
        const positions = await getPositionsRef.current();
        if (cancelled) break;
        // An empty map means a failed read: skip it rather than snapping the
        // arm to zero.
        if (positions.size > 0) {
          const reading = servoIdsRef.current
            .filter((id) => positions.has(id))
            .map((id) => ({ servoId: id, angle: servoPositionToAngle(positions.get(id)!) }));
          latestRef.current = reading;
          countRef.current++;
          onReadingRef.current(reading);
        }
        // Keep to the beat; if a read overran, start the next one right away
        // instead of trying to catch up with a burst.
        next += 1000 / hzRef.current;
        const wait = next - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        else next = performance.now();
      }
    };
    loop();

    let lastAt = performance.now();
    const display = setInterval(() => {
      const now = performance.now();
      setMeasuredHz((countRef.current * 1000) / (now - lastAt));
      countRef.current = 0;
      lastAt = now;
      setAngles(latestRef.current);
    }, DISPLAY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(display);
    };
  }, [isConnected]);

  return { angles, measuredHz };
}
