"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Stacking order of the floating panels: pressing anywhere on a panel brings
 * it to the front.
 *
 * z-index follows each panel's rank rather than a counter that grows on every
 * click, so panels stay within a fixed band (PANEL_Z_BASE and up) - below the
 * z-50 dialogs and header no matter how often they are clicked.
 */
const PANEL_Z_BASE = 40;

let order: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function register(id: string) {
  if (!order.includes(id)) {
    order = [...order, id];
    emit();
  }
}

function bringToFront(id: string) {
  if (order[order.length - 1] === id) return;
  order = [...order.filter((p) => p !== id), id];
  emit();
}

/**
 * z-index for one panel, and a handler that raises it. Put `zIndex` on the
 * panel's `<Rnd style>` and `bringToFront` on `onMouseDown` / `onTouchStart`.
 */
export function usePanelZ(id: string) {
  useEffect(() => register(id), [id]);
  const rank = useSyncExternalStore(
    subscribe,
    () => order.indexOf(id),
    () => -1
  );
  const raise = useCallback(() => bringToFront(id), [id]);
  return { zIndex: PANEL_Z_BASE + Math.max(rank, 0), bringToFront: raise };
}
