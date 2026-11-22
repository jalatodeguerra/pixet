import { Download, Film, SlidersHorizontal } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { syncTimelineCels } from "../../engine/document/timelineActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Render options and rig output actions. R6 adds pixel cleanup / mesh
 * deformation toggles here; keep them below the existing render options.
 */
export function RigRenderPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  void rigVersion;

  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const toggleRigPixelSnap = useEditorStore((s) => s.toggleRigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);
  const toggleRigRotSprite = useEditorStore((s) => s.toggleRigRotSprite);
  const rigCleanupOrphans = useEditorStore((s) => s.rigCleanupOrphans);
  const rigCleanupHoles = useEditorStore((s) => s.rigCleanupHoles);
  const rigCleanupPaletteLock = useEditorStore((s) => s.rigCleanupPaletteLock);
  const rigCleanupOutline = useEditorStore((s) => s.rigCleanupOutline);
  const toggleRigCleanupOrphans = useEditorStore(
    (s) => s.toggleRigCleanupOrphans
  );
  const toggleRigCleanupHoles = useEditorStore((s) => s.toggleRigCleanupHoles);
  const toggleRigCleanupPaletteLock = useEditorStore(
    (s) => s.toggleRigCleanupPaletteLock
  );
  const toggleRigCleanupOutline = useEditorStore(
    (s) => s.toggleRigCleanupOutline
  );
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const documentName = useEditorStore((s) => s.documentName);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const setRigExportModalOpen = useEditorStore((s) => s.setRigExportModalOpen);

  const handleBakeToFrames = () => {
    if (pixelEngine.rig.bones.length === 0) {
      setStatusMessage("Add or seed bones before baking");
      return;
    }
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const activeClip = pixelEngine.rig.getActiveClip();
    const bakeCount = Math.max(state.frames.length, activeClip.frameCount);
    const snapshotLayers = state.layers.slice();

    const bakedBuffers: Uint8ClampedArray[] = [];
    const cleanup = {
      removeOrphans: state.rigCleanupOrphans,
      fillHoles: state.rigCleanupHoles,
      paletteLock: state.rigCleanupPaletteLock,
      preserveOutline: state.rigCleanupOutline,
    };
    for (let f = 0; f < bakeCount; f++) {
      const composited = pixelEngine.compositeRigFrame(
        snapshotLayers,
        f,
        {
          pixelSnap: state.rigPixelSnap,
          rotSprite: state.rigRotSprite,
          mode: "pose",
          cleanup,
        },
        false
      );
      bakedBuffers.push(new Uint8ClampedArray(composited));
    }

    const newLayerId = state.addNamedLayer("Baked Rig");
    const addedFrames = bakeCount > state.frames.length;
    while (useEditorStore.getState().frames.length < bakeCount) {
      const count = useEditorStore.getState().frames.length;
      pixelEngine.insertEmptyFrame(count, count);
      useEditorStore.getState().insertFrameMetadata(count);
    }

    for (let f = 0; f < bakeCount; f++) {
      const cel = pixelEngine.getOrCreateCel(newLayerId, f);
      cel.data.set(bakedBuffers[f]);
      cel.markAllDirty();
    }

    if (addedFrames) {
      pixelEngine.history.clear();
      useEditorStore.getState().setHistoryFlags(false, false);
    }

    syncTimelineCels();
    useEditorStore.getState().setCurrentFrame(0);
    pixelEngine.emitChange();
    setStatusMessage(`Baked ${bakeCount} rig frames to "Baked Rig" layer`);
  };

  const handleExportRigJson = () => {
    const json = pixelEngine.rig.serializeRuntimeJson(
      canvasWidth,
      canvasHeight
    );
    const base = documentName.replace(/\.pixet$/i, "") || "character";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.rig.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(`Exported ${base}.rig.json`);
  };

  return (
    <RigPanelSection
      title="Render"
      icon={<SlidersHorizontal size={12} />}
    >
      <div className="rig-option-row">
        <label className="modal-checkbox" style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={rigPixelSnap}
            onChange={toggleRigPixelSnap}
          />
          <span>Pixel-Snap</span>
        </label>
        <label className="modal-checkbox" style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={rigRotSprite}
            onChange={toggleRigRotSprite}
          />
          <span>RotSprite Clean</span>
        </label>
      </div>

      {/* R6 post-deformation pixel cleanup. */}
      <div className="rig-cleanup-box">
        <span className="rig-cleanup-title">Pixel Cleanup (post-deform)</span>
        <div className="rig-cleanup-options">
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigCleanupOrphans}
              onChange={toggleRigCleanupOrphans}
            />
            <span>Orphans</span>
          </label>
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigCleanupHoles}
              onChange={toggleRigCleanupHoles}
            />
            <span>Fill Holes</span>
          </label>
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigCleanupPaletteLock}
              onChange={toggleRigCleanupPaletteLock}
            />
            <span>Palette Lock</span>
          </label>
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigCleanupOutline}
              onChange={toggleRigCleanupOutline}
            />
            <span>Outline</span>
          </label>
        </div>
      </div>

      <div className="rig-output-actions">
        <button
          type="button"
          className="mini-btn"
          title="Bake every rig frame into a new raster layer"
          onClick={handleBakeToFrames}
        >
          <Film size={11} />
          <span>Bake Frames</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Export the runtime .rig.json"
          onClick={handleExportRigJson}
        >
          <Download size={11} />
          <span>Rig JSON</span>
        </button>
        <button
          type="button"
          className="mini-btn"
          title="Export Rig (Spine, Godot, v2 JSON, Multi-Clip Bake)"
          onClick={() => setRigExportModalOpen(true)}
        >
          <Download size={11} />
          <span>Export Rig…</span>
        </button>
      </div>

      <span className="rotate3d-hint">
        Cleanup runs after skinning/deformation. Mesh deformation tooling
        arrives in a later milestone.
      </span>
    </RigPanelSection>
  );
}
