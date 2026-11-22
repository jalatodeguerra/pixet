import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import { computeAimLocalAngleDeg, solveFabrik } from "./constraints.ts";
import type { PixelCleanupOptions } from "./pixelCleanup.ts";
import type { RigMesh, RigMeshKeyframe } from "./mesh.ts";
import {
  autoAssignWeights,
  normalizeInfluences,
  paintWeightBrush,
  type WeightBrushMode,
  type WeightFalloff,
} from "./skinning.ts";

export type EasingMode =
  | "linear"
  | "step"
  | "easeInOut"
  | "easeIn"
  | "easeOut"
  | "bezier";

export type CubicBezierHandles = [number, number, number, number];

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  localX: number;
  localY: number;
  length: number;
  rotationDeg: number;
  boundLayerId: string | null;
  /** Local scale on X, defaults to 1. */
  scaleX?: number;
  /** Local scale on Y, defaults to 1. */
  scaleY?: number;
  /** Editor tag color (UI only). */
  color?: string;
  /** Editor-only visibility toggle. */
  hidden?: boolean;
  /** Editor-only lock toggle. */
  locked?: boolean;
  /** Local rotation lower bound in degrees, applied to procedural motion. */
  minAngleDeg?: number;
  /** Local rotation upper bound in degrees, applied to procedural motion. */
  maxAngleDeg?: number;
}

export interface BonePose {
  localX: number;
  localY: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  attachment: string | null;
}

export interface BoneWorldTransform {
  id: string;
  x: number;
  y: number;
  tipX: number;
  tipY: number;
  worldRotationDeg: number;
  length: number;
  worldScaleX: number;
  worldScaleY: number;
}

export interface BoneKeyframe {
  frame: number;
  rotationDeg: number;
  localX?: number;
  localY?: number;
  easing?: EasingMode;
  scaleX?: number;
  scaleY?: number;
  /** Sprite swap key (R5); step-interpolated. */
  attachment?: string | null;
  /** Cubic-bezier handles for easing "bezier". */
  curve?: CubicBezierHandles;
}

export interface ConstraintTargetKeyframe {
  frame: number;
  targetX: number;
  targetY: number;
  easing?: EasingMode;
  curve?: CubicBezierHandles;
}

export interface RigClip {
  id: string;
  name: string;
  frameCount: number;
  tracks: Record<string, BoneKeyframe[]>;
  constraintTracks?: Record<string, ConstraintTargetKeyframe[]>;
  /** R6 per-mesh FFD vertex offset tracks, keyed by mesh id. */
  meshTracks?: Record<string, RigMeshKeyframe[]>;
  loop?: boolean;
}

interface RigConstraintBase {
  id: string;
  name: string;
  enabled: boolean;
  /** 0..1 blend between the animated pose and the constraint result. */
  mix: number;
}

export type RigConstraint =
  | (RigConstraintBase & {
      type: "ik";
      /** Chain ordered root -> tip. */
      boneIds: string[];
      targetX: number;
      targetY: number;
      bendSign: 1 | -1;
    })
  | (RigConstraintBase & {
      type: "aim";
      boneId: string;
      targetX: number;
      targetY: number;
      offsetDeg: number;
    })
  | (RigConstraintBase & {
      type: "copyRotation" | "copyTransform";
      boneId: string;
      sourceBoneId: string;
    })
  | (RigConstraintBase & {
      type: "spring";
      boneId: string;
      stiffness: number;
      damping: number;
      gravity: number;
    });

export interface RigSlot {
  id: string;
  name: string;
  boneId: string;
  layerId: string | null;
  attachments: Record<string, { layerId: string; frame: number }>;
  defaultAttachment: string | null;
}

export interface RigPoseBone {
  rotationDeg: number;
  localX: number;
  localY: number;
  scaleX?: number;
  scaleY?: number;
}

export interface RigPose {
  id: string;
  name: string;
  bones: Record<string, RigPoseBone>;
}

export interface BoneWeightInfluence {
  boneId: string;
  /** 0..1 */
  w: number;
}

/** Sparse per-pixel skin weights, at most MAX_BONE_INFLUENCES per pixel. */
export interface BoneWeights {
  width: number;
  height: number;
  entries: Map<number, BoneWeightInfluence[]>;
}

export const MAX_BONE_INFLUENCES = 4;

export interface RigRenderOptions {
  pixelSnap: boolean;
  rotSprite: boolean;
  /**
   * Which evaluation to render. "rest" shows the bind pose (Rig Setup mode),
   * leaving the pose/keyframe channels out of the viewport preview.
   */
  mode?: "rest" | "pose";
  /** R6 post-deformation pixel cleanup (optional). */
  cleanup?: PixelCleanupOptions;
}

export interface BoneMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RigMaskSnapshot {
  boneId: string;
  width: number;
  height: number;
  indices: number[];
}

export interface RigWeightEntrySnapshot {
  i: number;
  b: Array<[string, number]>;
}

export interface RigWeightSnapshot {
  width: number;
  height: number;
  entries: RigWeightEntrySnapshot[];
}

export const RIG_SNAPSHOT_VERSION = 2;

export interface RigSnapshot {
  version: 2;
  bones: Bone[];
  clips: RigClip[];
  activeClipId: string;
  constraints: RigConstraint[];
  slots: RigSlot[];
  poses: RigPose[];
  weights: RigWeightSnapshot | null;
  masks: RigMaskSnapshot[];
  /** R6 grid/FFD meshes (optional in older v2 files). */
  meshes: RigMesh[];
}

export interface RigEvaluateOptions {
  /** Use the live pose overrides (default true). */
  useOverrides?: boolean;
  /** Apply enabled constraints in list order (default true). */
  applyConstraints?: boolean;
}

export const BONE_INFLUENCE_COLORS: readonly RGBA[] = [
  [91, 140, 255, 255],
  [239, 100, 97, 255],
  [78, 205, 130, 255],
  [251, 197, 49, 255],
  [189, 107, 237, 255],
  [69, 214, 224, 255],
];

export function getBoneInfluenceColor(boneIndex: number): RGBA {
  return BONE_INFLUENCE_COLORS[
    ((boneIndex % BONE_INFLUENCE_COLORS.length) +
      BONE_INFLUENCE_COLORS.length) %
      BONE_INFLUENCE_COLORS.length
  ];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  const projX = x0 + t * vx;
  const projY = y0 + t * vy;
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

export function normalizeAngleDeg(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

function bezierComponent(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}

function bezierDerivative(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * p1 + 6 * mu * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

const DEFAULT_BEZIER_HANDLES: CubicBezierHandles = [0.25, 0.1, 0.25, 1];

/**
 * CSS-like cubic-bezier easing. Solves x(u) = t with Newton steps and a
 * bisection fallback, then returns y(u). Endpoints are exactly 0 and 1.
 */
export function cubicBezierEase(
  t: number,
  curve: CubicBezierHandles = DEFAULT_BEZIER_HANDLES
): number {
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const handles =
    Array.isArray(curve) && curve.length === 4 ? curve : DEFAULT_BEZIER_HANDLES;
  const x1 = clamp01(handles[0]);
  const y1 = handles[1];
  const x2 = clamp01(handles[2]);
  const y2 = handles[3];

  let u = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierComponent(u, x1, x2) - x;
    if (Math.abs(err) < 1e-6) {
      return bezierComponent(u, y1, y2);
    }
    const slope = bezierDerivative(u, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    const next = u - err / slope;
    if (next < 0 || next > 1) break;
    u = next;
  }

  let lo = 0;
  let hi = 1;
  u = x;
  for (let i = 0; i < 24; i++) {
    const sample = bezierComponent(u, x1, x2);
    if (Math.abs(sample - x) < 1e-7) break;
    if (sample < x) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  return bezierComponent(u, y1, y2);
}

export function evaluateEasing(
  t: number,
  easing: EasingMode,
  curve?: CubicBezierHandles
): number {
  const clamped = clamp01(t);
  switch (easing) {
    case "step":
      return clamped >= 1 ? 1 : 0;
    case "easeInOut":
      return clamped * clamped * (3 - 2 * clamped);
    case "easeIn":
      return clamped * clamped;
    case "easeOut":
      return 1 - (1 - clamped) * (1 - clamped);
    case "bezier":
      return cubicBezierEase(clamped, curve);
    default:
      return clamped;
  }
}

export function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = normalizeAngleDeg(b - a);
  return normalizeAngleDeg(a + diff * t);
}

/**
 * Analytic law-of-cosines 2-bone IK solver.
 * Returns world angle for root bone and local bend angle for child bone.
 */
export function solveTwoBoneIK(
  rootX: number,
  rootY: number,
  len1: number,
  len2: number,
  targetX: number,
  targetY: number,
  bendSign: 1 | -1 = 1
): { rootWorldDeg: number; childLocalDeg: number } {
  const l1 = Math.max(0.5, len1);
  const l2 = Math.max(0.5, len2);
  const dx = targetX - rootX;
  const dy = targetY - rootY;
  const rawDist = Math.hypot(dx, dy);
  const baseAngle = rawDist < 1e-6 ? 0 : Math.atan2(dy, dx);

  const minDist = Math.abs(l1 - l2) + 0.001;
  const maxDist = l1 + l2 - 0.001;
  const d = Math.max(minDist, Math.min(maxDist, rawDist));

  const cosA = Math.max(
    -1,
    Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))
  );
  const angleA = Math.acos(cosA);

  const cosB = Math.max(
    -1,
    Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))
  );
  const interiorB = Math.acos(cosB);

  const rootWorldRad = baseAngle - bendSign * angleA;
  const childLocalRad = bendSign * (Math.PI - interiorB);

  return {
    rootWorldDeg: normalizeAngleDeg((rootWorldRad * 180) / Math.PI),
    childLocalDeg: normalizeAngleDeg((childLocalRad * 180) / Math.PI),
  };
}

function isRightAngle(deg: number): boolean {
  const mod = ((deg % 90) + 90) % 90;
  return mod < 0.5 || mod > 89.5;
}

/**
 * Warps a raster cel `src` from `rest` bone space into `posed` bone space.
 */
export function warpLayerByBone(
  src: PixelBuffer,
  rest: BoneWorldTransform,
  posed: BoneWorldTransform,
  opts: RigRenderOptions
): PixelBuffer {
  const w = src.width;
  const h = src.height;
  const dRot = normalizeAngleDeg(posed.worldRotationDeg - rest.worldRotationDeg);

  const rx = opts.pixelSnap ? Math.round(rest.x) : rest.x;
  const ry = opts.pixelSnap ? Math.round(rest.y) : rest.y;
  const pxOrigin = opts.pixelSnap ? Math.round(posed.x) : posed.x;
  const pyOrigin = opts.pixelSnap ? Math.round(posed.y) : posed.y;

  if (
    Math.abs(dRot) < 0.05 &&
    Math.abs(pxOrigin - rx) < 0.05 &&
    Math.abs(pyOrigin - ry) < 0.05
  ) {
    return src.clone();
  }

  const out = new PixelBuffer(w, h);
  const rad = (dRot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const srcData = src.data;
  const outData = out.data;

  const useRotSprite = opts.rotSprite && !isRightAngle(dRot);

  if (!useRotSprite) {
    for (let dy = 0; dy < h; dy++) {
      const uy = dy - pyOrigin;
      for (let dx = 0; dx < w; dx++) {
        const ux = dx - pxOrigin;
        const sx = Math.round(rx + ux * cos + uy * sin);
        const sy = Math.round(ry - ux * sin + uy * cos);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;

        const sIdx = (sy * w + sx) * 4;
        if (srcData[sIdx + 3] === 0) continue;

        const dIdx = (dy * w + dx) * 4;
        outData[dIdx] = srcData[sIdx];
        outData[dIdx + 1] = srcData[sIdx + 1];
        outData[dIdx + 2] = srcData[sIdx + 2];
        outData[dIdx + 3] = srcData[sIdx + 3];
      }
    }
    out.markAllDirty();
    return out;
  }

  // RotSprite-style 3x3 majority-vote clean sampling for non-90° angles
  const subOffsets = [-0.33, 0, 0.33];
  const colorCounts = new Map<number, { count: number; rgba: RGBA }>();

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      colorCounts.clear();
      let opaqueCount = 0;
      let centerRgba: RGBA | null = null;

      for (const oy of subOffsets) {
        const uy = dy + oy - pyOrigin;
        for (const ox of subOffsets) {
          const ux = dx + ox - pxOrigin;
          const sx = Math.round(rx + ux * cos + uy * sin);
          const sy = Math.round(ry - ux * sin + uy * cos);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;

          const sIdx = (sy * w + sx) * 4;
          const a = srcData[sIdx + 3];
          if (a === 0) continue;

          opaqueCount++;
          const r = srcData[sIdx];
          const g = srcData[sIdx + 1];
          const b = srcData[sIdx + 2];
          if (ox === 0 && oy === 0) {
            centerRgba = [r, g, b, a];
          }

          const packed = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
          const existing = colorCounts.get(packed);
          if (existing) {
            existing.count++;
          } else {
            colorCounts.set(packed, { count: 1, rgba: [r, g, b, a] });
          }
        }
      }

      if (opaqueCount === 0) continue;
      if (opaqueCount < 5 && !(centerRgba && opaqueCount >= 3)) continue;

      let best: RGBA = centerRgba ?? [0, 0, 0, 0];
      let bestCount = centerRgba ? 1 : 0;
      for (const entry of colorCounts.values()) {
        if (entry.count > bestCount) {
          bestCount = entry.count;
          best = entry.rgba;
        }
      }

      if (best[3] > 0) {
        const dIdx = (dy * w + dx) * 4;
        outData[dIdx] = best[0];
        outData[dIdx + 1] = best[1];
        outData[dIdx + 2] = best[2];
        outData[dIdx + 3] = best[3];
      }
    }
  }

  out.markAllDirty();
  return out;
}

interface LocalBonePose {
  localX: number;
  localY: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

function bindPoseOf(bone: Bone): BonePose {
  return {
    localX: bone.localX,
    localY: bone.localY,
    rotationDeg: bone.rotationDeg,
    scaleX: bone.scaleX ?? 1,
    scaleY: bone.scaleY ?? 1,
    attachment: null,
  };
}

function clampLocalAngle(bone: Bone, angle: number): number {
  let clamped = normalizeAngleDeg(angle);
  if (
    bone.minAngleDeg !== undefined &&
    Number.isFinite(bone.minAngleDeg) &&
    clamped < bone.minAngleDeg
  ) {
    clamped = bone.minAngleDeg;
  }
  if (
    bone.maxAngleDeg !== undefined &&
    Number.isFinite(bone.maxAngleDeg) &&
    clamped > bone.maxAngleDeg
  ) {
    clamped = bone.maxAngleDeg;
  }
  return normalizeAngleDeg(clamped);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Converts the legacy per-bone hard masks into sparse skin weights (hard w=1).
 * A pixel touched by more than MAX_BONE_INFLUENCES masks keeps the first four.
 */
export function masksToBoneWeights(
  masks: ReadonlyMap<string, BoneMask>
): BoneWeights | null {
  let width = 0;
  let height = 0;
  for (const mask of masks.values()) {
    width = mask.width;
    height = mask.height;
    break;
  }
  if (width <= 0 || height <= 0) return null;

  const entries = new Map<number, BoneWeightInfluence[]>();
  for (const [boneId, mask] of masks.entries()) {
    if (mask.width !== width || mask.height !== height) continue;
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] === 0) continue;
      const list = entries.get(i) ?? [];
      if (list.some((influence) => influence.boneId === boneId)) continue;
      if (list.length >= MAX_BONE_INFLUENCES) continue;
      list.push({ boneId, w: 1 });
      entries.set(i, list);
    }
  }
  if (entries.size === 0) return null;
  return { width, height, entries };
}

function serializeBoneWeights(weights: BoneWeights): RigWeightSnapshot {
  const entries: RigWeightEntrySnapshot[] = [];
  const indices = Array.from(weights.entries.keys()).sort((a, b) => a - b);
  for (const index of indices) {
    const influences = weights.entries.get(index);
    if (!influences || influences.length === 0) continue;
    entries.push({
      i: index,
      b: influences
        .slice(0, MAX_BONE_INFLUENCES)
        .map((influence) => [influence.boneId, influence.w]),
    });
  }
  return { width: weights.width, height: weights.height, entries };
}

function parseBoneWeights(raw: unknown): BoneWeights | null {
  if (!isRecord(raw)) return null;
  const width = typeof raw.width === "number" ? Math.round(raw.width) : 0;
  const height = typeof raw.height === "number" ? Math.round(raw.height) : 0;
  if (width <= 0 || height <= 0) return null;
  if (!Array.isArray(raw.entries)) return null;

  const pixelCount = width * height;
  const entries = new Map<number, BoneWeightInfluence[]>();
  for (const entry of raw.entries) {
    if (!isRecord(entry)) continue;
    const index = typeof entry.i === "number" ? Math.round(entry.i) : -1;
    if (index < 0 || index >= pixelCount) continue;
    if (!Array.isArray(entry.b)) continue;

    const influences: BoneWeightInfluence[] = [];
    for (const pair of entry.b) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const boneId = pair[0];
      const weight = pair[1];
      if (typeof boneId !== "string" || typeof weight !== "number") continue;
      if (!Number.isFinite(weight) || weight <= 0) continue;
      influences.push({ boneId, w: clamp01(weight) });
      if (influences.length >= MAX_BONE_INFLUENCES) break;
    }
    if (influences.length > 0) entries.set(index, influences);
  }
  if (entries.size === 0) return null;
  return { width, height, entries };
}

function sampleConstraintTrack(
  track: readonly ConstraintTargetKeyframe[] | undefined,
  frame: number,
  fallbackX: number,
  fallbackY: number
): { x: number; y: number } {
  if (!track || track.length === 0) {
    return { x: fallbackX, y: fallbackY };
  }
  if (frame <= track[0].frame) {
    return { x: track[0].targetX, y: track[0].targetY };
  }
  const last = track[track.length - 1];
  if (frame >= last.frame) {
    return { x: last.targetX, y: last.targetY };
  }
  for (let i = 0; i < track.length - 1; i++) {
    const k0 = track[i];
    const k1 = track[i + 1];
    if (frame >= k0.frame && frame <= k1.frame) {
      const span = Math.max(1, k1.frame - k0.frame);
      const t = evaluateEasing((frame - k0.frame) / span, k0.easing ?? "linear", k0.curve);
      return {
        x: lerp(k0.targetX, k1.targetX, t),
        y: lerp(k0.targetY, k1.targetY, t),
      };
    }
  }
  return { x: fallbackX, y: fallbackY };
}

export class RigState {
  bones: Bone[] = [];
  clips: RigClip[] = [
    { id: "clip-idle", name: "idle", frameCount: 4, tracks: {} },
  ];
  activeClipId = "clip-idle";
  currentPoseOverrides = new Map<string, BonePose>();
  boneMasks = new Map<string, BoneMask>();
  constraints: RigConstraint[] = [];
  slots: RigSlot[] = [];
  poses: RigPose[] = [];
  /** R6 grid/FFD meshes bound to layers. */
  meshes: RigMesh[] = [];
  private nextBoneNum = 1;
  private nextMeshNum = 1;
  private nextConstraintNum = 1;
  private nextClipNum = 1;
  private nextPoseNum = 1;
  private revision = 0;
  private springCache = new Map<string, number[]>();
  private cachedWeights: BoneWeights | null = null;
  private cachedWeightsRevision = -1;
  /** Authoritative R6 soft weight map (null = derive hard weights from masks). */
  private skinWeights: BoneWeights | null = null;

  /** Monotonic revision used by render caches; bumped by every mutation. */
  get revisionId(): number {
    return this.revision;
  }

  reset(): void {
    this.bones = [];
    this.clips = [
      { id: "clip-idle", name: "idle", frameCount: 4, tracks: {} },
    ];
    this.activeClipId = "clip-idle";
    this.currentPoseOverrides.clear();
    this.boneMasks.clear();
    this.constraints = [];
    this.slots = [];
    this.poses = [];
    this.meshes = [];
    this.nextBoneNum = 1;
    this.nextMeshNum = 1;
    this.nextConstraintNum = 1;
    this.nextClipNum = 1;
    this.nextPoseNum = 1;
    this.springCache.clear();
    this.cachedWeights = null;
    this.cachedWeightsRevision = -1;
    this.skinWeights = null;
    this.revision++;
  }

  /** Invalidates cached evaluation data after direct field mutation. */
  invalidateEvaluation(): void {
    this.revision++;
    this.springCache.clear();
  }

  getActiveClip(): RigClip {
    return (
      this.clips.find((c) => c.id === this.activeClipId) ?? this.clips[0]
    );
  }

  addClip(name: string, frameCount = 4, loop = true): RigClip {
    const num = this.nextClipNum++;
    const clip: RigClip = {
      id: `clip-${num}`,
      name: name.trim() || `clip-${num}`,
      frameCount: Math.max(1, Math.round(frameCount)),
      tracks: {},
      loop,
    };
    this.clips.push(clip);
    this.activeClipId = clip.id;
    this.currentPoseOverrides.clear();
    this.invalidateEvaluation();
    return clip;
  }

  updateClip(
    clipId: string,
    patch: { name?: string; frameCount?: number; loop?: boolean }
  ): void {
    const clip = this.clips.find((c) => c.id === clipId);
    if (!clip) return;
    if (patch.name !== undefined) {
      clip.name = patch.name.trim() || clip.name;
    }
    if (patch.frameCount !== undefined) {
      clip.frameCount = Math.max(1, Math.round(patch.frameCount));
    }
    if (patch.loop !== undefined) {
      clip.loop = patch.loop;
    }
    this.invalidateEvaluation();
  }

  duplicateClip(clipId: string): RigClip | null {
    const source = this.clips.find((c) => c.id === clipId);
    if (!source) return null;
    const num = this.nextClipNum++;
    const copy: RigClip = {
      id: `clip-${num}`,
      name: `${source.name} copy`,
      frameCount: source.frameCount,
      loop: source.loop,
      tracks: Object.fromEntries(
        Object.entries(source.tracks).map(([boneId, kfs]) => [
          boneId,
          kfs.map((kf) => ({
            ...kf,
            curve: kf.curve
              ? ([...kf.curve] as CubicBezierHandles)
              : undefined,
          })),
        ])
      ),
      ...(source.constraintTracks
        ? {
            constraintTracks: Object.fromEntries(
              Object.entries(source.constraintTracks).map(([cid, kfs]) => [
                cid,
                kfs.map((kf) => ({ ...kf })),
              ])
            ),
          }
        : {}),
      ...(source.meshTracks
        ? {
            meshTracks: Object.fromEntries(
              Object.entries(source.meshTracks).map(([mid, kfs]) => [
                mid,
                kfs.map((kf) => ({
                  ...kf,
                  offsets: kf.offsets.map(
                    ([dx, dy]) => [dx, dy] as [number, number]
                  ),
                })),
              ])
            ),
          }
        : {}),
    };
    this.clips.push(copy);
    this.activeClipId = copy.id;
    this.currentPoseOverrides.clear();
    this.invalidateEvaluation();
    return copy;
  }

  removeClip(clipId: string): boolean {
    if (this.clips.length <= 1) return false;
    const next = this.clips.filter((c) => c.id !== clipId);
    if (next.length === this.clips.length) return false;
    this.clips = next;
    if (this.activeClipId === clipId) {
      this.activeClipId = this.clips[0].id;
      this.currentPoseOverrides.clear();
    }
    this.invalidateEvaluation();
    return true;
  }

  setActiveClip(clipId: string): void {
    if (!this.clips.some((c) => c.id === clipId)) return;
    this.activeClipId = clipId;
    this.currentPoseOverrides.clear();
    this.invalidateEvaluation();
  }

  addPose(pose: RigPose): RigPose {
    const id = pose.id || `pose-${this.nextPoseNum++}`;
    const saved: RigPose = {
      id,
      name: pose.name.trim() || `Pose ${this.nextPoseNum}`,
      bones: Object.fromEntries(
        Object.entries(pose.bones).map(([k, v]) => [k, { ...v }])
      ),
    };
    this.poses.push(saved);
    return saved;
  }

  removePose(poseId: string): void {
    this.poses = this.poses.filter((p) => p.id !== poseId);
  }

  addBone(partial: {
    name?: string;
    parentId: string | null;
    localX: number;
    localY: number;
    length: number;
    rotationDeg: number;
    boundLayerId?: string | null;
    scaleX?: number;
    scaleY?: number;
    color?: string;
    hidden?: boolean;
    locked?: boolean;
    minAngleDeg?: number;
    maxAngleDeg?: number;
  }): Bone {
    const num = this.nextBoneNum++;
    const bone: Bone = {
      id: `bone-${num}`,
      name: partial.name?.trim() || `Bone ${num}`,
      parentId: partial.parentId,
      localX: partial.localX,
      localY: partial.localY,
      length: Math.max(1, partial.length),
      rotationDeg: normalizeAngleDeg(partial.rotationDeg),
      boundLayerId: partial.boundLayerId ?? null,
    };
    if (partial.scaleX !== undefined) bone.scaleX = partial.scaleX;
    if (partial.scaleY !== undefined) bone.scaleY = partial.scaleY;
    if (partial.color !== undefined) bone.color = partial.color;
    if (partial.hidden !== undefined) bone.hidden = partial.hidden;
    if (partial.locked !== undefined) bone.locked = partial.locked;
    if (partial.minAngleDeg !== undefined) bone.minAngleDeg = partial.minAngleDeg;
    if (partial.maxAngleDeg !== undefined) bone.maxAngleDeg = partial.maxAngleDeg;
    this.bones.push(bone);
    this.invalidateEvaluation();
    return bone;
  }

  updateBone(id: string, patch: Partial<Omit<Bone, "id">>): void {
    const bone = this.bones.find((b) => b.id === id);
    if (!bone) return;
    if (patch.name !== undefined) bone.name = patch.name;
    if (patch.parentId !== undefined && patch.parentId !== id) {
      bone.parentId = patch.parentId;
    }
    if (patch.localX !== undefined) bone.localX = patch.localX;
    if (patch.localY !== undefined) bone.localY = patch.localY;
    if (patch.length !== undefined) bone.length = Math.max(1, patch.length);
    if (patch.rotationDeg !== undefined) {
      bone.rotationDeg = normalizeAngleDeg(patch.rotationDeg);
    }
    if (patch.boundLayerId !== undefined) bone.boundLayerId = patch.boundLayerId;
    if (patch.scaleX !== undefined) bone.scaleX = patch.scaleX;
    if (patch.scaleY !== undefined) bone.scaleY = patch.scaleY;
    if ("color" in patch) {
      if (patch.color === undefined) delete bone.color;
      else bone.color = patch.color;
    }
    if (patch.hidden !== undefined) bone.hidden = patch.hidden;
    if (patch.locked !== undefined) bone.locked = patch.locked;
    if ("minAngleDeg" in patch) {
      if (patch.minAngleDeg === undefined) delete bone.minAngleDeg;
      else bone.minAngleDeg = patch.minAngleDeg;
    }
    if ("maxAngleDeg" in patch) {
      if (patch.maxAngleDeg === undefined) delete bone.maxAngleDeg;
      else bone.maxAngleDeg = patch.maxAngleDeg;
    }
    this.invalidateEvaluation();
  }

  removeBone(id: string): void {
    const target = this.bones.find((b) => b.id === id);
    if (!target) return;
    for (const b of this.bones) {
      if (b.parentId === id) {
        b.parentId = target.parentId;
      }
    }
    this.bones = this.bones.filter((b) => b.id !== id);
    this.currentPoseOverrides.delete(id);
    this.boneMasks.delete(id);
    this.constraints = this.constraints.filter(
      (constraint) => !constraintReferencesBone(constraint, id)
    );
    for (const clip of this.clips) {
      delete clip.tracks[id];
    }
    if (this.skinWeights && removeBoneFromWeights(this.skinWeights, id)) {
      this.rebuildMasksFromWeights();
    }
    this.invalidateEvaluation();
  }

  getBoneMask(boneId: string): BoneMask | undefined {
    return this.boneMasks.get(boneId);
  }

  hasAnyBoneMask(): boolean {
    if (this.skinWeights && this.skinWeights.entries.size > 0) return true;
    for (const mask of this.boneMasks.values()) {
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i] > 0) return true;
      }
    }
    return false;
  }

  clearBoneMask(boneId: string): void {
    this.boneMasks.delete(boneId);
    this.clearBoneWeights(boneId);
    this.invalidateEvaluation();
  }

  /**
   * Sparse skin weights: the stored R6 soft map when present, otherwise hard
   * weights derived from the legacy bone masks.
   */
  getBoneWeights(): BoneWeights | null {
    if (this.skinWeights) return this.skinWeights;
    if (this.cachedWeightsRevision !== this.revision) {
      this.cachedWeights = masksToBoneWeights(this.boneMasks);
      this.cachedWeightsRevision = this.revision;
    }
    return this.cachedWeights;
  }

  /** Replaces the soft weight map (null falls back to mask-derived weights). */
  setBoneWeights(weights: BoneWeights | null): void {
    this.skinWeights = weights;
    this.cachedWeights = weights;
    this.cachedWeightsRevision = this.revision;
    this.rebuildMasksFromWeights();
    this.invalidateEvaluation();
  }

  /** Removes the selected bone from the soft weight map (keeps others). */
  clearBoneWeights(boneId: string): void {
    if (!this.skinWeights) return;
    if (removeBoneFromWeights(this.skinWeights, boneId)) {
      this.rebuildMasksFromWeights();
      this.invalidateEvaluation();
    }
  }

  private rebuildMasksFromWeights(): void {
    this.boneMasks.clear();
    const weights = this.skinWeights;
    if (!weights) return;
    const pixelCount = weights.width * weights.height;
    for (const [index, influences] of weights.entries) {
      if (index < 0 || index >= pixelCount) continue;
      let bestBoneId: string | null = null;
      let bestWeight = 0;
      for (const influence of influences) {
        if (influence.w > bestWeight) {
          bestWeight = influence.w;
          bestBoneId = influence.boneId;
        }
      }
      if (!bestBoneId || bestWeight < 0.5) continue;
      let mask = this.boneMasks.get(bestBoneId);
      if (!mask || mask.width !== weights.width || mask.height !== weights.height) {
        mask = {
          width: weights.width,
          height: weights.height,
          data: new Uint8Array(pixelCount),
        };
        this.boneMasks.set(bestBoneId, mask);
      }
      mask.data[index] = 1;
    }
  }

  /**
   * Paints one smooth-weight brush dab (strength/mode/falloff) for `boneId`.
   * Every touched pixel keeps its influences normalized and capped at 4.
   */
  paintBoneWeights(
    boneId: string,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    options: {
      strength: number;
      mode: WeightBrushMode;
      falloff: WeightFalloff;
    }
  ): void {
    if (!this.bones.some((b) => b.id === boneId)) return;
    let weights = this.skinWeights;
    if (!weights || weights.width !== width || weights.height !== height) {
      const derived = masksToBoneWeights(this.boneMasks);
      weights =
        derived && derived.width === width && derived.height === height
          ? derived
          : { width, height, entries: new Map() };
      this.skinWeights = weights;
      this.cachedWeights = weights;
    }
    paintWeightBrush(weights, boneId, {
      cx,
      cy,
      radius,
      strength: options.strength,
      mode: options.mode,
      falloff: options.falloff,
    });
    this.rebuildMasksFromWeights();
    this.invalidateEvaluation();
  }

  /**
   * Smooth auto weights: distance-to-bone-segment falloff, top-4 influences
   * per opaque pixel, normalized to 1.
   */
  autoAssignBoneWeights(src: PixelBuffer, frame = 0): void {
    this.boneMasks.clear();
    this.skinWeights = null;
    if (this.bones.length === 0) {
      this.invalidateEvaluation();
      return;
    }

    const transforms = this.computeWorldTransforms(frame, "rest", false);
    const autoBones = this.bones
      .map((bone) => ({ bone, transform: transforms.get(bone.id) }))
      .filter(
        (item): item is { bone: Bone; transform: BoneWorldTransform } =>
          item.transform !== undefined
      )
      .map(({ bone, transform }) => ({
        id: bone.id,
        x: transform.x,
        y: transform.y,
        tipX: transform.tipX,
        tipY: transform.tipY,
      }));

    const weights = autoAssignWeights(src, autoBones);
    this.skinWeights = weights;
    this.cachedWeights = weights;
    this.cachedWeightsRevision = this.revision;
    this.rebuildMasksFromWeights();
    this.invalidateEvaluation();
  }

  private ensureBoneMask(boneId: string, width: number, height: number): BoneMask {
    const existing = this.boneMasks.get(boneId);
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }
    const created: BoneMask = {
      width,
      height,
      data: new Uint8Array(width * height),
    };
    this.boneMasks.set(boneId, created);
    return created;
  }

  paintBoneMask(
    boneId: string,
    width: number,
    height: number,
    cx: number,
    cy: number,
    radius: number,
    erase: boolean,
    exclusive = true
  ): void {
    if (!this.bones.some((b) => b.id === boneId)) return;
    const mask = this.ensureBoneMask(boneId, width, height);
    const r = Math.max(0.5, radius);
    const rInt = Math.floor(r);
    const rSq = r * r;

    for (let y = cy - rInt; y <= cy + rInt; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = cx - rInt; x <= cx + rInt; x++) {
        if (x < 0 || x >= width) continue;
        if (r > 1) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > rSq) continue;
        }
        const idx = y * width + x;
        mask.data[idx] = erase ? 0 : 1;
        if (!erase && exclusive) {
          for (const [otherId, otherMask] of this.boneMasks.entries()) {
            if (
              otherId !== boneId &&
              otherMask.width === width &&
              otherMask.height === height
            ) {
              otherMask.data[idx] = 0;
            }
          }
        }

        // Keep the R6 soft weight map in sync when it exists (legacy brush).
        const weights = this.skinWeights;
        if (weights && weights.width === width && weights.height === height) {
          const current = weights.entries.get(idx) ?? [];
          let next: BoneWeightInfluence[];
          if (erase) {
            next = normalizeInfluences(
              current.filter((influence) => influence.boneId !== boneId)
            );
          } else if (exclusive) {
            next = [{ boneId, w: 1 }];
          } else {
            next = normalizeInfluences([...current, { boneId, w: 1 }]);
          }
          if (next.length === 0) weights.entries.delete(idx);
          else weights.entries.set(idx, next);
        }
      }
    }
    if (this.skinWeights) this.rebuildMasksFromWeights();
    this.invalidateEvaluation();
  }

  autoAssignBoneMasks(src: PixelBuffer, frame = 0): void {
    this.boneMasks.clear();
    // Legacy hard-mask assignment replaces the R6 soft weight map.
    this.skinWeights = null;
    this.cachedWeights = null;
    if (this.bones.length === 0) {
      this.invalidateEvaluation();
      return;
    }

    const transforms = this.computeWorldTransforms(frame, "rest", false);
    const activeBones = this.bones
      .map((b) => ({ bone: b, t: transforms.get(b.id) }))
      .filter(
        (item): item is { bone: Bone; t: BoneWorldTransform } =>
          item.t !== undefined
      );
    if (activeBones.length === 0) {
      this.invalidateEvaluation();
      return;
    }

    const w = src.width;
    const h = src.height;
    const masks = activeBones.map(({ bone }) =>
      this.ensureBoneMask(bone.id, w, h)
    );

    const srcData = src.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = srcData[(y * w + x) * 4 + 3];
        if (a === 0) continue;

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let bi = 0; bi < activeBones.length; bi++) {
          const { t } = activeBones[bi];
          const dSq = pointToSegmentDistSq(x, y, t.x, t.y, t.tipX, t.tipY);
          if (dSq < bestDist) {
            bestDist = dSq;
            bestIdx = bi;
          }
        }
        masks[bestIdx].data[y * w + x] = 1;
      }
    }
    this.invalidateEvaluation();
  }

  getMeshForLayer(layerId: string): RigMesh | null {
    return this.meshes.find((mesh) => mesh.layerId === layerId) ?? null;
  }

  addMesh(mesh: RigMesh): RigMesh {
    let id = mesh.id || `mesh-${this.nextMeshNum++}`;
    while (this.meshes.some((existing) => existing.id === id)) {
      id = `mesh-${this.nextMeshNum++}`;
    }
    const clone = cloneMesh(mesh);
    clone.id = id;
    this.meshes.push(clone);
    this.invalidateEvaluation();
    return clone;
  }

  updateMesh(id: string, patch: Partial<Omit<RigMesh, "id">>): void {
    const mesh = this.meshes.find((item) => item.id === id);
    if (!mesh) return;
    if (patch.name !== undefined) mesh.name = patch.name;
    if (patch.layerId !== undefined) mesh.layerId = patch.layerId;
    if (patch.cellSize !== undefined) mesh.cellSize = patch.cellSize;
    if (patch.boundsX !== undefined) mesh.boundsX = patch.boundsX;
    if (patch.boundsY !== undefined) mesh.boundsY = patch.boundsY;
    if (patch.boundsWidth !== undefined) mesh.boundsWidth = patch.boundsWidth;
    if (patch.boundsHeight !== undefined) mesh.boundsHeight = patch.boundsHeight;
    if (patch.vertices !== undefined) {
      mesh.vertices = patch.vertices.map((vertex) => ({ ...vertex }));
    }
    if (patch.triangles !== undefined) mesh.triangles = [...patch.triangles];
    this.invalidateEvaluation();
  }

  removeMesh(id: string): void {
    this.meshes = this.meshes.filter((mesh) => mesh.id !== id);
    for (const clip of this.clips) {
      if (clip.meshTracks) delete clip.meshTracks[id];
    }
    this.invalidateEvaluation();
  }

  setMeshVertexOffset(
    meshId: string,
    vertexIndex: number,
    offsetX: number,
    offsetY: number
  ): void {
    const mesh = this.meshes.find((item) => item.id === meshId);
    const vertex = mesh?.vertices[vertexIndex];
    if (!vertex) return;
    vertex.offsetX = offsetX;
    vertex.offsetY = offsetY;
    this.invalidateEvaluation();
  }

  /** Keys the current absolute FFD vertex offsets of a mesh on the active clip. */
  setMeshKeyframe(
    meshId: string,
    frame: number,
    offsets: ReadonlyArray<readonly [number, number]>,
    easing: EasingMode = "linear"
  ): void {
    const mesh = this.meshes.find((item) => item.id === meshId);
    if (!mesh) return;
    const clip = this.getActiveClip();
    if (!clip.meshTracks) clip.meshTracks = {};
    const track = clip.meshTracks[meshId] ?? [];
    const key: RigMeshKeyframe = {
      frame: Math.round(frame),
      offsets: mesh.vertices.map((_, index): [number, number] => {
        const value = offsets[index];
        return value ? [value[0], value[1]] : [0, 0];
      }),
      easing,
    };
    const next = track.filter((item) => item.frame !== key.frame);
    next.push(key);
    next.sort((a, b) => a.frame - b.frame);
    clip.meshTracks[meshId] = next;
    if (frame + 1 > clip.frameCount) clip.frameCount = frame + 1;
    this.invalidateEvaluation();
  }

  clearMeshKeyframe(meshId: string, frame: number): void {
    const clip = this.getActiveClip();
    const track = clip.meshTracks?.[meshId];
    if (!track) return;
    clip.meshTracks![meshId] = track.filter((item) => item.frame !== frame);
    this.invalidateEvaluation();
  }

  private attachmentAtFrame(
    track: readonly BoneKeyframe[],
    frame: number
  ): string | null {
    let attachment: string | null = null;
    for (const key of track) {
      if (key.frame > frame) break;
      if (key.attachment !== undefined) attachment = key.attachment;
    }
    return attachment;
  }

  getBonePoseAtFrame(
    boneId: string,
    frame: number,
    useOverrides = true
  ): BonePose {
    const bone = this.bones.find((b) => b.id === boneId);
    if (!bone) {
      return {
        localX: 0,
        localY: 0,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
        attachment: null,
      };
    }

    if (useOverrides) {
      const override = this.currentPoseOverrides.get(boneId);
      if (override) {
        return { ...override };
      }
    }

    const bind = bindPoseOf(bone);
    const clip = this.getActiveClip();
    const track = clip?.tracks[boneId];
    if (!track || track.length === 0) {
      return bind;
    }

    const keyToPose = (key: BoneKeyframe): BonePose => ({
      localX: key.localX ?? bone.localX,
      localY: key.localY ?? bone.localY,
      rotationDeg: key.rotationDeg,
      scaleX: key.scaleX ?? bind.scaleX,
      scaleY: key.scaleY ?? bind.scaleY,
      attachment: this.attachmentAtFrame(track, key.frame),
    });

    if (frame <= track[0].frame) {
      return keyToPose(track[0]);
    }

    const last = track[track.length - 1];
    if (frame >= last.frame) {
      return keyToPose(last);
    }

    for (let i = 0; i < track.length - 1; i++) {
      const k0 = track[i];
      const k1 = track[i + 1];
      if (frame >= k0.frame && frame <= k1.frame) {
        const span = Math.max(1, k1.frame - k0.frame);
        const rawT = (frame - k0.frame) / span;
        const t = evaluateEasing(rawT, k0.easing ?? "linear", k0.curve);
        return {
          localX: lerp(k0.localX ?? bone.localX, k1.localX ?? bone.localX, t),
          localY: lerp(k0.localY ?? bone.localY, k1.localY ?? bone.localY, t),
          rotationDeg: lerpAngleDeg(k0.rotationDeg, k1.rotationDeg, t),
          scaleX: lerp(
            k0.scaleX ?? bind.scaleX,
            k1.scaleX ?? bind.scaleX,
            t
          ),
          scaleY: lerp(
            k0.scaleY ?? bind.scaleY,
            k1.scaleY ?? bind.scaleY,
            t
          ),
          attachment: this.attachmentAtFrame(track, frame),
        };
      }
    }

    return bind;
  }

  private computeFk(
    locals: ReadonlyMap<string, LocalBonePose>
  ): Map<string, BoneWorldTransform> {
    const result = new Map<string, BoneWorldTransform>();
    const byId = new Map(this.bones.map((b) => [b.id, b]));
    const visiting = new Set<string>();

    const resolve = (boneId: string): BoneWorldTransform | null => {
      const cached = result.get(boneId);
      if (cached) return cached;
      if (visiting.has(boneId)) return null;

      const bone = byId.get(boneId);
      if (!bone) return null;
      visiting.add(boneId);

      const transform = this.computeWorldTransform(bone, locals, result);
      visiting.delete(boneId);
      if (transform) result.set(boneId, transform);
      return transform;
    };

    for (const bone of this.bones) {
      resolve(bone.id);
    }

    return result;
  }

  private computeWorldTransform(
    bone: Bone,
    locals: ReadonlyMap<string, LocalBonePose>,
    resolved: ReadonlyMap<string, BoneWorldTransform>
  ): BoneWorldTransform | null {
    const local = locals.get(bone.id);
    if (!local) return null;

    let worldX = local.localX;
    let worldY = local.localY;
    let worldRotationDeg = local.rotationDeg;
    let worldScaleX = local.scaleX;
    let worldScaleY = local.scaleY;

    if (bone.parentId) {
      const parent = resolved.get(bone.parentId);
      if (parent) {
        const pRad = (parent.worldRotationDeg * Math.PI) / 180;
        const cos = Math.cos(pRad);
        const sin = Math.sin(pRad);
        const sx = local.localX * parent.worldScaleX;
        const sy = local.localY * parent.worldScaleY;
        worldX = parent.x + sx * cos - sy * sin;
        worldY = parent.y + sx * sin + sy * cos;
        worldRotationDeg = normalizeAngleDeg(
          parent.worldRotationDeg + local.rotationDeg
        );
        worldScaleX = parent.worldScaleX * local.scaleX;
        worldScaleY = parent.worldScaleY * local.scaleY;
      }
    }

    const wRad = (worldRotationDeg * Math.PI) / 180;
    const tipX = worldX + Math.cos(wRad) * bone.length * worldScaleX;
    const tipY = worldY + Math.sin(wRad) * bone.length * worldScaleX;

    return {
      id: bone.id,
      x: worldX,
      y: worldY,
      tipX,
      tipY,
      worldRotationDeg,
      length: bone.length,
      worldScaleX,
      worldScaleY,
    };
  }

  private buildChildrenMap(): Map<string, string[]> {
    const children = new Map<string, string[]>();
    for (const bone of this.bones) {
      if (!bone.parentId) continue;
      const list = children.get(bone.parentId) ?? [];
      list.push(bone.id);
      children.set(bone.parentId, list);
    }
    return children;
  }

  private recomputeSubtree(
    result: Map<string, BoneWorldTransform>,
    locals: ReadonlyMap<string, LocalBonePose>,
    rootId: string,
    childrenByParent: ReadonlyMap<string, string[]>
  ): void {
    const byId = new Map(this.bones.map((b) => [b.id, b]));
    const stack = [rootId];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      const bone = byId.get(id);
      if (!bone) continue;
      const transform = this.computeWorldTransform(bone, locals, result);
      if (transform) result.set(id, transform);
      const children = childrenByParent.get(id);
      if (children) {
        for (const child of children) stack.push(child);
      }
    }
  }

  private findBone(boneId: string): Bone | undefined {
    return this.bones.find((bone) => bone.id === boneId);
  }

  private blendLocalRotation(
    locals: Map<string, LocalBonePose>,
    boneId: string,
    proposedDeg: number,
    mix: number
  ): void {
    const local = locals.get(boneId);
    if (!local) return;
    local.rotationDeg = lerpAngleDeg(
      local.rotationDeg,
      normalizeAngleDeg(proposedDeg),
      clamp01(mix)
    );
  }

  private aimBone(
    boneId: string,
    targetX: number,
    targetY: number,
    offsetDeg: number,
    mix: number,
    locals: Map<string, LocalBonePose>,
    transforms: ReadonlyMap<string, BoneWorldTransform>
  ): string[] {
    const bone = this.findBone(boneId);
    const transform = transforms.get(boneId);
    if (!bone || !transform) return [];
    const parentDeg = bone.parentId
      ? transforms.get(bone.parentId)?.worldRotationDeg ?? 0
      : 0;
    const localDeg = computeAimLocalAngleDeg(
      transform.x,
      transform.y,
      targetX,
      targetY,
      offsetDeg,
      parentDeg
    );
    this.blendLocalRotation(locals, boneId, localDeg, mix);
    return [boneId];
  }

  private springAngleAt(
    constraint: Extract<RigConstraint, { type: "spring" }>,
    frame: number
  ): number {
    const clip = this.getActiveClip();
    const cacheKey = `${clip.id}::${constraint.id}::${this.revision}`;
    let trajectory = this.springCache.get(cacheKey);
    if (!trajectory) {
      trajectory = [];
      if (this.springCache.size >= 256) this.springCache.clear();
      this.springCache.set(cacheKey, trajectory);
    }

    const targetFrame = Math.max(0, Math.floor(frame));
    if (trajectory.length === 0) {
      trajectory.push(
        this.getBonePoseAtFrame(constraint.boneId, 0, false).rotationDeg
      );
    }

    const stiffness =
      Number.isFinite(constraint.stiffness) && constraint.stiffness >= 0
        ? constraint.stiffness
        : 0.25;
    const damping =
      Number.isFinite(constraint.damping) && constraint.damping >= 0
        ? constraint.damping
        : 0.18;
    const gravity = Number.isFinite(constraint.gravity)
      ? constraint.gravity
      : 0;

    for (let f = trajectory.length; f <= targetFrame; f++) {
      const previous = trajectory[f - 1];
      const velocity = f >= 2 ? previous - trajectory[f - 2] : 0;
      const target = this.getBonePoseAtFrame(
        constraint.boneId,
        f,
        false
      ).rotationDeg;
      const acceleration =
        -stiffness * normalizeAngleDeg(previous - target) -
        damping * velocity +
        gravity;
      trajectory.push(previous + velocity + acceleration);
    }

    return normalizeAngleDeg(trajectory[targetFrame]);
  }

  private applyConstraint(
    constraint: RigConstraint,
    frame: number,
    mix: number,
    locals: Map<string, LocalBonePose>,
    transforms: ReadonlyMap<string, BoneWorldTransform>
  ): string[] {
    switch (constraint.type) {
      case "ik": {
        const chain = constraint.boneIds.filter((id) =>
          this.bones.some((bone) => bone.id === id)
        );
        if (chain.length === 0) return [];
        const target = this.getConstraintTargetAtFrame(constraint.id, frame);
        if (!target) return [];
        if (chain.length === 1) {
          return this.aimBone(
            chain[0],
            target.x,
            target.y,
            0,
            mix,
            locals,
            transforms
          );
        }

        const childId = chain[chain.length - 1];
        const rootId = chain[chain.length - 2];
        const rootBone = this.findBone(rootId);
        const childBone = this.findBone(childId);
        const rootWorld = transforms.get(rootId);
        if (
          chain.length === 2 &&
          rootBone &&
          childBone &&
          rootWorld &&
          childBone.parentId === rootId &&
          rootBone.minAngleDeg === undefined &&
          rootBone.maxAngleDeg === undefined &&
          childBone.minAngleDeg === undefined &&
          childBone.maxAngleDeg === undefined
        ) {
          const grandParentDeg = rootBone.parentId
            ? transforms.get(rootBone.parentId)?.worldRotationDeg ?? 0
            : 0;
          const solved = solveTwoBoneIK(
            rootWorld.x,
            rootWorld.y,
            rootBone.length,
            childBone.length,
            target.x,
            target.y,
            constraint.bendSign
          );
          this.blendLocalRotation(
            locals,
            rootId,
            normalizeAngleDeg(solved.rootWorldDeg - grandParentDeg),
            mix
          );
          this.blendLocalRotation(locals, childId, solved.childLocalDeg, mix);
          return [rootId, childId];
        }

        // FABRIK N-bone IK (also used for 2-bone chains with angle limits).
        const chainBones: Bone[] = [];
        const chainWorldPoints: { x: number; y: number }[] = [];
        const lengths: number[] = [];
        const angleLimits: { minDeg?: number; maxDeg?: number }[] = [];
        for (const id of chain) {
          const b = this.findBone(id);
          const t = transforms.get(id);
          if (!b || !t) continue;
          chainBones.push(b);
          chainWorldPoints.push({ x: t.x, y: t.y });
          lengths.push(Math.max(0.001, b.length * Math.abs(t.worldScaleX || 1)));
          angleLimits.push({
            minDeg: b.minAngleDeg,
            maxDeg: b.maxAngleDeg,
          });
        }
        if (chainBones.length === 0) return [];
        const tipTransform = transforms.get(
          chainBones[chainBones.length - 1].id
        );
        if (!tipTransform) return [];
        chainWorldPoints.push({ x: tipTransform.tipX, y: tipTransform.tipY });
        const rootParentId = chainBones[0].parentId;
        const parentWorldDeg = rootParentId
          ? (transforms.get(rootParentId)?.worldRotationDeg ?? 0)
          : 0;

        const solved = solveFabrik(
          chainWorldPoints,
          lengths,
          target,
          12,
          0.01,
          angleLimits,
          parentWorldDeg
        );
        const affected: string[] = [];
        for (let i = 0; i < chainBones.length; i++) {
          const b = chainBones[i];
          this.blendLocalRotation(
            locals,
            b.id,
            solved.localRotationsDeg[i] ?? 0,
            mix
          );
          affected.push(b.id);
        }
        return affected;
      }

      case "aim": {
        const target = this.getConstraintTargetAtFrame(constraint.id, frame);
        if (!target) return [];
        return this.aimBone(
          constraint.boneId,
          target.x,
          target.y,
          constraint.offsetDeg,
          mix,
          locals,
          transforms
        );
      }

      case "copyRotation": {
        const bone = this.findBone(constraint.boneId);
        const source = transforms.get(constraint.sourceBoneId);
        if (!bone || !source) return [];
        const parentDeg = bone.parentId
          ? transforms.get(bone.parentId)?.worldRotationDeg ?? 0
          : 0;
        this.blendLocalRotation(
          locals,
          constraint.boneId,
          normalizeAngleDeg(source.worldRotationDeg - parentDeg),
          mix
        );
        return [constraint.boneId];
      }

      case "copyTransform": {
        const bone = this.findBone(constraint.boneId);
        const source = transforms.get(constraint.sourceBoneId);
        const local = locals.get(constraint.boneId);
        if (!bone || !source || !local) return [];
        const parent = bone.parentId ? transforms.get(bone.parentId) : undefined;
        const blend = clamp01(mix);

        let desiredX = source.x;
        let desiredY = source.y;
        let desiredRotation = source.worldRotationDeg;
        let desiredScaleX = source.worldScaleX;
        let desiredScaleY = source.worldScaleY;

        if (parent) {
          const pRad = (parent.worldRotationDeg * Math.PI) / 180;
          const cos = Math.cos(pRad);
          const sin = Math.sin(pRad);
          const dx = source.x - parent.x;
          const dy = source.y - parent.y;
          const parentScaleX = Math.abs(parent.worldScaleX) < 1e-6
            ? 1
            : parent.worldScaleX;
          const parentScaleY = Math.abs(parent.worldScaleY) < 1e-6
            ? 1
            : parent.worldScaleY;
          desiredX = (dx * cos + dy * sin) / parentScaleX;
          desiredY = (-dx * sin + dy * cos) / parentScaleY;
          desiredRotation = normalizeAngleDeg(
            source.worldRotationDeg - parent.worldRotationDeg
          );
          desiredScaleX = source.worldScaleX / parentScaleX;
          desiredScaleY = source.worldScaleY / parentScaleY;
        }

        local.localX = lerp(local.localX, desiredX, blend);
        local.localY = lerp(local.localY, desiredY, blend);
        local.scaleX = lerp(local.scaleX, desiredScaleX, blend);
        local.scaleY = lerp(local.scaleY, desiredScaleY, blend);
        this.blendLocalRotation(locals, constraint.boneId, desiredRotation, blend);
        return [constraint.boneId];
      }

      case "spring": {
        const bone = this.findBone(constraint.boneId);
        if (!bone) return [];
        this.blendLocalRotation(
          locals,
          constraint.boneId,
          this.springAngleAt(constraint, frame),
          mix
        );
        return [constraint.boneId];
      }
    }
  }

  /** Target of a keyable IK/aim constraint at `frame`, or null. */
  getConstraintTargetAtFrame(
    constraintId: string,
    frame: number
  ): { x: number; y: number } | null {
    const constraint = this.constraints.find((c) => c.id === constraintId);
    if (!constraint) return null;
    if (constraint.type !== "ik" && constraint.type !== "aim") return null;
    const track = this.getActiveClip().constraintTracks?.[constraintId];
    return sampleConstraintTrack(
      track,
      frame,
      constraint.targetX,
      constraint.targetY
    );
  }

  addConstraint(
    input: (
      | Omit<Extract<RigConstraint, { type: "ik" }>, "id">
      | Omit<Extract<RigConstraint, { type: "aim" }>, "id">
      | Omit<
          Extract<RigConstraint, { type: "copyRotation" | "copyTransform" }>,
          "id"
        >
      | Omit<Extract<RigConstraint, { type: "spring" }>, "id">
    ) & { id?: string }
  ): RigConstraint {
    const id = input.id ?? `constraint-${this.nextConstraintNum++}`;
    const created = cloneConstraint({ ...input, id } as RigConstraint);
    this.constraints.push(created);
    this.invalidateEvaluation();
    return created;
  }

  updateConstraint(
    id: string,
    patch: Record<string, unknown>
  ): void {
    const idx = this.constraints.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const current = this.constraints[idx];
    const next = { ...current, ...patch, id: current.id, type: current.type };
    this.constraints[idx] = cloneConstraint(next as RigConstraint);
    this.invalidateEvaluation();
  }

  removeConstraint(id: string): void {
    this.constraints = this.constraints.filter((c) => c.id !== id);
    for (const clip of this.clips) {
      if (clip.constraintTracks) {
        delete clip.constraintTracks[id];
      }
    }
    this.invalidateEvaluation();
  }

  moveConstraint(id: string, delta: -1 | 1): void {
    const idx = this.constraints.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= this.constraints.length) return;
    const [item] = this.constraints.splice(idx, 1);
    this.constraints.splice(targetIdx, 0, item);
    this.invalidateEvaluation();
  }

  setConstraintTargetKeyframe(
    constraintId: string,
    frame: number,
    x?: number,
    y?: number,
    easing: EasingMode = "linear"
  ): void {
    const constraint = this.constraints.find((c) => c.id === constraintId);
    if (!constraint || (constraint.type !== "ik" && constraint.type !== "aim")) {
      return;
    }
    const clip = this.getActiveClip();
    if (!clip.constraintTracks) clip.constraintTracks = {};
    const track = clip.constraintTracks[constraintId] ?? [];
    const current = this.getConstraintTargetAtFrame(constraintId, frame);
    const kf: ConstraintTargetKeyframe = {
      frame,
      targetX: x ?? current?.x ?? constraint.targetX,
      targetY: y ?? current?.y ?? constraint.targetY,
      easing,
    };
    const existingIdx = track.findIndex((k) => k.frame === frame);
    if (existingIdx >= 0) track[existingIdx] = kf;
    else {
      track.push(kf);
      track.sort((a, b) => a.frame - b.frame);
    }
    clip.constraintTracks[constraintId] = track;
    this.invalidateEvaluation();
  }

  deleteConstraintTargetKeyframe(constraintId: string, frame: number): void {
    const clip = this.getActiveClip();
    const track = clip.constraintTracks?.[constraintId];
    if (!track) return;
    const next = track.filter((k) => k.frame !== frame);
    if (next.length === 0 && clip.constraintTracks) {
      delete clip.constraintTracks[constraintId];
    } else if (clip.constraintTracks) {
      clip.constraintTracks[constraintId] = next;
    }
    this.invalidateEvaluation();
  }

  hasConstraintTargetKeyframe(constraintId: string, frame: number): boolean {
    const track = this.getActiveClip().constraintTracks?.[constraintId];
    return Boolean(track?.some((k) => k.frame === frame));
  }

  /**
   * Deterministic full evaluation: local pose (override ?? clip), FK with
   * scale, enabled constraints in list order, rotation limits after each
   * constraint. `computeWorldTransforms(frame, "pose")` wraps this method.
   */
  evaluate(
    frame: number,
    opts: RigEvaluateOptions = {}
  ): Map<string, BoneWorldTransform> {
    const useOverrides = opts.useOverrides ?? true;
    const applyConstraints = opts.applyConstraints ?? true;

    const locals = new Map<string, LocalBonePose>();
    for (const bone of this.bones) {
      const pose = this.getBonePoseAtFrame(bone.id, frame, useOverrides);
      locals.set(bone.id, {
        localX: pose.localX,
        localY: pose.localY,
        rotationDeg: pose.rotationDeg,
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
      });
    }

    const result = this.computeFk(locals);
    if (!applyConstraints || this.constraints.length === 0) {
      return result;
    }

    const childrenByParent = this.buildChildrenMap();
    for (const constraint of this.constraints) {
      if (constraint.enabled === false) continue;
      const mix = Number.isFinite(constraint.mix)
        ? clamp01(constraint.mix)
        : 1;
      if (mix <= 0) continue;

      const affected = this.applyConstraint(
        constraint,
        frame,
        mix,
        locals,
        result
      );
      for (const boneId of affected) {
        const bone = this.findBone(boneId);
        const local = locals.get(boneId);
        if (!bone || !local) continue;
        local.rotationDeg = clampLocalAngle(bone, local.rotationDeg);
        this.recomputeSubtree(result, locals, boneId, childrenByParent);
      }
    }

    return result;
  }

  computeWorldTransforms(
    frame: number,
    mode: "rest" | "pose",
    useOverrides = true
  ): Map<string, BoneWorldTransform> {
    if (mode === "rest") {
      const locals = new Map<string, LocalBonePose>();
      for (const bone of this.bones) {
        const bind = bindPoseOf(bone);
        locals.set(bone.id, {
          localX: bind.localX,
          localY: bind.localY,
          rotationDeg: bind.rotationDeg,
          scaleX: bind.scaleX,
          scaleY: bind.scaleY,
        });
      }
      return this.computeFk(locals);
    }
    return this.evaluate(frame, { useOverrides });
  }

  setPoseOverride(
    boneId: string,
    patch: Partial<BonePose>,
    frame: number
  ): void {
    const current = this.getBonePoseAtFrame(boneId, frame, true);
    this.currentPoseOverrides.set(boneId, {
      localX: patch.localX ?? current.localX,
      localY: patch.localY ?? current.localY,
      rotationDeg:
        patch.rotationDeg !== undefined
          ? normalizeAngleDeg(patch.rotationDeg)
          : current.rotationDeg,
      scaleX: patch.scaleX ?? current.scaleX,
      scaleY: patch.scaleY ?? current.scaleY,
      attachment:
        patch.attachment !== undefined ? patch.attachment : current.attachment,
    });
    this.invalidateEvaluation();
  }

  clearPoseOverrides(): void {
    if (this.currentPoseOverrides.size === 0) return;
    this.currentPoseOverrides.clear();
    this.invalidateEvaluation();
  }

  setKeyframe(
    boneId: string,
    frame: number,
    easing: EasingMode = "linear",
    curve?: CubicBezierHandles
  ): void {
    const pose = this.getBonePoseAtFrame(boneId, frame, true);
    const clip = this.getActiveClip();
    if (!clip.tracks[boneId]) {
      clip.tracks[boneId] = [];
    }
    const track = clip.tracks[boneId];
    const nextKey: BoneKeyframe = {
      frame,
      rotationDeg: normalizeAngleDeg(pose.rotationDeg),
      localX: pose.localX,
      localY: pose.localY,
      easing,
      scaleX: pose.scaleX,
      scaleY: pose.scaleY,
      attachment: pose.attachment,
    };
    if (curve) nextKey.curve = curve;

    const existingIdx = track.findIndex((k) => k.frame === frame);
    if (existingIdx >= 0) {
      track[existingIdx] = nextKey;
    } else {
      track.push(nextKey);
      track.sort((a, b) => a.frame - b.frame);
    }
    if (frame + 1 > clip.frameCount) {
      clip.frameCount = frame + 1;
    }
    this.invalidateEvaluation();
  }

  deleteKeyframe(boneId: string, frame: number): void {
    const clip = this.getActiveClip();
    const track = clip.tracks[boneId];
    if (!track) return;
    clip.tracks[boneId] = track.filter((k) => k.frame !== frame);
    this.invalidateEvaluation();
  }

  hasKeyframe(boneId: string, frame: number): boolean {
    const clip = this.getActiveClip();
    return Boolean(clip.tracks[boneId]?.some((k) => k.frame === frame));
  }

  /**
   * Auto-keys only the touched channels on `frame`, preserving any untouched
   * channels on an existing keyframe at `frame`.
   */
  autoKeyBone(
    boneId: string,
    frame: number,
    touched: Partial<BonePose>,
    easing: EasingMode = "easeInOut"
  ): void {
    const clip = this.getActiveClip();
    if (!clip.tracks[boneId]) clip.tracks[boneId] = [];
    const track = clip.tracks[boneId];
    const existing = track.find((k) => k.frame === frame);
    const currentPose = this.getBonePoseAtFrame(boneId, frame, true);

    const nextKey: BoneKeyframe = existing
      ? {
          ...existing,
          curve: existing.curve
            ? ([...existing.curve] as CubicBezierHandles)
            : undefined,
        }
      : {
          frame,
          rotationDeg: normalizeAngleDeg(currentPose.rotationDeg),
          easing,
        };

    if (touched.rotationDeg !== undefined) {
      nextKey.rotationDeg = normalizeAngleDeg(touched.rotationDeg);
    }
    if (touched.localX !== undefined) nextKey.localX = touched.localX;
    if (touched.localY !== undefined) nextKey.localY = touched.localY;
    if (touched.scaleX !== undefined) nextKey.scaleX = touched.scaleX;
    if (touched.scaleY !== undefined) nextKey.scaleY = touched.scaleY;
    if (touched.attachment !== undefined) {
      nextKey.attachment = touched.attachment;
    }

    const existingIdx = track.findIndex((k) => k.frame === frame);
    if (existingIdx >= 0) track[existingIdx] = nextKey;
    else {
      track.push(nextKey);
      track.sort((a, b) => a.frame - b.frame);
    }
    if (frame + 1 > clip.frameCount) {
      clip.frameCount = frame + 1;
    }
    this.invalidateEvaluation();
  }

  applyTwoBoneIK(
    childBoneId: string,
    targetX: number,
    targetY: number,
    frame: number,
    bendSign: 1 | -1 = 1
  ): boolean {
    const child = this.bones.find((b) => b.id === childBoneId);
    if (!child || !child.parentId) return false;
    const parent = this.bones.find((b) => b.id === child.parentId);
    if (!parent) return false;

    const worldMap = this.computeWorldTransforms(frame, "pose", true);
    const parentWorld = worldMap.get(parent.id);
    if (!parentWorld) return false;

    const grandParentWorldDeg = parent.parentId
      ? (worldMap.get(parent.parentId)?.worldRotationDeg ?? 0)
      : 0;

    const solved = solveTwoBoneIK(
      parentWorld.x,
      parentWorld.y,
      parent.length,
      child.length,
      targetX,
      targetY,
      bendSign
    );

    const parentLocalDeg = normalizeAngleDeg(
      solved.rootWorldDeg - grandParentWorldDeg
    );

    this.setPoseOverride(parent.id, { rotationDeg: parentLocalDeg }, frame);
    this.setPoseOverride(child.id, { rotationDeg: solved.childLocalDeg }, frame);
    return true;
  }

  seedStarterRig(
    canvasW: number,
    canvasH: number,
    rasterLayerIds: readonly string[]
  ): Bone {
    this.reset();
    const cx = Math.round(canvasW / 2);
    const baseY = Math.round(canvasH * 0.78);
    const segLen = Math.max(4, Math.round(canvasH * 0.28));

    const root = this.addBone({
      name: "Root",
      parentId: null,
      localX: cx,
      localY: baseY,
      length: segLen,
      rotationDeg: -90,
      boundLayerId: rasterLayerIds[rasterLayerIds.length - 1] ?? null,
    });

    const upper = this.addBone({
      name: "Body",
      parentId: root.id,
      localX: segLen,
      localY: 0,
      length: segLen,
      rotationDeg: 0,
      boundLayerId: rasterLayerIds.length > 1 ? rasterLayerIds[0] : null,
    });

    // Subtle 4-frame idle sway keyframes
    const clip = this.getActiveClip();
    clip.frameCount = 4;
    clip.tracks[root.id] = [
      { frame: 0, rotationDeg: -90, localX: cx, localY: baseY, easing: "easeInOut" },
      { frame: 1, rotationDeg: -84, localX: cx, localY: baseY, easing: "easeInOut" },
      { frame: 2, rotationDeg: -90, localX: cx, localY: baseY, easing: "easeInOut" },
      { frame: 3, rotationDeg: -96, localX: cx, localY: baseY, easing: "easeInOut" },
    ];
    clip.tracks[upper.id] = [
      { frame: 0, rotationDeg: 0, localX: segLen, localY: 0, easing: "easeInOut" },
      { frame: 1, rotationDeg: 8, localX: segLen, localY: 0, easing: "easeInOut" },
      { frame: 2, rotationDeg: 0, localX: segLen, localY: 0, easing: "easeInOut" },
      { frame: 3, rotationDeg: -8, localX: segLen, localY: 0, easing: "easeInOut" },
    ];
    this.invalidateEvaluation();

    return root;
  }

  serializeRuntimeJson(canvasW: number, canvasH: number): string {
    return JSON.stringify(
      {
        schema: "pixet-rig-v1",
        canvas: { width: canvasW, height: canvasH },
        bones: this.bones,
        clips: this.clips,
      },
      null,
      2
    );
  }

  toSnapshot(): RigSnapshot {
    const masks: RigMaskSnapshot[] = [];
    for (const [boneId, mask] of this.boneMasks.entries()) {
      const indices: number[] = [];
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i] > 0) indices.push(i);
      }
      if (indices.length > 0) {
        masks.push({
          boneId,
          width: mask.width,
          height: mask.height,
          indices,
        });
      }
    }

    const weights = this.getBoneWeights();

    return {
      version: RIG_SNAPSHOT_VERSION,
      bones: this.bones.map((b) => ({ ...b })),
      clips: this.clips.map((c) => {
        const clip: RigClip = {
          id: c.id,
          name: c.name,
          frameCount: c.frameCount,
          tracks: Object.fromEntries(
            Object.entries(c.tracks).map(([k, arr]) => [
              k,
              arr.map((kf) => ({ ...kf })),
            ])
          ),
        };
        if (c.constraintTracks) {
          clip.constraintTracks = Object.fromEntries(
            Object.entries(c.constraintTracks).map(([k, arr]) => [
              k,
              arr.map((kf) => ({ ...kf })),
            ])
          );
        }
        if (c.meshTracks) {
          clip.meshTracks = Object.fromEntries(
            Object.entries(c.meshTracks).map(([k, arr]) => [
              k,
              arr.map((kf) => ({
                ...kf,
                offsets: kf.offsets.map((value) => [value[0], value[1]] as [number, number]),
              })),
            ])
          );
        }
        if (c.loop !== undefined) clip.loop = c.loop;
        return clip;
      }),
      activeClipId: this.activeClipId,
      constraints: this.constraints.map(cloneConstraint),
      slots: this.slots.map((slot) => ({
        ...slot,
        attachments: Object.fromEntries(
          Object.entries(slot.attachments).map(([key, attachment]) => [
            key,
            { ...attachment },
          ])
        ),
      })),
      poses: this.poses.map((pose) => ({
        ...pose,
        bones: Object.fromEntries(
          Object.entries(pose.bones).map(([boneId, bonePose]) => [
            boneId,
            { ...bonePose },
          ])
        ),
      })),
      weights: weights ? serializeBoneWeights(weights) : null,
      masks,
      meshes: this.meshes.map(cloneMesh),
    };
  }

  fromSnapshot(snap: unknown): void {
    this.reset();
    if (!snap || typeof snap !== "object") return;
    const raw = snap as Record<string, unknown>;

    if (Array.isArray(raw.bones)) {
      this.bones = (raw.bones as Bone[]).map((b) => ({ ...b }));
      let maxNum = this.bones.length;
      for (const b of this.bones) {
        const m = /(\d+)$/.exec(b.id);
        if (m) {
          maxNum = Math.max(maxNum, Number(m[1]));
        }
      }
      this.nextBoneNum = maxNum + 1;
    }

    if (Array.isArray(raw.clips) && raw.clips.length > 0) {
      this.clips = (raw.clips as RigClip[]).map((c) => {
        const clip: RigClip = {
          id: c.id,
          name: c.name,
          frameCount: Math.max(1, c.frameCount ?? 4),
          tracks: Object.fromEntries(
            Object.entries(c.tracks ?? {}).map(([k, arr]) => [
              k,
              Array.isArray(arr) ? arr.map((kf) => ({ ...kf })) : [],
            ])
          ),
        };
        if (c.constraintTracks && typeof c.constraintTracks === "object") {
          clip.constraintTracks = Object.fromEntries(
            Object.entries(c.constraintTracks).map(([k, arr]) => [
              k,
              Array.isArray(arr) ? arr.map((kf) => ({ ...kf })) : [],
            ])
          );
        }
        if (typeof c.loop === "boolean") clip.loop = c.loop;
        if (c.meshTracks && typeof c.meshTracks === "object") {
          const meshTracks: Record<string, RigMeshKeyframe[]> = {};
          for (const [meshId, arr] of Object.entries(c.meshTracks)) {
            if (!Array.isArray(arr)) continue;
            meshTracks[meshId] = arr
              .filter((kf) => isRecord(kf) && typeof kf.frame === "number")
              .map((kf) => ({
                frame: kf.frame,
                offsets: Array.isArray(kf.offsets)
                  ? kf.offsets
                      .filter((value) => Array.isArray(value) && value.length >= 2)
                      .map((value) => [value[0], value[1]] as [number, number])
                  : [],
                easing: kf.easing,
              }));
          }
          clip.meshTracks = meshTracks;
        }
        return clip;
      });
    }

    if (
      typeof raw.activeClipId === "string" &&
      this.clips.some((c) => c.id === raw.activeClipId)
    ) {
      this.activeClipId = raw.activeClipId;
    } else {
      this.activeClipId = this.clips[0].id;
    }

    if (Array.isArray(raw.constraints)) {
      this.constraints = (raw.constraints as RigConstraint[])
        .filter(
          (constraint) =>
            isRecord(constraint) &&
            typeof constraint.id === "string" &&
            typeof constraint.type === "string"
        )
        .map(cloneConstraint);
      for (const constraint of this.constraints) {
        const match = /(\d+)$/.exec(constraint.id);
        if (match) {
          this.nextConstraintNum = Math.max(
            this.nextConstraintNum,
            Number(match[1]) + 1
          );
        }
      }
    }

    if (Array.isArray(raw.slots)) {
      this.slots = (raw.slots as RigSlot[])
        .filter((slot) => isRecord(slot) && typeof slot.id === "string")
        .map((slot) => ({
          ...slot,
          attachments: Object.fromEntries(
            Object.entries(slot.attachments ?? {}).map(([key, attachment]) => [
              key,
              { ...attachment },
            ])
          ),
        }));
    }

    if (Array.isArray(raw.poses)) {
      this.poses = (raw.poses as RigPose[])
        .filter((pose) => isRecord(pose) && typeof pose.id === "string")
        .map((pose) => ({
          ...pose,
          bones: Object.fromEntries(
            Object.entries(pose.bones ?? {}).map(([boneId, bonePose]) => [
              boneId,
              { ...bonePose },
            ])
          ),
        }));
      for (const pose of this.poses) {
        const match = /(\d+)$/.exec(pose.id);
        if (match) {
          this.nextPoseNum = Math.max(this.nextPoseNum, Number(match[1]) + 1);
        }
      }
    }
    for (const clip of this.clips) {
      const match = /(\d+)$/.exec(clip.id);
      if (match) {
        this.nextClipNum = Math.max(this.nextClipNum, Number(match[1]) + 1);
      }
    }

    if (Array.isArray(raw.meshes)) {
      this.meshes = (raw.meshes as RigMesh[])
        .filter(
          (mesh) =>
            isRecord(mesh) &&
            typeof mesh.id === "string" &&
            Array.isArray(mesh.vertices) &&
            Array.isArray(mesh.triangles)
        )
        .map(cloneMesh);
      for (const mesh of this.meshes) {
        const match = /(\d+)$/.exec(mesh.id);
        if (match) {
          this.nextMeshNum = Math.max(this.nextMeshNum, Number(match[1]) + 1);
        }
      }
    }

    if (Array.isArray(raw.masks)) {
      for (const m of raw.masks) {
        if (
          !m ||
          typeof m.boneId !== "string" ||
          typeof m.width !== "number" ||
          typeof m.height !== "number" ||
          m.width <= 0 ||
          m.height <= 0 ||
          !Array.isArray(m.indices)
        ) {
          continue;
        }
        const len = m.width * m.height;
        const data = new Uint8Array(len);
        for (const idx of m.indices) {
          if (Number.isInteger(idx) && idx >= 0 && idx < len) {
            data[idx] = 1;
          }
        }
        this.boneMasks.set(m.boneId, {
          width: m.width,
          height: m.height,
          data,
        });
      }
    }

    const weights = parseBoneWeights(raw.weights);
    if (weights) {
      this.skinWeights = weights;
      this.cachedWeights = weights;
      this.cachedWeightsRevision = this.revision;
      if (this.boneMasks.size === 0) {
        this.rebuildMasksFromWeights();
      }
    }
  }
}

function removeBoneFromWeights(weights: BoneWeights, boneId: string): boolean {
  let changed = false;
  for (const [index, influences] of weights.entries) {
    if (!influences.some((influence) => influence.boneId === boneId)) continue;
    changed = true;
    const normalized = normalizeInfluences(
      influences.filter((influence) => influence.boneId !== boneId)
    );
    if (normalized.length === 0) weights.entries.delete(index);
    else weights.entries.set(index, normalized);
  }
  return changed;
}

function cloneMesh(mesh: RigMesh): RigMesh {
  const clone: RigMesh = {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => ({
      ...vertex,
      weights: vertex.weights
        ? vertex.weights.map((influence) => ({ ...influence }))
        : undefined,
    })),
    triangles: [...mesh.triangles],
  };
  return clone;
}

function cloneConstraint(constraint: RigConstraint): RigConstraint {
  switch (constraint.type) {
    case "ik":
      return { ...constraint, boneIds: [...constraint.boneIds] };
    case "aim":
      return { ...constraint };
    case "copyRotation":
    case "copyTransform":
      return { ...constraint };
    case "spring":
      return { ...constraint };
  }
}

function constraintReferencesBone(
  constraint: RigConstraint,
  boneId: string
): boolean {
  switch (constraint.type) {
    case "ik":
      return constraint.boneIds.includes(boneId);
    case "aim":
    case "spring":
      return constraint.boneId === boneId;
    case "copyRotation":
    case "copyTransform":
      return constraint.boneId === boneId || constraint.sourceBoneId === boneId;
  }
}

/**
 * Draws per-bone color-coded influence masks onto `overlay` for live visual
 * preview. Pass `mode: "heatmap"` to show the selected bone's weight as an
 * alpha heatmap instead (R6 default in the UI).
 */
export function renderBoneInfluenceOverlay(
  rig: RigState,
  overlay: PixelBuffer,
  selectedBoneId: string | null,
  opts: { mode?: "boneColors" | "heatmap" } = {}
): void {
  if (opts.mode === "heatmap") {
    renderBoneWeightHeatmap(rig, overlay, selectedBoneId);
    return;
  }

  const w = overlay.width;
  const h = overlay.height;
  const out = overlay.data;

  for (let bi = 0; bi < rig.bones.length; bi++) {
    const bone = rig.bones[bi];
    const mask = rig.getBoneMask(bone.id);
    if (!mask || mask.width !== w || mask.height !== h) continue;

    const color = getBoneInfluenceColor(bi);
    const alpha = bone.id === selectedBoneId ? 145 : 65;
    const len = w * h;
    for (let i = 0; i < len; i++) {
      if (mask.data[i] === 0) continue;
      const pIdx = i * 4;
      out[pIdx] = color[0];
      out[pIdx + 1] = color[1];
      out[pIdx + 2] = color[2];
      out[pIdx + 3] = alpha;
    }
  }

  overlay.markAllDirty();
}

/**
 * R6 --- selected-bone weight heatmap: one flat accent color whose alpha is
 * proportional to that bone's weight (0..1) at each pixel.
 */
export function renderBoneWeightHeatmap(
  rig: RigState,
  overlay: PixelBuffer,
  boneId: string | null
): void {
  if (!boneId) return;
  const weights = rig.getBoneWeights();
  if (!weights) return;
  if (weights.width !== overlay.width || weights.height !== overlay.height) return;

  const out = overlay.data;
  const color = getBoneInfluenceColor(0);
  for (const [index, influences] of weights.entries) {
    let weight = 0;
    for (const influence of influences) {
      if (influence.boneId === boneId) {
        weight = influence.w;
        break;
      }
    }
    if (weight <= 0.01) continue;
    const pIdx = index * 4;
    out[pIdx] = color[0];
    out[pIdx + 1] = color[1];
    out[pIdx + 2] = color[2];
    out[pIdx + 3] = Math.round(Math.max(0, Math.min(1, weight)) * 220);
  }
  overlay.markAllDirty();
}
