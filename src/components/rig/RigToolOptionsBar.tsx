import { Eye, EyeOff, Redo2, Undo2 } from "lucide-react";
import { performRedo, performUndo } from "../../engine/document/historyActions";
import { useEditorStore } from "../../store/editorStore";
import { RIG_TOOL_BY_ID } from "./rigTools";

/** Focused options bar shown instead of the drawing options in Rig mode. */
export function RigToolOptionsBar() {
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigTool = useEditorStore((s) => s.rigTool);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const rigBrushSize = useEditorStore((s) => s.rigBrushSize);
  const setRigBrushSize = useEditorStore((s) => s.setRigBrushSize);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const toggleRigShowBones = useEditorStore((s) => s.toggleRigShowBones);
  const rigShowInfluence = useEditorStore((s) => s.rigShowInfluence);
  const toggleRigShowInfluence = useEditorStore((s) => s.toggleRigShowInfluence);

  const tool = RIG_TOOL_BY_ID.get(rigTool);
  const setupMode = rigMode === "setup";

  return (
    <div className="tool-options-bar">
      <div className="options-group">
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 24, height: 24 }}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={performUndo}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 24, height: 24 }}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={performRedo}
        >
          <Redo2 size={13} />
        </button>

        <div className="option-divider" />

        <span className={`rig-mode-badge ${rigMode}`}>
          {setupMode ? "Setup" : "Animate"}
        </span>
        <span
          className="option-label"
          style={{ fontWeight: 600, color: "var(--text-primary)" }}
        >
          {tool ? `${tool.label} (${tool.shortcut})` : rigTool}
        </span>

        {rigTool === "weightPaint" && (
          <label className="option-label">
            <span>Brush</span>
            <input
              type="range"
              className="compact-range"
              min={1}
              max={12}
              value={rigBrushSize}
              onChange={(e) => setRigBrushSize(Number(e.target.value))}
            />
            <span className="mono-value">{rigBrushSize}px</span>
          </label>
        )}

        <div className="option-divider" />

        <button
          type="button"
          className={`toggle-chip ${rigShowBones ? "active" : ""}`}
          title="Toggle the bone overlay"
          onClick={toggleRigShowBones}
        >
          {rigShowBones ? <Eye size={12} /> : <EyeOff size={12} />}
          <span>Bones</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${rigShowInfluence ? "active" : ""}`}
          title="Toggle the bone influence heatmap"
          onClick={toggleRigShowInfluence}
        >
          <span>Influence</span>
        </button>
      </div>

      <div className="mode-hint">
        {setupMode
          ? "Setup · Edit bind pose and skeleton · B add bone · W paint weights"
          : "Animate · Pose overrides and keyframes · Set Key in Bone Properties"}
      </div>
    </div>
  );
}
