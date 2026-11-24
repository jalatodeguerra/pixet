/**
 * Pure 3x3 rotation matrix and Euler angle utilities shared by 3D sprite
 * rendering (`rotate3d.ts`) and 3D bone/rig FK (`RigEngine.ts`).
 *
 * Row-major Mat3 layout:
 *   [m00, m01, m02,
 *    m10, m11, m12,
 *    m20, m21, m22]
 *
 * Rotation convention: R = Rz(roll) * Rx(pitch) * Ry(yaw).
 *
 * React-free; explicit `.ts` relative imports for `node --test`.
 */

export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface EulerDeg {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Normalizes an angle in degrees to the range (-180, 180]. */
export function normalizeDeg180(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a === 0 ? 0 : a;
}

/** Returns the 3x3 identity matrix. */
export function mat3Identity(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

/**
 * Builds a 3x3 rotation matrix using R = Rz(roll) * Rx(pitch) * Ry(yaw).
 */
export function mat3FromEulerDeg(
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number
): Mat3 {
  const yaw = yawDeg * DEG_TO_RAD;
  const pitch = pitchDeg * DEG_TO_RAD;
  const roll = rollDeg * DEG_TO_RAD;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  // A = Rx(pitch) * Ry(yaw)
  const a00 = cy;
  const a02 = sy;
  const a10 = sp * sy;
  const a11 = cp;
  const a12 = -sp * cy;
  const a20 = -cp * sy;
  const a21 = sp;
  const a22 = cp * cy;

  // R = Rz(roll) * A
  const r00 = cr * a00 - sr * a10;
  const r01 = -sr * a11;
  const r02 = cr * a02 - sr * a12;
  const r10 = sr * a00 + cr * a10;
  const r11 = cr * a11;
  const r12 = sr * a02 + cr * a12;
  const r20 = a20;
  const r21 = a21;
  const r22 = a22;

  return [r00, r01, r02, r10, r11, r12, r20, r21, r22];
}

/** Multiplies two 3x3 row-major matrices: A * B. */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** Returns the transpose of a 3x3 matrix (inverse for orthonormal rotation matrices). */
export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Multiplies a 3x3 matrix by a 3D column vector: M * [x, y, z]^T. */
export function mat3MulVec(
  m: Mat3,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** Multiplies the transpose of a 3x3 matrix by a 3D column vector: M^T * [x, y, z]^T. */
export function mat3TransposeMulVec(
  m: Mat3,
  x: number,
  y: number,
  z: number
): [number, number, number] {
  return [
    m[0] * x + m[3] * y + m[6] * z,
    m[1] * x + m[4] * y + m[7] * z,
    m[2] * x + m[5] * y + m[8] * z,
  ];
}

/**
 * Extracts Euler angles (in degrees) from a rotation matrix produced by
 * R = Rz(roll) * Rx(pitch) * Ry(yaw), handling gimbal lock near pitch = ±90°.
 */
export function mat3ExtractEulerDeg(m: Mat3): EulerDeg {
  const sinPitch = Math.max(-1, Math.min(1, m[7]));
  const pitch = Math.asin(sinPitch);

  let yaw: number;
  let roll: number;

  if (Math.abs(sinPitch) < 0.999999) {
    yaw = Math.atan2(-m[6], m[8]);
    roll = Math.atan2(-m[1], m[4]);
  } else {
    // Gimbal lock: cos(pitch) ≈ 0, attribute combined rotation to roll.
    yaw = 0;
    roll = Math.atan2(m[3], m[0]);
  }

  return {
    yawDeg: normalizeDeg180(yaw * RAD_TO_DEG),
    pitchDeg: normalizeDeg180(pitch * RAD_TO_DEG),
    rollDeg: normalizeDeg180(roll * RAD_TO_DEG),
  };
}

/**
 * Returns the Z-facing component (r22 = m[8]) of a rotation matrix.
 * Positive values face the viewer (+Z), negative values face away (-Z).
 */
export function mat3FacingZ(m: Mat3): number {
  return m[8];
}
