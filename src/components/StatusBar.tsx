import { pixelEngine } from "../engine/document/PixelEngine";
import { formatCellFlags } from "../engine/tiles/overlayGeometry";
import { useEditorStore } from "../store/editorStore";

export function StatusBar() {
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const cursorPos = useEditorStore((s) => s.cursorPos);
  const zoom = useEditorStore((s) => s.zoom);
  const colorMode = useEditorStore((s) => s.colorMode);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const hoveredTileCell = useEditorStore((s) => s.hoveredTileCell);
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tileBrushFlags = useEditorStore((s) => s.tileBrushFlags);

  const activeFrame = frames[currentFrame] ?? frames[0];
  const activeLayer = layers.find((l) => l.id === activeLayerId);

  // Rig status: bound to rigVersion so every mutateRig() refresh is reflected.
  void rigVersion;
  const rigBone =
    workspaceMode === "rig" && selectedBoneId
      ? (pixelEngine.rig.bones.find((b) => b.id === selectedBoneId) ?? null)
      : null;
  let rigAngle = 0;
  let rigWorldX = 0;
  let rigWorldY = 0;
  if (rigBone) {
    if (rigMode === "setup") {
      rigAngle = rigBone.rotationDeg;
      const rest = pixelEngine.rig.computeWorldTransforms(
        currentFrame,
        "rest",
        false
      );
      const world = rest.get(rigBone.id);
      rigWorldX = world?.x ?? 0;
      rigWorldY = world?.y ?? 0;
    } else {
      rigAngle = pixelEngine.rig.getBonePoseAtFrame(
        rigBone.id,
        currentFrame,
        true
      ).rotationDeg;
      const posed = pixelEngine.rig.computeWorldTransforms(
        currentFrame,
        "pose",
        true
      );
      const world = posed.get(rigBone.id);
      rigWorldX = world?.x ?? 0;
      rigWorldY = world?.y ?? 0;
    }
  }
  const activeConstraintCount = pixelEngine.rig.constraints.filter(
    (constraint) => constraint.enabled !== false && constraint.mix > 0
  ).length;

  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <span className="mono-value">
          {canvasWidth}×{canvasHeight} px
        </span>
        <div className="status-sep" />
        <span className="mono-value">
          {cursorPos ? `X: ${cursorPos.x}, Y: ${cursorPos.y}` : "X: --, Y: --"}
        </span>
        <div className="status-sep" />
        <span className="mono-value">{zoom * 100}%</span>
        <div className="status-sep" />
        <span>{colorMode}</span>
        <div className="status-sep" />
        <span className="mono-value">
          Frame {currentFrame + 1}/{frames.length}
          {activeFrame ? ` (${activeFrame.durationMs}ms)` : ""}
        </span>
        {workspaceMode === "rig" && rigBone ? (
          <>
            <div className="status-sep" />
            <span>Bone: {rigBone.name}</span>
            <div className="status-sep" />
            <span className="mono-value">Angle: {Math.round(rigAngle)}°</span>
            <div className="status-sep" />
            <span className="mono-value">
              Pos: {Math.round(rigWorldX)}, {Math.round(rigWorldY)}
            </span>
            <div className="status-sep" />
            <span className="mono-value">
              Constraints: {activeConstraintCount}
            </span>
          </>
        ) : workspaceMode === "tiles" ? (
          <>
            <div className="status-sep" />
            <span className="mono-value">
              {hoveredTileCell
                ? `Cell: ${hoveredTileCell.col}, ${hoveredTileCell.row}`
                : "Cell: --"}
            </span>
            <div className="status-sep" />
            <span>
              {(pixelEngine.tilesetRegistry.get(activeTilesetIndex)?.name ??
                pixelEngine.tileset.name)}{" "}
              {activeTileId > 0 ? `#${activeTileId}` : "Empty"}
            </span>
            {formatCellFlags(tileBrushFlags) && (
              <>
                <div className="status-sep" />
                <span className="mono-value">
                  {formatCellFlags(tileBrushFlags)}
                </span>
              </>
            )}
          </>
        ) : activeLayer ? (
          <>
            <div className="status-sep" />
            <span>Layer: {activeLayer.name}</span>
          </>
        ) : null}
      </div>

      <div className="statusbar-group">
        {statusMessage ? (
          <span className="status-toast">{statusMessage}</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Pixet v0.1.0</span>
        )}
      </div>
    </footer>
  );
}
