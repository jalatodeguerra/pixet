import type { Bone } from "./RigEngine.ts";

export interface Vec2 {
  x: number;
  y: number;
}

export interface FabrikAngleLimit {
  minDeg?: number;
  maxDeg?: number;
}

export interface FabrikResult {
  points: Vec2[];
  localRotationsDeg: number[];
}

function normalizeDeg(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

function clampSegmentAngle(
  limit: FabrikAngleLimit | undefined,
  prevWorldDeg: number,
  rawWorldDeg: number
): number {
  if (!limit || (limit.minDeg === undefined && limit.maxDeg === undefined)) {
    return rawWorldDeg;
  }
  let local = normalizeDeg(rawWorldDeg - prevWorldDeg);
  if (limit.minDeg !== undefined && local < limit.minDeg) local = limit.minDeg;
  if (limit.maxDeg !== undefined && local > limit.maxDeg) local = limit.maxDeg;
  return prevWorldDeg + local;
}

/**
 * Solves an N-bone IK chain using FABRIK (Forward And Backward Reaching
 * Inverse Kinematics) with optional per-bone local angle limits.
 *
 * `chainWorldPoints` has length `N + 1` (`[joint_0, ..., joint_{N-1}, tip]`)
 * and `lengths` has length `N`.
 */
export function solveFabrik(
  chainWorldPoints: readonly Vec2[],
  lengths: readonly number[],
  target: Vec2,
  iterations = 12,
  tolerance = 0.01,
  angleLimits?: readonly (FabrikAngleLimit | undefined)[],
  parentWorldDeg = 0
): FabrikResult {
  const n = lengths.length;
  if (n === 0 || chainWorldPoints.length < n + 1) {
    return {
      points: chainWorldPoints.map((p) => ({ x: p.x, y: p.y })),
      localRotationsDeg: [],
    };
  }

  const pts: Vec2[] = chainWorldPoints
    .slice(0, n + 1)
    .map((p) => ({ x: p.x, y: p.y }));
  const root: Vec2 = { x: pts[0].x, y: pts[0].y };
  const totalLength = lengths.reduce((sum, len) => sum + Math.max(0.001, len), 0);
  const distToTarget = Math.hypot(target.x - root.x, target.y - root.y);
  const hasLimits = Boolean(
    angleLimits?.some(
      (lim) => lim && (lim.minDeg !== undefined || lim.maxDeg !== undefined)
    )
  );

  if (distToTarget >= totalLength - 1e-6) {
    const baseWorldDeg =
      distToTarget > 1e-6
        ? (Math.atan2(target.y - root.y, target.x - root.x) * 180) / Math.PI
        : parentWorldDeg;
    let prevWorldDeg = parentWorldDeg;
    for (let i = 0; i < n; i++) {
      const len = Math.max(0.001, lengths[i]);
      const worldDeg = hasLimits
        ? clampSegmentAngle(angleLimits?.[i], prevWorldDeg, baseWorldDeg)
        : baseWorldDeg;
      const rad = (worldDeg * Math.PI) / 180;
      pts[i + 1] = {
        x: pts[i].x + Math.cos(rad) * len,
        y: pts[i].y + Math.sin(rad) * len,
      };
      prevWorldDeg = worldDeg;
    }
  } else {
    const maxIter = Math.max(1, Math.floor(iterations));
    for (let iter = 0; iter < maxIter; iter++) {
      if (Math.hypot(pts[n].x - target.x, pts[n].y - target.y) <= tolerance) {
        break;
      }

      // Forward pass: pull tip to target and pull joints toward tip.
      pts[n] = { x: target.x, y: target.y };
      for (let i = n - 1; i >= 0; i--) {
        const len = Math.max(0.001, lengths[i]);
        const dx = pts[i].x - pts[i + 1].x;
        const dy = pts[i].y - pts[i + 1].y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) {
          pts[i] = {
            x: pts[i + 1].x + (dx / d) * len,
            y: pts[i + 1].y + (dy / d) * len,
          };
        } else {
          pts[i] = { x: pts[i + 1].x - len, y: pts[i + 1].y };
        }
      }

      // Backward pass: pin root and push joints outward, enforcing angle limits.
      pts[0] = { x: root.x, y: root.y };
      let prevWorldDeg = parentWorldDeg;
      for (let i = 0; i < n; i++) {
        const len = Math.max(0.001, lengths[i]);
        const dx = pts[i + 1].x - pts[i].x;
        const dy = pts[i + 1].y - pts[i].y;
        const rawWorldDeg =
          Math.hypot(dx, dy) > 1e-6
            ? (Math.atan2(dy, dx) * 180) / Math.PI
            : prevWorldDeg;
        const clampedWorldDeg = clampSegmentAngle(
          angleLimits?.[i],
          prevWorldDeg,
          rawWorldDeg
        );
        const rad = (clampedWorldDeg * Math.PI) / 180;
        pts[i + 1] = {
          x: pts[i].x + Math.cos(rad) * len,
          y: pts[i].y + Math.sin(rad) * len,
        };
        prevWorldDeg = clampedWorldDeg;
      }
    }
  }

  const localRotationsDeg: number[] = [];
  let prevDeg = parentWorldDeg;
  for (let i = 0; i < n; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const worldDeg =
      Math.hypot(dx, dy) > 1e-6
        ? (Math.atan2(dy, dx) * 180) / Math.PI
        : prevDeg;
    localRotationsDeg.push(normalizeDeg(worldDeg - prevDeg));
    prevDeg = worldDeg;
  }

  return { points: pts, localRotationsDeg };
}

/**
 * Computes the local rotation (in degrees) so a bone's +X axis points at
 * `(targetX, targetY)` plus `offsetDeg`.
 */
export function computeAimLocalAngleDeg(
  jointX: number,
  jointY: number,
  targetX: number,
  targetY: number,
  offsetDeg: number,
  parentWorldDeg: number
): number {
  const desiredWorldDeg =
    (Math.atan2(targetY - jointY, targetX - jointX) * 180) / Math.PI +
    offsetDeg;
  return normalizeDeg(desiredWorldDeg - parentWorldDeg);
}

/**
 * Walks up `parentId` from `tipBoneId` up to `maxLength` bones and returns
 * the chain in root -> tip order.
 */
export function detectIkChainForBone(
  bones: readonly Bone[],
  tipBoneId: string,
  maxLength = 3
): string[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  const chain: string[] = [];
  const visited = new Set<string>();
  let cur: Bone | undefined = byId.get(tipBoneId);
  const limit = Math.max(1, Math.floor(maxLength));
  while (cur && chain.length < limit && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.unshift(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}
