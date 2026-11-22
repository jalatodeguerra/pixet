import { useRef, useState } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { solveTwoBoneIK } from "../../engine/rig/RigEngine";
import {
  beginRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { plotBresenhamLine } from "../../engine/tools/pixelAlgos";
import {
  buildRigBoneShapes,
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
}

type RigDragKind =
  | "rotateBone"
  | "moveBone"
  | "scaleBone"
  | "addBone"
  | "ik"
  | "weightPaint";

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

function canvasPoint(
  e: React.PointerEvent<HTMLCanvasElement>,
  zoom: number
): { x: number; y: number; px: number; py: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left) / zoom;
  const y = (e.clientY - rect.top) / zoom;
  return { x, y, px: Math.floor(x), py: Math.floor(y) };
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
    rig.applyTwoBoneIK(boneId, targetX, targetY, state.currentFrame);
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
  const [draftBone, setDraftBone] = useState<RigDraftBone | null>(null);
  const [hoveredBoneId, setHoveredBoneId] = useState<string | null>(null);

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

    if (e.button !== 0) return true;

    const tool = state.rigTool;
    if (tool === "chain" || tool === "meshEdit" || tool === "pin") {
      // Behaviour for these tools lands in R2/R3/R6; the rail disables them.
      return true;
    }

    const shapes = buildRigBoneShapes(
      rig,
      state.currentFrame,
      state.rigMode,
      state.selectedBoneId,
      null
    );

    if (tool === "addBone") {
      if (state.rigMode !== "setup") {
        state.setStatusMessage("Add Bone is only available in Setup mode");
        return true;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: "addBone",
        boneId: state.selectedBoneId ?? "",
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
      };
      setDraftBone({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
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
      state.setSelectedBoneId(hit.boneId);
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
    state.setSelectedBoneId(hit.boneId);
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
      const shapes = buildRigBoneShapes(
        pixelEngine.rig,
        state.currentFrame,
        state.rigMode,
        state.selectedBoneId,
        null
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
      drag.addTipX = pt.x;
      drag.addTipY = pt.y;
      setDraftBone({
        x0: drag.startX,
        y0: drag.startY,
        x1: pt.x,
        y1: pt.y,
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
      const localDeg = worldDeg - drag.parentWorldDeg;
      if (state.rigMode === "setup") {
        mutateRig("Edit bind rotation", () =>
          rig.updateBone(drag.boneId, { rotationDeg: localDeg })
        );
      } else {
        mutateRig("Rotate bone", () =>
          rig.setPoseOverride(
            drag.boneId,
            { rotationDeg: localDeg },
            state.currentFrame
          )
        );
      }
      return true;
    }

    if (drag.kind === "moveBone") {
      ensureGesture(
        drag,
        state.rigMode === "setup" ? "Move bind bone" : "Move bone"
      );
      const dx = pt.x - drag.startX;
      const dy = pt.y - drag.startY;
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
        mutateRig("Move bone", () =>
          rig.setPoseOverride(
            drag.boneId,
            { localX, localY },
            state.currentFrame
          )
        );
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
          length: Math.max(1, drag.origLength * ratio),
        })
      );
    } else {
      const nextScaleX = Math.max(0.05, Math.min(20, drag.origScaleX * ratio));
      const nextScaleY = Math.max(0.05, Math.min(20, drag.origScaleY * ratio));
      mutateRig("Scale bone", () =>
        rig.setPoseOverride(
          drag.boneId,
          { scaleX: nextScaleX, scaleY: nextScaleY },
          state.currentFrame
        )
      );
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
      const dx = drag.addTipX - drag.startX;
      const dy = drag.addTipY - drag.startY;
      const len = Math.hypot(dx, dy);
      if (len < 1.5) return true;
      const rig = pixelEngine.rig;
      const transforms = rig.computeWorldTransforms(
        state.currentFrame,
        "rest",
        true
      );
      const worldDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const parent = drag.boneId
        ? transforms.get(drag.boneId)
        : undefined;
      let localX = drag.startX;
      let localY = drag.startY;
      let rotationDeg = worldDeg;
      if (parent) {
        const pRad = (-parent.worldRotationDeg * Math.PI) / 180;
        const cos = Math.cos(pRad);
        const sin = Math.sin(pRad);
        const ox = drag.startX - parent.x;
        const oy = drag.startY - parent.y;
        localX = ox * cos - oy * sin;
        localY = ox * sin + oy * cos;
        rotationDeg = worldDeg - parent.worldRotationDeg;
      }
      const created = mutateRig("Add bone", () =>
        rig.addBone({
          parentId: parent ? parent.id : null,
          localX,
          localY,
          length: Math.max(2, len),
          rotationDeg,
          boundLayerId: null,
        })
      );
      state.setSelectedBoneId(created.id);
    }
    return true;
  };

  const onPointerLeave = () => {
    setHoveredBoneId(null);
  };

  return {
    draftBone,
    hoveredBoneId,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}
