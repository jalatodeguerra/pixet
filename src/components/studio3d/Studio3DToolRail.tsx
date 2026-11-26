import {
  Box,
  Compass,
  Diamond,
  Disc,
  EyeOff,
  Film,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { Model3DToolRail } from "./Model3DToolRail";
import { setStudio3DGridMode } from "./studio3dActions";

export function Studio3DToolRail() {
  const studio3d = useEditorStore((s) => s.studio3d);
  const patchStudio3D = useEditorStore((s) => s.patchStudio3D);
  const resetStudio3DCamera = useEditorStore((s) => s.resetStudio3DCamera);

  if (studio3d.workspaceKind === "lowpoly3d") {
    return <Model3DToolRail />;
  }

  return (
    <aside className="tool-rail" aria-label="3D Studio Tools">
      <button
        type="button"
        className={`tool-btn ${studio3d.gridMode === "perspective" ? "active" : ""}`}
        title="3D Perspective Grid"
        aria-pressed={studio3d.gridMode === "perspective"}
        onClick={() => setStudio3DGridMode("perspective")}
      >
        <Box size={16} />
      </button>

      <button
        type="button"
        className={`tool-btn ${studio3d.gridMode === "isometric" ? "active" : ""}`}
        title="Isometric Grid Preview"
        aria-pressed={studio3d.gridMode === "isometric"}
        onClick={() => setStudio3DGridMode("isometric")}
      >
        <Diamond size={16} />
      </button>

      <button
        type="button"
        className={`tool-btn ${studio3d.gridMode === "none" ? "active" : ""}`}
        title="Hide Floor Grid"
        aria-pressed={studio3d.gridMode === "none"}
        onClick={() => setStudio3DGridMode("none")}
      >
        <EyeOff size={16} />
      </button>

      <div className="tool-rail-sep" />

      <button
        type="button"
        className={`tool-btn ${studio3d.showAxes ? "active" : ""}`}
        title="Toggle 3D Axes"
        aria-pressed={studio3d.showAxes}
        onClick={() => patchStudio3D({ showAxes: !studio3d.showAxes })}
      >
        <Compass size={16} />
      </button>

      <button
        type="button"
        className={`tool-btn ${studio3d.showFloorStage ? "active" : ""}`}
        title="Toggle Turntable Stage & Shadow"
        aria-pressed={studio3d.showFloorStage}
        onClick={() =>
          patchStudio3D({ showFloorStage: !studio3d.showFloorStage })
        }
      >
        <Disc size={16} />
      </button>

      <div className="tool-rail-sep" />

      <button
        type="button"
        className={`tool-btn ${studio3d.previewMode === "orbit" && studio3d.autoSpin ? "active" : ""}`}
        title={studio3d.autoSpin ? "Stop Auto-Spin" : "Start Auto-Spin"}
        onClick={() =>
          patchStudio3D({
            previewMode: "orbit",
            scrubberPlaying: false,
            autoSpin: !studio3d.autoSpin,
          })
        }
      >
        {studio3d.autoSpin ? <Square size={16} /> : <Play size={16} />}
      </button>

      <button
        type="button"
        className={`tool-btn ${studio3d.previewMode === "turntable" ? "active" : ""}`}
        title="Turntable Scrubber Mode"
        aria-pressed={studio3d.previewMode === "turntable"}
        onClick={() =>
          patchStudio3D({
            autoSpin: false,
            previewMode:
              studio3d.previewMode === "turntable" ? "orbit" : "turntable",
          })
        }
      >
        <Film size={16} />
      </button>

      <button
        type="button"
        className="tool-btn"
        title="Reset 3D Camera"
        onClick={() => resetStudio3DCamera()}
      >
        <RotateCcw size={16} />
      </button>
    </aside>
  );
}
