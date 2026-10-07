// Turns IK results into the servo updates `updateJointsDegrees` expects.

import type { JointDetails } from "@/components/playground/RobotScene";
import { radiansToDegrees } from "@/lib/utils";

type JointUpdate = { servoId: number; value: number };

/**
 * Maps solved chain angles, plus an optional gripper opening, onto servo IDs.
 *
 * @param chainJoints URDF joint names, in the order the angles were solved.
 * @param angles Joint values in radians, one per chain joint.
 * @param details Joint details of the loaded robot (names, servo IDs, limits).
 * @param gripper Gripper joint name and how open it should be, 0 = closed, 1 = open.
 */
export function buildJointUpdates(
  chainJoints: string[],
  angles: number[],
  details: JointDetails[],
  gripper?: { joint: string; openness: number }
): JointUpdate[] {
  const updates: JointUpdate[] = [];
  for (let i = 0; i < chainJoints.length; i++) {
    const detail = details.find((d) => d.name === chainJoints[i]);
    if (!detail) continue;
    updates.push({
      servoId: detail.servoId,
      value: radiansToDegrees(angles[i]),
    });
  }

  if (gripper) {
    const detail = details.find((d) => d.name === gripper.joint);
    if (detail) {
      const lower = Number(detail.limit?.lower ?? 0);
      const upper = Number(detail.limit?.upper ?? Math.PI / 2);
      updates.push({
        servoId: detail.servoId,
        value: radiansToDegrees(lower + gripper.openness * (upper - lower)),
      });
    }
  }

  return updates;
}
