import { useCallback, useEffect, useRef, useState } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { solveTwoBoneIK } from "../../engine/rig/RigEngine";
import {
  beginRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { detectIkChainForBone } from "../../engine/rig/constraints";
import {
  getBoneSubtreeIds,
  mirrorBones,
  snapAngleDeg,
  snapToPixelCenter,
} from "../../engine/rig/skeletonTools";
import { useEditorStore } from "../../store/editorStore";
import { plotBresenhamLine } from "../../engine/tools/pixelAlgos";
import {
  buildConstraintTargetShapes,
  buildRigBoneShapes,
  hitTestConstraintTarget,
  hitTestRigGizmo,
  type RigDraftBone,
} from "./rigGizmo";

export interface UseRigPointerOptions {
  /** Repaints the brush footprint/influence overlay while hovering. */
  onHoverPixels: (px: number, py: number) => void;
}

export interface UseRigPointerResult {
  draftBone: RigDraftBone | null;
  hoveredBoneId: string | null;
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => boolean;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => boolean;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => boolean;
  onPointerLeave: () => void;
  onContextMenu: (
    e: React.MouseEvent,
    canvas: HTMLCanvasElement | null
  ) => void;
}

type RigDragKind =
  | "rotateBone"
  | "moveBone"
  | "scaleBone"
  | "addBone"
  | "ik"
  | "weightPaint"
  | "constraintTarget";

interface RigDrag {
  kind: RigDragKind;
  /** Bone being edited, or the parent candidate for Add Bone ("" = root). */
  boneId: string;
  startX: number;
  startY: number;
  jointX: number;
  jointY: number;
  parentWorldDeg: number;
  parentScaleX: number;
  parentScaleY: number;
  origLocalX: number;
  origLocalY: number;
  origScaleX: number;
  origScaleY: number;
  origLength: number;
  startDist: number;
  addTipX: number;
  addTipY: number;
  eraseMask?: boolean;
  lastPx?: number;
  lastPy?: number;
  historyStarted?: boolean;
}

function canvasPointFromClient(
  clientX: number,
  clientY: number,
  target: HTMLElement,
  zoom: number
): { x: number; y: number; px: number; py: number } {
  const rect = target.getBoundingClientRect();
  const x = (clientX - rect.left) / zoom;
  const y = (clientY - rect.top) / zoom;
  return { x, y, px: Math.floor(x), py: Math.floor(y) };
}

function canvasPoint(
  e: React.PointerEvent<HTMLCanvasElement>,
  zoom: number
): { x: number; y: number; px: number; py: number } {
  return canvasPointFromClient(e.clientX, e.clientY, e.currentTarget, zoom);
}

/**
 * Computes a snapped bone tip from `(x0, y0)` toward `(rawX, rawY)`.
 * Shift snaps angles to 22.5° steps with integer lengths; Pixel Snap snaps
 * the endpoint to pixel centers when not angle-snapped.
 */
function resolveBoneTip(
  x0: number,
  y0: number,
  rawX: number,
  rawY: number,
  shiftSnap: boolean,
  pixelSnap: boolean
): { x: number; y: number; length: number } {
  if (shiftSnap) {
    const rawLen = Math.hypot(rawX - x0, rawY - y0);
    const length = Math.max(1, Math.round(rawLen));
    const deg = snapAngleDeg((Math.atan2(rawY - y0, rawX - x0) * 180) / Math.PI);
    const rad = (deg * Math.PI) / 180;
    return {
      x: x0 + Math.cos(rad) * length,
      y: y0 + Math.sin(rad) * length,
      length,
    };
  }
  const tx = pixelSnap ? snapToPixelCenter(rawX) : rawX;
  const ty = pixelSnap ? snapToPixelCenter(rawY) : rawY;
  return {
    x: tx,
    y: ty,
    length: Math.max(1, Math.round(Math.hypot(tx - x0, ty - y0))),
  };
}

function createBoneFromSegment(
  parentId: string | null,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  label: string
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(2, Math.round(Math.hypot(dx, dy)));
  const rig = pixelEngine.rig;
  const transforms = rig.computeWorldTransforms(0, "rest", true);
  const worldDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const parent = parentId ? transforms.get(parentId) : undefined;
  let localX = x0;
  let localY = y0;
  let rotationDeg = worldDeg;
  if (parent) {
    const pRad = (-parent.worldRotationDeg * Math.PI) / 180;
    const cos = Math.cos(pRad);
    const sin = Math.sin(pRad);
    const ox = x0 - parent.x;
    const oy = y0 - parent.y;
    localX = ox * cos - oy * sin;
    localY = ox * sin + oy * cos;
    rotationDeg = worldDeg - parent.worldRotationDeg;
  }
  return mutateRig(label, () =>
    rig.addBone({
      parentId: parent ? parent.id : null,
      localX,
      localY,
      length: len,
      rotationDeg,
      boundLayerId: null,
    })
  );
}

function ensureGesture(drag: RigDrag, label: string): void {
  if (drag.historyStarted) return;
  beginRigGesture(label);
  drag.historyStarted = true;
}

/**
 * Applies a 2-bone IK solve. In Setup mode it edits the bind rotations; in
 * Animate mode it writes pose overrides through the R0 pipeline.
 */
function applyIk(boneId: string, targetX: number, targetY: number): void {
  const state = useEditorStore.getState();
  const rig = pixelEngine.rig;
  const child = rig.bones.find((b) => b.id === boneId);
  const parent = child?.parentId
    ? rig.bones.find((b) => b.id === child.parentId)
    : undefined;
  if (!child || !parent) return;

  if (state.rigMode === "setup") {
    const rest = rig.computeWorldTransforms(
      state.currentFrame,
      "rest",
      false
    );
    const parentWorld = rest.get(parent.id);
    const childWorld = rest.get(child.id);
    if (!parentWorld || !childWorld) return;
    const grandParentDeg = parent.parentId
      ? (rest.get(parent.parentId)?.worldRotationDeg ?? 0)
      : 0;
    const solved = solveTwoBoneIK(
      parentWorld.x,
      parentWorld.y,
      parent.length * parentWorld.worldScaleX,
      child.length * childWorld.worldScaleX,
      targetX,
      targetY,
      1
    );
    mutateRig("IK bind pose", () => {
      rig.updateBone(parent.id, {
        rotationDeg: solved.rootWorldDeg - grandParentDeg,
      });
      rig.updateBone(child.id, { rotationDeg: solved.childLocalDeg });
    });
    return;
  }

  mutateRig("IK pose", () => {
    if (rig.applyTwoBoneIK(boneId, targetX, targetY, state.currentFrame) && state.rigAutoKey) {
      const parentPose = rig.getBonePoseAtFrame(parent.id, state.currentFrame, true);
      const childPose = rig.getBonePoseAtFrame(child.id, state.currentFrame, true);
      rig.autoKeyBone(parent.id, state.currentFrame, {
        rotationDeg: parentPose.rotationDeg,
      });
      rig.autoKeyBone(child.id, state.currentFrame, {
        rotationDeg: childPose.rotationDeg,
      });
    }
  });
}

/**
 * All rig pointer interaction for the viewport. The hook owns the drag state
 * and the Add Bone draft so Viewport.tsx stays focused on canvas rendering.
 *
 * Handlers return `true` when they handled the event (always, in Rig mode) so
 * drawing tools can never run while the rig workspace is active.
 */
export function useRigPointer({
  onHoverPixels,
}: UseRigPointerOptions): UseRigPointerResult {
  const dragRef = useRef<RigDrag | null>(null);
  const chainRef = useRef<{
    parentId: string | null;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const [draftBone, setDraftBone] = useState<RigDraftBone | null>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<string | null>(null);

  const rigTool = useEditorStore((s) => s.rigTool);
  const rigMode = useEditorStore((s) => s.rigMode);

  const finishChain = useCallback(() => {
    if (!chainRef.current) return;
    chainRef.current = null;
    setDraftBone(null);
  }, []);

  useEffect(() => {
    if (rigTool !== "chain" || rigMode !== "setup") {
      finishChain();
    }
  }, [rigTool, rigMode, finishChain]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!chainRef.current) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        finishChain();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishChain]);

  const beginBoneDrag = (
    kind: "rotateBone" | "moveBone" | "scaleBone",
    boneId: string,
    x: number,
    y: number,
    canvas: HTMLCanvasElement,
    pointerId: number
  ) => {
    const state = useEditorStore.getState();
    const rig = pixelEngine.rig;
    const bone = rig.bones.find((b) => b.id === boneId);
    if (!bone) return;
    const mode = state.rigMode === "setup" ? "rest" : "pose";
    const transforms = rig.computeWorldTransforms(
      state.currentFrame,
      mode,
      true
    );
    const t = transforms.get(bone.id);
    if (!t) return;
    const parent = bone.parentId ? transforms.get(bone.parentId) : undefined;
    const pose =
      state.rigMode === "setup"
        ? {
            localX: bone.localX,
            localY: bone.localY,
            rotationDeg: bone.rotationDeg,
            scaleX: bone.scaleX ?? 1,
            scaleY: bone.scaleY ?? 1,
          }
        : rig.getBonePoseAtFrame(bone.id, state.currentFrame, true);

    dragRef.current = {
      kind,
      boneId: bone.id,
      startX: x,
      startY: y,
      jointX: t.x,
      jointY: t.y,
      parentWorldDeg: parent?.worldRotationDeg ?? 0,
      parentScaleX: parent?.worldScaleX ?? 1,
      parentScaleY: parent?.worldScaleY ?? 1,
      origLocalX: pose.localX,
      origLocalY: pose.localY,
      origScaleX: pose.scaleX,
      origScaleY: pose.scaleY,
      origLength: bone.length,
      startDist: Math.max(0.5, Math.hypot(x - t.x, y - t.y)),
      addTipX: x,
      addTipY: y,
    };
    canvas.setPointerCapture(pointerId);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useEditorStore.getState();
    const zoom = Math.max(1, state.zoom);
    const pt = canvasPoint(e, zoom);
    const rig = pixelEngine.rig;

    if (e.button !== 0 && e.button !== 2) return true;

    if (state.rigTool === "weightPaint" && (e.button === 0 || e.button === 2)) {
      const targetBoneId =
        state.selectedBoneId ?? rig.bones[0]?.id ?? null;
      if (!targetBoneId) {
        state.setStatusMessage("Add or select a bone before painting weights");
        return true;
      }
      if (state.selectedBoneId !== targetBoneId) {
        state.setSelectedBoneId(targetBoneId);
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      const eraseMask = e.button === 2;
      beginRigGesture("Paint weights");
      mutateRig("Paint weights", () => {
        rig.paintBoneWeights(
          targetBoneId,
          state.canvasWidth,
          state.canvasHeight,
          pt.px,
          pt.py,
          state.rigBrushSize / 2,
          {
            strength: state.rigWeightStrength,
            mode: eraseMask ? "subtract" : state.rigWeightMode,
            falloff: state.rigWeightFalloff,
          }
        );
      });
      dragRef.current = {
        kind: "weightPaint",
        boneId: targetBoneId,
        startX: pt.px,
        startY: pt.py,
        jointX: 0,
        jointY: 0,
        parentWorldDeg: 0,
        parentScaleX: 1,
        parentScaleY: 1,
        origLocalX: 0,
        origLocalY: 0,
        origScaleX: 1,
        origScaleY: 1,
        origLength: 0,
        startDist: 1,
        addTipX: pt.px,
        addTipY: pt.py,
        eraseMask,
        lastPx: pt.px,
        lastPy: pt.py,
        historyStarted: true,
      };
      onHoverPixels(pt.px, pt.py);
      return true;
    }

    if (e.button === 2 && chainRef.current) {
      finishChain();
      return true;
    }

    if (e.button !== 0) return true;

    const tool = state.rigTool;
    if (tool === "meshEdit") {
      // Behaviour for Mesh Edit lands with mesh UI; the rail disables it.
      return true;
    }

    if (tool === "chain") {
      if (state.rigMode !== "setup") {
        state.setStatusMessage("Chain tool is only available in Setup mode");
        return true;
      }
      const chain = chainRef.current;
      if (!chain) {
        const ax = state.rigPixelSnap ? snapToPixelCenter(pt.x) : pt.x;
        const ay = state.rigPixelSnap ? snapToPixelCenter(pt.y) : pt.y;
        chainRef.current = {
          parentId: state.selectedBoneId,
          anchorX: ax,
          anchorY: ay,
        };
        setDraftBone({ x0: ax, y0: ay, x1: ax, y1: ay });
        return true;
      }
      const tip = resolveBoneTip(
        chain.anchorX,
        chain.anchorY,
        pt.x,
        pt.y,
        e.shiftKey,
        state.rigPixelSnap
      );
      if (Math.hypot(tip.x - chain.anchorX, tip.y - chain.anchorY) < 1.5) {
        return true;
      }
      const created = createBoneFromSegment(
        chain.parentId,
        chain.anchorX,
        chain.anchorY,
        tip.x,
        tip.y,
        "Add chain bone"
      );
      state.setSelectedBoneId(created.id);
      chainRef.current = {
        parentId: created.id,
        anchorX: tip.x,
        anchorY: tip.y,
      };
      setDraftBone({ x0: tip.x, y0: tip.y, x1: tip.x, y1: tip.y });
      return true;
    }

    const shapes = buildRigBoneShapes(
      rig,
      state.currentFrame,
      state.rigMode,
      state.selectedBoneId,
      null,
      state.selectedBoneIds
    );

    if (
      tool === "select" ||
      tool === "translate" ||
      tool === "ik" ||
      tool === "pin"
    ) {
      const targets = buildConstraintTargetShapes(
        rig,
        state.currentFrame,
        state.rigMode
      );
      const targetHit = hitTestConstraintTarget(targets, pt.x, pt.y, zoom);
      if (targetHit) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = {
          kind: "constraintTarget",
          boneId: targetHit.id,
          startX: pt.x,
          startY: pt.y,
          jointX: targetHit.x,
          jointY: targetHit.y,
          parentWorldDeg: 0,
          parentScaleX: 1,
          parentScaleY: 1,
          origLocalX: targetHit.x,
          origLocalY: targetHit.y,
          origScaleX: 1,
          origScaleY: 1,
          origLength: 0,
          startDist: 1,
          addTipX: pt.x,
          addTipY: pt.y,
        };
        return true;
      }
    }

    if (tool === "pin") {
      const hit = hitTestRigGizmo(shapes, pt.x, pt.y, zoom, false);
      if (!hit) return true;
      const bone = rig.bones.find((b) => b.id === hit.boneId);
      if (!bone) return true;
      const chain = detectIkChainForBone(rig.bones, bone.id, 3);
      const transforms = rig.computeWorldTransforms(
        state.currentFrame,
        state.rigMode === "setup" ? "rest" : "pose",
        true
      );
      const tipTransform = transforms.get(bone.id);
      const targetX = tipTransform ? tipTransform.tipX : pt.x;
      const targetY = tipTransform ? tipTransform.tipY : pt.y;
      mutateRig("Pin IK constraint", () =>
        rig.addConstraint({
          type: "ik",
          name: `IK ${bone.name}`,
          enabled: true,
          mix: 1,
          boneIds: chain,
          targetX,
          targetY,
          bendSign: 1,
        })
      );
      state.setSelectedBoneId(bone.id);
      state.setStatusMessage(
        `Pinned ${chain.length}-bone IK constraint on "${bone.name}"`
      );
      return true;
    }

    if (tool === "addBone") {
      if (state.rigMode !== "setup") {
        state.setStatusMessage("Add Bone is only available in Setup mode");
        return true;
      }
      const sx = state.rigPixelSnap ? snapToPixelCenter(pt.x) : pt.x;
      const sy = state.rigPixelSnap ? snapToPixelCenter(pt.y) : pt.y;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: "addBone",
        boneId: state.selectedBoneId ?? "",
        startX: sx,
        startY: sy,
        jointX: sx,
        jointY: sy,
        parentWorldDeg: 0,
        parentScaleX: 1,
        parentScaleY: 1,
        origLocalX: 0,
        origLocalY: 0,
        origScaleX: 1,
        origScaleY: 1,
        origLength: 0,
        startDist: 1,
        addTipX: sx,
        addTipY: sy,
      };
      setDraftBone({ x0: sx, y0: sy, x1: sx, y1: sy });
      return true;
    }

    if (tool === "ik") {
      const hitRadius = Math.max(1.8, 9 / zoom);
      const mode = state.rigMode === "setup" ? "rest" : "pose";
      const transforms = rig.computeWorldTransforms(
        state.currentFrame,
        mode,
        true
      );
      let ikBoneId: string | null = null;
      let bestDist = hitRadius * 1.4;
      for (const bone of rig.bones) {
        if (!bone.parentId || bone.hidden || bone.locked) continue;
        const t = transforms.get(bone.id);
        if (!t) continue;
        const d = Math.hypot(pt.x - t.tipX, pt.y - t.tipY);
        if (d <= bestDist) {
          bestDist = d;
          ikBoneId = bone.id;
        }
      }
      if (!ikBoneId && state.selectedBoneId) {
        const selected = rig.bones.find(
          (b) => b.id === state.selectedBoneId
        );
        if (selected?.parentId && !selected.hidden && !selected.locked) {
          ikBoneId = selected.id;
        }
      }
      if (!ikBoneId) return true;

      e.currentTarget.setPointerCapture(e.pointerId);
      state.setSelectedBoneId(ikBoneId);
      beginRigGesture(state.rigMode === "setup" ? "IK bind pose" : "IK pose");
      applyIk(ikBoneId, pt.x, pt.y);
      dragRef.current = {
        kind: "ik",
        boneId: ikBoneId,
        startX: pt.x,
        startY: pt.y,
        jointX: pt.x,
        jointY: pt.y,
        parentWorldDeg: 0,
        parentScaleX: 1,
        parentScaleY: 1,
        origLocalX: 0,
        origLocalY: 0,
        origScaleX: 1,
        origScaleY: 1,
        origLength: 0,
        startDist: 1,
        addTipX: pt.x,
        addTipY: pt.y,
        historyStarted: true,
      };
      return true;
    }

    if (tool === "translate" || tool === "scale") {
      const hit = hitTestRigGizmo(shapes, pt.x, pt.y, zoom, false);
      if (!hit) return true;
      if (e.ctrlKey || e.metaKey) {
        state.toggleBoneSelection(hit.boneId);
        return true;
      }
      if (e.shiftKey) {
        state.setSelectedBoneIds(
          [...state.selectedBoneIds, hit.boneId],
          hit.boneId
        );
      } else {
        state.setSelectedBoneId(hit.boneId);
      }
      beginBoneDrag(
        tool === "translate" ? "moveBone" : "scaleBone",
        hit.boneId,
        pt.x,
        pt.y,
        e.currentTarget,
        e.pointerId
      );
      return true;
    }

    // Select / Rotate: gizmo handles first, then any visible unlocked bone.
    const hit = hitTestRigGizmo(shapes, pt.x, pt.y, zoom, true);
    if (!hit) return true;
    if (hit.kind === "body" && (e.ctrlKey || e.metaKey)) {
      state.toggleBoneSelection(hit.boneId);
      return true;
    }
    if (hit.kind === "body" && e.shiftKey) {
      state.setSelectedBoneIds(
        [...state.selectedBoneIds, hit.boneId],
        hit.boneId
      );
      return true;
    }
    if (hit.kind === "body") {
      state.setSelectedBoneId(hit.boneId);
    }
    beginBoneDrag(
      hit.kind === "translate"
        ? "moveBone"
        : hit.kind === "scale"
          ? "scaleBone"
          : "rotateBone",
      hit.boneId,
      pt.x,
      pt.y,
      e.currentTarget,
      e.pointerId
    );
    return true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useEditorStore.getState();
    const zoom = Math.max(1, state.zoom);
    const pt = canvasPoint(e, zoom);
    const drag = dragRef.current;

    if (!drag) {
      if (state.rigTool === "chain" && chainRef.current) {
        const tip = resolveBoneTip(
          chainRef.current.anchorX,
          chainRef.current.anchorY,
          pt.x,
          pt.y,
          e.shiftKey,
          state.rigPixelSnap
        );
        setDraftBone({
          x0: chainRef.current.anchorX,
          y0: chainRef.current.anchorY,
          x1: tip.x,
          y1: tip.y,
        });
        return true;
      }
      const shapes = buildRigBoneShapes(
        pixelEngine.rig,
        state.currentFrame,
        state.rigMode,
        state.selectedBoneId,
        null,
        state.selectedBoneIds
      );
      const hit = hitTestRigGizmo(shapes, pt.x, pt.y, zoom, false);
      const nextHovered = hit ? hit.boneId : null;
      setHoveredBoneId((prev) => (prev === nextHovered ? prev : nextHovered));
      if (state.rigTool === "weightPaint") {
        onHoverPixels(pt.px, pt.py);
      }
      return true;
    }

    const rig = pixelEngine.rig;

    if (drag.kind === "weightPaint") {
      ensureGesture(drag, "Paint weights");
      const lastX = drag.lastPx ?? pt.px;
      const lastY = drag.lastPy ?? pt.py;
      const segment = plotBresenhamLine(lastX, lastY, pt.px, pt.py);
      mutateRig("Paint weights", () => {
        for (const point of segment) {
          rig.paintBoneWeights(
            drag.boneId,
            state.canvasWidth,
            state.canvasHeight,
            point.x,
            point.y,
            state.rigBrushSize / 2,
            {
              strength: state.rigWeightStrength,
              mode: drag.eraseMask ? "subtract" : state.rigWeightMode,
              falloff: state.rigWeightFalloff,
            }
          );
        }
      });
      drag.lastPx = pt.px;
      drag.lastPy = pt.py;
      onHoverPixels(pt.px, pt.py);
      return true;
    }

    if (drag.kind === "addBone") {
      const tip = resolveBoneTip(
        drag.startX,
        drag.startY,
        pt.x,
        pt.y,
        e.shiftKey,
        state.rigPixelSnap
      );
      drag.addTipX = tip.x;
      drag.addTipY = tip.y;
      setDraftBone({
        x0: drag.startX,
        y0: drag.startY,
        x1: tip.x,
        y1: tip.y,
      });
      return true;
    }

    if (drag.kind === "constraintTarget") {
      ensureGesture(drag, "Move constraint target");
      const nextX = state.rigPixelSnap ? snapToPixelCenter(pt.x) : pt.x;
      const nextY = state.rigPixelSnap ? snapToPixelCenter(pt.y) : pt.y;
      mutateRig("Move constraint target", () => {
        rig.updateConstraint(drag.boneId, { targetX: nextX, targetY: nextY });
        if (
          state.rigMode === "animate" &&
          rig.getActiveClip().constraintTracks?.[drag.boneId]
        ) {
          rig.setConstraintTargetKeyframe(
            drag.boneId,
            state.currentFrame,
            nextX,
            nextY
          );
        }
      });
      return true;
    }

    if (drag.kind === "ik") {
      ensureGesture(
        drag,
        state.rigMode === "setup" ? "IK bind pose" : "IK pose"
      );
      applyIk(drag.boneId, pt.x, pt.y);
      return true;
    }

    if (drag.kind === "rotateBone") {
      ensureGesture(
        drag,
        state.rigMode === "setup" ? "Edit bind rotation" : "Rotate bone"
      );
      const worldDeg =
        (Math.atan2(pt.y - drag.jointY, pt.x - drag.jointX) * 180) / Math.PI;
      const rawLocalDeg = worldDeg - drag.parentWorldDeg;
      const localDeg = e.shiftKey ? snapAngleDeg(rawLocalDeg) : rawLocalDeg;
      if (state.rigMode === "setup") {
        mutateRig("Edit bind rotation", () =>
          rig.updateBone(drag.boneId, { rotationDeg: localDeg })
        );
      } else {
        mutateRig("Rotate bone", () => {
          rig.setPoseOverride(
            drag.boneId,
            { rotationDeg: localDeg },
            state.currentFrame
          );
          if (state.rigAutoKey) {
            rig.autoKeyBone(drag.boneId, state.currentFrame, {
              rotationDeg: localDeg,
            });
          }
        });
      }
      return true;
    }

    if (drag.kind === "moveBone") {
      ensureGesture(
        drag,
        state.rigMode === "setup" ? "Move bind bone" : "Move bone"
      );
      let dx = pt.x - drag.startX;
      let dy = pt.y - drag.startY;
      if (state.rigMode === "setup" && state.rigPixelSnap) {
        dx = snapToPixelCenter(drag.jointX + dx) - drag.jointX;
        dy = snapToPixelCenter(drag.jointY + dy) - drag.jointY;
      }
      const pRad = (drag.parentWorldDeg * Math.PI) / 180;
      const cos = Math.cos(pRad);
      const sin = Math.sin(pRad);
      const localDx =
        (dx * cos + dy * sin) / (Math.abs(drag.parentScaleX) < 1e-6 ? 1 : drag.parentScaleX);
      const localDy =
        (-dx * sin + dy * cos) / (Math.abs(drag.parentScaleY) < 1e-6 ? 1 : drag.parentScaleY);
      const localX = drag.origLocalX + localDx;
      const localY = drag.origLocalY + localDy;
      if (state.rigMode === "setup") {
        mutateRig("Move bind bone", () =>
          rig.updateBone(drag.boneId, { localX, localY })
        );
      } else {
        mutateRig("Move bone", () => {
          rig.setPoseOverride(
            drag.boneId,
            { localX, localY },
            state.currentFrame
          );
          if (state.rigAutoKey) {
            rig.autoKeyBone(drag.boneId, state.currentFrame, {
              localX,
              localY,
            });
          }
        });
      }
      return true;
    }

    // scaleBone
    ensureGesture(
      drag,
      state.rigMode === "setup" ? "Resize bone" : "Scale bone"
    );
    const dist = Math.hypot(pt.x - drag.jointX, pt.y - drag.jointY);
    const ratio = dist / drag.startDist;
    if (state.rigMode === "setup") {
      mutateRig("Resize bone", () =>
        rig.updateBone(drag.boneId, {
          length: Math.max(2, Math.round(drag.origLength * ratio)),
        })
      );
    } else {
      const nextScaleX = Math.max(0.05, Math.min(20, drag.origScaleX * ratio));
      const nextScaleY = Math.max(0.05, Math.min(20, drag.origScaleY * ratio));
      mutateRig("Scale bone", () => {
        rig.setPoseOverride(
          drag.boneId,
          { scaleX: nextScaleX, scaleY: nextScaleY },
          state.currentFrame
        );
        if (state.rigAutoKey) {
          rig.autoKeyBone(drag.boneId, state.currentFrame, {
            scaleX: nextScaleX,
            scaleY: nextScaleY,
          });
        }
      });
    }
    return true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return true;
    dragRef.current = null;
    setDraftBone(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const state = useEditorStore.getState();
    endRigGesture();

    if (drag.kind === "addBone") {
      if (state.rigMode !== "setup") {
        state.setStatusMessage("Add Bone is only available in Setup mode");
        return true;
      }
      const len = Math.hypot(
        drag.addTipX - drag.startX,
        drag.addTipY - drag.startY
      );
      if (len < 1.5) return true;
      const created = createBoneFromSegment(
        drag.boneId || null,
        drag.startX,
        drag.startY,
        drag.addTipX,
        drag.addTipY,
        "Add bone"
      );
      state.setSelectedBoneId(created.id);
    }
    return true;
  };

  const onPointerLeave = () => {
    setHoveredBoneId(null);
  };

  const onContextMenu = (
    e: React.MouseEvent,
    canvas: HTMLCanvasElement | null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const state = useEditorStore.getState();
    if (state.rigTool === "weightPaint") return;
    if (chainRef.current) {
      finishChain();
      return;
    }
    if (!canvas) return;
    const zoom = Math.max(1, state.zoom);
    const pt = canvasPointFromClient(e.clientX, e.clientY, canvas, zoom);
    const rig = pixelEngine.rig;
    const shapes = buildRigBoneShapes(
      rig,
      state.currentFrame,
      state.rigMode,
      state.selectedBoneId,
      null,
      state.selectedBoneIds
    );
    const hit = hitTestRigGizmo(shapes, pt.x, pt.y, zoom, false);
    if (!hit) return;
    const targetBone = rig.bones.find((b) => b.id === hit.boneId);
    if (!targetBone) return;
    if (!state.selectedBoneIds.includes(targetBone.id)) {
      state.setSelectedBoneId(targetBone.id);
    }
    const setupMode = state.rigMode === "setup";
    const axisX = state.canvasWidth / 2;

    state.openContextMenu(e.clientX, e.clientY, [
      {
        kind: "item",
        label: "Add Child Bone",
        disabled: !setupMode,
        action: () => {
          const child = mutateRig("Add child bone", () =>
            rig.addBone({
              parentId: targetBone.id,
              localX: targetBone.length,
              localY: 0,
              length: Math.max(4, Math.round(targetBone.length * 0.8)),
              rotationDeg: 0,
              boundLayerId: null,
            })
          );
          state.setSelectedBoneId(child.id);
        },
      },
      {
        kind: "item",
        label: "Mirror Subtree",
        disabled: !setupMode,
        action: () => {
          const res = mutateRig("Mirror bone subtree", () =>
            mirrorBones(rig, [targetBone.id], axisX)
          );
          if (res.createdIds.length > 0) {
            state.setSelectedBoneIds(res.createdIds, res.createdIds[0]);
          }
        },
      },
      {
        kind: "item",
        label: "Select Children",
        action: () => {
          const ids = getBoneSubtreeIds(rig.bones, targetBone.id);
          state.setSelectedBoneIds(ids, targetBone.id);
        },
      },
      {
        kind: "item",
        label: "Reset Pose",
        disabled: setupMode,
        action: () => {
          mutateRig("Reset bone pose", () => {
            rig.setPoseOverride(
              targetBone.id,
              {
                rotationDeg: targetBone.rotationDeg,
                localX: targetBone.localX,
                localY: targetBone.localY,
                scaleX: targetBone.scaleX ?? 1,
                scaleY: targetBone.scaleY ?? 1,
              },
              state.currentFrame
            );
          });
        },
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Delete Bone",
        danger: true,
        action: () => {
          mutateRig("Delete bone", () => rig.removeBone(targetBone.id));
          state.setSelectedBoneId(rig.bones[0]?.id ?? null);
        },
      },
    ]);
  };

  return {
    draftBone,
    hoveredBoneId,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onContextMenu,
  };
}
