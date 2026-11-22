import { Paintbrush } from "lucide-react";
import { PixelBuffer } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { mutateRig } from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Weight painting controls. R6 adds smooth-weight brush modes, falloff and
 * auto-weight options here; keep new controls grouped under the existing
 * "Influence"/"Brush" blocks so they layer cleanly.
 */
export function WeightsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const rigTool = useEditorStore((s) => s.rigTool);
  const setRigTool = useEditorStore((s) => s.setRigTool);
  const rigShowInfluence = useEditorStore((s) => s.rigShowInfluence);
  const toggleRigShowInfluence = useEditorStore((s) => s.toggleRigShowInfluence);
  const rigBrushSize = useEditorStore((s) => s.rigBrushSize);
  const setRigBrushSize = useEditorStore((s) => s.setRigBrushSize);
  const layers = useEditorStore((s) => s.layers);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  void rigVersion;
  const bones = pixelEngine.rig.bones;
  const selectedBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;

  const handleAutoWeight = () => {
    if (bones.length === 0) {
      setStatusMessage("Add bones before auto-weighting");
      return;
    }
    mutateRig("Auto-weight", () => {
      const composited = pixelEngine.compositeFrame(layers, currentFrame);
      const buf = new PixelBuffer(canvasWidth, canvasHeight, composited);
      pixelEngine.rig.autoAssignBoneMasks(buf, currentFrame);
    });
    setStatusMessage("Auto-weighted pixels to nearest bones");
  };

  const handleClearMask = () => {
    if (!selectedBone) return;
    mutateRig("Clear weights", () =>
      pixelEngine.rig.clearBoneMask(selectedBone.id)
    );
    setStatusMessage(`Cleared influence mask for "${selectedBone.name}"`);
  };

  return (
    <RigPanelSection
      title="Weights"
      icon={<Paintbrush size={12} />}
      actions={
        <button
          type="button"
          className={`mini-btn ${rigTool === "weightPaint" ? "active" : ""}`}
          title="Weight Paint (W)"
          onClick={() => setRigTool("weightPaint")}
        >
          <Paintbrush size={11} />
          <span>Paint</span>
        </button>
      }
    >
      <div className="rig-influence-box">
        <div className="rig-option-row">
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigShowInfluence}
              onChange={toggleRigShowInfluence}
            />
            <span>Show Influence</span>
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="mini-btn"
              title="Auto-assign opaque pixels to nearest bone"
              onClick={handleAutoWeight}
            >
              Auto-Weight
            </button>
            {selectedBone && pixelEngine.rig.getBoneMask(selectedBone.id) && (
              <button
                type="button"
                className="mini-btn"
                title="Clear selected bone influence mask"
                onClick={handleClearMask}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!selectedBone && (
          <span className="rotate3d-hint">
            Select a bone to paint its influence mask.
          </span>
        )}
      </div>

      <label className="rig-slider-row">
        <span>Brush</span>
        <input
          type="range"
          min={1}
          max={12}
          value={rigBrushSize}
          onChange={(e) => setRigBrushSize(Number(e.target.value))}
        />
        <span className="mono-value">{rigBrushSize}px</span>
      </label>
      <span className="rotate3d-hint">
        Left-drag paint · Right-drag erase weight · W selects the brush
      </span>

      {selectedBone && rigTool !== "weightPaint" && (
        <button
          type="button"
          className="mini-btn"
          title="Select the Weight Paint tool"
          onClick={() => {
            setSelectedBoneId(selectedBone.id);
            setRigTool("weightPaint");
          }}
        >
          <Paintbrush size={11} />
          <span>Paint "{selectedBone.name}"</span>
        </button>
      )}
    </RigPanelSection>
  );
}
