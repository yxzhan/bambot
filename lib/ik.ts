/**
 * Damped least squares (DLS) inverse kinematics over a URDF joint chain.
 *
 * The solver is deliberately generic: it only needs a list of revolute joints
 * and a tool frame somewhere below them in the scene graph, so it works for any
 * robot in `robotConfigMap` without hand-derived link lengths. The Jacobian is
 * built by finite differences on the live Three.js transforms, which means the
 * scene scale and the -90 deg X rotation applied in `RobotScene` are handled
 * automatically - everything happens in world space.
 *
 * SO-ARM101 only has five arm joints, so a full 6-DOF pose is generally not
 * attainable. DLS degrades gracefully here: with the position rows weighted
 * higher than the orientation rows it returns the least-squares compromise
 * instead of failing.
 */

import * as THREE from "three";

/** The subset of `URDFJoint` the solver relies on. */
export type IKJointLike = THREE.Object3D & {
  setJointValue: (...values: (number | null)[]) => boolean;
  angle: number | string;
  limit: { lower?: number | string; upper?: number | string };
};

export type IKChain = {
  joints: IKJointLike[];
  tcp: THREE.Object3D;
  limits: { lower: number; upper: number }[];
};

export type IKOptions = {
  /** Iterations for the position-only pass. */
  maxIterations?: number;
  /** Iterations for the orientation refinement pass. */
  refineIterations?: number;
  /** Extra attempts from perturbed seeds when a solve lands out of tolerance. */
  restarts?: number;
  /** Damping factor; larger = smoother but slower convergence near singularities. */
  lambda?: number;
  posWeight?: number;
  /**
   * Weight of the orientation rows. Kept low on purpose: with five joints the
   * arm cannot hit an arbitrary 6-DOF pose, and position is what the operator
   * actually aims with.
   */
  rotWeight?: number;
  /** Largest joint change per iteration, radians. */
  maxStep?: number;
  /** Position residual under which the target counts as reached, scene units. */
  positionTolerance?: number;
  /** Orientation residual under which the target counts as reached, radians. */
  rotationTolerance?: number;
};

export type IKResult = {
  /** Solved joint values in radians, one per chain joint. */
  angles: number[];
  /** Remaining position error, scene units. */
  posError: number;
  /** Remaining orientation error, radians. */
  rotError: number;
  /** Whether the position residual is within `positionTolerance`. */
  reachable: boolean;
  iterations: number;
};

const DEFAULTS: Required<IKOptions> = {
  maxIterations: 20,
  refineIterations: 15,
  restarts: 6,
  lambda: 0.1,
  posWeight: 1,
  rotWeight: 0.05,
  maxStep: 0.3,
  positionTolerance: 0.25,
  rotationTolerance: 0.15,
};

const JACOBIAN_DELTA = 1e-3;

/**
 * How far each retry may wander from the current pose, as a fraction of each
 * joint's range. 1 means "anywhere within the limits".
 */
const RESTART_SPREADS = [0.15, 0.35, 0.7, 1, 1, 1];

// Scratch objects, reused across calls to keep the 30 Hz loop allocation free.
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _basePos = new THREE.Vector3();
const _baseQuat = new THREE.Quaternion();
const _quatError = new THREE.Quaternion();
const _quatInverse = new THREE.Quaternion();
const _dp = new THREE.Vector3();
const _dr = new THREE.Vector3();

/**
 * Resolves joint and link names against a loaded URDF robot.
 *
 * @returns The chain, or null when any name is missing from the robot.
 */
export function createIKChain(
  robot: {
    joints: Record<string, unknown>;
    links: Record<string, unknown>;
  },
  jointNames: string[],
  tcpLinkName: string
): IKChain | null {
  const joints: IKJointLike[] = [];
  for (const name of jointNames) {
    const joint = robot.joints[name] as IKJointLike | undefined;
    if (!joint) {
      console.warn(`IK: joint "${name}" not found on the robot.`);
      return null;
    }
    joints.push(joint);
  }

  const tcp = robot.links[tcpLinkName] as THREE.Object3D | undefined;
  if (!tcp) {
    console.warn(`IK: tool frame link "${tcpLinkName}" not found on the robot.`);
    return null;
  }

  const limits = joints.map((joint) => ({
    lower: Number(joint.limit?.lower ?? -Math.PI),
    upper: Number(joint.limit?.upper ?? Math.PI),
  }));

  return { joints, tcp, limits };
}

/** Reads the current joint values of the chain, in radians. */
export function readChainAngles(chain: IKChain): number[] {
  return chain.joints.map((joint) => Number(joint.angle) || 0);
}

function applyAngles(chain: IKChain, angles: number[]) {
  for (let i = 0; i < chain.joints.length; i++) {
    chain.joints[i].setJointValue(angles[i]);
  }
}

/**
 * Writes the difference between the tool frame and the target into `_dp` / `_dr`
 * (a translation and a rotation vector, both in world space).
 */
function poseError(
  chain: IKChain,
  targetPos: THREE.Vector3,
  targetQuat: THREE.Quaternion
) {
  chain.tcp.updateWorldMatrix(true, false);
  chain.tcp.matrixWorld.decompose(_pos, _quat, _scale);

  _dp.subVectors(targetPos, _pos);
  quaternionDelta(_quat, targetQuat, _dr);
}

/** Rotation vector (axis * angle) that takes `from` to `to`, in world space. */
function quaternionDelta(
  from: THREE.Quaternion,
  to: THREE.Quaternion,
  target: THREE.Vector3
): THREE.Vector3 {
  _quatInverse.copy(from).invert();
  _quatError.multiplyQuaternions(to, _quatInverse).normalize();

  // Always take the short way round.
  let { x, y, z, w } = _quatError;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }

  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalf < 1e-8) {
    return target.set(0, 0, 0);
  }
  const angle = 2 * Math.acos(Math.min(1, w));
  return target.set(x, y, z).multiplyScalar(angle / sinHalf);
}

/** Angle between two orientations, radians. */
export function quaternionAngle(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.abs(a.dot(b));
  return 2 * Math.acos(Math.min(1, dot));
}

/** Solves `A y = b` for a small dense symmetric system, in place. Returns null if singular. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [m[col], m[pivot]] = [m[pivot], m[col]];

    const diag = m[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = m[row][col] / diag;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }

  const y = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n];
    for (let col = row + 1; col < n; col++) sum -= m[row][col] * y[col];
    y[row] = sum / m[row][row];
  }
  return y;
}

/**
 * One damped least squares run from the chain's current joint values.
 *
 * Split out of `solveIK` because the solve is done in two passes: position
 * first (well conditioned, and with five joints the arm is redundant for a
 * 3-DOF goal), then a light orientation refinement that must not throw the
 * position away.
 */
function runDLS(
  chain: IKChain,
  targetPos: THREE.Vector3,
  targetQuat: THREE.Quaternion,
  opts: Required<IKOptions>,
  rotWeight: number,
  maxIterations: number
): { angles: number[]; posError: number; rotError: number; iterations: number } {
  const n = chain.joints.length;
  const q = readChainAngles(chain);

  // 6 x n Jacobian, stored row major.
  const J: number[][] = Array.from({ length: 6 }, () => new Array<number>(n).fill(0));
  const error = new Array<number>(6).fill(0);

  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    applyAngles(chain, q);
    poseError(chain, targetPos, targetQuat);

    if (
      _dp.length() < opts.positionTolerance &&
      (rotWeight === 0 || _dr.length() < opts.rotationTolerance)
    ) {
      break;
    }

    // `_pos` / `_quat` are overwritten by each perturbation, so keep the
    // unperturbed pose aside for the finite differences.
    _basePos.copy(_pos);
    _baseQuat.copy(_quat);

    for (let i = 0; i < n; i++) {
      const original = q[i];
      // Step away from the limit when the joint is sitting on it, otherwise the
      // URDF clamp would silently zero out this column.
      const delta =
        original + JACOBIAN_DELTA > chain.limits[i].upper
          ? -JACOBIAN_DELTA
          : JACOBIAN_DELTA;

      chain.joints[i].setJointValue(original + delta);
      chain.tcp.updateWorldMatrix(true, false);
      chain.tcp.matrixWorld.decompose(_pos, _quat, _scale);

      J[0][i] = ((_pos.x - _basePos.x) / delta) * opts.posWeight;
      J[1][i] = ((_pos.y - _basePos.y) / delta) * opts.posWeight;
      J[2][i] = ((_pos.z - _basePos.z) / delta) * opts.posWeight;

      quaternionDelta(_baseQuat, _quat, _dr);
      J[3][i] = (_dr.x / delta) * rotWeight;
      J[4][i] = (_dr.y / delta) * rotWeight;
      J[5][i] = (_dr.z / delta) * rotWeight;

      chain.joints[i].setJointValue(original);
    }

    // Recompute the error vector from the unperturbed pose.
    chain.tcp.updateWorldMatrix(true, false);
    chain.tcp.matrixWorld.decompose(_pos, _quat, _scale);
    _dp.subVectors(targetPos, _pos);
    quaternionDelta(_quat, targetQuat, _dr);

    error[0] = _dp.x * opts.posWeight;
    error[1] = _dp.y * opts.posWeight;
    error[2] = _dp.z * opts.posWeight;
    error[3] = _dr.x * rotWeight;
    error[4] = _dr.y * rotWeight;
    error[5] = _dr.z * rotWeight;

    // A = J J^T + lambda^2 I, then dq = J^T A^-1 e.
    const A: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    for (let r = 0; r < 6; r++) {
      for (let c = r; c < 6; c++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += J[r][k] * J[c][k];
        A[r][c] = sum;
        A[c][r] = sum;
      }
      A[r][r] += opts.lambda * opts.lambda;
    }

    const y = solveLinearSystem(A, error);
    if (!y) break;

    let moved = 0;
    for (let i = 0; i < n; i++) {
      let dq = 0;
      for (let r = 0; r < 6; r++) dq += J[r][i] * y[r];
      dq = THREE.MathUtils.clamp(dq, -opts.maxStep, opts.maxStep);
      const next = THREE.MathUtils.clamp(
        q[i] + dq,
        chain.limits[i].lower,
        chain.limits[i].upper
      );
      moved += Math.abs(next - q[i]);
      q[i] = next;
    }

    // Wedged against joint limits or stuck at a stationary point - further
    // iterations would not change anything.
    if (moved < 1e-5) {
      iterations++;
      break;
    }
  }

  applyAngles(chain, q);
  poseError(chain, targetPos, targetQuat);

  return {
    angles: q,
    posError: _dp.length(),
    rotError: _dr.length(),
    iterations,
  };
}

/**
 * Drives the tool frame of `chain` towards a world-space target pose.
 *
 * Each attempt runs a position-only pass followed by an orientation refinement.
 * If that lands outside the position tolerance the solve is retried from
 * progressively more perturbed seeds - a stuck DLS run sits at a stationary
 * point and would otherwise never recover, and at ~0.05 ms per pass there is
 * plenty of room inside the 33 ms control tick.
 *
 * The chain is always restored to the joint values it had on entry - the caller
 * decides whether to commit the result (normally by pushing it through
 * `updateJointsDegrees`).
 */
export function solveIK(
  chain: IKChain,
  targetPos: THREE.Vector3,
  targetQuat: THREE.Quaternion,
  options: IKOptions = {}
): IKResult {
  const opts = { ...DEFAULTS, ...options };
  const startAngles = readChainAngles(chain);

  let best: IKResult | null = null;
  let totalIterations = 0;

  for (let attempt = 0; attempt <= opts.restarts; attempt++) {
    if (attempt === 0) {
      applyAngles(chain, startAngles);
    } else {
      // Widen the search around the current pose, ending with a fully random
      // seed. Staying close for the early retries keeps the arm from jumping.
      const spread = RESTART_SPREADS[Math.min(attempt - 1, RESTART_SPREADS.length - 1)];
      applyAngles(
        chain,
        startAngles.map((angle, i) => {
          const { lower, upper } = chain.limits[i];
          const value =
            spread >= 1
              ? lower + Math.random() * (upper - lower)
              : angle + (Math.random() * 2 - 1) * spread * (upper - lower);
          return THREE.MathUtils.clamp(value, lower, upper);
        })
      );
    }

    const positionPass = runDLS(
      chain,
      targetPos,
      targetQuat,
      opts,
      0,
      opts.maxIterations
    );
    totalIterations += positionPass.iterations;

    let candidate = positionPass;
    if (opts.rotWeight > 0) {
      const refined = runDLS(
        chain,
        targetPos,
        targetQuat,
        opts,
        opts.rotWeight,
        opts.refineIterations
      );
      totalIterations += refined.iterations;
      // Only keep the refinement when it did not trade the position away.
      if (refined.posError <= opts.positionTolerance ||
          refined.posError <= positionPass.posError) {
        candidate = refined;
      }
    }

    if (!best || candidate.posError < best.posError) {
      best = {
        angles: candidate.angles,
        posError: candidate.posError,
        rotError: candidate.rotError,
        reachable: candidate.posError <= opts.positionTolerance,
        iterations: totalIterations,
      };
    }
    if (best.reachable) break;
  }

  // Leave the robot exactly as we found it.
  applyAngles(chain, startAngles);
  chain.tcp.updateWorldMatrix(true, false);

  return (
    best ?? {
      angles: startAngles,
      posError: Infinity,
      rotError: Infinity,
      reachable: false,
      iterations: 0,
    }
  );
}

/** World-space pose of the chain's tool frame. */
export function getTcpPose(
  chain: IKChain,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion
) {
  chain.tcp.updateWorldMatrix(true, false);
  chain.tcp.matrixWorld.decompose(outPos, outQuat, _scale);
}
