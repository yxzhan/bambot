"use client";

import { useEffect, useRef, useState } from "react";

type Position = { x: number; y: number };

/**
 * Position state for a react-rnd panel that is mounted hidden.
 *
 * The panel starts at (0, 0) and only moves to `initial` the first time it is
 * shown. react-rnd works out its offset from the parent when it mounts; a
 * panel mounted with `display: none` at a non-zero position gets that offset
 * wrong and opens at twice the position.
 */
export function usePanelPosition(show: boolean, initial: Position) {
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const placedRef = useRef(false);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (show && !placedRef.current) {
      placedRef.current = true;
      setPosition(initialRef.current);
    }
  }, [show]);

  return [position, setPosition] as const;
}
