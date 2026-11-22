import { useMemo } from "react";
import {
  Bone as BoneIcon,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  MousePointer,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import type { Bone } from "../engine/rig/RigEngine";
import { type RigTool, useEditorStore } from "../store/editorStore";

function getBoneDepth(bones: readonly Bone[], bone: Bone): number {
  const byId = new Map(bones.map((b) => [b.id, b]));
  let depth = 0;
  let parentId = bone.parentId;
  const visited = new Set<string>([bone.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth++;
    parentId = parent.parentId;
  }
  return depth;
}

export function RigPanel() {
  const rigTool = useEditorStore((s) => s.rigTool);
  const setRigTool = useEditorStore((s) => s.setRigTool);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const toggleRigPixelSnap = useEditorStore((s) => s.toggleRigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);
  const toggleRigRotSprite = useEditorStore((s) => s.toggleRigRotSprite);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const toggleRigShowBones = useEditorStore((s) => s.toggleRigShowBones);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const bumpRigVersion = useEditorStore((s) => s.bumpRigVersion);

  const layers = useEditorStore((s) => s.layers);
  const frames = useEditorStore((s) => s.frames);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const documentName = useEditorStore((s) => s.documentName);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const rasterLayers = useMemo(
    () => layers.filter((l) => l.kind === "raster"),
    [layers]
  );

  const bones = pixelEngine.rig.bones;
  const activeClip = pixelEngine.rig.getActiveClip();
  const selectedBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;

  // Read live pose for selected bone (recomputed cleanly via rigVersion + currentFrame)
  const selectedPose = useMemo(() => {
    void rigVersion;
    if (!selectedBone) return null;
    return pixelEngine.rig.getBonePoseAtFrame(
      selectedBone.id,
      currentFrame,
      true
    );
  }, [selectedBone, currentFrame, rigVersion]);

  const handleStarterRig = () => {
    const root = pixelEngine.rig.seedStarterRig(
      canvasWidth,
      canvasHeight,
      rasterLayers.map((l) => l.id)
    );
    setSelectedBoneId(root.id);
    bumpRigVersion();
    pixelEngine.emitChange();
    setStatusMessage("Created starter 2-bone idle rig");
  };

  const handleAddBone = () => {
    const parent = selectedBone;
    const bone = pixelEngine.rig.addBone({
      parentId: parent ? parent.id : null,
      localX: parent ? parent.length : Math.round(canvasWidth / 2),
      localY: parent ? 0 : Math.round(canvasHeight / 2),
      length: Math.max(4, Math.round(canvasHeight * 0.2)),
      rotationDeg: parent ? 0 : -90,
      boundLayerId: null,
    });
    setSelectedBoneId(bone.id);
    bumpRigVersion();
    pixelEngine.emitChange();
  };

  const handleDeleteBone = (boneId: string) => {
    pixelEngine.rig.removeBone(boneId);
    if (selectedBoneId === boneId) {
      setSelectedBoneId(pixelEngine.rig.bones[0]?.id ?? null);
    }
    bumpRigVersion();
    pixelEngine.emitChange();
  };

  const handleUpdatePose = (patch: {
    rotationDeg?: number;
    localX?: number;
    localY?: number;
  }) => {
    if (!selectedBone) return;
    pixelEngine.rig.setPoseOverride(selectedBone.id, patch, currentFrame);
    bumpRigVersion();
    pixelEngine.emitChange();
  };

  const handleSetKeyframe = () => {
    if (!selectedBone) return;
    pixelEngine.rig.setKeyframe(selectedBone.id, currentFrame, "easeInOut");
    bumpRigVersion();
    pixelEngine.emitChange();
    setStatusMessage(
      `Keyframed "${selectedBone.name}" on frame ${currentFrame + 1}`
    );
  };

  const handleDeleteKeyframe = () => {
    if (!selectedBone) return;
    pixelEngine.rig.deleteKeyframe(selectedBone.id, currentFrame);
    pixelEngine.rig.clearPoseOverrides();
    bumpRigVersion();
    pixelEngine.emitChange();
  };

  const handleBakeToFrames = () => {
    if (pixelEngine.rig.bones.length === 0) {
      setStatusMessage("Add or seed bones before baking");
      return;
    }
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const bakeCount = Math.max(state.frames.length, activeClip.frameCount);
    const snapshotLayers = state.layers.slice();

    const bakedBuffers: Uint8ClampedArray[] = [];
    for (let f = 0; f < bakeCount; f++) {
      const composited = pixelEngine.compositeRigFrame(
        snapshotLayers,
        f,
        { pixelSnap: state.rigPixelSnap, rotSprite: state.rigRotSprite },
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
    setStatusMessage(`Baked ${bakeCount} rig frames to "${"Baked Rig"}" layer`);
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

  const toolButtons: { id: RigTool; label: string; icon: typeof MousePointer }[] = [
    { id: "select", label: "Pose", icon: MousePointer },
    { id: "addBone", label: "Add Bone", icon: Plus },
    { id: "ik", label: "2-Bone IK", icon: Crosshair },
  ];

  const isKeyed = selectedBone
    ? pixelEngine.rig.hasKeyframe(selectedBone.id, currentFrame)
    : false;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <BoneIcon size={12} />
          <span>2D Pixel Rig</span>
        </div>
        <div className="panel-header-actions">
          <button
            type="button"
            className="mini-btn"
            title={rigShowBones ? "Hide Bone Overlay" : "Show Bone Overlay"}
            onClick={toggleRigShowBones}
          >
            {rigShowBones ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            type="button"
            className="mini-btn"
            title="Create Starter 2-Bone Idle Rig"
            onClick={handleStarterRig}
          >
            <Sparkles size={11} />
            <span>Starter</span>
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div className="rig-tool-row">
          {toolButtons.map((tb) => {
            const Icon = tb.icon;
            return (
              <button
                key={tb.id}
                type="button"
                className={`mini-btn ${rigTool === tb.id ? "active" : ""}`}
                onClick={() => setRigTool(tb.id)}
              >
                <Icon size={11} />
                <span>{tb.label}</span>
              </button>
            );
          })}
        </div>

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

        <div className="rig-hierarchy-head">
          <span>Bones ({bones.length})</span>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Add Child/Root Bone"
            onClick={handleAddBone}
          >
            <Plus size={12} />
          </button>
        </div>

        {bones.length === 0 ? (
          <div className="rig-empty-note">
            Click <strong>Starter</strong> or select <strong>Add Bone</strong>{" "}
            and drag on the canvas to build a skeleton.
          </div>
        ) : (
          <div className="rig-bone-list">
            {bones.map((bone) => {
              const depth = getBoneDepth(bones, bone);
              const active = selectedBone?.id === bone.id;
              const keyed = pixelEngine.rig.hasKeyframe(bone.id, currentFrame);
              return (
                <div
                  key={bone.id}
                  className={`rig-bone-row ${active ? "active" : ""}`}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => setSelectedBoneId(bone.id)}
                >
                  <BoneIcon size={11} />
                  <span className="rig-bone-name">{bone.name}</span>
                  {keyed && (
                    <span
                      className="rig-key-dot"
                      title={`Keyframed on F${currentFrame + 1}`}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 18, height: 18 }}
                    title="Delete Bone"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteBone(bone.id);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {selectedBone && selectedPose && (
          <div className="rig-inspector">
            <div className="rig-inspector-row">
              <span>Name</span>
              <input
                className="rig-text-input"
                value={selectedBone.name}
                onChange={(e) => {
                  pixelEngine.rig.updateBone(selectedBone.id, {
                    name: e.target.value,
                  });
                  bumpRigVersion();
                }}
              />
            </div>

            <div className="rig-inspector-row">
              <span>Bind Layer</span>
              <select
                className="palette-select"
                value={selectedBone.boundLayerId ?? ""}
                onChange={(e) => {
                  pixelEngine.rig.updateBone(selectedBone.id, {
                    boundLayerId: e.target.value || null,
                  });
                  bumpRigVersion();
                  pixelEngine.emitChange();
                }}
              >
                <option value="">None (IK / Guide)</option>
                {rasterLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="rig-slider-row">
              <span>Angle</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(selectedPose.rotationDeg)}
                onChange={(e) =>
                  handleUpdatePose({ rotationDeg: Number(e.target.value) })
                }
              />
              <span className="mono-value">
                {Math.round(selectedPose.rotationDeg)}°
              </span>
            </label>

            <label className="rig-slider-row">
              <span>Length</span>
              <input
                type="range"
                min={2}
                max={Math.max(16, Math.max(canvasWidth, canvasHeight))}
                value={Math.round(selectedBone.length)}
                onChange={(e) => {
                  pixelEngine.rig.updateBone(selectedBone.id, {
                    length: Number(e.target.value),
                  });
                  bumpRigVersion();
                  pixelEngine.emitChange();
                }}
              />
              <span className="mono-value">
                {Math.round(selectedBone.length)}px
              </span>
            </label>

            <div className="rig-key-actions">
              <button
                type="button"
                className={`mini-btn ${isKeyed ? "active" : ""}`}
                onClick={handleSetKeyframe}
              >
                <KeyRound size={11} />
                <span>Set Key (F{currentFrame + 1}/{frames.length})</span>
              </button>
              {isKeyed && (
                <button
                  type="button"
                  className="mini-btn"
                  title="Delete Keyframe"
                  onClick={handleDeleteKeyframe}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="rig-output-actions">
          <button
            type="button"
            className="mini-btn"
            onClick={handleBakeToFrames}
          >
            <Film size={11} />
            <span>Bake Frames</span>
          </button>
          <button
            type="button"
            className="mini-btn"
            onClick={handleExportRigJson}
          >
            <Download size={11} />
            <span>Rig JSON</span>
          </button>
        </div>
      </div>
    </section>
  );
}
