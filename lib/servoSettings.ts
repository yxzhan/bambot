// Follower servo settings, persisted per browser.

/**
 * Acceleration written to every position-mode servo (STS3215 register 41,
 * units of 100 steps/s^2, i.e. ~8.8 deg/s^2; 0 means unlimited). Control
 * modes stream a new target every ~33 ms, and with no acceleration limit the
 * servo starts and stops hard on each one, which shows as jitter. Lower is
 * smoother but lags more.
 */
export const MIN_SERVO_ACCELERATION = 0;
export const MAX_SERVO_ACCELERATION = 100;
export const DEFAULT_SERVO_ACCELERATION = 20;

const ACCELERATION_KEY = "servo_acceleration";

export function getServoAccelerationFromLocalStorage(): number {
  if (typeof window === "undefined") return DEFAULT_SERVO_ACCELERATION;
  try {
    const stored = localStorage.getItem(ACCELERATION_KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isFinite(value)
      ? Math.min(MAX_SERVO_ACCELERATION, Math.max(MIN_SERVO_ACCELERATION, Math.round(value)))
      : DEFAULT_SERVO_ACCELERATION;
  } catch {
    return DEFAULT_SERVO_ACCELERATION;
  }
}

export function setServoAccelerationToLocalStorage(value: number) {
  try {
    localStorage.setItem(ACCELERATION_KEY, String(value));
  } catch (error) {
    console.warn("Failed to persist servo acceleration:", error);
  }
}
