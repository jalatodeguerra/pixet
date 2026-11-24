import { Eye, EyeOff, Layers } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { BonePropertiesPanel } from "./BonePropertiesPanel";
import { BoneTreePanel } from "./BoneTreePanel";
import { ClipsPosesPanel } from "./ClipsPosesPanel";
import { ConstraintsPanel } from "./ConstraintsPanel";
import { RigPanelSection } from "./RigPanelSection";
import { RigRenderPanel } from "./RigRenderPanel";
import { SlotsPanel } from "./SlotsPanel";
import { WeightsPanel } from "./WeightsPanel";

/**
 * The focused rig inspector: only rig sections, plus a compact list of the
 * layers that are bound to bones instead of the full Draw layers panel.
 */
export function RigSidebar() {
  return (
    <>
      <BoneTreePanel />
      <BonePropertiesPanel />
      <ConstraintsPanel />
      <SlotsPanel />
      <WeightsPanel />
      <ClipsPosesPanel />
      <RigRenderPanel />
      <BoundLayersPanel />
    </>
  );
}

export function BoundLayersPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleLayerVisible = useEditorStore((s) => s.toggleLayerVisible);

  void rigVersion;
  const boneNamesByLayer = new Map<string, string[]>();
  for (const bone of pixelEngine.rig.bones) {
    if (!bone.boundLayerId) continue;
    const names = boneNamesByLayer.get(bone.boundLayerId) ?? [];
    names.push(bone.name);
    boneNamesByLayer.set(bone.boundLayerId, names);
  }
  const boundLayers = layers.filter(
    (layer) => layer.kind === "raster" && boneNamesByLayer.has(layer.id)
  );

  return (
    <RigPanelSection
      id="rig-bound-layers"
      title="Bound Layers"
      icon={<Layers size={12} />}
      actions={
        <span className="mono-value" style={{ fontSize: 10 }}>
          {boundLayers.length}
        </span>
      }
    >
      {boundLayers.length === 0 ? (
        <div className="rig-empty-note">
          No layers bound to bones. Assign one in{" "}
          <strong>Bone Properties → Bind Layer</strong>.
        </div>
      ) : (
        <div className="rig-bound-layers">
          {boundLayers.map((layer) => {
            const boneNames = boneNamesByLayer.get(layer.id) ?? [];
            return (
              <div
                key={layer.id}
                className={`rig-bound-layer-row ${layer.id === activeLayerId ? "active" : ""}`}
                title={`${layer.name} → ${boneNames.join(", ")}`}
                onClick={() => selectLayer(layer.id)}
              >
                <button
                  type="button"
                  className="icon-action-btn"
                  style={{ width: 18, height: 18 }}
                  title={layer.visible ? "Hide Layer" : "Show Layer"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisible(layer.id);
                  }}
                >
                  {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
                <span className="rig-bound-layer-name">{layer.name}</span>
                <span className="rig-bound-layer-bone">
                  {boneNames.join(", ")}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <span className="rotate3d-hint">
        Full layer management is available in Draw mode.
      </span>
    </RigPanelSection>
  );
}
