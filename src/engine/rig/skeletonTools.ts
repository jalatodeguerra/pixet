import {
  normalizeAngleDeg,
  type Bone,
  type BoneKeyframe,
  type RigState,
} from "./RigEngine.ts";

/**
 * Returns `[rootId, ...descendants]` in parent-before-child order,
 * guarding against cyclic parent links.
 */
export function getBoneSubtreeIds(
  bones: readonly Bone[],
  rootId: string
): string[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  if (!byId.has(rootId)) return [];

  const childrenByParent = new Map<string, string[]>();
  for (const bone of bones) {
    if (!bone.parentId) continue;
    const list = childrenByParent.get(bone.parentId);
    if (list) list.push(bone.id);
    else childrenByParent.set(bone.parentId, [bone.id]);
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    const children = childrenByParent.get(id);
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (!visited.has(children[i])) stack.push(children[i]);
      }
    }
  }
  return result;
}

/**
 * Returns true if `candidateId` is a strict descendant of `ancestorId`.
 */
export function isDescendantBone(
  bones: readonly Bone[],
  ancestorId: string,
  candidateId: string
): boolean {
  if (ancestorId === candidateId) return false;
  const byId = new Map(bones.map((b) => [b.id, b]));
  const visited = new Set<string>([candidateId]);
  let cur = byId.get(candidateId)?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    if (visited.has(cur)) break;
    visited.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

function worldToLocalTransform(
  worldX: number,
  worldY: number,
  worldRotDeg: number,
  worldScaleX: number,
  worldScaleY: number,
  parent:
    | {
        x: number;
        y: number;
        worldRotationDeg: number;
        worldScaleX: number;
        worldScaleY: number;
      }
    | undefined
): {
  localX: number;
  localY: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
} {
  if (!parent) {
    return {
      localX: worldX,
      localY: worldY,
      rotationDeg: normalizeAngleDeg(worldRotDeg),
      scaleX: worldScaleX,
      scaleY: worldScaleY,
    };
  }
  const rad = (-parent.worldRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = worldX - parent.x;
  const dy = worldY - parent.y;
  const sx = Math.abs(parent.worldScaleX) < 1e-6 ? 1 : parent.worldScaleX;
  const sy = Math.abs(parent.worldScaleY) < 1e-6 ? 1 : parent.worldScaleY;
  return {
    localX: (dx * cos - dy * sin) / sx,
    localY: (dx * sin + dy * cos) / sy,
    rotationDeg: normalizeAngleDeg(worldRotDeg - parent.worldRotationDeg),
    scaleX: worldScaleX / sx,
    scaleY: worldScaleY / sy,
  };
}

/**
 * Reparents `boneId` under `newParentId` while preserving its rest-pose world
 * position, rotation, and scale. Optionally moves the bone to `insertIndex`
 * in `rig.bones`.
 */
export function reparentBonePreserveWorld(
  rig: RigState,
  boneId: string,
  newParentId: string | null,
  insertIndex?: number
): boolean {
  const bone = rig.bones.find((b) => b.id === boneId);
  if (!bone) return false;
  if (newParentId === boneId) return false;
  if (newParentId !== null) {
    if (!rig.bones.some((b) => b.id === newParentId)) return false;
    if (isDescendantBone(rig.bones, boneId, newParentId)) return false;
  }

  const rest = rig.computeWorldTransforms(0, "rest", false);
  const w = rest.get(boneId);
  if (!w) return false;

  const p = newParentId ? rest.get(newParentId) : undefined;
  const local = worldToLocalTransform(
    w.x,
    w.y,
    w.worldRotationDeg,
    w.worldScaleX,
    w.worldScaleY,
    p
  );

  rig.updateBone(boneId, {
    parentId: newParentId,
    localX: local.localX,
    localY: local.localY,
    rotationDeg: local.rotationDeg,
    scaleX: local.scaleX,
    scaleY: local.scaleY,
  });

  if (insertIndex !== undefined) {
    const currentIdx = rig.bones.findIndex((b) => b.id === boneId);
    if (currentIdx !== -1) {
      const [moved] = rig.bones.splice(currentIdx, 1);
      const targetIdx = Math.max(
        0,
        Math.min(
          rig.bones.length,
          currentIdx < insertIndex ? insertIndex - 1 : insertIndex
        )
      );
      rig.bones.splice(targetIdx, 0, moved);
      rig.invalidateEvaluation();
    }
  }
  return true;
}

const MIRROR_NAME_RULES: ReadonlyArray<[RegExp, string]> = [
  [/\.L(?=$|[^a-zA-Z0-9])/, ".R"],
  [/\.R(?=$|[^a-zA-Z0-9])/, ".L"],
  [/\.l(?=$|[^a-zA-Z0-9])/, ".r"],
  [/\.r(?=$|[^a-zA-Z0-9])/, ".l"],
  [/_L(?=$|[^a-zA-Z0-9])/, "_R"],
  [/_R(?=$|[^a-zA-Z0-9])/, "_L"],
  [/_l(?=$|[^a-zA-Z0-9])/, "_r"],
  [/_r(?=$|[^a-zA-Z0-9])/, "_l"],
  [/-L(?=$|[^a-zA-Z0-9])/, "-R"],
  [/-R(?=$|[^a-zA-Z0-9])/, "-L"],
  [/-l(?=$|[^a-zA-Z0-9])/, "-r"],
  [/-r(?=$|[^a-zA-Z0-9])/, "-l"],
  [/LEFT/, "RIGHT"],
  [/RIGHT/, "LEFT"],
  [/Left/, "Right"],
  [/Right/, "Left"],
  [/left/, "right"],
  [/right/, "left"],
];

/**
 * Swaps standard L/R tokens in a bone name (e.g. `Arm.L` -> `Arm.R`,
 * `arm_l` -> `arm_r`, `LeftLeg` -> `RightLeg`). Falls back to `_M`.
 */
export function mirrorBoneName(name: string): string {
  for (const [pattern, replacement] of MIRROR_NAME_RULES) {
    if (pattern.test(name)) {
      return name.replace(pattern, replacement);
    }
  }
  return `${name}_M`;
}

/**
 * Duplicates the selected bone subtrees mirrored across vertical line `x = axisX`.
 * Returns newly created bone IDs and a `sourceId -> mirroredId` map.
 */
export function mirrorBones(
  rig: RigState,
  rootBoneIds: readonly string[],
  axisX: number,
  options?: { mirrorKeyframes?: boolean; clipId?: string }
): { createdIds: string[]; idMap: Map<string, string> } {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const selectedSet = new Set(rootBoneIds.filter((id) => byId.has(id)));
  const topRoots = [...selectedSet].filter((id) => {
    let cur = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>([id]);
    while (cur) {
      if (selectedSet.has(cur)) return false;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    return true;
  });

  const orderedSourceIds: string[] = [];
  const seenOrder = new Set<string>();
  for (const rootId of topRoots) {
    for (const id of getBoneSubtreeIds(rig.bones, rootId)) {
      if (!seenOrder.has(id)) {
        seenOrder.add(id);
        orderedSourceIds.push(id);
      }
    }
  }

  const rest = rig.computeWorldTransforms(0, "rest", false);
  const idMap = new Map<string, string>();
  const createdIds: string[] = [];
  const mirroredWorld = new Map<
    string,
    {
      x: number;
      y: number;
      worldRotationDeg: number;
      worldScaleX: number;
      worldScaleY: number;
    }
  >();

  for (const srcId of orderedSourceIds) {
    const src = byId.get(srcId);
    const w = rest.get(srcId);
    if (!src || !w) continue;

    const mx = 2 * axisX - w.x;
    const my = w.y;
    const mRot = normalizeAngleDeg(180 - w.worldRotationDeg);
    const newParentId =
      src.parentId && idMap.has(src.parentId)
        ? idMap.get(src.parentId)!
        : src.parentId;
    const parentWorld = newParentId
      ? (mirroredWorld.get(newParentId) ?? rest.get(newParentId))
      : undefined;

    const local = worldToLocalTransform(
      mx,
      my,
      mRot,
      w.worldScaleX,
      w.worldScaleY,
      parentWorld
    );

    const minAngleDeg =
      src.maxAngleDeg !== undefined ? -src.maxAngleDeg : undefined;
    const maxAngleDeg =
      src.minAngleDeg !== undefined ? -src.minAngleDeg : undefined;

    const created = rig.addBone({
      name: mirrorBoneName(src.name),
      parentId: newParentId,
      localX: local.localX,
      localY: local.localY,
      length: src.length,
      rotationDeg: local.rotationDeg,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
      color: src.color,
      boundLayerId: null,
      minAngleDeg,
      maxAngleDeg,
    });

    idMap.set(srcId, created.id);
    createdIds.push(created.id);
    mirroredWorld.set(created.id, {
      x: mx,
      y: my,
      worldRotationDeg: mRot,
      worldScaleX: w.worldScaleX,
      worldScaleY: w.worldScaleY,
    });
  }

  if (options?.mirrorKeyframes && idMap.size > 0) {
    const clip = options.clipId
      ? rig.clips.find((c) => c.id === options.clipId)
      : rig.getActiveClip();
    if (clip) {
      for (const [srcId, dstId] of idMap) {
        const srcTrack = clip.tracks[srcId];
        const srcBone = byId.get(srcId);
        if (!srcTrack || !srcBone) continue;
        const parentMirrored = Boolean(
          srcBone.parentId && idMap.has(srcBone.parentId)
        );
        const parentWorldDeg = srcBone.parentId
          ? (rest.get(srcBone.parentId)?.worldRotationDeg ?? 0)
          : 0;

        clip.tracks[dstId] = srcTrack.map((kf): BoneKeyframe => {
          const mirroredRot = parentMirrored
            ? normalizeAngleDeg(-kf.rotationDeg)
            : normalizeAngleDeg(180 - 2 * parentWorldDeg - kf.rotationDeg);
          const next: BoneKeyframe = {
            frame: kf.frame,
            rotationDeg: mirroredRot,
            easing: kf.easing,
          };
          if (kf.localX !== undefined) next.localX = kf.localX;
          if (kf.localY !== undefined) next.localY = kf.localY;
          if (kf.scaleX !== undefined) next.scaleX = kf.scaleX;
          if (kf.scaleY !== undefined) next.scaleY = kf.scaleY;
          if (kf.attachment !== undefined) next.attachment = kf.attachment;
          if (kf.curve) next.curve = [...kf.curve];
          return next;
        });
      }
      rig.invalidateEvaluation();
    }
  }

  return { createdIds, idMap };
}

/**
 * Copies the evaluated pose from each source bone to its mirrored L/R
 * counterpart (matched by `mirrorBoneName`). Returns the count of updated bones.
 */
export function mirrorPose(
  rig: RigState,
  sourceBoneIds: readonly string[],
  frame: number
): number {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const byLowerName = new Map(
    rig.bones.map((b) => [b.name.toLowerCase(), b])
  );
  const rest = rig.computeWorldTransforms(0, "rest", false);
  let count = 0;

  for (const srcId of sourceBoneIds) {
    const src = byId.get(srcId);
    if (!src) continue;
    const target = byLowerName.get(mirrorBoneName(src.name).toLowerCase());
    if (!target || target.id === src.id) continue;

    const pose = rig.getBonePoseAtFrame(src.id, frame, true);
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
      mirroredRot = normalizeAngleDeg(-pose.rotationDeg);
    } else {
      const pDeg = src.parentId
        ? (rest.get(src.parentId)?.worldRotationDeg ?? 0)
        : 0;
      mirroredRot = normalizeAngleDeg(180 - 2 * pDeg - pose.rotationDeg);
    }

    rig.setPoseOverride(
      target.id,
      {
        rotationDeg: mirroredRot,
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
      },
      frame
    );
    count++;
  }
  return count;
}

/** Snaps an angle in degrees to the nearest `step` (default 22.5 deg). */
export function snapAngleDeg(deg: number, step = 22.5): number {
  return normalizeAngleDeg(Math.round(deg / step) * step);
}

/** Snaps a coordinate to the nearest pixel center (`floor(v) + 0.5`). */
export function snapToPixelCenter(value: number): number {
  return Math.floor(value) + 0.5;
}
