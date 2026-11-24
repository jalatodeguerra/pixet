import type { RigState } from "../../engine/rig/RigEngine";
import type { RigMode } from "../../store/editorStore";

/** Live dashed bone preview while the Add Bone / Chain tool drags. */
export interface RigDraftBone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RigBoneShape {
  id: string;
  name: string;
  x: number;
  y: number;
  tipX: number;
  tipY: number;
  length: number;
  polygon: string;
  selected: boolean;
  primarySelected: boolean;
  hovered: boolean;
  keyed: boolean;
  locked: boolean;
  ikTinted: boolean;
  color?: string;
  facingZ: number;
  z: number;
  worldYawDeg: number;
  worldPitchDeg: number;
}

export interface RigConstraintTargetShape {
  id: string;
  name: string;
  type: "ik" | "aim";
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  enabled: boolean;
}

export type RigGizmoHitKind = "translate" | "rotate" | "scale" | "body";

export interface RigGizmoHit {
  boneId: string;
  kind: RigGizmoHitKind;
}

/** All gizmo sizes are screen pixels converted to canvas units via zoom. */
export const GIZMO_RING_RADIUS_PX = 14;
export const GIZMO_RING_HIT_PX = 5;
export const GIZMO_HANDLE_SIZE_PX = 8;
export const GIZMO_HANDLE_HIT_PX = 7;
export const GIZMO_BODY_HIT_PX = 6;

/**
 * Builds the drawable bone shapes for the current rig mode. Setup mode shows
 * the bind skeleton, Animate mode shows the evaluated pose (constraints
 * included). Hidden bones are never drawn; locked bones are drawn but the hit
 * tester ignores them.
 */
export function buildRigBoneShapes(
  rig: RigState,
  frame: number,
  rigMode: RigMode,
  selectedBoneId: string | null,
  hoveredBoneId: string | null,
  selectedBoneIds: readonly string[] = []
): RigBoneShape[] {
  const transforms = rig.computeWorldTransforms(
    frame,
    rigMode === "setup" ? "rest" : "pose",
    true
  );
  const selectedSet = new Set(selectedBoneIds);
  const ikBoneIds = new Set<string>();
  for (const constraint of rig.constraints) {
    if (constraint.type === "ik" && constraint.enabled !== false) {
      for (const id of constraint.boneIds) ikBoneIds.add(id);
    }
  }
  const shapes: RigBoneShape[] = [];
  for (const bone of rig.bones) {
    if (bone.hidden) continue;
    const t = transforms.get(bone.id);
    if (!t) continue;
    const dx = t.tipX - t.x;
    const dy = t.tipY - t.y;
    const len = Math.max(0.01, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;
    const halfBase = Math.min(1.1, Math.max(0.45, len * 0.14));
    const b1x = t.x + nx * halfBase;
    const b1y = t.y + ny * halfBase;
    const b2x = t.x - nx * halfBase;
    const b2y = t.y - ny * halfBase;
    const isPrimary = bone.id === selectedBoneId;
    shapes.push({
      id: bone.id,
      name: bone.name,
      x: t.x,
      y: t.y,
      tipX: t.tipX,
      tipY: t.tipY,
      length: t.length,
      polygon: `${t.x},${t.y} ${b1x},${b1y} ${t.tipX},${t.tipY} ${b2x},${b2y}`,
      selected: isPrimary || selectedSet.has(bone.id),
      primarySelected: isPrimary,
      hovered: bone.id === hoveredBoneId,
      keyed: rigMode === "animate" && rig.hasKeyframe(bone.id, frame),
      locked: Boolean(bone.locked),
      ikTinted: ikBoneIds.has(bone.id),
      color: bone.color,
      facingZ: t.facingZ,
      z: t.z,
      worldYawDeg: t.worldYawDeg,
      worldPitchDeg: t.worldPitchDeg,
    });
  }
  return shapes;
}

function distance(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq < 1e-9) return distance(px, py, ax, ay);
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq)
  );
  return distance(px, py, ax + abx * t, ay + aby * t);
}

/**
 * Picks a bone or, when handles are enabled, one of the selected bone's
 * gizmo handles (scale tip > translate joint > rotate ring > bone body).
 * Locked bones are never pickable.
 */
export function hitTestRigGizmo(
  shapes: readonly RigBoneShape[],
  x: number,
  y: number,
  zoom: number,
  includeHandles: boolean
): RigGizmoHit | null {
  const safeZoom = Math.max(1, zoom);
  const handleRadius = GIZMO_HANDLE_HIT_PX / safeZoom;

  const selected = includeHandles
    ? shapes.find((shape) => shape.primarySelected && !shape.locked)
    : undefined;
  if (selected) {
    if (distance(x, y, selected.tipX, selected.tipY) <= handleRadius) {
      return { boneId: selected.id, kind: "scale" };
    }
    if (distance(x, y, selected.x, selected.y) <= handleRadius) {
      return { boneId: selected.id, kind: "translate" };
    }
    const ringRadius = GIZMO_RING_RADIUS_PX / safeZoom;
    const ringBand = GIZMO_RING_HIT_PX / safeZoom;
    const fromJoint = distance(x, y, selected.x, selected.y);
    if (Math.abs(fromJoint - ringRadius) <= ringBand) {
      return { boneId: selected.id, kind: "rotate" };
    }
  }

  const bodyRadius = GIZMO_BODY_HIT_PX / safeZoom;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (shape.locked) continue;
    const nearest = Math.min(
      pointSegmentDistance(x, y, shape.x, shape.y, shape.tipX, shape.tipY),
      distance(x, y, shape.x, shape.y),
      distance(x, y, shape.tipX, shape.tipY)
    );
    if (nearest <= bodyRadius) {
      return { boneId: shape.id, kind: "body" };
    }
  }
  return null;
}

/**
 * Builds drawable target handles for enabled IK and Aim constraints.
 */
export function buildConstraintTargetShapes(
  rig: RigState,
  frame: number,
  rigMode: RigMode
): RigConstraintTargetShape[] {
  const transforms = rig.computeWorldTransforms(
    frame,
    rigMode === "setup" ? "rest" : "pose",
    true
  );
  const shapes: RigConstraintTargetShape[] = [];
  for (const constraint of rig.constraints) {
    if (constraint.enabled === false) continue;
    if (constraint.type === "ik") {
      const tipId = constraint.boneIds[constraint.boneIds.length - 1];
      const tipTransform = tipId ? transforms.get(tipId) : undefined;
      if (!tipTransform) continue;
      const target =
        rigMode === "animate"
          ? rig.getConstraintTargetAtFrame(constraint.id, frame)
          : { x: constraint.targetX, y: constraint.targetY };
      if (!target) continue;
      shapes.push({
        id: constraint.id,
        name: constraint.name,
        type: "ik",
        x: target.x,
        y: target.y,
        anchorX: tipTransform.tipX,
        anchorY: tipTransform.tipY,
        enabled: true,
      });
    } else if (constraint.type === "aim") {
      const boneTransform = transforms.get(constraint.boneId);
      if (!boneTransform) continue;
      const target =
        rigMode === "animate"
          ? rig.getConstraintTargetAtFrame(constraint.id, frame)
          : { x: constraint.targetX, y: constraint.targetY };
      if (!target) continue;
      shapes.push({
        id: constraint.id,
        name: constraint.name,
        type: "aim",
        x: target.x,
        y: target.y,
        anchorX: boneTransform.x,
        anchorY: boneTransform.y,
        enabled: true,
      });
    }
  }
  return shapes;
}

export function hitTestConstraintTarget(
  targets: readonly RigConstraintTargetShape[],
  x: number,
  y: number,
  zoom: number
): RigConstraintTargetShape | null {
  const radius = GIZMO_HANDLE_HIT_PX / Math.max(1, zoom);
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (distance(x, y, t.x, t.y) <= radius) {
      return t;
    }
  }
  return null;
}
