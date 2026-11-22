import { useEffect, useMemo, useState } from "react";
import {
  Bone as BoneIcon,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  MousePointer,
  Paintbrush,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PixelBuffer, rgbaToHex } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import { type Bone, getBoneInfluenceColor } from "../engine/rig/RigEngine";
import {
  beginRigGesture,
  cancelRigGesture,
  endRigGesture,
  mutateRig,
} from "../engine/rig/rigActions";
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
  const rigShowInfluence = useEditorStore((s) => s.rigShowInfluence);
  const toggleRigShowInfluence = useEditorStore((s) => s.toggleRigShowInfluence);
  const rigBrushSize = useEditorStore((s) => s.rigBrushSize);
  const setRigBrushSize = useEditorStore((s) => s.setRigBrushSize);
  const rigWeightStrength = useEditorStore((s) => s.rigWeightStrength);
  const setRigWeightStrength = useEditorStore((s) => s.setRigWeightStrength);
  const rigWeightMode = useEditorStore((s) => s.rigWeightMode);
  const setRigWeightMode = useEditorStore((s) => s.setRigWeightMode);
  const rigWeightFalloff = useEditorStore((s) => s.rigWeightFalloff);
  const setRigWeightFalloff = useEditorStore((s) => s.setRigWeightFalloff);
  const rigWeightOverlay = useEditorStore((s) => s.rigWeightOverlay);
  const setRigWeightOverlay = useEditorStore((s) => s.setRigWeightOverlay);
  const rigCleanupOrphans = useEditorStore((s) => s.rigCleanupOrphans);
  const rigCleanupHoles = useEditorStore((s) => s.rigCleanupHoles);
  const rigCleanupPaletteLock = useEditorStore((s) => s.rigCleanupPaletteLock);
  const rigCleanupOutline = useEditorStore((s) => s.rigCleanupOutline);
  const toggleRigCleanupOrphans = useEditorStore((s) => s.toggleRigCleanupOrphans);
  const toggleRigCleanupHoles = useEditorStore((s) => s.toggleRigCleanupHoles);
  const toggleRigCleanupPaletteLock = useEditorStore(
    (s) => s.toggleRigCleanupPaletteLock
  );
  const toggleRigCleanupOutline = useEditorStore(
    (s) => s.toggleRigCleanupOutline
  );
  const rigVersion = useEditorStore((s) => s.rigVersion);

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

  useEffect(() => () => cancelRigGesture(), []);

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
    let rootId: string | null = null;
    mutateRig("Create starter rig", () => {
      rootId = pixelEngine.rig.seedStarterRig(
        canvasWidth,
        canvasHeight,
        rasterLayers.map((l) => l.id)
      ).id;
    });
    if (rootId) setSelectedBoneId(rootId);
    setStatusMessage("Created starter 2-bone idle rig");
  };

  const handleAddBone = () => {
    const parent = selectedBone;
    const bone = mutateRig("Add bone", () =>
      pixelEngine.rig.addBone({
        parentId: parent ? parent.id : null,
        localX: parent ? parent.length : Math.round(canvasWidth / 2),
        localY: parent ? 0 : Math.round(canvasHeight / 2),
        length: Math.max(4, Math.round(canvasHeight * 0.2)),
        rotationDeg: parent ? 0 : -90,
        boundLayerId: null,
      })
    );
    setSelectedBoneId(bone.id);
  };

  const handleDeleteBone = (boneId: string) => {
    mutateRig("Delete bone", () => pixelEngine.rig.removeBone(boneId));
    if (selectedBoneId === boneId) {
      setSelectedBoneId(pixelEngine.rig.bones[0]?.id ?? null);
    }
  };

  const handleUpdatePose = (patch: {
    rotationDeg?: number;
    localX?: number;
    localY?: number;
  }) => {
    if (!selectedBone) return;
    mutateRig("Pose bone", () =>
      pixelEngine.rig.setPoseOverride(selectedBone.id, patch, currentFrame)
    );
  };

  const handleSetKeyframe = () => {
    if (!selectedBone) return;
    mutateRig("Set keyframe", () =>
      pixelEngine.rig.setKeyframe(selectedBone.id, currentFrame, "easeInOut")
    );
    setStatusMessage(
      `Keyframed "${selectedBone.name}" on frame ${currentFrame + 1}`
    );
  };

  const handleDeleteKeyframe = () => {
    if (!selectedBone) return;
    mutateRig("Delete keyframe", () => {
      pixelEngine.rig.deleteKeyframe(selectedBone.id, currentFrame);
      pixelEngine.rig.clearPoseOverrides();
    });
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

  const handleAutoWeight = () => {
    if (pixelEngine.rig.bones.length === 0) {
      setStatusMessage("Add bones before auto-weighting");
      return;
    }
    mutateRig("Auto-weight", () => {
      const composited = pixelEngine.compositeFrame(layers, currentFrame);
      const buf = new PixelBuffer(canvasWidth, canvasHeight, composited);
      pixelEngine.rig.autoAssignBoneWeights(buf, currentFrame);
    });
    setStatusMessage("Auto-weighted pixels with smooth bone falloff");
  };

  const handleClearMask = () => {
    if (!selectedBone) return;
    mutateRig("Clear weights", () =>
      pixelEngine.rig.clearBoneMask(selectedBone.id)
    );
    setStatusMessage(`Cleared influence mask for "${selectedBone.name}"`);
  };

  const toolButtons: { id: RigTool; label: string; icon: typeof MousePointer }[] = [
    { id: "select", label: "Pose", icon: MousePointer },
    { id: "addBone", label: "Add Bone", icon: Plus },
    { id: "ik", label: "2-Bone IK", icon: Crosshair },
    { id: "weightPaint", label: "Paint", icon: Paintbrush },
  ];

  const [collapsed, setCollapsed] = useState(false);

  const isKeyed = selectedBone
    ? pixelEngine.rig.hasKeyframe(selectedBone.id, currentFrame)
    : false;

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <BoneIcon size={12} />
          <span>2D Pixel Rig</span>
        </button>
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

      {!collapsed && <div className="panel-body">
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

        {/* R6 Pixel Cleanup — carried into src/components/rig/RigRenderPanel.tsx by R1. */}
        <div
          className="rig-option-row"
          style={{ flexWrap: "wrap", justifyContent: "flex-start", gap: 6 }}
        >
          <span style={{ width: "100%", fontSize: 10, color: "var(--text-muted)" }}>
            Pixel Cleanup (post-deform)
          </span>
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

        {bones.length > 0 && (
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

            {/* R6 smooth weight brush — carried into src/components/rig/WeightsPanel.tsx by R1. */}
            {rigTool === "weightPaint" && (
              <>
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
                <label className="rig-slider-row">
                  <span>Strength</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rigWeightStrength}
                    onChange={(e) =>
                      setRigWeightStrength(Number(e.target.value))
                    }
                  />
                  <span className="mono-value">
                    {Math.round(rigWeightStrength * 100)}%
                  </span>
                </label>
                <div className="rig-option-row">
                  <span>Mode</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {(
                      [
                        ["add", "Add"],
                        ["subtract", "Sub"],
                        ["smooth", "Smooth"],
                        ["replace", "Replace"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`mini-btn ${rigWeightMode === mode ? "active" : ""}`}
                        onClick={() => setRigWeightMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rig-option-row">
                  <span>Falloff</span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {(
                      [
                        ["hard", "Hard"],
                        ["linear", "Linear"],
                      ] as const
                    ).map(([falloff, label]) => (
                      <button
                        key={falloff}
                        type="button"
                        className={`mini-btn ${rigWeightFalloff === falloff ? "active" : ""}`}
                        onClick={() => setRigWeightFalloff(falloff)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="rotate3d-hint">
                  Left-drag paint · Right-drag erase weight
                </span>
              </>
            )}

            {/* R6 overlay view switch (heatmap is the default). */}
            <div className="rig-option-row">
              <span>Overlay</span>
              <div style={{ display: "flex", gap: 3 }}>
                {(
                  [
                    ["heatmap", "Heatmap"],
                    ["boneColors", "Colors"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`mini-btn ${rigWeightOverlay === mode ? "active" : ""}`}
                    onClick={() => setRigWeightOverlay(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}

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
            {bones.map((bone, boneIndex) => {
              const depth = getBoneDepth(bones, bone);
              const active = selectedBone?.id === bone.id;
              const keyed = pixelEngine.rig.hasKeyframe(bone.id, currentFrame);
              const infColor = getBoneInfluenceColor(boneIndex);
              const infHex = rgbaToHex(infColor[0], infColor[1], infColor[2]);
              return (
                <div
                  key={bone.id}
                  className={`rig-bone-row ${active ? "active" : ""}`}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => setSelectedBoneId(bone.id)}
                >
                  <span
                    className="rig-influence-swatch"
                    style={{ backgroundColor: infHex }}
                    title="Bone influence color"
                  />
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
                onFocus={() => beginRigGesture("Rename bone")}
                onBlur={endRigGesture}
                onChange={(e) =>
                  mutateRig("Rename bone", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      name: e.target.value,
                    })
                  )
                }
              />
            </div>

            <div className="rig-inspector-row">
              <span>Bind Layer</span>
              <select
                className="palette-select"
                value={selectedBone.boundLayerId ?? ""}
                onChange={(e) =>
                  mutateRig("Bind layer", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      boundLayerId: e.target.value || null,
                    })
                  )
                }
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
                onPointerDown={() => beginRigGesture("Pose bone")}
                onPointerUp={endRigGesture}
                onPointerCancel={endRigGesture}
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
                onPointerDown={() => beginRigGesture("Resize bone")}
                onPointerUp={endRigGesture}
                onPointerCancel={endRigGesture}
                onChange={(e) =>
                  mutateRig("Resize bone", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      length: Number(e.target.value),
                    })
                  )
                }
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
      </div>}
    </section>
  );
}
