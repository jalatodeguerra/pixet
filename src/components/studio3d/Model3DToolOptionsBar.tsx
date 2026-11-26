import { Download, LayoutGrid } from "lucide-react";
import { type ShadingMode } from "../../engine/model3d/types";
import {
  STUDIO3D_FLAT_MODES,
  getStudio3DFlatMode,
  studio3DFlatModePatch,
} from "../../engine/model3d/studio3dModes";
import {
  ROTATE3D_CAMERA_PRESETS,
  type Rotate3DCameraPreset,
} from "../../engine/tools/rotate3d";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { mutateModel3D } from "../../engine/model3d/model3dActions";
import { useEditorStore } from "../../store/editorStore";
import {
  applyStudio3DCameraPreset,
  STUDIO3D_SIDE_PRESET,
} from "./studio3dActions";
import { downloadExportedModelAction } from "./three/modelExporter";

const SNAP_OPTIONS = [0.25, 0.5, 1, 4, 16] as const;

const SHADING_OPTIONS: readonly { id: ShadingMode; label: string }[] = [
  { id: "unlit", label: "Unlit" },
  { id: "flat", label: "Flat" },
  { id: "ps1", label: "PS1" },
  { id: "pbr", label: "PBR" },
];

const MODEL_CAMERA_PRESETS: readonly {
  preset: Rotate3DCameraPreset;
  label: string;
}[] = [
  { preset: ROTATE3D_CAMERA_PRESETS.front, label: "Front" },
  { preset: STUDIO3D_SIDE_PRESET, label: "Side" },
  { preset: ROTATE3D_CAMERA_PRESETS.threeQuarterR, label: "3/4" },
  { preset: ROTATE3D_CAMERA_PRESETS.iso2to1, label: "Iso 2:1" },
  { preset: ROTATE3D_CAMERA_PRESETS.topDown, label: "Top" },
];

/** The single flat 3D Studio mode switcher (sprite views and low-poly modes). */
export function Studio3DModeSwitcher() {
  const flat = useEditorStore((s) =>
    getStudio3DFlatMode({
      workspaceKind: s.studio3d.workspaceKind,
      mode: s.studio3d.mode,
      subMode: s.studio3d.subMode,
    })
  );
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  // Re-render when bones are added or removed so Rig Preview enables itself.
  useEditorStore((s) => s.rigVersion);
  const hasBones = pixelEngine.rig.bones.length > 0;

  return (
    <div
      className="m3d-submode-strip"
      role="tablist"
      aria-label="3D Studio Mode"
    >
      {STUDIO3D_FLAT_MODES.map((m) => {
        const needsBones = m.id === "rigPreview" && !hasBones;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={flat === m.id}
            disabled={needsBones}
            title={needsBones ? "Add bones in the Rig workspace first" : m.hint}
            className={`m3d-submode-btn${flat === m.id ? " active" : ""}${m.id === "model" ? " group-start" : ""}`}
            onClick={() => patchStudio3D(studio3DFlatModePatch(m.id))}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function Model3DToolOptionsBar() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const model3dVersion = useEditorStore((s) => s.model3dVersion);
  void model3dVersion;

  const ppu = pixelEngine.model3d.pixelsPerUnit;

  const handleCameraPreset = (preset: Rotate3DCameraPreset) => {
    applyStudio3DCameraPreset(preset);
    if (preset.id !== ROTATE3D_CAMERA_PRESETS.iso2to1.id && studio3d.gridMode === "isometric") {
      patchStudio3D({ gridMode: "perspective", perspective: 0.35 });
    }
  };

  return (
    <div className="tool-options-bar">
      <Studio3DModeSwitcher />

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Snap</span>
        <select
          className="m3d-select"
          value={studio3d.snapPx}
          onChange={(e) =>
            patchStudio3D({ snapPx: Number(e.target.value) || 1 })
          }
          aria-label="Grid Snap Pixels"
        >
          {SNAP_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v} px
            </option>
          ))}
        </select>

        <span className="option-label">PPU</span>
        <select
          className="m3d-select"
          value={ppu}
          onChange={(e) => {
            const next = Number(e.target.value) || 16;
            mutateModel3D(`Set PPU ${next}`, (eng) => {
              eng.setPixelsPerUnit(next);
            });
          }}
          aria-label="Pixels Per Unit"
        >
          <option value={8}>8 px/m</option>
          <option value={16}>16 px/m</option>
          <option value={32}>32 px/m</option>
        </select>
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Shading</span>
        {SHADING_OPTIONS.map((sh) => (
          <button
            key={sh.id}
            type="button"
            className={`mini-btn ${studio3d.shadingMode === sh.id ? "active" : ""}`}
            onClick={() => patchStudio3D({ shadingMode: sh.id })}
          >
            {sh.label}
          </button>
        ))}
        <button
          type="button"
          className={`mini-btn ${studio3d.wireframeOverlay ? "active" : ""}`}
          onClick={() =>
            patchStudio3D({ wireframeOverlay: !studio3d.wireframeOverlay })
          }
          title="Toggle Wireframe Overlay"
        >
          Wire
        </button>
        <button
          type="button"
          className={`mini-btn ${studio3d.cullBackfacesInView ? "active" : ""}`}
          onClick={() =>
            patchStudio3D({
              cullBackfacesInView: !studio3d.cullBackfacesInView,
            })
          }
          title="See-Through Room Walls (Backface Auto-Hide)"
        >
          See-Through
        </button>
      </div>

      <div className="option-divider" />

      <div className="options-group">
        <span className="option-label">Cam</span>
        {MODEL_CAMERA_PRESETS.map((item) => (
          <button
            key={item.preset.id}
            type="button"
            className="mini-btn"
            title={`Camera Preset: ${item.label}`}
            onClick={() => handleCameraPreset(item.preset)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="options-group" style={{ marginLeft: "auto" }}>
        <button
          type="button"
          className={`mini-btn ${studio3d.uvDrawerOpen ? "active" : ""}`}
          onClick={() =>
            patchStudio3D({ uvDrawerOpen: !studio3d.uvDrawerOpen })
          }
          title="Toggle 2D Pixel-UV Editor Drawer"
        >
          <LayoutGrid size={12} />
          <span>UV Drawer</span>
        </button>
        <button
          type="button"
          className="export-cta"
          onClick={() => {
            void downloadExportedModelAction("glb");
          }}
          title="Export Low-Poly 3D Scene to .GLB"
        >
          <Download size={12} />
          <span>Export .GLB</span>
        </button>
      </div>
    </div>
  );
}
