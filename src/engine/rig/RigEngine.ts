import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";

export type EasingMode = "linear" | "step" | "easeInOut";

export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  localX: number;
  localY: number;
  length: number;
  rotationDeg: number;
  boundLayerId: string | null;
}

export interface BonePose {
  localX: number;
  localY: number;
  rotationDeg: number;
}

export interface BoneWorldTransform {
  id: string;
  x: number;
  y: number;
  tipX: number;
  tipY: number;
  worldRotationDeg: number;
  length: number;
}

export interface BoneKeyframe {
  frame: number;
  rotationDeg: number;
  localX?: number;
  localY?: number;
  easing?: EasingMode;
}

export interface RigClip {
  id: string;
  name: string;
  frameCount: number;
  tracks: Record<string, BoneKeyframe[]>;
}

export interface RigRenderOptions {
  pixelSnap: boolean;
  rotSprite: boolean;
}

export interface BoneMask {
  width: number;
  height: number;
  data: Uint8Array;
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

export function evaluateEasing(t: number, easing: EasingMode): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (easing === "step") {
    return clamped >= 1 ? 1 : 0;
  }
  if (easing === "easeInOut") {
    return clamped * clamped * (3 - 2 * clamped);
  }
  return clamped;
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

export class RigState {
  bones: Bone[] = [];
  clips: RigClip[] = [
    { id: "clip-idle", name: "idle", frameCount: 4, tracks: {} },
  ];
  activeClipId = "clip-idle";
  currentPoseOverrides = new Map<string, BonePose>();
  boneMasks = new Map<string, BoneMask>();
  private nextBoneNum = 1;

  reset(): void {
    this.bones = [];
    this.clips = [
      { id: "clip-idle", name: "idle", frameCount: 4, tracks: {} },
    ];
    this.activeClipId = "clip-idle";
    this.currentPoseOverrides.clear();
    this.boneMasks.clear();
    this.nextBoneNum = 1;
  }

  getActiveClip(): RigClip {
    return (
      this.clips.find((c) => c.id === this.activeClipId) ?? this.clips[0]
    );
  }

  addBone(partial: {
    name?: string;
    parentId: string | null;
    localX: number;
    localY: number;
    length: number;
    rotationDeg: number;
    boundLayerId?: string | null;
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
    this.bones.push(bone);
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
    for (const clip of this.clips) {
      delete clip.tracks[id];
    }
  }

  getBoneMask(boneId: string): BoneMask | undefined {
    return this.boneMasks.get(boneId);
  }

  hasAnyBoneMask(): boolean {
    for (const mask of this.boneMasks.values()) {
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i] > 0) return true;
      }
    }
    return false;
  }

  clearBoneMask(boneId: string): void {
    this.boneMasks.delete(boneId);
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
      }
    }
  }

  autoAssignBoneMasks(src: PixelBuffer, frame = 0): void {
    this.boneMasks.clear();
    if (this.bones.length === 0) return;

    const transforms = this.computeWorldTransforms(frame, "rest", false);
    const activeBones = this.bones
      .map((b) => ({ bone: b, t: transforms.get(b.id) }))
      .filter(
        (item): item is { bone: Bone; t: BoneWorldTransform } =>
          item.t !== undefined
      );
    if (activeBones.length === 0) return;

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
  }

  getBonePoseAtFrame(
    boneId: string,
    frame: number,
    useOverrides = true
  ): BonePose {
    const bone = this.bones.find((b) => b.id === boneId);
    if (!bone) {
      return { localX: 0, localY: 0, rotationDeg: 0 };
    }

    if (useOverrides) {
      const override = this.currentPoseOverrides.get(boneId);
      if (override) {
        return { ...override };
      }
    }

    const clip = this.getActiveClip();
    const track = clip?.tracks[boneId];
    if (!track || track.length === 0) {
      return {
        localX: bone.localX,
        localY: bone.localY,
        rotationDeg: bone.rotationDeg,
      };
    }

    if (frame <= track[0].frame) {
      const k = track[0];
      return {
        localX: k.localX ?? bone.localX,
        localY: k.localY ?? bone.localY,
        rotationDeg: k.rotationDeg,
      };
    }

    const last = track[track.length - 1];
    if (frame >= last.frame) {
      return {
        localX: last.localX ?? bone.localX,
        localY: last.localY ?? bone.localY,
        rotationDeg: last.rotationDeg,
      };
    }

    for (let i = 0; i < track.length - 1; i++) {
      const k0 = track[i];
      const k1 = track[i + 1];
      if (frame >= k0.frame && frame <= k1.frame) {
        const span = Math.max(1, k1.frame - k0.frame);
        const rawT = (frame - k0.frame) / span;
        const t = evaluateEasing(rawT, k0.easing ?? "linear");
        const x0 = k0.localX ?? bone.localX;
        const y0 = k0.localY ?? bone.localY;
        const x1 = k1.localX ?? bone.localX;
        const y1 = k1.localY ?? bone.localY;
        return {
          localX: x0 + (x1 - x0) * t,
          localY: y0 + (y1 - y0) * t,
          rotationDeg: lerpAngleDeg(k0.rotationDeg, k1.rotationDeg, t),
        };
      }
    }

    return {
      localX: bone.localX,
      localY: bone.localY,
      rotationDeg: bone.rotationDeg,
    };
  }

  computeWorldTransforms(
    frame: number,
    mode: "rest" | "pose",
    useOverrides = true
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

      const local =
        mode === "rest"
          ? {
              localX: bone.localX,
              localY: bone.localY,
              rotationDeg: bone.rotationDeg,
            }
          : this.getBonePoseAtFrame(bone.id, frame, useOverrides);

      let worldX = local.localX;
      let worldY = local.localY;
      let worldRotationDeg = local.rotationDeg;

      if (bone.parentId) {
        const parent = resolve(bone.parentId);
        if (parent) {
          const pRad = (parent.worldRotationDeg * Math.PI) / 180;
          const cos = Math.cos(pRad);
          const sin = Math.sin(pRad);
          worldX = parent.x + local.localX * cos - local.localY * sin;
          worldY = parent.y + local.localX * sin + local.localY * cos;
          worldRotationDeg = normalizeAngleDeg(
            parent.worldRotationDeg + local.rotationDeg
          );
        }
      }

      const wRad = (worldRotationDeg * Math.PI) / 180;
      const tipX = worldX + Math.cos(wRad) * bone.length;
      const tipY = worldY + Math.sin(wRad) * bone.length;

      const transform: BoneWorldTransform = {
        id: bone.id,
        x: worldX,
        y: worldY,
        tipX,
        tipY,
        worldRotationDeg,
        length: bone.length,
      };
      visiting.delete(boneId);
      result.set(boneId, transform);
      return transform;
    };

    for (const bone of this.bones) {
      resolve(bone.id);
    }

    return result;
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
    });
  }

  clearPoseOverrides(): void {
    this.currentPoseOverrides.clear();
  }

  setKeyframe(
    boneId: string,
    frame: number,
    easing: EasingMode = "linear"
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
    };

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
  }

  deleteKeyframe(boneId: string, frame: number): void {
    const clip = this.getActiveClip();
    const track = clip.tracks[boneId];
    if (!track) return;
    clip.tracks[boneId] = track.filter((k) => k.frame !== frame);
  }

  hasKeyframe(boneId: string, frame: number): boolean {
    const clip = this.getActiveClip();
    return Boolean(clip.tracks[boneId]?.some((k) => k.frame === frame));
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
}

/**
 * Draws per-bone color-coded influence masks onto `overlay` for live visual preview.
 */
export function renderBoneInfluenceOverlay(
  rig: RigState,
  overlay: PixelBuffer,
  selectedBoneId: string | null
): void {
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
