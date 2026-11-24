import { useEffect, useMemo } from "react";
import { KeyRound, RotateCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  beginRigGesture,
  cancelRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import {
  isDescendantBone,
  reparentBonePreserveWorld,
} from "../../engine/rig/skeletonTools";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function BonePropertiesPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
  const rigAutoKey = useEditorStore((s) => s.rigAutoKey);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const frames = useEditorStore((s) => s.frames);
  const layers = useEditorStore((s) => s.layers);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const setupMode = rigMode === "setup";
  const bones = pixelEngine.rig.bones;
  const selectedBone =
    bones.find((b) => b.id === selectedBoneId) ?? bones[0] ?? null;

  useEffect(() => () => cancelRigGesture(), []);

  const selectedPose = useMemo(() => {
    void rigVersion;
    if (!selectedBone) return null;
    return pixelEngine.rig.getBonePoseAtFrame(
      selectedBone.id,
      currentFrame,
      true
    );
  }, [selectedBone, currentFrame, rigVersion]);

  const validParents = useMemo(() => {
    if (!selectedBone) return [];
    return bones.filter(
      (b) =>
        b.id !== selectedBone.id &&
        !isDescendantBone(bones, selectedBone.id, b.id)
    );
  }, [bones, selectedBone]);

  const isKeyed =
    rigMode === "animate" && selectedBone
      ? pixelEngine.rig.hasKeyframe(selectedBone.id, currentFrame)
      : false;

  const activeLocalX = selectedBone
    ? setupMode
      ? selectedBone.localX
      : (selectedPose?.localX ?? selectedBone.localX)
    : 0;
  const activeLocalY = selectedBone
    ? setupMode
      ? selectedBone.localY
      : (selectedPose?.localY ?? selectedBone.localY)
    : 0;
  const activeRot = selectedBone
    ? setupMode
      ? selectedBone.rotationDeg
      : (selectedPose?.rotationDeg ?? selectedBone.rotationDeg)
    : 0;
  const activeScaleX = selectedBone
    ? setupMode
      ? (selectedBone.scaleX ?? 1)
      : (selectedPose?.scaleX ?? 1)
    : 1;
  const activeScaleY = selectedBone
    ? setupMode
      ? (selectedBone.scaleY ?? 1)
      : (selectedPose?.scaleY ?? 1)
    : 1;
  const activeYaw = selectedBone
    ? setupMode
      ? (selectedBone.yawDeg ?? 0)
      : (selectedPose?.yawDeg ?? selectedBone.yawDeg ?? 0)
    : 0;
  const activePitch = selectedBone
    ? setupMode
      ? (selectedBone.pitchDeg ?? 0)
      : (selectedPose?.pitchDeg ?? selectedBone.pitchDeg ?? 0)
    : 0;
  const activeLocalZ = selectedBone
    ? setupMode
      ? (selectedBone.localZ ?? 0)
      : (selectedPose?.localZ ?? selectedBone.localZ ?? 0)
    : 0;

  const hasLimits =
    selectedBone !== null &&
    (selectedBone.minAngleDeg !== undefined ||
      selectedBone.maxAngleDeg !== undefined);

  const handleEditTransform = (patch: {
    localX?: number;
    localY?: number;
    rotationDeg?: number;
    scaleX?: number;
    scaleY?: number;
    yawDeg?: number;
    pitchDeg?: number;
    localZ?: number;
  }) => {
    if (!selectedBone) return;
    if (setupMode) {
      mutateRig("Edit bind transform", () =>
        pixelEngine.rig.updateBone(selectedBone.id, patch)
      );
    } else {
      mutateRig("Pose bone", () => {
        pixelEngine.rig.setPoseOverride(selectedBone.id, patch, currentFrame);
        if (rigAutoKey) {
          pixelEngine.rig.autoKeyBone(selectedBone.id, currentFrame, patch);
        }
      });
    }
  };

  const handleSetKeyframe = () => {
    if (!selectedBone || setupMode) return;
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

  return (
    <RigPanelSection
      id="rig-bone-props"
      title="Bone Properties"
      icon={<SlidersHorizontal size={12} />}
    >
      {!selectedBone || !selectedPose ? (
        <div className="rig-empty-note">
          Select a bone in the viewport or the Bone Tree to edit its
          properties.
        </div>
      ) : (
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
            <span>Parent</span>
            <select
              className="palette-select"
              disabled={!setupMode}
              value={selectedBone.parentId ?? ""}
              onChange={(e) => {
                const nextParent = e.target.value || null;
                mutateRig("Reparent bone", () =>
                  reparentBonePreserveWorld(
                    pixelEngine.rig,
                    selectedBone.id,
                    nextParent
                  )
                );
              }}
            >
              <option value="">None (Root)</option>
              {validParents.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
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
              {layers
                .filter((l) => l.kind === "raster")
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="rig-inspector-row">
            <span>Color</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="color"
                value={selectedBone.color ?? "#4c8bf5"}
                style={{
                  width: 24,
                  height: 20,
                  padding: 0,
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-root)",
                }}
                onChange={(e) =>
                  mutateRig("Set bone color", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      color: e.target.value,
                    })
                  )
                }
              />
              {selectedBone.color && (
                <button
                  type="button"
                  className="mini-btn"
                  title="Reset Bone Color"
                  onClick={() =>
                    mutateRig("Reset bone color", () =>
                      pixelEngine.rig.updateBone(selectedBone.id, {
                        color: undefined,
                      })
                    )
                  }
                >
                  <RotateCcw size={10} />
                </button>
              )}
            </div>
          </div>

          <div className="rig-inspector-row">
            <span>Position</span>
            <div className="rig-num-grid">
              <label className="rig-num-field">
                <span>X</span>
                <input
                  type="number"
                  step={0.5}
                  className="rig-num-input"
                  value={round2(activeLocalX)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) handleEditTransform({ localX: v });
                  }}
                />
              </label>
              <label className="rig-num-field">
                <span>Y</span>
                <input
                  type="number"
                  step={0.5}
                  className="rig-num-input"
                  value={round2(activeLocalY)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) handleEditTransform({ localY: v });
                  }}
                />
              </label>
            </div>
          </div>

          <div className="rig-inspector-row">
            <span>Scale</span>
            <div className="rig-num-grid">
              <label className="rig-num-field">
                <span>SX</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={20}
                  className="rig-num-input"
                  value={round2(activeScaleX)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) {
                      handleEditTransform({ scaleX: v });
                    }
                  }}
                />
              </label>
              <label className="rig-num-field">
                <span>SY</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={20}
                  className="rig-num-input"
                  value={round2(activeScaleY)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v > 0) {
                      handleEditTransform({ scaleY: v });
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <label className="rig-slider-row">
            <span>{setupMode ? "Bind Angle" : "Angle"}</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={Math.round(activeRot)}
              onPointerDown={() =>
                beginRigGesture(setupMode ? "Edit bind angle" : "Pose bone")
              }
              onPointerUp={endRigGesture}
              onPointerCancel={endRigGesture}
              onChange={(e) =>
                handleEditTransform({ rotationDeg: Number(e.target.value) })
              }
            />
            <input
              type="number"
              className="rig-num-input"
              style={{ width: 46 }}
              value={Math.round(activeRot)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) handleEditTransform({ rotationDeg: v });
              }}
            />
          </label>

          <label
            className="rig-slider-row"
            title={
              setupMode
                ? "Bind length"
                : "Bind length is read-only in Animate mode"
            }
          >
            <span>Length</span>
            <input
              type="range"
              min={2}
              max={Math.max(16, Math.max(canvasWidth, canvasHeight))}
              value={Math.round(selectedBone.length)}
              disabled={!setupMode}
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
            <input
              type="number"
              min={1}
              disabled={!setupMode}
              className="rig-num-input"
              style={{ width: 46 }}
              value={Math.round(selectedBone.length)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 1) {
                  mutateRig("Resize bone", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, { length: v })
                  );
                }
              }}
            />
          </label>

          <div className="rig-inspector-row">
            <label className="modal-checkbox" style={{ fontSize: 11 }}>
              <input
                type="checkbox"
                checked={hasLimits}
                onChange={(e) =>
                  mutateRig("Toggle angle limits", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      minAngleDeg: e.target.checked ? -90 : undefined,
                      maxAngleDeg: e.target.checked ? 90 : undefined,
                    })
                  )
                }
              />
              <span>Limits</span>
            </label>
            {hasLimits ? (
              <div className="rig-num-grid">
                <label className="rig-num-field">
                  <span>Min</span>
                  <input
                    type="number"
                    className="rig-num-input"
                    value={Math.round(selectedBone.minAngleDeg ?? -90)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        mutateRig("Set min angle", () =>
                          pixelEngine.rig.updateBone(selectedBone.id, {
                            minAngleDeg: v,
                          })
                        );
                      }
                    }}
                  />
                </label>
                <label className="rig-num-field">
                  <span>Max</span>
                  <input
                    type="number"
                    className="rig-num-input"
                    value={Math.round(selectedBone.maxAngleDeg ?? 90)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) {
                        mutateRig("Set max angle", () =>
                          pixelEngine.rig.updateBone(selectedBone.id, {
                            maxAngleDeg: v,
                          })
                        );
                      }
                    }}
                  />
                </label>
              </div>
            ) : (
              <span className="rotate3d-hint">Unconstrained</span>
            )}
          </div>

          <div className="rig-cleanup-box">
            <div className="rig-option-row">
              <span className="rig-cleanup-title">3D Rotation & Extrusion</span>
              <button
                type="button"
                className="mini-btn"
                title="Reset 3D Yaw, Pitch, and Z"
                onClick={() =>
                  handleEditTransform({ yawDeg: 0, pitchDeg: 0, localZ: 0 })
                }
              >
                <RotateCcw size={10} />
                <span>Reset 3D</span>
              </button>
            </div>

            <label className="rig-slider-row">
              <span>Yaw</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(activeYaw)}
                onPointerDown={() => beginRigGesture("3D Rotate Bone")}
                onPointerUp={endRigGesture}
                onPointerCancel={endRigGesture}
                onChange={(e) =>
                  handleEditTransform({ yawDeg: Number(e.target.value) })
                }
              />
              <input
                type="number"
                className="rig-num-input"
                style={{ width: 46 }}
                value={Math.round(activeYaw)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) handleEditTransform({ yawDeg: v });
                }}
              />
            </label>

            <label className="rig-slider-row">
              <span>Pitch</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(activePitch)}
                onPointerDown={() => beginRigGesture("3D Rotate Bone")}
                onPointerUp={endRigGesture}
                onPointerCancel={endRigGesture}
                onChange={(e) =>
                  handleEditTransform({ pitchDeg: Number(e.target.value) })
                }
              />
              <input
                type="number"
                className="rig-num-input"
                style={{ width: 46 }}
                value={Math.round(activePitch)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) handleEditTransform({ pitchDeg: v });
                }}
              />
            </label>

            <div className="rig-inspector-row">
              <span>Depth Z</span>
              <input
                type="number"
                step={0.5}
                className="rig-num-input"
                style={{ width: 64 }}
                value={round2(activeLocalZ)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) handleEditTransform({ localZ: v });
                }}
              />
            </div>

            <label className="rig-slider-row">
              <span>Thickness</span>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={Math.round(selectedBone.extrudeDepth ?? 0)}
                onPointerDown={() => beginRigGesture("Set bone thickness")}
                onPointerUp={endRigGesture}
                onPointerCancel={endRigGesture}
                onChange={(e) =>
                  mutateRig("Set bone thickness", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      extrudeDepth: Number(e.target.value),
                    })
                  )
                }
              />
              <input
                type="number"
                min={0}
                max={12}
                className="rig-num-input"
                style={{ width: 46 }}
                value={Math.round(selectedBone.extrudeDepth ?? 0)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    const clamped = Math.max(0, Math.min(12, Math.round(v)));
                    mutateRig("Set bone thickness", () =>
                      pixelEngine.rig.updateBone(selectedBone.id, {
                        extrudeDepth: clamped,
                      })
                    );
                  }
                }}
              />
            </label>

            <div className="rig-inspector-row">
              <span>Profile</span>
              <select
                className="palette-select"
                value={selectedBone.depthProfile ?? "slab"}
                onChange={(e) => {
                  const v = e.target.value as "slab" | "bevel" | "pillow";
                  mutateRig("Set bone depth profile", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      depthProfile: v,
                    })
                  );
                }}
              >
                <option value="slab">Slab</option>
                <option value="bevel">Bevel</option>
                <option value="pillow">Pillow</option>
              </select>
            </div>

            <div className="rig-inspector-row">
              <span>Back Layer</span>
              <select
                className="palette-select"
                value={selectedBone.backLayerId ?? ""}
                onChange={(e) =>
                  mutateRig("Set bone back layer", () =>
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      backLayerId: e.target.value || null,
                    })
                  )
                }
              >
                <option value="">None</option>
                {layers
                  .filter((l) => l.kind === "raster")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="rig-key-actions">
            <button
              type="button"
              className={`mini-btn ${isKeyed ? "active" : ""}`}
              title={
                setupMode
                  ? "Keyframes are edited in Animate mode"
                  : "Set/replace a keyframe on the current frame"
              }
              aria-disabled={setupMode || undefined}
              onClick={handleSetKeyframe}
            >
              <KeyRound size={11} />
              <span>
                Set Key (F{currentFrame + 1}/{frames.length})
              </span>
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

          {setupMode && (
            <span className="rotate3d-hint">
              Setup edits the bind pose. Switch to Animate for pose overrides
              and keyframes.
            </span>
          )}
        </div>
      )}
    </RigPanelSection>
  );
}
