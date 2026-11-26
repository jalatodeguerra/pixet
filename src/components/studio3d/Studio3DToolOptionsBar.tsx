import { Download, Film, Sparkles } from "lucide-react";
import {
  ROTATE3D_CAMERA_PRESETS,
  type Render3DPass,
  type Rotate3DCameraPreset,
} from "../../engine/tools/rotate3d";
import { useEditorStore, type Studio3DZoom } from "../../store/editorStore";
import {
  applyStudio3DCameraPreset,
  applyStudio3DToCurrentFrameAction,
  bakeStudio3DTurntableAction,
  exportStudio3DPassPngAction,
  setStudio3DGridMode,
  STUDIO3D_SIDE_PRESET,
} from "./studio3dActions";
import {
  Model3DToolOptionsBar,
  Studio3DWorkspaceKindSwitcher,
} from "./Model3DToolOptionsBar";

const PASS_OPTIONS: readonly { id: Render3DPass; label: string }[] = [
  { id: "lit", label: "Lit" },
  { id: "normal", label: "Normal" },
  { id: "height", label: "Height" },
  { id: "depth", label: "Depth" },
];

const CAMERA_PRESETS: readonly Rotate3DCameraPreset[] = [
  ROTATE3D_CAMERA_PRESETS.front,
  STUDIO3D_SIDE_PRESET,
  ROTATE3D_CAMERA_PRESETS.threeQuarterL,
  ROTATE3D_CAMERA_PRESETS.threeQuarterR,
  ROTATE3D_CAMERA_PRESETS.iso2to1,
  ROTATE3D_CAMERA_PRESETS.topDown,
];

const ZOOM_OPTIONS: readonly Studio3DZoom[] = ["auto", 2, 4, 6, 8];

export function Studio3DToolOptionsBar() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);

  if (studio3d.workspaceKind === "lowpoly3d") {
    return <Model3DToolOptionsBar />;
  }

  return (
    <div className="tool-options-bar">
      <div className="options-group">
        <Studio3DWorkspaceKindSwitcher />
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Grid</span>
        <button
          type="button"
          className={`mini-btn ${studio3d.gridMode === "perspective" ? "active" : ""}`}
          onClick={() => setStudio3DGridMode("perspective")}
        >
          3D Grid
        </button>
        <button
          type="button"
          className={`mini-btn ${studio3d.gridMode === "isometric" ? "active" : ""}`}
          onClick={() => setStudio3DGridMode("isometric")}
        >
          Iso Grid
        </button>
        <button
          type="button"
          className={`mini-btn ${studio3d.gridMode === "none" ? "active" : ""}`}
          onClick={() => setStudio3DGridMode("none")}
        >
          Off
        </button>
        <button
          type="button"
          className={`mini-btn ${studio3d.showAxes ? "active" : ""}`}
          onClick={() => patchStudio3D({ showAxes: !studio3d.showAxes })}
        >
          Axes
        </button>
        <button
          type="button"
          className={`mini-btn ${studio3d.showFloorStage ? "active" : ""}`}
          onClick={() =>
            patchStudio3D({ showFloorStage: !studio3d.showFloorStage })
          }
        >
          Stage
        </button>
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Camera</span>
        {CAMERA_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="mini-btn"
            onClick={() => applyStudio3DCameraPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Zoom</span>
        {ZOOM_OPTIONS.map((z) => (
          <button
            key={String(z)}
            type="button"
            className={`mini-btn ${studio3d.previewZoom === z ? "active" : ""}`}
            onClick={() => patchStudio3D({ previewZoom: z })}
          >
            {z === "auto" ? "Auto" : `${z}×`}
          </button>
        ))}
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Pass</span>
        {PASS_OPTIONS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`mini-btn ${studio3d.renderPass === p.id ? "active" : ""}`}
            onClick={() => patchStudio3D({ renderPass: p.id })}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="options-group" style={{ marginLeft: "auto" }}>
        <button
          type="button"
          className="mini-btn"
          title="Export current 3D pass as PNG"
          onClick={exportStudio3DPassPngAction}
        >
          <Download size={12} />
          <span>Export PNG</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={applyStudio3DToCurrentFrameAction}
        >
          <Sparkles size={12} />
          <span>Apply to Frame</span>
        </button>
        <button
          type="button"
          className="export-cta"
          onClick={bakeStudio3DTurntableAction}
        >
          <Film size={12} />
          <span>Bake Turntable</span>
        </button>
      </div>
    </div>
  );
}
