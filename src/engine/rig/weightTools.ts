import { PixelBuffer } from "../document/PixelBuffer.ts";
import type { Bone, BoneWeightInfluence, BoneWeights } from "./RigEngine.ts";
import { mirrorBoneName } from "./skeletonTools.ts";
import {
  normalizeInfluencesWithLocks,
  setBoneWeightNormalizedWithLocks,
} from "./skinning.ts";

export interface WeightSelectionMask {
  contains(x: number, y: number): boolean;
}

export interface WeightGradientOptions {
  falloff?: "linear" | "smoothstep";
  strength?: number;
  selectionMask?: WeightSelectionMask | null;
  lockedBoneIds?: ReadonlySet<string> | null;
}

export interface WeightFloodOptions {
  colorTolerance?: number;
  contiguous?: boolean;
  selectionMask?: WeightSelectionMask | null;
  lockedBoneIds?: ReadonlySet<string> | null;
}

export interface WeightGlobalOptions {
  selectionMask?: WeightSelectionMask | null;
  lockedBoneIds?: ReadonlySet<string> | null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function boneWeightOf(
  influences: readonly BoneWeightInfluence[] | undefined,
  boneId: string
): number {
  if (!influences) return 0;
  for (const inf of influences) {
    if (inf.boneId === boneId) return inf.w;
  }
  return 0;
}

/**
 * Applies a linear or smoothstep weight gradient for `boneId` along `(x0, y0) -> (x1, y1)`.
 * Pixels near `(x0, y0)` blend toward `1.0 * strength`; pixels near `(x1, y1)` blend toward `0.0`.
 */
export function applyWeightGradient(
  weights: BoneWeights,
  src: PixelBuffer,
  boneId: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  opts: WeightGradientOptions = {}
): BoneWeights {
  const locked = opts.lockedBoneIds ?? null;
  if (locked?.has(boneId)) return weights;

  const falloff = opts.falloff ?? "linear";
  const strength = clamp01(opts.strength ?? 1);
  const mask = opts.selectionMask ?? null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  const w = Math.min(weights.width, src.width);
  const h = Math.min(weights.height, src.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask && !mask.contains(x, y)) continue;
      const idx = y * w + x;
      if (src.data[idx * 4 + 3] === 0) continue;

      const t =
        lenSq < 1e-6
          ? 0
          : clamp01(((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / lenSq);
      const raw = 1 - t;
      const desired =
        falloff === "smoothstep" ? raw * raw * (3 - 2 * raw) : raw;

      const current = weights.entries.get(idx) ?? [];
      const curW = boneWeightOf(current, boneId);
      const target = curW + (desired - curW) * strength;
      const next = setBoneWeightNormalizedWithLocks(
        current,
        boneId,
        target,
        locked
      );
      if (next.length === 0) weights.entries.delete(idx);
      else weights.entries.set(idx, next);
    }
  }
  return weights;
}

/**
 * Flood-fills `boneId` to `targetWeight` across opaque pixels matching the
 * seed pixel's RGB within `colorTolerance` (contiguous 4-connected BFS by default).
 */
export function floodFillWeights(
  weights: BoneWeights,
  src: PixelBuffer,
  boneId: string,
  startX: number,
  startY: number,
  targetWeight: number,
  opts: WeightFloodOptions = {}
): BoneWeights {
  const locked = opts.lockedBoneIds ?? null;
  if (locked?.has(boneId)) return weights;

  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  const w = Math.min(weights.width, src.width);
  const h = Math.min(weights.height, src.height);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return weights;

  const mask = opts.selectionMask ?? null;
  if (mask && !mask.contains(sx, sy)) return weights;

  const seedIdx = sy * w + sx;
  const seedBase = seedIdx * 4;
  if (src.data[seedBase + 3] === 0) return weights;

  const r0 = src.data[seedBase];
  const g0 = src.data[seedBase + 1];
  const b0 = src.data[seedBase + 2];
  const maxDelta = Math.max(0, opts.colorTolerance ?? 0) * 3;
  const target = clamp01(targetWeight);
  const contiguous = opts.contiguous ?? true;

  const matches = (idx: number): boolean => {
    const p = idx * 4;
    if (src.data[p + 3] === 0) return false;
    const delta =
      Math.abs(src.data[p] - r0) +
      Math.abs(src.data[p + 1] - g0) +
      Math.abs(src.data[p + 2] - b0);
    return delta <= maxDelta;
  };

  const paintPixel = (idx: number) => {
    const current = weights.entries.get(idx) ?? [];
    const next = setBoneWeightNormalizedWithLocks(
      current,
      boneId,
      target,
      locked
    );
    if (next.length === 0) weights.entries.delete(idx);
    else weights.entries.set(idx, next);
  };

  if (!contiguous) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask && !mask.contains(x, y)) continue;
        const idx = y * w + x;
        if (matches(idx)) paintPixel(idx);
      }
    }
    return weights;
  }

  const visited = new Uint8Array(w * h);
  const queue: number[] = [seedIdx];
  visited[seedIdx] = 1;

  while (queue.length > 0) {
    const curr = queue.pop()!;
    paintPixel(curr);
    const cx = curr % w;
    const cy = Math.floor(curr / w);
    const neighbors: [number, number][] = [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (mask && !mask.contains(nx, ny)) continue;
      const nIdx = ny * w + nx;
      if (visited[nIdx] || !matches(nIdx)) continue;
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }
  return weights;
}

/** Resolves the L/R counterpart bone ID via `mirrorBoneName`, or returns `boneId`. */
export function resolveMirroredBoneId(
  bones: readonly Pick<Bone, "id" | "name">[],
  boneId: string
): string {
  const src = bones.find((b) => b.id === boneId);
  if (!src) return boneId;
  const mirroredName = mirrorBoneName(src.name).toLowerCase();
  const match = bones.find((b) => b.name.toLowerCase() === mirroredName);
  return match ? match.id : boneId;
}

/**
 * Mirrors all weights across `axisX` from `LtoR` (`x < axisX`) or `RtoL` (`x > axisX`),
 * remapping bone IDs via `resolveMirroredBoneId` and preserving locked destination bones.
 */
export function mirrorBoneWeights(
  weights: BoneWeights,
  bones: readonly Pick<Bone, "id" | "name">[],
  direction: "LtoR" | "RtoL",
  axisX: number,
  lockedBoneIds?: ReadonlySet<string> | null
): BoneWeights {
  const w = weights.width;
  const mirroredMap = new Map<string, string>();
  for (const b of bones) {
    mirroredMap.set(b.id, resolveMirroredBoneId(bones, b.id));
  }

  const updates = new Map<number, BoneWeightInfluence[]>();
  for (const [idx, infs] of weights.entries) {
    const x = idx % w;
    const y = Math.floor(idx / w);
    if (direction === "LtoR" && x >= axisX) continue;
    if (direction === "RtoL" && x <= axisX) continue;

    const mx = Math.round(2 * axisX - 1 - x);
    if (mx < 0 || mx >= w) continue;
    const dstIdx = y * w + mx;

    const remapped: BoneWeightInfluence[] = [];
    for (const inf of infs) {
      const targetId = mirroredMap.get(inf.boneId) ?? inf.boneId;
      if (lockedBoneIds?.has(targetId)) continue;
      remapped.push({ boneId: targetId, w: inf.w });
    }

    const existingDst = weights.entries.get(dstIdx) ?? [];
    const preservedLocked: BoneWeightInfluence[] = [];
    if (lockedBoneIds && lockedBoneIds.size > 0) {
      for (const inf of existingDst) {
        if (lockedBoneIds.has(inf.boneId)) {
          preservedLocked.push({ boneId: inf.boneId, w: inf.w });
        }
      }
    }

    const normalized = normalizeInfluencesWithLocks(
      [...preservedLocked, ...remapped],
      lockedBoneIds
    );
    updates.set(dstIdx, normalized);
  }

  for (const [dstIdx, infs] of updates) {
    if (infs.length === 0) weights.entries.delete(dstIdx);
    else weights.entries.set(dstIdx, infs);
  }
  return weights;
}

/** Sets all opaque (or selected) pixels to `targetWeight` for `boneId`. */
export function floodBoneWeights(
  weights: BoneWeights,
  src: PixelBuffer,
  boneId: string,
  targetWeight: number,
  opts: WeightGlobalOptions = {}
): BoneWeights {
  const locked = opts.lockedBoneIds ?? null;
  if (locked?.has(boneId)) return weights;
  const mask = opts.selectionMask ?? null;
  const target = clamp01(targetWeight);
  const w = Math.min(weights.width, src.width);
  const h = Math.min(weights.height, src.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask && !mask.contains(x, y)) continue;
      const idx = y * w + x;
      if (src.data[idx * 4 + 3] === 0) continue;
      const current = weights.entries.get(idx) ?? [];
      const next = setBoneWeightNormalizedWithLocks(
        current,
        boneId,
        target,
        locked
      );
      if (next.length === 0) weights.entries.delete(idx);
      else weights.entries.set(idx, next);
    }
  }
  return weights;
}

/** Global Laplacian relaxation across all opaque (or selected) pixels. */
export function smoothAllWeights(
  weights: BoneWeights,
  src: PixelBuffer,
  iterations = 2,
  strength = 0.5,
  opts: WeightGlobalOptions = {}
): BoneWeights {
  const locked = opts.lockedBoneIds ?? null;
  const mask = opts.selectionMask ?? null;
  const amt = clamp01(strength);
  const iters = Math.max(1, Math.round(iterations));
  const w = Math.min(weights.width, src.width);
  const h = Math.min(weights.height, src.height);

  for (let iter = 0; iter < iters; iter++) {
    const nextEntries = new Map<number, BoneWeightInfluence[]>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (src.data[idx * 4 + 3] === 0) continue;
        if (mask && !mask.contains(x, y)) continue;

        const current = weights.entries.get(idx) ?? [];
        const avg = new Map<string, number>();
        let samples = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= h) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= w) continue;
            const nIdx = ny * w + nx;
            if (src.data[nIdx * 4 + 3] === 0) continue;
            samples++;
            const nInfs = weights.entries.get(nIdx);
            if (!nInfs) continue;
            for (const inf of nInfs) {
              avg.set(inf.boneId, (avg.get(inf.boneId) ?? 0) + inf.w);
            }
          }
        }
        if (samples === 0) continue;
        const curMap = new Map<string, number>();
        for (const inf of current) curMap.set(inf.boneId, inf.w);

        const blended: BoneWeightInfluence[] = [];
        const ids = new Set<string>([...curMap.keys(), ...avg.keys()]);
        for (const id of ids) {
          const now = curMap.get(id) ?? 0;
          if (locked?.has(id)) {
            if (now > 1e-5) blended.push({ boneId: id, w: now });
            continue;
          }
          const target = (avg.get(id) ?? 0) / samples;
          const val = now + (target - now) * amt;
          if (val > 1e-5) blended.push({ boneId: id, w: val });
        }
        const normalized = normalizeInfluencesWithLocks(blended, locked);
        if (normalized.length > 0) nextEntries.set(idx, normalized);
      }
    }
    for (const [idx, infs] of nextEntries) {
      weights.entries.set(idx, infs);
    }
  }
  return weights;
}

/**
 * Snaps unlocked weights to multiples of `step` (e.g. `0.25` or `1.0`).
 * When `step >= 1`, each pixel's unlocked weight collapses to its dominant bone,
 * restoring `weightsAreHard === true` when no locked bones split it.
 */
export function quantizeWeights(
  weights: BoneWeights,
  step = 0.25,
  lockedBoneIds?: ReadonlySet<string> | null
): BoneWeights {
  const s = Math.max(0.05, step);
  for (const [idx, infs] of weights.entries) {
    if (infs.length === 0) continue;
    const locked: BoneWeightInfluence[] = [];
    const unlocked: BoneWeightInfluence[] = [];
    for (const inf of infs) {
      if (lockedBoneIds?.has(inf.boneId)) locked.push({ ...inf });
      else unlocked.push({ ...inf });
    }
    if (unlocked.length === 0) continue;

    if (s >= 0.99) {
      unlocked.sort((a, b) => b.w - a.w || a.boneId.localeCompare(b.boneId));
      const dominant = { boneId: unlocked[0].boneId, w: 1 };
      weights.entries.set(
        idx,
        normalizeInfluencesWithLocks([...locked, dominant], lockedBoneIds)
      );
      continue;
    }

    const quantized = unlocked
      .map((inf) => ({
        boneId: inf.boneId,
        w: Math.round(inf.w / s) * s,
      }))
      .filter((inf) => inf.w > 1e-5);
    if (quantized.length === 0) {
      unlocked.sort((a, b) => b.w - a.w);
      quantized.push({ boneId: unlocked[0].boneId, w: 1 });
    }
    weights.entries.set(
      idx,
      normalizeInfluencesWithLocks([...locked, ...quantized], lockedBoneIds)
    );
  }
  return weights;
}

/** Drops unlocked influences below `threshold` and re-normalizes to sum = 1. */
export function pruneWeights(
  weights: BoneWeights,
  threshold = 0.05,
  lockedBoneIds?: ReadonlySet<string> | null
): BoneWeights {
  const minW = clamp01(threshold);
  for (const [idx, infs] of weights.entries) {
    const kept = infs.filter(
      (inf) => lockedBoneIds?.has(inf.boneId) || inf.w >= minW
    );
    const next = normalizeInfluencesWithLocks(kept, lockedBoneIds);
    if (next.length === 0) weights.entries.delete(idx);
    else weights.entries.set(idx, next);
  }
  return weights;
}

/**
 * Replaces `boneId`'s weight `w` with `1 - w` on all opaque pixels. If
 * `targetBoneId` is given, the previous weight `w` is shifted toward `targetBoneId`.
 */
export function invertBoneWeights(
  weights: BoneWeights,
  src: PixelBuffer,
  boneId: string,
  targetBoneId?: string | null,
  lockedBoneIds?: ReadonlySet<string> | null
): BoneWeights {
  if (lockedBoneIds?.has(boneId)) return weights;
  const w = Math.min(weights.width, src.width);
  const h = Math.min(weights.height, src.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (src.data[idx * 4 + 3] === 0) continue;
      const current = weights.entries.get(idx) ?? [];
      const curW = boneWeightOf(current, boneId);
      const inverted = clamp01(1 - curW);
      let next = setBoneWeightNormalizedWithLocks(
        current,
        boneId,
        inverted,
        lockedBoneIds
      );
      if (targetBoneId && targetBoneId !== boneId && !lockedBoneIds?.has(targetBoneId)) {
        const targetCur = boneWeightOf(next, targetBoneId);
        next = setBoneWeightNormalizedWithLocks(
          next,
          targetBoneId,
          clamp01(targetCur + curW),
          lockedBoneIds
        );
      }
      if (next.length === 0) weights.entries.delete(idx);
      else weights.entries.set(idx, next);
    }
  }
  return weights;
}

/** Transfers all weight influences from `fromBoneId` to `toBoneId`. */
export function transferBoneWeights(
  weights: BoneWeights,
  fromBoneId: string,
  toBoneId: string
): BoneWeights {
  if (fromBoneId === toBoneId) return weights;
  for (const [idx, infs] of weights.entries) {
    let changed = false;
    const mapped = infs.map((inf) => {
      if (inf.boneId === fromBoneId) {
        changed = true;
        return { boneId: toBoneId, w: inf.w };
      }
      return inf;
    });
    if (changed) {
      weights.entries.set(idx, normalizeInfluencesWithLocks(mapped, null));
    }
  }
  return weights;
}
