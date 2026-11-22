import { useMemo } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import {
  buildRigBoneShapes,
  GIZMO_HANDLE_SIZE_PX,
  GIZMO_RING_RADIUS_PX,
  type RigDraftBone,
} from "./rigGizmo";

/**
 * SVG skeleton + gizmo overlay for the Rig workspace. Bones are drawn from
 * the bind pose in Setup mode and from the evaluated pose in Animate mode.
 */
export function RigOverlay({
  draftBone,
  hoveredBoneId,
}: {
  draftBone: RigDraftBone | null;
  hoveredBoneId: string | null;
}) {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const zoom = useEditorStore((s) => s.zoom);

  const shapes = useMemo(() => {
    void rigVersion;
    if (workspaceMode !== "rig" || !rigShowBones) return [];
    return buildRigBoneShapes(
      pixelEngine.rig,
      currentFrame,
      rigMode,
      selectedBoneId,
      hoveredBoneId
    );
  }, [
    workspaceMode,
    rigShowBones,
    currentFrame,
    rigMode,
    selectedBoneId,
    hoveredBoneId,
    rigVersion,
  ]);

  if (workspaceMode !== "rig" || !rigShowBones) return null;

  const safeZoom = Math.max(1, zoom);
  const ringRadius = GIZMO_RING_RADIUS_PX / safeZoom;
  const handleHalf = GIZMO_HANDLE_SIZE_PX / safeZoom / 2;
  const selected = shapes.find((shape) => shape.selected && !shape.locked);

  return (
    <svg
      className="viewport-rig-svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
    >
      {shapes.map((b) => (
        <g key={b.id}>
          <polygon
            className={`rig-bone-shape ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""} ${b.locked ? "locked" : ""}`}
            points={b.polygon}
          />
          <circle
            className={`rig-bone-joint ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""} ${b.keyed ? "keyed" : ""}`}
            cx={b.x}
            cy={b.y}
            r={0.85}
          />
          <circle
            className={`rig-bone-tip ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""}`}
            cx={b.tipX}
            cy={b.tipY}
            r={0.7}
          />
        </g>
      ))}

      {selected && (
        <g key={`gizmo-${selected.id}`}>
          <circle
            className="rig-gizmo-ring"
            cx={selected.x}
            cy={selected.y}
            r={ringRadius}
          />
          <rect
            className="rig-gizmo-handle rig-gizmo-translate"
            x={selected.x - handleHalf}
            y={selected.y - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
          />
          <rect
            className="rig-gizmo-handle rig-gizmo-scale"
            x={selected.tipX - handleHalf}
            y={selected.tipY - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
          />
        </g>
      )}

      {draftBone && (
        <line
          className="rig-bone-draft"
          x1={draftBone.x0}
          y1={draftBone.y0}
          x2={draftBone.x1}
          y2={draftBone.y1}
        />
      )}
    </svg>
  );
}
