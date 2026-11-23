import { PixelBuffer } from "../document/PixelBuffer.ts";
import type { BoneWeightInfluence, BoneWeights } from "./RigEngine.ts";
import {
  type AutoWeightBone,
  autoAssignWeights,
  MAX_WEIGHT_INFLUENCES,
  normalizeInfluences,
} from "./skinning.ts";

/** Supported auto-weighting algorithms for pixel-art sprite rigs. */
export type AutoWeightMethod =
  | "geodesic"
  | "heat"
  | "envelope"
  | "rigid"
  | "euclidean";

/** Bone descriptor extended with optional envelope radius and weight lock. */
export interface AutoWeightBoneV2 extends AutoWeightBone {
  envelopeRadius?: number;
  weightLocked?: boolean;
}

/** Options controlling W0 smart auto-weighting. */
export interface AutoWeightV2Options {
  method?: AutoWeightMethod;
  power?: number;
  colorPenalty?: number;
  maxInfluences?: number;
  heatIterations?: number;
  selectionMask?: Uint8Array | null;
  existingWeights?: BoneWeights | null;
  targetBoneIds?: ReadonlySet<string> | null;
  respectLockedBones?: boolean;
}

/** Default envelope capsule radius derived from bone length (minimum 4 px). */
export function defaultEnvelopeRadius(
  bone: Pick<AutoWeightBone, "x" | "y" | "tipX" | "tipY">
): number {
  return Math.max(4, Math.hypot(bone.tipX - bone.x, bone.tipY - bone.y) * 0.6);
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function colorDiff(data: Uint8ClampedArray, idxA: number, idxB: number): number {
  const a = idxA * 4;
  const b = idxB * 4;
  return (
    (Math.abs(data[a] - data[b]) +
      Math.abs(data[a + 1] - data[b + 1]) +
      Math.abs(data[a + 2] - data[b + 2])) /
    (3 * 255)
  );
}

/** Binary min-heap keyed by priority array for Dijkstra geodesic traversal. */
class IndexMinHeap {
  private heap: number[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(idx: number, dist: Float32Array): void {
    const h = this.heap;
    h.push(idx);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (dist[h[parent]] <= dist[h[i]]) break;
      const tmp = h[parent];
      h[parent] = h[i];
      h[i] = tmp;
      i = parent;
    }
  }

  pop(dist: Float32Array): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      while (true) {
        let smallest = i;
        const left = i * 2 + 1;
        const right = left + 1;
        if (left < n && dist[h[left]] < dist[h[smallest]]) smallest = left;
        if (right < n && dist[h[right]] < dist[h[smallest]]) smallest = right;
        if (smallest === i) break;
        const tmp = h[i];
        h[i] = h[smallest];
        h[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

const NEIGHBORS_8: readonly [number, number, number][] = [
  [-1, 0, 1],
  [1, 0, 1],
  [0, -1, 1],
  [0, 1, 1],
  [-1, -1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, 1, Math.SQRT2],
];

const NEIGHBORS_4: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function collectBoneSeeds(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bones: readonly AutoWeightBoneV2[]
): number[][] {
  const opaqueIndices: number[] = [];
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > 0) opaqueIndices.push(i);
  }
  if (opaqueIndices.length === 0) {
    return bones.map(() => []);
  }

  return bones.map((bone) => {
    const seeds = new Set<number>();
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(bone.tipX - bone.x, bone.tipY - bone.y) * 2)
    );
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const sx = Math.floor(bone.x + (bone.tipX - bone.x) * t);
      const sy = Math.floor(bone.y + (bone.tipY - bone.y) * t);
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
        const idx = sy * width + sx;
        if (data[idx * 4 + 3] > 0) {
          seeds.add(idx);
        }
      }
    }
    if (seeds.size === 0) {
      let bestIdx = opaqueIndices[0];
      let bestDist = Infinity;
      for (const idx of opaqueIndices) {
        const px = (idx % width) + 0.5;
        const py = Math.floor(idx / width) + 0.5;
        const d = distToSegment(px, py, bone.x, bone.y, bone.tipX, bone.tipY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      }
      seeds.add(bestIdx);
    }
    return Array.from(seeds);
  });
}

function euclideanInfluencesForPixel(
  px: number,
  py: number,
  bones: readonly AutoWeightBoneV2[],
  power: number
): BoneWeightInfluence[] {
  const raw: BoneWeightInfluence[] = [];
  for (const bone of bones) {
    const d = distToSegment(px, py, bone.x, bone.y, bone.tipX, bone.tipY);
    const w = 1 / Math.pow(Math.max(0.5, d), power);
    raw.push({ boneId: bone.id, w });
  }
  return normalizeInfluences(raw);
}

function solveGeodesic(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bones: readonly AutoWeightBoneV2[],
  power: number,
  colorPenalty: number
): Map<number, BoneWeightInfluence[]> {
  const total = width * height;
  const seedsPerBone = collectBoneSeeds(width, height, data, bones);
  const distMaps: Float32Array[] = [];
  const penaltyScale = colorPenalty * 8;

  for (let b = 0; b < bones.length; b++) {
    const bone = bones[b];
    const dist = new Float32Array(total);
    dist.fill(Infinity);
    const heap = new IndexMinHeap();

    for (const seedIdx of seedsPerBone[b]) {
      const px = (seedIdx % width) + 0.5;
      const py = Math.floor(seedIdx / width) + 0.5;
      const d0 = Math.max(
        0.05,
        distToSegment(px, py, bone.x, bone.y, bone.tipX, bone.tipY)
      );
      if (d0 < dist[seedIdx]) {
        dist[seedIdx] = d0;
        heap.push(seedIdx, dist);
      }
    }

    while (heap.size > 0) {
      const curr = heap.pop(dist);
      const currDist = dist[curr];
      const cx = curr % width;
      const cy = Math.floor(curr / width);

      for (const [dx, dy, stepLen] of NEIGHBORS_8) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (data[nIdx * 4 + 3] === 0) continue;

        const edge =
          penaltyScale > 0
            ? stepLen * (1 + penaltyScale * colorDiff(data, curr, nIdx))
            : stepLen;
        const nd = currDist + edge;
        if (nd < dist[nIdx]) {
          dist[nIdx] = nd;
          heap.push(nIdx, dist);
        }
      }
    }

    distMaps.push(dist);
  }

  const out = new Map<number, BoneWeightInfluence[]>();
  for (let idx = 0; idx < total; idx++) {
    if (data[idx * 4 + 3] === 0) continue;
    const raw: BoneWeightInfluence[] = [];
    for (let b = 0; b < bones.length; b++) {
      const d = distMaps[b][idx];
      if (!Number.isFinite(d)) continue;
      raw.push({
        boneId: bones[b].id,
        w: 1 / Math.pow(Math.max(0.25, d), power),
      });
    }
    if (raw.length === 0) {
      const px = (idx % width) + 0.5;
      const py = Math.floor(idx / width) + 0.5;
      out.set(idx, euclideanInfluencesForPixel(px, py, bones, power));
    } else {
      out.set(idx, normalizeInfluences(raw));
    }
  }
  return out;
}

function solveHeat(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bones: readonly AutoWeightBoneV2[],
  power: number,
  colorPenalty: number,
  heatIterations: number
): Map<number, BoneWeightInfluence[]> {
  const total = width * height;
  const seedsPerBone = collectBoneSeeds(width, height, data, bones);
  const seedOwners = new Map<number, number[]>();
  for (let b = 0; b < bones.length; b++) {
    for (const idx of seedsPerBone[b]) {
      const list = seedOwners.get(idx);
      if (list) list.push(b);
      else seedOwners.set(idx, [b]);
    }
  }

  const opaquePixels: number[] = [];
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > 0) opaquePixels.push(i);
  }

  const penaltyScale = colorPenalty * 8;
  const heatMaps: Float32Array[] = bones.map(() => new Float32Array(total));

  for (const [idx, owners] of seedOwners) {
    const val = 1 / owners.length;
    for (const b of owners) {
      heatMaps[b][idx] = val;
    }
  }

  for (let iter = 0; iter < heatIterations; iter++) {
    for (const idx of opaquePixels) {
      if (seedOwners.has(idx)) continue;
      const cx = idx % width;
      const cy = Math.floor(idx / width);

      let weightSum = 0;
      const neighborIndices: number[] = [];
      const neighborWeights: number[] = [];

      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (data[nIdx * 4 + 3] === 0) continue;
        const w =
          penaltyScale > 0
            ? 1 / (1 + penaltyScale * colorDiff(data, idx, nIdx))
            : 1;
        neighborIndices.push(nIdx);
        neighborWeights.push(w);
        weightSum += w;
      }

      if (weightSum <= 0) continue;
      for (let b = 0; b < bones.length; b++) {
        const hm = heatMaps[b];
        let acc = 0;
        for (let k = 0; k < neighborIndices.length; k++) {
          acc += hm[neighborIndices[k]] * neighborWeights[k];
        }
        hm[idx] = acc / weightSum;
      }
    }
  }

  const out = new Map<number, BoneWeightInfluence[]>();
  for (const idx of opaquePixels) {
    const raw: BoneWeightInfluence[] = [];
    for (let b = 0; b < bones.length; b++) {
      const h = heatMaps[b][idx];
      if (h > 1e-6) {
        raw.push({ boneId: bones[b].id, w: h });
      }
    }
    if (raw.length === 0) {
      const px = (idx % width) + 0.5;
      const py = Math.floor(idx / width) + 0.5;
      out.set(idx, euclideanInfluencesForPixel(px, py, bones, power));
    } else {
      out.set(idx, normalizeInfluences(raw));
    }
  }
  return out;
}

function solveEnvelope(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bones: readonly AutoWeightBoneV2[],
  power: number
): Map<number, BoneWeightInfluence[]> {
  const total = width * height;
  const radii = bones.map((b) =>
    Math.max(1, b.envelopeRadius ?? defaultEnvelopeRadius(b))
  );
  const out = new Map<number, BoneWeightInfluence[]>();

  for (let idx = 0; idx < total; idx++) {
    if (data[idx * 4 + 3] === 0) continue;
    const px = (idx % width) + 0.5;
    const py = Math.floor(idx / width) + 0.5;
    const raw: BoneWeightInfluence[] = [];

    for (let b = 0; b < bones.length; b++) {
      const bone = bones[b];
      const d = distToSegment(px, py, bone.x, bone.y, bone.tipX, bone.tipY);
      const r = radii[b];
      if (d <= r) {
        const t = d / r;
        const smooth = 1 - (3 * t * t - 2 * t * t * t);
        if (smooth > 1e-4) {
          raw.push({
            boneId: bone.id,
            w: Math.pow(smooth, Math.max(0.5, power * 0.5)),
          });
        }
      }
    }

    if (raw.length === 0) {
      out.set(idx, euclideanInfluencesForPixel(px, py, bones, power));
    } else {
      out.set(idx, normalizeInfluences(raw));
    }
  }
  return out;
}

function solveRigid(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  bones: readonly AutoWeightBoneV2[]
): Map<number, BoneWeightInfluence[]> {
  const total = width * height;
  const visited = new Uint8Array(total);
  const out = new Map<number, BoneWeightInfluence[]>();

  for (let start = 0; start < total; start++) {
    if (visited[start] || data[start * 4 + 3] === 0) continue;

    const component: number[] = [];
    const queue: number[] = [start];
    visited[start] = 1;

    while (queue.length > 0) {
      const curr = queue.pop()!;
      component.push(curr);
      const cx = curr % width;
      const cy = Math.floor(curr / width);
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx] || data[nIdx * 4 + 3] === 0) continue;
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }

    let bestBone = bones[0];
    let bestAvgDist = Infinity;
    for (const bone of bones) {
      let sumDist = 0;
      for (const idx of component) {
        const px = (idx % width) + 0.5;
        const py = Math.floor(idx / width) + 0.5;
        sumDist += distToSegment(px, py, bone.x, bone.y, bone.tipX, bone.tipY);
      }
      const avgDist = sumDist / component.length;
      if (avgDist < bestAvgDist) {
        bestAvgDist = avgDist;
        bestBone = bone;
      }
    }

    for (const idx of component) {
      out.set(idx, [{ boneId: bestBone.id, w: 1 }]);
    }
  }
  return out;
}

/**
 * Compute smooth or rigid skinning weights using silhouette- and color-aware
 * solvers while optionally preserving selection-masked and weight-locked bones.
 */
export function computeAutoWeightsV2(
  src: PixelBuffer,
  bones: readonly AutoWeightBoneV2[],
  options: AutoWeightV2Options = {}
): BoneWeights {
  if (bones.length === 0) {
    return { width: src.width, height: src.height, entries: new Map() };
  }

  const method = options.method ?? "geodesic";
  const power = Math.max(0.25, options.power ?? 2);
  const colorPenalty = Math.max(0, options.colorPenalty ?? 0.35);
  const maxInfluences = Math.max(
    1,
    Math.min(
      MAX_WEIGHT_INFLUENCES,
      Math.round(options.maxInfluences ?? MAX_WEIGHT_INFLUENCES)
    )
  );
  const heatIterations = Math.max(8, Math.round(options.heatIterations ?? 120));
  const selectionMask = options.selectionMask ?? null;
  const existingWeights = options.existingWeights ?? null;
  const respectLockedBones = options.respectLockedBones ?? true;
  const targetBoneIds =
    options.targetBoneIds && options.targetBoneIds.size > 0
      ? options.targetBoneIds
      : null;

  const lockedBoneIds = new Set<string>();
  if (respectLockedBones) {
    for (const bone of bones) {
      if (bone.weightLocked) lockedBoneIds.add(bone.id);
    }
  }

  const solveBones = bones.filter((bone) => {
    if (lockedBoneIds.has(bone.id)) return false;
    if (targetBoneIds && !targetBoneIds.has(bone.id)) return false;
    return true;
  });

  if (solveBones.length === 0) {
    const cloned = new Map<number, BoneWeightInfluence[]>();
    if (existingWeights) {
      for (const [idx, infs] of existingWeights.entries) {
        cloned.set(
          idx,
          infs.map((inf) => ({ ...inf }))
        );
      }
    }
    return { width: src.width, height: src.height, entries: cloned };
  }

  const solveBoneSet = new Set(solveBones.map((b) => b.id));
  const needsPartialMerge =
    existingWeights !== null &&
    (selectionMask !== null ||
      lockedBoneIds.size > 0 ||
      targetBoneIds !== null);

  let solvedEntries: Map<number, BoneWeightInfluence[]>;
  if (method === "euclidean") {
    solvedEntries =
      autoAssignWeights(src, solveBones, {
        falloffPower: power,
        maxInfluences,
      })?.entries ?? new Map();
  } else if (method === "heat") {
    solvedEntries = solveHeat(
      src.width,
      src.height,
      src.data,
      solveBones,
      power,
      colorPenalty,
      heatIterations
    );
  } else if (method === "envelope") {
    solvedEntries = solveEnvelope(
      src.width,
      src.height,
      src.data,
      solveBones,
      power
    );
  } else if (method === "rigid") {
    solvedEntries = solveRigid(src.width, src.height, src.data, solveBones);
  } else {
    solvedEntries = solveGeodesic(
      src.width,
      src.height,
      src.data,
      solveBones,
      power,
      colorPenalty
    );
  }

  if (!needsPartialMerge && !selectionMask) {
    return { width: src.width, height: src.height, entries: solvedEntries };
  }

  const total = src.width * src.height;
  const entries = new Map<number, BoneWeightInfluence[]>();

  for (let idx = 0; idx < total; idx++) {
    if (src.data[idx * 4 + 3] === 0) continue;

    const existing = existingWeights?.entries.get(idx);
    if (selectionMask && selectionMask[idx] === 0) {
      if (existing && existing.length > 0) {
        entries.set(
          idx,
          existing.map((inf) => ({ ...inf }))
        );
      }
      continue;
    }

    const preserved: BoneWeightInfluence[] = [];
    if (existing) {
      for (const inf of existing) {
        if (!solveBoneSet.has(inf.boneId) && inf.w > 1e-6) {
          preserved.push({ ...inf });
        }
      }
    }

    if (preserved.length === 0) {
      const infs = solvedEntries.get(idx);
      if (infs && infs.length > 0) {
        entries.set(idx, infs);
      }
      continue;
    }

    const preservedSum = preserved.reduce((acc, inf) => acc + inf.w, 0);
    if (preservedSum >= 1 - 1e-4) {
      entries.set(idx, normalizeInfluences(preserved));
      continue;
    }

    const remaining = 1 - preservedSum;
    const newInfs = solvedEntries.get(idx) ?? [];
    const merged: BoneWeightInfluence[] = [...preserved];
    for (const inf of newInfs) {
      merged.push({ boneId: inf.boneId, w: inf.w * remaining });
    }
    entries.set(idx, normalizeInfluences(merged));
  }

  return { width: src.width, height: src.height, entries };
}
