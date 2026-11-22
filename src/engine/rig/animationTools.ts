import {
  lerpAngleDeg,
  normalizeAngleDeg,
  type BoneKeyframe,
  type CubicBezierHandles,
  type EasingMode,
  type RigClip,
  type RigPose,
  type RigState,
} from "./RigEngine.ts";
import { mirrorBoneName } from "./skeletonTools.ts";

export interface RigKeyRef {
  boneId: string;
  frame: number;
}

export interface CopiedRigKeyframe {
  boneId: string;
  offsetFrame: number;
  keyframe: BoneKeyframe;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cloneKeyframe(kf: BoneKeyframe): BoneKeyframe {
  return {
    ...kf,
    curve: kf.curve ? ([...kf.curve] as CubicBezierHandles) : undefined,
  };
}

/**
 * Retimes a batch of keyframes without overwriting collisions between moved
 * keys, keeping every affected track sorted by frame.
 */
export function retimeKeyframes(
  clip: RigClip,
  moves: ReadonlyArray<{ boneId: string; fromFrame: number; toFrame: number }>
): boolean {
  if (moves.length === 0) return false;
  const extracted: Array<{ boneId: string; toFrame: number; kf: BoneKeyframe }> =
    [];
  const byBone = new Map<string, Set<number>>();
  for (const m of moves) {
    let set = byBone.get(m.boneId);
    if (!set) {
      set = new Set();
      byBone.set(m.boneId, set);
    }
    set.add(m.fromFrame);
  }

  for (const m of moves) {
    const track = clip.tracks[m.boneId];
    if (!track) continue;
    const kf = track.find((k) => k.frame === m.fromFrame);
    if (!kf) continue;
    const toFrame = Math.max(0, Math.round(m.toFrame));
    extracted.push({ boneId: m.boneId, toFrame, kf: cloneKeyframe(kf) });
  }
  if (extracted.length === 0) return false;

  for (const [boneId, fromFrames] of byBone) {
    const track = clip.tracks[boneId];
    if (!track) continue;
    clip.tracks[boneId] = track.filter((k) => !fromFrames.has(k.frame));
  }

  for (const item of extracted) {
    if (!clip.tracks[item.boneId]) clip.tracks[item.boneId] = [];
    const track = clip.tracks[item.boneId];
    item.kf.frame = item.toFrame;
    const existingIdx = track.findIndex((k) => k.frame === item.toFrame);
    if (existingIdx >= 0) track[existingIdx] = item.kf;
    else track.push(item.kf);
    if (item.toFrame + 1 > clip.frameCount) {
      clip.frameCount = item.toFrame + 1;
    }
  }

  for (const boneId of byBone.keys()) {
    clip.tracks[boneId]?.sort((a, b) => a.frame - b.frame);
  }
  return true;
}

/**
 * Copies the referenced keyframes from `clip` with frame offsets relative to
 * the earliest copied frame.
 */
export function copyKeyframes(
  clip: RigClip,
  refs: readonly RigKeyRef[]
): CopiedRigKeyframe[] {
  const found: Array<{ boneId: string; kf: BoneKeyframe }> = [];
  for (const ref of refs) {
    const kf = clip.tracks[ref.boneId]?.find((k) => k.frame === ref.frame);
    if (kf) found.push({ boneId: ref.boneId, kf: cloneKeyframe(kf) });
  }
  if (found.length === 0) return [];
  let minFrame = Infinity;
  for (const item of found) {
    if (item.kf.frame < minFrame) minFrame = item.kf.frame;
  }
  return found.map((item) => ({
    boneId: item.boneId,
    offsetFrame: item.kf.frame - minFrame,
    keyframe: item.kf,
  }));
}

/**
 * Pastes `copied` keyframes starting at `targetFrame`, replacing any existing
 * key at the destination frame and keeping tracks sorted.
 */
export function pasteKeyframes(
  clip: RigClip,
  copied: readonly CopiedRigKeyframe[],
  targetFrame: number
): number {
  if (copied.length === 0) return 0;
  let count = 0;
  const touchedBones = new Set<string>();
  for (const item of copied) {
    const destFrame = Math.max(0, Math.round(targetFrame + item.offsetFrame));
    if (!clip.tracks[item.boneId]) clip.tracks[item.boneId] = [];
    const track = clip.tracks[item.boneId];
    const next = cloneKeyframe(item.keyframe);
    next.frame = destFrame;
    const existingIdx = track.findIndex((k) => k.frame === destFrame);
    if (existingIdx >= 0) track[existingIdx] = next;
    else track.push(next);
    if (destFrame + 1 > clip.frameCount) {
      clip.frameCount = destFrame + 1;
    }
    touchedBones.add(item.boneId);
    count++;
  }
  for (const boneId of touchedBones) {
    clip.tracks[boneId]?.sort((a, b) => a.frame - b.frame);
  }
  return count;
}

export function setKeyframeEasing(
  clip: RigClip,
  boneId: string,
  frame: number,
  easing: EasingMode,
  curve?: CubicBezierHandles
): boolean {
  const kf = clip.tracks[boneId]?.find((k) => k.frame === frame);
  if (!kf) return false;
  kf.easing = easing;
  if (easing === "bezier") {
    kf.curve = curve ? ([...curve] as CubicBezierHandles) : kf.curve ?? [0.25, 0.1, 0.25, 1];
  } else {
    delete kf.curve;
  }
  return true;
}

/**
 * Captures the evaluated local pose of `boneIds` (or all bones) at `frame`.
 */
export function capturePose(
  rig: RigState,
  name: string,
  frame: number,
  boneIds?: readonly string[],
  id?: string
): RigPose {
  const targetIds =
    boneIds && boneIds.length > 0
      ? boneIds
      : rig.bones.map((b) => b.id);
  const bones: RigPose["bones"] = {};
  for (const boneId of targetIds) {
    if (!rig.bones.some((b) => b.id === boneId)) continue;
    const pose = rig.getBonePoseAtFrame(boneId, frame, true);
    bones[boneId] = {
      rotationDeg: pose.rotationDeg,
      localX: pose.localX,
      localY: pose.localY,
      scaleX: pose.scaleX,
      scaleY: pose.scaleY,
    };
  }
  return {
    id: id ?? `pose-${Date.now().toString(36)}`,
    name: name.trim() || "Pose",
    bones,
  };
}

/**
 * Applies `pose` to `rig` at `frame`, blending from the current pose by
 * `blend` (0..1). When `autoKey` is true, also keys each affected bone.
 */
export function applyPose(
  rig: RigState,
  pose: RigPose,
  frame: number,
  blend = 1,
  autoKey = false
): number {
  const t = clamp01(blend);
  let count = 0;
  for (const [boneId, target] of Object.entries(pose.bones)) {
    if (!rig.bones.some((b) => b.id === boneId)) continue;
    const cur = rig.getBonePoseAtFrame(boneId, frame, true);
    const nextRot = lerpAngleDeg(cur.rotationDeg, target.rotationDeg, t);
    const nextX = lerp(cur.localX, target.localX, t);
    const nextY = lerp(cur.localY, target.localY, t);
    const nextSx = lerp(cur.scaleX, target.scaleX ?? 1, t);
    const nextSy = lerp(cur.scaleY, target.scaleY ?? 1, t);
    rig.setPoseOverride(
      boneId,
      {
        rotationDeg: nextRot,
        localX: nextX,
        localY: nextY,
        scaleX: nextSx,
        scaleY: nextSy,
      },
      frame
    );
    if (autoKey) {
      rig.setKeyframe(boneId, frame);
    }
    count++;
  }
  return count;
}

/**
 * Applies `pose` mirrored across L/R bone names at `frame`.
 */
export function pasteMirroredPose(
  rig: RigState,
  pose: RigPose,
  frame: number,
  autoKey = false
): number {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const byLowerName = new Map(
    rig.bones.map((b) => [b.name.toLowerCase(), b])
  );
  const rest = rig.computeWorldTransforms(0, "rest", false);
  let count = 0;

  for (const [srcId, srcPose] of Object.entries(pose.bones)) {
    const src = byId.get(srcId);
    if (!src) continue;
    const target = byLowerName.get(mirrorBoneName(src.name).toLowerCase());
    if (!target) continue;

    const srcParent = src.parentId ? byId.get(src.parentId) : undefined;
    const targetParent = target.parentId
      ? byId.get(target.parentId)
      : undefined;
    const parentMirrored = Boolean(
      srcParent &&
        targetParent &&
        mirrorBoneName(srcParent.name).toLowerCase() ===
          targetParent.name.toLowerCase()
    );

    let mirroredRot: number;
    if (parentMirrored) {
      mirroredRot = normalizeAngleDeg(-srcPose.rotationDeg);
    } else {
      const pDeg = src.parentId
        ? (rest.get(src.parentId)?.worldRotationDeg ?? 0)
        : 0;
      mirroredRot = normalizeAngleDeg(180 - 2 * pDeg - srcPose.rotationDeg);
    }

    rig.setPoseOverride(
      target.id,
      {
        rotationDeg: mirroredRot,
        scaleX: srcPose.scaleX ?? 1,
        scaleY: srcPose.scaleY ?? 1,
      },
      frame
    );
    if (autoKey) {
      rig.setKeyframe(target.id, frame);
    }
    count++;
  }
  return count;
}
