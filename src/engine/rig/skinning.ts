import { PixelBuffer } from "../document/PixelBuffer.ts";
import type {
  BoneWeightInfluence,
  BoneWeights,
  BoneWorldTransform,
} from "./RigEngine.ts";

/**
 * R6 — smooth skin weights (brush + auto weights) and per-pixel linear blend
 * skinning (LBS) by inverse triangle mapping.
 *
 * React-free. Relative imports use explicit `.ts` extensions so `node --test`
 * can load this module directly. `RigEngine` is imported type-only to avoid a
 * runtime import cycle (RigEngine runtime-imports this module).
 */

export type WeightBrushMode = "add" | "subtract" | "smooth" | "replace";
export type WeightFalloff = "hard" | "linear";

/** R0 hard cap on influences per pixel. */
export const MAX_WEIGHT_INFLUENCES = 4;

/** Weights at/above this are treated as a hard single-bone bind. */
export const HARD_WEIGHT_THRESHOLD = 0.99;

/** Default spacing (px) of the forward-mapped lattice used for LBS. */
export const DEFAULT_SKIN_LATTICE_STEP = 3;

export interface WeightPaintOptions {
  /** Brush center in cel pixels. */
  cx: number;
  cy: number;
  /** Brush radius in pixels (0.5 = one pixel). */
  radius: number;
  /** 0..1 brush strength. */
  strength: number;
  mode: WeightBrushMode;
  falloff: WeightFalloff;
}

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoWeightBone {
  id: string;
  x: number;
  y: number;
  tipX: number;
  tipY: number;
}

export interface AutoWeightOptions {
  /** Defaults to MAX_WEIGHT_INFLUENCES. */
  maxInfluences?: number;
  /** Inverse-distance exponent, default 2. */
  falloffPower?: number;
}

export interface BoneTransformPair {
  rest: BoneWorldTransform;
  posed: BoneWorldTransform;
}

export type BoneTransformMap = ReadonlyMap<string, BoneTransformPair>;

/** Precomputed per-bone rotation/translation for fast point LBS. */
export interface BoneDeformEntry {
  boneId: string;
  restX: number;
  restY: number;
  posedX: number;
  posedY: number;
  cos: number;
  sin: number;
}

export type BoneDeformTable = ReadonlyMap<string, BoneDeformEntry>;

export interface Point2 {
  x: number;
  y: number;
}

/**
 * A forward-mapped triangle: `d*` are destination (deformed) corners and
 * `s*` the matching source (rest) corners.
 */
export interface InverseTriangle {
  sx0: number;
  sy0: number;
  sx1: number;
  sy1: number;
  sx2: number;
  sy2: number;
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
  dx2: number;
  dy2: number;
}

export interface SkinLayerOptions {
  pixelSnap?: boolean;
  /** Forward-mapped lattice spacing in px, clamped to 2..4. */
  latticeStep?: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeDeg(deg: number): number {
  let angle = ((deg % 360) + 360) % 360;
  if (angle > 180) angle -= 360;
  return angle;
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-6) {
    const dx = px - x0;
    const dy = py - y0;
    return dx * dx + dy * dy;
  }
  const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / lenSq));
  const dx = px - (x0 + t * vx);
  const dy = py - (y0 + t * vy);
  return dx * dx + dy * dy;
}

/** Brush falloff weight at `distance` px from the brush center. */
export function falloffAt(
  distance: number,
  radius: number,
  falloff: WeightFalloff
): number {
  const r = Math.max(0.0001, radius);
  if (falloff === "hard") {
    return distance <= r + 1e-6 ? 1 : 0;
  }
  const t = 1 - distance / r;
  return t <= 0 ? 0 : Math.min(1, t);
}

/**
 * Drops non-positive influences, merges duplicate bones, keeps the strongest
 * MAX_WEIGHT_INFLUENCES and normalizes the sum to exactly 1.
 */
export function normalizeInfluences(
  influences: readonly BoneWeightInfluence[]
): BoneWeightInfluence[] {
  const merged = new Map<string, number>();
  for (const influence of influences) {
    if (!Number.isFinite(influence.w) || influence.w <= 1e-5) continue;
    merged.set(influence.boneId, (merged.get(influence.boneId) ?? 0) + influence.w);
  }
  if (merged.size === 0) return [];

  const sorted = Array.from(merged.entries())
    .map(([boneId, w]) => ({ boneId, w }))
    .sort((a, b) => b.w - a.w || a.boneId.localeCompare(b.boneId))
    .slice(0, MAX_WEIGHT_INFLUENCES);

  let sum = 0;
  for (const influence of sorted) sum += influence.w;
  if (sum <= 0) return [];
  for (const influence of sorted) influence.w = influence.w / sum;
  return sorted;
}

/** Returns a normalized copy of a full sparse weight map. */
export function normalizeWeightMap(weights: BoneWeights): BoneWeights {
  const entries = new Map<number, BoneWeightInfluence[]>();
  for (const [index, influences] of weights.entries) {
    const normalized = normalizeInfluences(influences);
    if (normalized.length > 0) entries.set(index, normalized);
  }
  return { width: weights.width, height: weights.height, entries };
}

/**
 * Forces `boneId` to `target` (0..1) and rescales the other influences so the
 * pixel keeps summing to 1. Returns a new influence list.
 */
export function setBoneWeightNormalized(
  influences: readonly BoneWeightInfluence[],
  boneId: string,
  target: number
): BoneWeightInfluence[] {
  const t = clamp01(target);
  let otherSum = 0;
  const others: BoneWeightInfluence[] = [];
  for (const influence of influences) {
    if (influence.boneId === boneId) continue;
    if (!Number.isFinite(influence.w) || influence.w <= 1e-5) continue;
    others.push({ boneId: influence.boneId, w: influence.w });
    otherSum += influence.w;
  }

  if (others.length === 0) {
    return t > 1e-5 ? [{ boneId, w: 1 }] : [];
  }
  if (t >= 1 - 1e-6) {
    return [{ boneId, w: 1 }];
  }

  const result: BoneWeightInfluence[] = [];
  if (t > 1e-5) result.push({ boneId, w: t });
  const scale = (1 - t) / otherSum;
  for (const other of others) {
    const w = other.w * scale;
    if (w > 1e-5) result.push({ boneId: other.boneId, w });
  }
  return normalizeInfluences(result);
}

export function boneWeightAt(
  weights: BoneWeights,
  pixelIndex: number,
  boneId: string
): number {
  const influences = weights.entries.get(pixelIndex);
  if (!influences) return 0;
  for (const influence of influences) {
    if (influence.boneId === boneId) return influence.w;
  }
  return 0;
}

export function influenceSum(influences: readonly BoneWeightInfluence[]): number {
  let sum = 0;
  for (const influence of influences) sum += influence.w;
  return sum;
}

/**
 * True when every weighted pixel is dominated (>= threshold) by one bone, so
 * the legacy per-bone warp path can be used instead of LBS.
 */
export function weightsAreHard(
  weights: BoneWeights,
  threshold = HARD_WEIGHT_THRESHOLD
): boolean {
  for (const influences of weights.entries.values()) {
    if (influences.length === 0) continue;
    let max = 0;
    for (const influence of influences) {
      if (influence.w > max) max = influence.w;
    }
    if (max < threshold) return false;
  }
  return true;
}

function averageNeighborhoodWeights(
  weights: BoneWeights,
  px: number,
  py: number
): Map<string, number> {
  const averaged = new Map<string, number>();
  const w = weights.width;
  const h = weights.height;
  let samples = 0;
  for (let oy = -1; oy <= 1; oy++) {
    const y = py + oy;
    if (y < 0 || y >= h) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const x = px + ox;
      if (x < 0 || x >= w) continue;
      samples++;
      const influences = weights.entries.get(y * w + x);
      if (!influences) continue;
      for (const influence of influences) {
        averaged.set(
          influence.boneId,
          (averaged.get(influence.boneId) ?? 0) + influence.w
        );
      }
    }
  }
  if (samples > 1) {
    for (const [boneId, value] of averaged.entries()) {
      averaged.set(boneId, value / samples);
    }
  }
  return averaged;
}

/**
 * Paints one brush dab into a sparse weight map (mutates and returns it).
 * Every touched pixel keeps its influences normalized to 1 (cap 4 bones).
 */
export function paintWeightBrush(
  weights: BoneWeights,
  boneId: string,
  options: WeightPaintOptions
): BoneWeights {
  const radius = Math.max(0.5, options.radius);
  const strength = clamp01(options.strength);
  const rInt = Math.ceil(radius);
  const cx = options.cx;
  const cy = options.cy;

  for (let y = Math.floor(cy) - rInt; y <= Math.floor(cy) + rInt; y++) {
    if (y < 0 || y >= weights.height) continue;
    for (let x = Math.floor(cx) - rInt; x <= Math.floor(cx) + rInt; x++) {
      if (x < 0 || x >= weights.width) continue;

      const distance = Math.hypot(x - cx, y - cy);
      const falloff = falloffAt(distance, radius, options.falloff);
      if (falloff <= 0) continue;

      const index = y * weights.width + x;
      const current = weights.entries.get(index) ?? [];
      let next: BoneWeightInfluence[];

      if (options.mode === "smooth") {
        const amount = strength * falloff;
        const averaged = averageNeighborhoodWeights(weights, x, y);
        const currentMap = new Map<string, number>();
        for (const influence of current) currentMap.set(influence.boneId, influence.w);

        const blended: BoneWeightInfluence[] = [];
        const bones = new Set<string>([
          ...currentMap.keys(),
          ...averaged.keys(),
        ]);
        for (const id of bones) {
          const now = currentMap.get(id) ?? 0;
          const target = averaged.get(id) ?? 0;
          const value = now + (target - now) * amount;
          if (value > 1e-5) blended.push({ boneId: id, w: value });
        }
        next = normalizeInfluences(blended);
      } else {
        const currentWeight = current.reduce(
          (acc, influence) => (influence.boneId === boneId ? influence.w : acc),
          0
        );
        const delta = strength * falloff;
        let target = currentWeight;
        if (options.mode === "add") target = currentWeight + delta;
        else if (options.mode === "subtract") target = currentWeight - delta;
        else if (options.mode === "replace") target = delta;
        next = setBoneWeightNormalized(current, boneId, target);
      }

      if (next.length === 0) {
        weights.entries.delete(index);
      } else {
        weights.entries.set(index, next);
      }
    }
  }
  return weights;
}

/**
 * Distance-to-bone auto weights with a smooth 1/(d+0.5)^p falloff, keeping the
 * strongest `maxInfluences` bones normalized per opaque pixel.
 */
export function autoAssignWeights(
  src: PixelBuffer,
  bones: readonly AutoWeightBone[],
  opts: AutoWeightOptions = {}
): BoneWeights | null {
  if (bones.length === 0) return null;
  const maxInfluences = Math.max(
    1,
    Math.min(MAX_WEIGHT_INFLUENCES, Math.round(opts.maxInfluences ?? MAX_WEIGHT_INFLUENCES))
  );
  const power = Number.isFinite(opts.falloffPower) ? Math.max(0.5, opts.falloffPower!) : 2;

  const entries = new Map<number, BoneWeightInfluence[]>();
  const w = src.width;
  const h = src.height;
  const data = src.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      if (data[index * 4 + 3] === 0) continue;

      const scored: BoneWeightInfluence[] = [];
      for (const bone of bones) {
        const distSq = pointToSegmentDistSq(x, y, bone.x, bone.y, bone.tipX, bone.tipY);
        const score = 1 / Math.pow(Math.sqrt(distSq) + 0.5, power);
        if (Number.isFinite(score) && score > 0) {
          scored.push({ boneId: bone.id, w: score });
        }
      }
      if (scored.length === 0) continue;
      scored.sort((a, b) => b.w - a.w);
      const normalized = normalizeInfluences(scored.slice(0, maxInfluences));
      if (normalized.length > 0) entries.set(index, normalized);
    }
  }

  if (entries.size === 0) return null;
  return { width: w, height: h, entries };
}

/** Tight integer bounds of all pixels with alpha > 0, or null when empty. */
export function opaquePixelBounds(src: PixelBuffer): PixelBounds | null {
  const w = src.width;
  const h = src.height;
  const data = src.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function buildBoneTransformMap(
  rest: ReadonlyMap<string, BoneWorldTransform>,
  posed: ReadonlyMap<string, BoneWorldTransform>
): Map<string, BoneTransformPair> {
  const result = new Map<string, BoneTransformPair>();
  for (const [boneId, restTransform] of rest.entries()) {
    const posedTransform = posed.get(boneId);
    if (!posedTransform) continue;
    result.set(boneId, { rest: restTransform, posed: posedTransform });
  }
  return result;
}

export function buildBoneDeformTable(
  transforms: BoneTransformMap
): Map<string, BoneDeformEntry> {
  const table = new Map<string, BoneDeformEntry>();
  for (const [boneId, pair] of transforms.entries()) {
    const deltaDeg = normalizeDeg(
      pair.posed.worldRotationDeg - pair.rest.worldRotationDeg
    );
    const rad = (deltaDeg * Math.PI) / 180;
    table.set(boneId, {
      boneId,
      restX: pair.rest.x,
      restY: pair.rest.y,
      posedX: pair.posed.x,
      posedY: pair.posed.y,
      cos: Math.cos(rad),
      sin: Math.sin(rad),
    });
  }
  return table;
}

/**
 * Linear blend skinning of one point. Missing bone transforms are skipped; if
 * no influence resolves, the point stays where it is.
 */
export function deformPointByInfluences(
  x: number,
  y: number,
  influences: readonly BoneWeightInfluence[],
  table: BoneDeformTable
): Point2 {
  let sx = 0;
  let sy = 0;
  let sum = 0;
  for (const influence of influences) {
    const entry = table.get(influence.boneId);
    if (!entry || !Number.isFinite(influence.w) || influence.w <= 0) continue;
    const dx = x - entry.restX;
    const dy = y - entry.restY;
    sx += (entry.posedX + dx * entry.cos - dy * entry.sin) * influence.w;
    sy += (entry.posedY + dx * entry.sin + dy * entry.cos) * influence.w;
    sum += influence.w;
  }
  if (sum <= 1e-6) return { x, y };
  return { x: sx / sum, y: sy / sum };
}

function influencesAtPixel(
  weights: BoneWeights,
  x: number,
  y: number
): BoneWeightInfluence[] | null {
  if (x < 0 || y < 0 || x >= weights.width || y >= weights.height) return null;
  return weights.entries.get(y * weights.width + x) ?? null;
}

/**
 * Influences for a continuous position. Looks at the containing pixel first,
 * then a small neighborhood, then (optionally) the nearest weighted pixel.
 */
export function lookupInfluencesAt(
  weights: BoneWeights,
  x: number,
  y: number,
  searchRadius = 2,
  nearestFallback = true
): BoneWeightInfluence[] | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const direct = influencesAtPixel(weights, px, py);
  if (direct) return direct;

  for (let radius = 1; radius <= searchRadius; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;
        const found = influencesAtPixel(weights, px + ox, py + oy);
        if (found) return found;
      }
    }
  }

  if (!nearestFallback) return null;
  let best: BoneWeightInfluence[] | null = null;
  let bestDist = Infinity;
  for (const [index, influences] of weights.entries) {
    if (influences.length === 0) continue;
    const ex = index % weights.width;
    const ey = Math.floor(index / weights.width);
    const dist = (ex - x) * (ex - x) + (ey - y) * (ey - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = influences;
    }
  }
  return best;
}

function makeTriangle(
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  dx0: number,
  dy0: number,
  dx1: number,
  dy1: number,
  dx2: number,
  dy2: number
): InverseTriangle {
  return { sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2 };
}

/**
 * Inverse-maps a set of forward-mapped triangles and nearest-neighbor samples
 * `src`, so no holes appear inside a triangle and no color is ever invented.
 */
export function sampleInverseTriangles(
  src: PixelBuffer,
  triangles: readonly InverseTriangle[],
  outWidth = src.width,
  outHeight = src.height
): PixelBuffer {
  const out = new PixelBuffer(outWidth, outHeight);
  const srcW = src.width;
  const srcH = src.height;
  const srcData = src.data;
  const outData = out.data;
  const written = new Uint8Array(outWidth * outHeight);
  const eps = 1e-6;

  for (const tri of triangles) {
    const denom =
      (tri.dy1 - tri.dy2) * (tri.dx0 - tri.dx2) +
      (tri.dx2 - tri.dx1) * (tri.dy0 - tri.dy2);
    if (Math.abs(denom) < 1e-9) continue;

    const minX = Math.max(
      0,
      Math.floor(Math.min(tri.dx0, tri.dx1, tri.dx2) - 0.5)
    );
    const maxX = Math.min(
      outWidth - 1,
      Math.ceil(Math.max(tri.dx0, tri.dx1, tri.dx2) - 0.5)
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(tri.dy0, tri.dy1, tri.dy2) - 0.5)
    );
    const maxY = Math.min(
      outHeight - 1,
      Math.ceil(Math.max(tri.dy0, tri.dy1, tri.dy2) - 0.5)
    );
    if (minX > maxX || minY > maxY) continue;

    const invDenom = 1 / denom;
    for (let py = minY; py <= maxY; py++) {
      const y = py + 0.5;
      for (let px = minX; px <= maxX; px++) {
        const dstIndex = py * outWidth + px;
        if (written[dstIndex] !== 0) continue;
        const x = px + 0.5;

        const l0 =
          ((tri.dy1 - tri.dy2) * (x - tri.dx2) +
            (tri.dx2 - tri.dx1) * (y - tri.dy2)) *
          invDenom;
        if (l0 < -eps || l0 > 1 + eps) continue;
        const l1 =
          ((tri.dy2 - tri.dy0) * (x - tri.dx2) +
            (tri.dx0 - tri.dx2) * (y - tri.dy2)) *
          invDenom;
        if (l1 < -eps || l1 > 1 + eps) continue;
        const l2 = 1 - l0 - l1;
        if (l2 < -eps || l2 > 1 + eps) continue;

        const u = l0 * tri.sx0 + l1 * tri.sx1 + l2 * tri.sx2;
        const v = l0 * tri.sy0 + l1 * tri.sy1 + l2 * tri.sy2;
        const sx = Math.floor(u);
        const sy = Math.floor(v);
        if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;

        const srcIndex = (sy * srcW + sx) * 4;
        if (srcData[srcIndex + 3] === 0) continue;

        const outIndex = dstIndex * 4;
        outData[outIndex] = srcData[srcIndex];
        outData[outIndex + 1] = srcData[srcIndex + 1];
        outData[outIndex + 2] = srcData[srcIndex + 2];
        outData[outIndex + 3] = srcData[srcIndex + 3];
        written[dstIndex] = 1;
      }
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Per-pixel LBS of a cel: forward-map a sparse lattice over the opaque bounds,
 * then inverse-sample every destination pixel through the deformed triangles.
 */
export function skinLayerPixels(
  src: PixelBuffer,
  weights: BoneWeights,
  transforms: BoneTransformMap,
  opts: SkinLayerOptions = {}
): PixelBuffer {
  const bounds = opaquePixelBounds(src);
  if (!bounds) return src.clone();

  const table = buildBoneDeformTable(transforms);
  const pixelSnap = opts.pixelSnap ?? false;
  const step = Math.max(
    2,
    Math.min(4, Math.round(opts.latticeStep ?? DEFAULT_SKIN_LATTICE_STEP))
  );
  const cols = Math.max(1, Math.ceil(bounds.width / step));
  const rows = Math.max(1, Math.ceil(bounds.height / step));
  const stepX = bounds.width / cols;
  const stepY = bounds.height / rows;

  const restX: number[] = [];
  const restY: number[] = [];
  const destX: number[] = [];
  const destY: number[] = [];

  for (let j = 0; j <= rows; j++) {
    const y = bounds.y + j * stepY;
    for (let i = 0; i <= cols; i++) {
      const x = bounds.x + i * stepX;
      restX.push(x);
      restY.push(y);
      const influences = lookupInfluencesAt(weights, x - 0.5, y - 0.5, 2, true);
      const deformed = influences
        ? deformPointByInfluences(x, y, influences, table)
        : { x, y };
      destX.push(pixelSnap ? Math.round(deformed.x) : deformed.x);
      destY.push(pixelSnap ? Math.round(deformed.y) : deformed.y);
    }
  }

  const stride = cols + 1;
  const triangles: InverseTriangle[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      triangles.push(
        makeTriangle(
          restX[a], restY[a], restX[b], restY[b], restX[c], restY[c],
          destX[a], destY[a], destX[b], destY[b], destX[c], destY[c]
        )
      );
      triangles.push(
        makeTriangle(
          restX[b], restY[b], restX[d], restY[d], restX[c], restY[c],
          destX[b], destY[b], destX[d], destY[d], destX[c], destY[c]
        )
      );
    }
  }

  return sampleInverseTriangles(src, triangles);
}
