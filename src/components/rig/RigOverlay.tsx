import { useMemo } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { defaultEnvelopeRadius } from "../../engine/rig/autoWeights";
import { useEditorStore } from "../../store/editorStore";
import {
  buildConstraintTargetShapes,
  buildRigBoneShapes,
  GIZMO_HANDLE_SIZE_PX,
  GIZMO_RING_RADIUS_PX,
  type RigDraftBone,
} from "./rigGizmo";
import type { RigDraftGradient } from "./useRigPointer";

/**
 * SVG skeleton + gizmo overlay for the Rig workspace. Bones are drawn from
 * the bind pose in Setup mode and from the evaluated pose in Animate mode.
 */
export function RigOverlay({
  draftBone,
  draftGradient,
  hoveredBoneId,
}: {
  draftBone: RigDraftBone | null;
  draftGradient: RigDraftGradient | null;
  hoveredBoneId: string | null;
}) {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigTool = useEditorStore((s) => s.rigTool);
  const rigBrushSize = useEditorStore((s) => s.rigBrushSize);
  const rigWeightSubTool = useEditorStore((s) => s.rigWeightSubTool);
  const hoverPixel = useEditorStore((s) => s.cursorPos);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedBoneIds = useEditorStore((s) => s.selectedBoneIds);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const zoom = useEditorStore((s) => s.zoom);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const onionPrevFrames = useEditorStore((s) => s.onionPrevFrames);
  const onionNextFrames = useEditorStore((s) => s.onionNextFrames);
  const rigAutoWeightMethod = useEditorStore((s) => s.rigAutoWeightMethod);
  const frames = useEditorStore((s) => s.frames);

  const shapes = useMemo(() => {
    void rigVersion;
    if (workspaceMode !== "rig" || !rigShowBones) return [];
    return buildRigBoneShapes(
      pixelEngine.rig,
      currentFrame,
      rigMode,
      selectedBoneId,
      hoveredBoneId,
      selectedBoneIds
    );
  }, [
    workspaceMode,
    rigShowBones,
    currentFrame,
    rigMode,
    selectedBoneId,
    selectedBoneIds,
    hoveredBoneId,
    rigVersion,
  ]);

  const onionGhosts = useMemo(() => {
    void rigVersion;
    if (
      workspaceMode !== "rig" ||
      !rigShowBones ||
      !onionSkin ||
      rigMode !== "animate"
    ) {
      return [];
    }
    const total = Math.max(frames.length, pixelEngine.rig.getActiveClip().frameCount);
    const ghosts: Array<{
      key: string;
      fill: string;
      stroke: string;
      polygons: string[];
    }> = [];
    for (let d = 1; d <= onionPrevFrames; d++) {
      const f = currentFrame - d;
      if (f < 0) continue;
      const alpha = Math.max(0.12, 0.35 - (d - 1) * 0.1);
      const list = buildRigBoneShapes(pixelEngine.rig, f, "animate", null, null);
      ghosts.push({
        key: `prev-${d}`,
        fill: `rgba(239, 68, 68, ${alpha * 0.45})`,
        stroke: `rgba(239, 68, 68, ${alpha})`,
        polygons: list.map((s) => s.polygon),
      });
    }
    for (let d = 1; d <= onionNextFrames; d++) {
      const f = currentFrame + d;
      if (f >= total) continue;
      const alpha = Math.max(0.12, 0.35 - (d - 1) * 0.1);
      const list = buildRigBoneShapes(pixelEngine.rig, f, "animate", null, null);
      ghosts.push({
        key: `next-${d}`,
        fill: `rgba(59, 130, 246, ${alpha * 0.45})`,
        stroke: `rgba(59, 130, 246, ${alpha})`,
        polygons: list.map((s) => s.polygon),
      });
    }
    return ghosts;
  }, [
    workspaceMode,
    rigShowBones,
    onionSkin,
    onionPrevFrames,
    onionNextFrames,
    rigMode,
    currentFrame,
    frames.length,
    rigVersion,
  ]);

  const constraintTargets = useMemo(() => {
    void rigVersion;
    if (workspaceMode !== "rig" || !rigShowBones) return [];
    return buildConstraintTargetShapes(pixelEngine.rig, currentFrame, rigMode);
  }, [workspaceMode, rigShowBones, currentFrame, rigMode, rigVersion]);

  if (workspaceMode !== "rig" || !rigShowBones) return null;

  const safeZoom = Math.max(1, zoom);
  const ringRadius = GIZMO_RING_RADIUS_PX / safeZoom;
  const handleHalf = GIZMO_HANDLE_SIZE_PX / safeZoom / 2;
  const selected = shapes.find((shape) => shape.primarySelected && !shape.locked);
  const selectedEnvelope = (() => {
    if (!selected || rigAutoWeightMethod !== "envelope") return null;
    const bone = pixelEngine.rig.bones.find((b) => b.id === selected.id);
    const r =
      bone?.envelopeRadius ??
      defaultEnvelopeRadius({
        x: selected.x,
        y: selected.y,
        tipX: selected.tipX,
        tipY: selected.tipY,
      });
    const dx = selected.tipX - selected.x;
    const dy = selected.tipY - selected.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) {
      return { kind: "circle" as const, cx: selected.x, cy: selected.y, r };
    }
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    const d = [
      `M ${selected.x + nx} ${selected.y + ny}`,
      `L ${selected.tipX + nx} ${selected.tipY + ny}`,
      `A ${r} ${r} 0 0 0 ${selected.tipX - nx} ${selected.tipY - ny}`,
      `L ${selected.x - nx} ${selected.y - ny}`,
      `A ${r} ${r} 0 0 0 ${selected.x + nx} ${selected.y + ny}`,
      "Z",
    ].join(" ");
    return { kind: "path" as const, d };
  })();

  return (
    <svg
      className="viewport-rig-svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
    >
      {onionGhosts.map((ghost) => (
        <g key={ghost.key} style={{ pointerEvents: "none" }}>
          {ghost.polygons.map((poly, idx) => (
            <polygon
              key={`${ghost.key}-${idx}`}
              points={poly}
              fill={ghost.fill}
              stroke={ghost.stroke}
              strokeWidth={0.22}
            />
          ))}
        </g>
      ))}

      {shapes.map((b) => (
        <g key={b.id}>
          <polygon
            className={`rig-bone-shape ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""} ${b.locked ? "locked" : ""} ${b.ikTinted ? "ik-chain" : ""} ${b.facingZ < 0 ? "back-facing" : ""}`}
            points={b.polygon}
            style={!b.selected && b.color ? { stroke: b.color } : undefined}
          />
          <circle
            className={`rig-bone-joint ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""} ${b.keyed ? "keyed" : ""}`}
            cx={b.x}
            cy={b.y}
            r={0.85}
            style={!b.selected && b.color ? { stroke: b.color } : undefined}
          />
          <circle
            className={`rig-bone-tip ${b.selected ? "selected" : ""} ${b.hovered ? "hovered" : ""}`}
            cx={b.tipX}
            cy={b.tipY}
            r={0.7}
          />
        </g>
      ))}

      {selectedEnvelope && (
        <g style={{ pointerEvents: "none" }}>
          {selectedEnvelope.kind === "circle" ? (
            <circle
              cx={selectedEnvelope.cx}
              cy={selectedEnvelope.cy}
              r={selectedEnvelope.r}
              fill="none"
              stroke="var(--accent, #4ec9b0)"
              strokeWidth={1.2 / safeZoom}
              strokeDasharray={`${3 / safeZoom} ${2 / safeZoom}`}
              strokeOpacity={0.85}
            />
          ) : (
            <path
              d={selectedEnvelope.d}
              fill="none"
              stroke="var(--accent, #4ec9b0)"
              strokeWidth={1.2 / safeZoom}
              strokeDasharray={`${3 / safeZoom} ${2 / safeZoom}`}
              strokeOpacity={0.85}
            />
          )}
        </g>
      )}

      {selected && (
        <g key={`gizmo-${selected.id}`}>
          <circle
            className="rig-gizmo-ring"
            cx={selected.x}
            cy={selected.y}
            r={ringRadius}
          />
          {(rigTool === "rotate3d" ||
            Math.abs(selected.worldYawDeg) > 0.1 ||
            Math.abs(selected.worldPitchDeg) > 0.1) &&
            (() => {
              const orbitR = ringRadius * 1.3;
              const yawRad = (selected.worldYawDeg * Math.PI) / 180;
              const pitchRad = (selected.worldPitchDeg * Math.PI) / 180;
              const pitchRy = Math.max(
                orbitR * 0.14,
                Math.abs(Math.sin(pitchRad)) * orbitR
              );
              const yawRx = Math.max(
                orbitR * 0.14,
                Math.abs(Math.sin(yawRad)) * orbitR
              );
              const crossLen = orbitR * 0.35;
              const strokeW = 1 / safeZoom;
              const badgeFontSize = 9 / safeZoom;
              const badgeW = 34 / safeZoom;
              const badgeH = 12 / safeZoom;
              const showZBadge = Math.abs(selected.z) > 0.1;
              const zLabel = `Z${selected.z >= 0 ? "+" : ""}${Math.round(selected.z * 10) / 10}`;
              return (
                <g className="rig-gizmo-3d" style={{ pointerEvents: "none" }}>
                  <circle
                    cx={selected.x}
                    cy={selected.y}
                    r={orbitR}
                    fill="none"
                    stroke={selected.facingZ < 0 ? "#eab308" : "#4c8bf5"}
                    strokeWidth={strokeW}
                    strokeDasharray={
                      selected.facingZ < 0
                        ? `${3 / safeZoom} ${2 / safeZoom}`
                        : undefined
                    }
                    strokeOpacity={0.85}
                  />
                  <ellipse
                    cx={selected.x}
                    cy={selected.y}
                    rx={orbitR}
                    ry={pitchRy}
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth={strokeW}
                    strokeOpacity={0.8}
                  />
                  <ellipse
                    cx={selected.x}
                    cy={selected.y}
                    rx={yawRx}
                    ry={orbitR}
                    fill="none"
                    stroke="#4c8bf5"
                    strokeWidth={strokeW}
                    strokeOpacity={0.8}
                  />
                  <line
                    x1={selected.x - crossLen}
                    y1={selected.y}
                    x2={selected.x + crossLen}
                    y2={selected.y}
                    stroke="#2dd4bf"
                    strokeWidth={strokeW}
                    strokeOpacity={0.7}
                  />
                  <line
                    x1={selected.x}
                    y1={selected.y - crossLen}
                    x2={selected.x}
                    y2={selected.y + crossLen}
                    stroke="#4c8bf5"
                    strokeWidth={strokeW}
                    strokeOpacity={0.7}
                  />
                  {showZBadge && (
                    <g
                      transform={`translate(${selected.x + orbitR + 2 / safeZoom}, ${selected.y - badgeH / 2})`}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={badgeW}
                        height={badgeH}
                        fill="#141414"
                        stroke="#4c8bf5"
                        strokeWidth={strokeW}
                      />
                      <text
                        x={badgeW / 2}
                        y={badgeH * 0.74}
                        textAnchor="middle"
                        fill="#e4e4ec"
                        fontSize={badgeFontSize}
                        fontFamily="monospace"
                      >
                        {zLabel}
                      </text>
                    </g>
                  )}
                </g>
              );
            })()}
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

      {constraintTargets.map((ct) => (
        <g key={`ct-${ct.id}`}>
          <line
            className="rig-constraint-line"
            x1={ct.anchorX}
            y1={ct.anchorY}
            x2={ct.x}
            y2={ct.y}
          />
          <rect
            className="rig-constraint-target"
            x={ct.x - handleHalf}
            y={ct.y - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
          />
          <line
            className="rig-constraint-line"
            x1={ct.x - handleHalf * 1.3}
            y1={ct.y}
            x2={ct.x + handleHalf * 1.3}
            y2={ct.y}
          />
          <line
            className="rig-constraint-line"
            x1={ct.x}
            y1={ct.y - handleHalf * 1.3}
            x2={ct.x}
            y2={ct.y + handleHalf * 1.3}
          />
        </g>
      ))}

      {draftBone && (
        <line
          className="rig-bone-draft"
          x1={draftBone.x0}
          y1={draftBone.y0}
          x2={draftBone.x1}
          y2={draftBone.y1}
        />
      )}

      {rigTool === "weightPaint" &&
        rigWeightSubTool === "brush" &&
        hoverPixel && (
          <g style={{ pointerEvents: "none" }}>
            <circle
              cx={hoverPixel.x + 0.5}
              cy={hoverPixel.y + 0.5}
              r={Math.max(0.5, rigBrushSize / 2)}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1 / safeZoom}
              strokeOpacity={0.9}
            />
            <circle
              cx={hoverPixel.x + 0.5}
              cy={hoverPixel.y + 0.5}
              r={Math.max(0.35, rigBrushSize / 4)}
              fill="none"
              stroke="#4c8bf5"
              strokeWidth={1 / safeZoom}
              strokeDasharray={`${2 / safeZoom} ${2 / safeZoom}`}
              strokeOpacity={0.9}
            />
          </g>
        )}

      {draftGradient && (
        <g style={{ pointerEvents: "none" }}>
          <line
            x1={draftGradient.x0}
            y1={draftGradient.y0}
            x2={draftGradient.x1}
            y2={draftGradient.y1}
            stroke="#4c8bf5"
            strokeWidth={1.2 / safeZoom}
          />
          <rect
            x={draftGradient.x0 - handleHalf}
            y={draftGradient.y0 - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
            fill="#4c8bf5"
            stroke="#ffffff"
            strokeWidth={0.8 / safeZoom}
          />
          <rect
            x={draftGradient.x1 - handleHalf}
            y={draftGradient.y1 - handleHalf}
            width={handleHalf * 2}
            height={handleHalf * 2}
            fill="#141414"
            stroke="#4c8bf5"
            strokeWidth={0.8 / safeZoom}
          />
        </g>
      )}
    </svg>
  );
}
