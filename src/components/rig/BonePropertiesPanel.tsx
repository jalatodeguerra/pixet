import { useEffect, useMemo } from "react";
import { KeyRound, SlidersHorizontal, Trash2 } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  beginRigGesture,
  cancelRigGesture,
  endRigGesture,
  mutateRig,
} from "../../engine/rig/rigActions";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

export function BonePropertiesPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigMode = useEditorStore((s) => s.rigMode);
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

  const isKeyed =
    rigMode === "animate" && selectedBone
      ? pixelEngine.rig.hasKeyframe(selectedBone.id, currentFrame)
      : false;

  const handleUpdateBindAngle = (rotationDeg: number) => {
    if (!selectedBone) return;
    mutateRig("Edit bind angle", () =>
      pixelEngine.rig.updateBone(selectedBone.id, { rotationDeg })
    );
  };

  const handleUpdatePose = (patch: { rotationDeg: number }) => {
    if (!selectedBone) return;
    mutateRig("Pose bone", () =>
      pixelEngine.rig.setPoseOverride(selectedBone.id, patch, currentFrame)
    );
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

          <label className="rig-slider-row">
            <span>{setupMode ? "Bind Angle" : "Angle"}</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={Math.round(
                setupMode ? selectedBone.rotationDeg : selectedPose.rotationDeg
              )}
              onPointerDown={() =>
                beginRigGesture(setupMode ? "Edit bind angle" : "Pose bone")
              }
              onPointerUp={endRigGesture}
              onPointerCancel={endRigGesture}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (setupMode) {
                  handleUpdateBindAngle(value);
                } else {
                  handleUpdatePose({ rotationDeg: value });
                }
              }}
            />
            <span className="mono-value">
              {Math.round(
                setupMode ? selectedBone.rotationDeg : selectedPose.rotationDeg
              )}
              °
            </span>
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
            <span className="mono-value">
              {Math.round(selectedBone.length)}px
            </span>
          </label>

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
