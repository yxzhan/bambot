/**
 * The maths behind VR controller teleoperation, free of React and WebXR.
 *
 * Two frames are involved. WebXR reports the headset and controllers in its
 * reference space, in metres. The scene is in "scene units", with the robot's
 * base at the origin and the robot scaled up by `RobotScene`. An XR rig - an
 * Object3D that parents the camera and the controller visuals - maps the
 * first onto the second: it carries the robot's scale, so the robot appears
 * life size, and a yaw plus an offset, so it stands in front of the operator.
 */

import * as THREE from "three";

/** Where the robot's base sits in the XR reference space, and how it is turned. */
export type RigPlacement = {
  /** Robot base position in the XR reference space, metres. */
  base: THREE.Vector3;
  /** Rotation about the vertical axis from XR space into scene space, radians. */
  yaw: number;
};

const _forward = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _deltaQuat = new THREE.Quaternion();

/** Heading of a direction in the horizontal plane, radians (0 = +Z). */
function heading(direction: THREE.Vector3): number {
  return Math.atan2(direction.x, direction.z);
}

/**
 * Places the robot in front of the operator, turned so that its arm reaches
 * the way the operator is looking.
 *
 * Standing behind the arm is what makes the mapping intuitive: pushing the
 * controller forward pushes the gripper forward, left is left.
 *
 * @param headPosition Headset position in the XR reference space.
 * @param headQuaternion Headset orientation in the XR reference space.
 * @param reachDirection Direction from the robot's base to its gripper, in scene space.
 * @param baseDistance Horizontal distance from the eyes to the base, metres.
 * @param baseBelowEyes Height of the eyes above the base, metres.
 */
export function computeRigPlacement(
  headPosition: THREE.Vector3,
  headQuaternion: THREE.Quaternion,
  reachDirection: THREE.Vector3,
  baseDistance: number,
  baseBelowEyes: number,
  out: RigPlacement
): RigPlacement {
  _forward.set(0, 0, -1).applyQuaternion(headQuaternion);
  _forward.y = 0;
  // Looking straight up or down leaves no heading to speak of.
  if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
  _forward.normalize();

  out.base.copy(headPosition).addScaledVector(_forward, baseDistance);
  out.base.y = headPosition.y - baseBelowEyes;

  const reachHeading =
    reachDirection.x * reachDirection.x + reachDirection.z * reachDirection.z > 1e-9
      ? heading(reachDirection)
      : 0;
  // Turning XR space by `yaw` must carry the gaze onto the arm's reach.
  out.yaw = reachHeading - heading(_forward);
  return out;
}

/**
 * Writes a placement into the rig transform: scene = rig * xr, with the robot
 * base (at the scene origin) landing on `placement.base`.
 */
export function applyRigPlacement(
  rig: THREE.Object3D,
  placement: RigPlacement,
  scale: number
) {
  rig.quaternion.setFromAxisAngle(_yAxis, placement.yaw);
  rig.scale.setScalar(scale);
  _offset
    .copy(placement.base)
    .applyQuaternion(rig.quaternion)
    .multiplyScalar(-scale);
  rig.position.copy(_offset);
  rig.updateMatrixWorld(true);
}

/**
 * Clutch-style mapping from controller motion to a gripper target.
 *
 * When the operator engages, the controller and gripper poses are recorded as
 * anchors. From then on the gripper is asked to move by however much the
 * controller has moved since - so engaging never makes the arm jump, and
 * releasing, repositioning the hand and engaging again extends the reach.
 *
 * All poses are in scene space.
 */
export function computeClutchTarget(
  anchorControllerPosition: THREE.Vector3,
  anchorControllerQuaternion: THREE.Quaternion,
  controllerPosition: THREE.Vector3,
  controllerQuaternion: THREE.Quaternion,
  anchorTcpPosition: THREE.Vector3,
  anchorTcpQuaternion: THREE.Quaternion,
  motionScale: number,
  followRotation: boolean,
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion
) {
  outPosition
    .copy(controllerPosition)
    .sub(anchorControllerPosition)
    .multiplyScalar(motionScale)
    .add(anchorTcpPosition);

  if (followRotation) {
    // The controller's rotation since engaging, expressed in scene space and
    // applied on top of the gripper's orientation at that moment.
    _deltaQuat
      .copy(anchorControllerQuaternion)
      .invert()
      .premultiply(controllerQuaternion);
    outQuaternion.copy(anchorTcpQuaternion).premultiply(_deltaQuat);
  } else {
    outQuaternion.copy(anchorTcpQuaternion);
  }
}

/**
 * Limits how far each joint may move towards `target` in one step, so an IK
 * solution that flips to a different configuration sweeps across instead of
 * snapping the servos there.
 *
 * @returns A new array of joint values, radians.
 */
export function limitJointStep(
  current: number[],
  target: number[],
  maxStep: number
): number[] {
  return target.map((value, i) => {
    const from = current[i] ?? value;
    return from + THREE.MathUtils.clamp(value - from, -maxStep, maxStep);
  });
}
