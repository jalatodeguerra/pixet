import type { Quat, Vec3 } from "./types.ts";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len <= 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function snapToGrid(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const snapped = Math.round(value / step) * step;
  // Clean floating point noise (e.g. 0.25 * 3 = 0.7500000000000001)
  return Math.abs(snapped) < 1e-12 ? 0 : Math.round(snapped * 1e6) / 1e6;
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len <= 1e-12) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Converts Euler XYZ angles (in degrees, intrinsic XYZ / extrinsic ZYX, matching Three.js "XYZ" order)
 * to a unit quaternion [x, y, z, w].
 */
export function eulerDegToQuat(eulerDeg: Vec3): Quat {
  const hx = eulerDeg[0] * DEG_TO_RAD * 0.5;
  const hy = eulerDeg[1] * DEG_TO_RAD * 0.5;
  const hz = eulerDeg[2] * DEG_TO_RAD * 0.5;

  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);

  return quatNormalize([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
}

/**
 * Converts a unit quaternion [x, y, z, w] back to Euler XYZ degrees (matching Three.js "XYZ" order).
 */
export function quatToEulerDeg(q: Quat): Vec3 {
  const [x, y, z, w] = quatNormalize(q);

  // Rotation matrix elements for XYZ extraction
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);

  const clampedM13 = Math.max(-1, Math.min(1, m13));
  const ry = Math.asin(clampedM13);
  let rx: number;
  let rz: number;

  if (Math.abs(clampedM13) < 0.999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }

  return [rx * RAD_TO_DEG, ry * RAD_TO_DEG, rz * RAD_TO_DEG];
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  const clampedT = Math.max(0, Math.min(1, t));
  const qa = quatNormalize(a);
  let qb = quatNormalize(b);

  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (dot < 0) {
    qb = [-qb[0], -qb[1], -qb[2], -qb[3]];
    dot = -dot;
  }

  if (dot > 0.9995) {
    return quatNormalize([
      qa[0] + (qb[0] - qa[0]) * clampedT,
      qa[1] + (qb[1] - qa[1]) * clampedT,
      qa[2] + (qb[2] - qa[2]) * clampedT,
      qa[3] + (qb[3] - qa[3]) * clampedT,
    ]);
  }

  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta0 = Math.sin(theta0);
  const theta = theta0 * clampedT;
  const sinTheta = Math.sin(theta);

  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;

  return quatNormalize([
    qa[0] * s0 + qb[0] * s1,
    qa[1] * s0 + qb[1] * s1,
    qa[2] * s0 + qb[2] * s1,
    qa[3] * s0 + qb[3] * s1,
  ]);
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = quatNormalize(q);
  const [vx, vy, vz] = v;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  // v' = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
