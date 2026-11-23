import { useEffect, useRef } from "react";
import { Lock, Paintbrush, Unlock } from "lucide-react";
import { PixelBuffer } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  type AutoWeightMethod,
  defaultEnvelopeRadius,
} from "../../engine/rig/autoWeights";
import { mutateRig } from "../../engine/rig/rigActions";
import { falloffAt } from "../../engine/rig/skinning";
import { useEditorStore } from "../../store/editorStore";
import { RigPanelSection } from "./RigPanelSection";

/**
 * Weight painting and R6 smooth-weight controls.
 *
 * The panel is deliberately split into "Influence", "Overlay" and "Brush"
 * blocks so later weight features can extend one block without disturbing the
 * others.
 */
export function WeightsPanel() {
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const selectedBoneIds = useEditorStore((s) => s.selectedBoneIds);
  const setSelectedBoneId = useEditorStore((s) => s.setSelectedBoneId);
  const rigTool = useEditorStore((s) => s.rigTool);
  const setRigTool = useEditorStore((s) => s.setRigTool);
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
  const rigWeightAirbrush = useEditorStore((s) => s.rigWeightAirbrush);
  const toggleRigWeightAirbrush = useEditorStore(
    (s) => s.toggleRigWeightAirbrush
  );
  const falloffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rigAutoWeightMethod = useEditorStore((s) => s.rigAutoWeightMethod);
  const setRigAutoWeightMethod = useEditorStore(
    (s) => s.setRigAutoWeightMethod
  );
  const rigAutoWeightPower = useEditorStore((s) => s.rigAutoWeightPower);
  const setRigAutoWeightPower = useEditorStore((s) => s.setRigAutoWeightPower);
  const rigAutoWeightColorPenalty = useEditorStore(
    (s) => s.rigAutoWeightColorPenalty
  );
  const setRigAutoWeightColorPenalty = useEditorStore(
    (s) => s.setRigAutoWeightColorPenalty
  );
  const rigAutoWeightSelectedOnly = useEditorStore(
    (s) => s.rigAutoWeightSelectedOnly
  );
  const toggleRigAutoWeightSelectedOnly = useEditorStore(
    (s) => s.toggleRigAutoWeightSelectedOnly
  );
  const rigAutoWeightRespectSelection = useEditorStore(
    (s) => s.rigAutoWeightRespectSelection
  );
  const toggleRigAutoWeightRespectSelection = useEditorStore(
    (s) => s.toggleRigAutoWeightRespectSelection
  );
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
    const targetBoneIds = rigAutoWeightSelectedOnly
      ? selectedBoneIds.length > 0
        ? selectedBoneIds
        : selectedBone
          ? [selectedBone.id]
          : undefined
      : undefined;
    if (rigAutoWeightSelectedOnly && (!targetBoneIds || targetBoneIds.length === 0)) {
      setStatusMessage("Select at least one bone for Selected-Only auto-weight");
      return;
    }
    const selectionMask =
      rigAutoWeightRespectSelection && pixelEngine.selection
        ? pixelEngine.selection.mask
        : null;

    mutateRig(`Auto-weight (${rigAutoWeightMethod})`, () => {
      const composited = pixelEngine.compositeFrame(layers, currentFrame);
      const buf = new PixelBuffer(canvasWidth, canvasHeight, composited);
      pixelEngine.rig.autoAssignBoneWeights(buf, currentFrame, {
        method: rigAutoWeightMethod,
        power: rigAutoWeightPower,
        colorPenalty: rigAutoWeightColorPenalty,
        selectionMask,
        targetBoneIds,
        respectLockedBones: true,
      });
    });
    setStatusMessage(`Auto-weighted pixels (${rigAutoWeightMethod})`);
  };

  useEffect(() => {
    const canvas = falloffCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#4c8bf5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const dist = (x / (w - 1)) * 1;
      const val = falloffAt(dist, 1, rigWeightFalloff);
      const y = h - 2 - val * (h - 4);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [rigWeightFalloff, bones.length]);

  const selectedEnvelopeRadius = selectedBone
    ? selectedBone.envelopeRadius ??
      defaultEnvelopeRadius({
        x: 0,
        y: 0,
        tipX: selectedBone.length,
        tipY: 0,
      })
    : 8;

  const handleClearMask = () => {
    if (!selectedBone) return;
    mutateRig("Clear weights", () =>
      pixelEngine.rig.clearBoneMask(selectedBone.id)
    );
    setStatusMessage(`Cleared weights for "${selectedBone.name}"`);
  };

  const selectPaintTool = () => {
    if (selectedBone) setSelectedBoneId(selectedBone.id);
    setRigTool("weightPaint");
  };

  return (
    <RigPanelSection
      id="rig-weights"
      title="Weights"
      icon={<Paintbrush size={12} />}
      actions={
        <button
          type="button"
          className={`mini-btn ${rigTool === "weightPaint" ? "active" : ""}`}
          title="Weight Paint (W)"
          onClick={selectPaintTool}
        >
          <Paintbrush size={11} />
          <span>Paint</span>
        </button>
      }
    >
      {/* Influence: visibility, auto weights and clearing. */}
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
            {selectedBone && (
              <button
                type="button"
                className={`mini-btn ${selectedBone.weightLocked ? "active" : ""}`}
                title={
                  selectedBone.weightLocked
                    ? "Unlock bone weights"
                    : "Lock bone weights against auto-weight and brush edits"
                }
                onClick={() => {
                  mutateRig("Toggle bone weight lock", () => {
                    pixelEngine.rig.updateBone(selectedBone.id, {
                      weightLocked: !selectedBone.weightLocked,
                    });
                  });
                }}
              >
                {selectedBone.weightLocked ? (
                  <Lock size={11} />
                ) : (
                  <Unlock size={11} />
                )}
              </button>
            )}
            <button
              type="button"
              className="mini-btn"
              title="Auto-assign smooth weights to the nearest bone segments"
              onClick={handleAutoWeight}
            >
              Auto-Weight
            </button>
            {selectedBone && pixelEngine.rig.getBoneMask(selectedBone.id) && (
              <button
                type="button"
                className="mini-btn"
                title="Clear selected bone weights"
                onClick={handleClearMask}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!selectedBone && (
          <span className="rotate3d-hint">
            Select a bone to paint its influence weights.
          </span>
        )}

        <div className="rig-option-row">
          <span className="rig-option-label">Method</span>
          <select
            className="rig-select"
            value={rigAutoWeightMethod}
            onChange={(e) =>
              setRigAutoWeightMethod(e.target.value as AutoWeightMethod)
            }
          >
            <option value="geodesic">Geodesic (Silhouette)</option>
            <option value="heat">Heat Diffusion</option>
            <option value="envelope">Envelope Capsule</option>
            <option value="rigid">Rigid (1-Bone / Island)</option>
            <option value="euclidean">Euclidean (Legacy)</option>
          </select>
        </div>

        <div className="rig-option-row">
          <span className="rig-option-label">Falloff</span>
          <input
            type="range"
            min={0.5}
            max={6}
            step={0.25}
            value={rigAutoWeightPower}
            onChange={(e) => setRigAutoWeightPower(Number(e.target.value))}
          />
          <span className="rig-option-value">
            {rigAutoWeightPower.toFixed(2)}
          </span>
        </div>

        {(rigAutoWeightMethod === "geodesic" ||
          rigAutoWeightMethod === "heat") && (
          <div className="rig-option-row">
            <span className="rig-option-label">Edge Respect</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={rigAutoWeightColorPenalty}
              onChange={(e) =>
                setRigAutoWeightColorPenalty(Number(e.target.value))
              }
            />
            <span className="rig-option-value">
              {Math.round(rigAutoWeightColorPenalty * 100)}%
            </span>
          </div>
        )}

        {rigAutoWeightMethod === "envelope" && selectedBone && (
          <div className="rig-option-row">
            <span className="rig-option-label">Envelope</span>
            <input
              type="range"
              min={1}
              max={64}
              step={0.5}
              value={selectedEnvelopeRadius}
              onChange={(e) => {
                const nextRadius = Number(e.target.value);
                mutateRig("Set envelope radius", () => {
                  pixelEngine.rig.updateBone(selectedBone.id, {
                    envelopeRadius: nextRadius,
                  });
                });
              }}
            />
            <span className="rig-option-value">
              {selectedEnvelopeRadius.toFixed(1)}px
            </span>
          </div>
        )}

        <div className="rig-option-row">
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigAutoWeightSelectedOnly}
              onChange={toggleRigAutoWeightSelectedOnly}
            />
            <span>Selected Bone(s) Only</span>
          </label>
          <label className="modal-checkbox" style={{ fontSize: 11 }}>
            <input
              type="checkbox"
              checked={rigAutoWeightRespectSelection}
              onChange={toggleRigAutoWeightRespectSelection}
            />
            <span>Clip to Selection</span>
          </label>
        </div>
      </div>

      {/* Overlay: R6 selected-bone heatmap or the original per-bone colors. */}
      {bones.length > 0 && (
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
                title={
                  mode === "heatmap"
                    ? "Show the selected bone's weight as a heatmap"
                    : "Show every bone's influence color"
                }
                onClick={() => setRigWeightOverlay(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Brush: R6 strength/mode/falloff around the existing size control. */}
      {bones.length > 0 && (
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
              onChange={(e) => setRigWeightStrength(Number(e.target.value))}
            />
            <span className="mono-value">
              {Math.round(rigWeightStrength * 100)}%
            </span>
          </label>

          <div className="rig-option-row">
            <span>Mode</span>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {(
                [
                  ["add", "Add"],
                  ["subtract", "Sub"],
                  ["smooth", "Smooth"],
                  ["replace", "Replace"],
                  ["sharpen", "Sharp"],
                  ["scale", "Scale"],
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
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 3 }}>
                {(
                  [
                    ["hard", "Hard"],
                    ["linear", "Linear"],
                    ["smoothstep", "Smooth"],
                    ["gaussian", "Gauss"],
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
              <canvas
                ref={falloffCanvasRef}
                width={48}
                height={20}
                style={{
                  border: "1px solid #303030",
                  borderRadius: 0,
                  flexShrink: 0,
                }}
                title="Brush falloff curve preview"
              />
            </div>
          </div>

          <div className="rig-option-row">
            <label className="modal-checkbox" style={{ fontSize: 11 }}>
              <input
                type="checkbox"
                checked={rigWeightAirbrush}
                onChange={toggleRigWeightAirbrush}
              />
              <span>Airbrush (Additive Drag)</span>
            </label>
          </div>

          <span className="rotate3d-hint">
            Left-drag paint · Right-drag subtract · W selects the brush
          </span>

          {selectedBone && rigTool !== "weightPaint" && (
            <button
              type="button"
              className="mini-btn"
              title="Select the Weight Paint tool"
              onClick={selectPaintTool}
            >
              <Paintbrush size={11} />
              <span>Paint "{selectedBone.name}"</span>
            </button>
          )}
        </>
      )}
    </RigPanelSection>
  );
}
