"use client";

import React from "react";
import {
  CONTROL_SOURCE_LABEL,
  ControlAuthority,
  ControlSource,
} from "@/hooks/useControlAuthority";

type ControlBadgeProps = {
  source: ControlSource;
  control: ControlAuthority;
  /** Hide the button where taking control means starting something (replay). */
  canTakeControl?: boolean;
};

/**
 * Tells a panel whether its input is the one driving the arm, and offers to
 * take control when it is not - the explicit switch the control authority
 * requires.
 */
export function ControlBadge({ source, control, canTakeControl = true }: ControlBadgeProps) {
  if (control.owner === source) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-400">
        <span className="h-2 w-2 rounded-full bg-green-400" />
        In control
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">
      <span className="flex-1">
        {CONTROL_SOURCE_LABEL[control.owner]} is controlling the arm — input here is ignored.
      </span>
      {canTakeControl && (
        <button
          onClick={() => control.claim(source)}
          className="shrink-0 rounded bg-yellow-500/80 px-2 py-0.5 text-black hover:bg-yellow-400"
        >
          Take control
        </button>
      )}
    </div>
  );
}

/** Who owns the arm, shown above the toolbar. */
export function ControlIndicator({ control }: { control: ControlAuthority }) {
  return (
    <div className="mb-2 flex justify-center">
      <span className="rounded-full bg-black/40 px-3 py-0.5 text-xs text-zinc-300 backdrop-blur-sm">
        Arm controlled by:{" "}
        <span className="font-semibold text-white">{CONTROL_SOURCE_LABEL[control.owner]}</span>
      </span>
    </div>
  );
}
