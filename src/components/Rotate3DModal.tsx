import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Film, Play, RotateCcw, Square, Sparkles, X } from "lucide-react";
import { hexToRgba, PixelBuffer } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import {
  bakeTurntableFrames,
  render25DSprite,
  renderSpriteStack,
  type Rotate3DMode,
  type SpinAxis,
} from "../engine/tools/rotate3d";
import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../store/editorStore";

type SourceScope = "visible" | "active";

function normalizeDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180 && deg > 0) d = 180;
  return Math.round(d);
}

export function Rotate3DModal() {
  const open = useEditorStore((s) => s.rotate3dModalOpen);
  const setOpen = useEditorStore((s) => s.setRotate3dModalOpen);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);

  const [mode, setMode] = useState<Rotate3DMode>("extruded");
  const [sourceScope, setSourceScope] = useState<SourceScope>("visible");

  // 2.5D & Shared angle controls
  const [yawDeg, setYawDeg] = useState(28);
  const [pitchDeg, setPitchDeg] = useState(18);
  const [rollDeg, setRollDeg] = useState(0);
  const [extrudeDepth, setExtrudeDepth] = useState(4);
  const [perspective, setPerspective] = useState(0.35);
  const [supersample, setSupersample] = useState(true);

  // Sprite stacking controls
  const [stackPitchDeg, setStackPitchDeg] = useState(42);
  const [sliceSpacing, setSliceSpacing] = useState(1.5);

  // Shared shading & outline
  const [shadeDepth, setShadeDepth] = useState(true);
  const [outlineEnabled, setOutlineEnabled] = useState(false);
  const [outlineHex, setOutlineHex] = useState("#0f0f17");

  // Orbit & turntable controls
  const [autoSpin, setAutoSpin] = useState(false);
  const [bakeFrameCount, setBakeFrameCount] = useState(8);
  const [spinAxis, setSpinAxis] = useState<SpinAxis>("yaw");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);

  // Escape key closes modal
  useEffect(() => {
    if (!open) {
      setAutoSpin(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // Smooth auto-spin preview animation
  useEffect(() => {
    if (!open || !autoSpin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setYawDeg((prev) => normalizeDeg(prev + dt * 90));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, autoSpin]);

  // Gather source buffer (2.5D) and slice stack (Sprite Stacking)
  const { singleSource, stackSlices } = useMemo(() => {
    if (!open) {
      return {
        singleSource: new PixelBuffer(1, 1),
        stackSlices: [] as PixelBuffer[],
      };
    }

    let single: PixelBuffer;
    if (sourceScope === "visible") {
      const composited = pixelEngine.compositeFrame(layers, currentFrame);
      single = new PixelBuffer(canvasWidth, canvasHeight, composited);
    } else {
      const cel = pixelEngine.getCel(activeLayerId, currentFrame);
      single = cel ? cel.clone() : new PixelBuffer(canvasWidth, canvasHeight);
    }

    const slices: PixelBuffer[] = [];
    // `layers` is ordered top-to-bottom; reverse for bottom-to-top stacking
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.kind !== "raster" || !layer.visible) continue;
      const cel = pixelEngine.getCel(layer.id, currentFrame);
      if (cel && !cel.isEmpty()) {
        slices.push(cel.clone());
      }
    }

    return { singleSource: single, stackSlices: slices };
  }, [open, sourceScope, layers, activeLayerId, currentFrame, canvasWidth, canvasHeight]);

  const outlineColor = useMemo(
    () => (outlineEnabled ? hexToRgba(outlineHex, 255) : null),
    [outlineEnabled, outlineHex]
  );

  // Render preview buffer whenever options change
  const renderedPreview = useMemo(() => {
    if (!open) return null;
    if (mode === "stack") {
      const slices = stackSlices.length > 0 ? stackSlices : [singleSource];
      return renderSpriteStack(slices, {
        yawDeg,
        pitchDeg: stackPitchDeg,
        sliceSpacing,
        depthShading: shadeDepth,
        outlineColor,
      });
    }
    return render25DSprite(singleSource, {
      pitchDeg,
      yawDeg,
      rollDeg,
      extrudeDepth,
      perspective,
      shadeDepth,
      supersample,
      outlineColor,
    });
  }, [
    open,
    mode,
    stackSlices,
    singleSource,
    yawDeg,
    stackPitchDeg,
    sliceSpacing,
    shadeDepth,
    outlineColor,
    pitchDeg,
    rollDeg,
    extrudeDepth,
    perspective,
    supersample,
  ]);

  // Blit preview PixelBuffer onto modal canvas
  useEffect(() => {
    if (!open || !renderedPreview) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new ImageData(
      new Uint8ClampedArray(renderedPreview.data),
      renderedPreview.width,
      renderedPreview.height
    );
    ctx.putImageData(img, 0, 0);
  }, [open, renderedPreview]);

  if (!open) return null;

  const previewScale = Math.max(
    2,
    Math.min(10, Math.floor(220 / Math.max(canvasWidth, canvasHeight)))
  );

  const applyPreset = (yaw: number, pitch: number, roll: number) => {
    setAutoSpin(false);
    setYawDeg(yaw);
    if (mode === "stack") {
      setStackPitchDeg(Math.max(0, Math.min(75, Math.abs(pitch))));
    } else {
      setPitchDeg(pitch);
      setRollDeg(roll);
    }
  };

  const handleApplyCurrentFrame = () => {
    if (!renderedPreview) return;
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    let targetLayerId = activeLayer?.id ?? "";

    if (
      !activeLayer ||
      activeLayer.kind !== "raster" ||
      isLayerEffectivelyLocked(state.layers, activeLayer.id)
    ) {
      targetLayerId = state.addNamedLayer("3D Sprite");
    }

    const frameIdx = state.currentFrame;
    const cel = pixelEngine.getOrCreateCel(targetLayerId, frameIdx);
    pixelEngine.history.beginTransaction(targetLayerId, frameIdx, "3D Rotate");
    pixelEngine.history.captureAllTiles(cel);
    cel.data.set(renderedPreview.data);
    cel.markAllDirty();
    pixelEngine.history.commitTransaction(cel);

    state.setHistoryFlags(
      pixelEngine.history.canUndo,
      pixelEngine.history.canRedo
    );
    syncTimelineCels();
    pixelEngine.emitChange();
    state.setStatusMessage("Applied 3D rotation to current frame");
    setOpen(false);
  };

  const handleBakeTurntable = () => {
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const slices = stackSlices.length > 0 ? stackSlices : [singleSource];
    const baked = bakeTurntableFrames({
      mode,
      frameCount: bakeFrameCount,
      spinAxis: mode === "stack" ? "yaw" : spinAxis,
      source: singleSource,
      slices,
      opts25d: {
        pitchDeg,
        yawDeg,
        rollDeg,
        extrudeDepth,
        perspective,
        shadeDepth,
        supersample,
        outlineColor,
      },
      optsStack: {
        yawDeg,
        pitchDeg: stackPitchDeg,
        sliceSpacing,
        depthShading: shadeDepth,
        outlineColor,
      },
    });

    const newLayerId = state.addNamedLayer(
      mode === "stack" ? "3D Stack Spin" : "3D Turntable"
    );

    const addedFrames = baked.length > state.frames.length;
    while (useEditorStore.getState().frames.length < baked.length) {
      const count = useEditorStore.getState().frames.length;
      pixelEngine.insertEmptyFrame(count, count);
      useEditorStore.getState().insertFrameMetadata(count);
    }

    for (let i = 0; i < baked.length; i++) {
      const cel = pixelEngine.getOrCreateCel(newLayerId, i);
      cel.data.set(baked[i].data);
      cel.markAllDirty();
    }

    if (addedFrames) {
      pixelEngine.history.clear();
      useEditorStore.getState().setHistoryFlags(false, false);
    }

    syncTimelineCels();
    useEditorStore.getState().setCurrentFrame(0);
    useEditorStore.getState().setIsPlaying(true);
    pixelEngine.emitChange();
    useEditorStore
      .getState()
      .setStatusMessage(`Baked ${baked.length}-frame 3D turntable`);
    setOpen(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="modal-card rotate3d-modal-card"
        role="dialog"
        aria-label="3D Rotate and Turntable"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Box size={14} />
            <span>3D Rotate &amp; Turntable</span>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        <div className="modal-body">
          <div className="rotate3d-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "extruded"}
              className={`rotate3d-tab ${mode === "extruded" ? "active" : ""}`}
              onClick={() => setMode("extruded")}
            >
              2.5D Extruded Spin
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "stack"}
              className={`rotate3d-tab ${mode === "stack" ? "active" : ""}`}
              onClick={() => setMode("stack")}
            >
              Sprite Stacking ({stackSlices.length} slices)
            </button>
          </div>

          <div className="rotate3d-layout">
            {/* Left column: interactive orbit preview */}
            <div className="rotate3d-preview-pane">
              <div
                className="rotate3d-preview-stage"
                onMouseDown={(e) => {
                  setAutoSpin(false);
                  dragRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    yaw: yawDeg,
                    pitch: mode === "stack" ? stackPitchDeg : pitchDeg,
                  };
                }}
                onMouseMove={(e) => {
                  const drag = dragRef.current;
                  if (!drag) return;
                  const dx = e.clientX - drag.x;
                  const dy = e.clientY - drag.y;
                  setYawDeg(normalizeDeg(drag.yaw + dx * 0.9));
                  if (mode === "stack") {
                    setStackPitchDeg(
                      Math.max(0, Math.min(75, Math.round(drag.pitch + dy * 0.6)))
                    );
                  } else {
                    setPitchDeg(
                      Math.max(-85, Math.min(85, Math.round(drag.pitch + dy * 0.8)))
                    );
                  }
                }}
                onMouseUp={() => {
                  dragRef.current = null;
                }}
                onMouseLeave={() => {
                  dragRef.current = null;
                }}
                title="Drag to orbit 3D angle"
              >
                <canvas
                  ref={canvasRef}
                  width={canvasWidth}
                  height={canvasHeight}
                  className="rotate3d-canvas"
                  style={{
                    width: canvasWidth * previewScale,
                    height: canvasHeight * previewScale,
                  }}
                />
              </div>

              <div className="rotate3d-preview-bar">
                <button
                  type="button"
                  className={`mini-btn ${autoSpin ? "active" : ""}`}
                  onClick={() => setAutoSpin((v) => !v)}
                >
                  {autoSpin ? <Square size={11} /> : <Play size={11} />}
                  <span>{autoSpin ? "Stop Spin" : "Auto-Spin"}</span>
                </button>
                <span className="rotate3d-hint">Drag preview to orbit</span>
              </div>

              <div className="rotate3d-presets">
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => applyPreset(0, 0, 0)}
                >
                  Front
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => applyPreset(-35, 22, 0)}
                >
                  3/4 L
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => applyPreset(35, 22, 0)}
                >
                  3/4 R
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => applyPreset(45, 35, 0)}
                >
                  Iso
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  title="Reset Angles"
                  onClick={() => applyPreset(0, 0, 0)}
                >
                  <RotateCcw size={11} />
                </button>
              </div>
            </div>

            {/* Right column: parameters & turntable baker */}
            <div className="rotate3d-controls">
              {mode === "extruded" ? (
                <label className="modal-field">
                  <span>Source</span>
                  <select
                    className="palette-select"
                    value={sourceScope}
                    onChange={(e) =>
                      setSourceScope(e.target.value as SourceScope)
                    }
                  >
                    <option value="visible">All Visible Layers</option>
                    <option value="active">Active Layer Only</option>
                  </select>
                </label>
              ) : (
                <div className="rotate3d-stack-note">
                  Stacks {stackSlices.length} visible raster layer
                  {stackSlices.length === 1 ? "" : "s"} bottom-to-top.
                  {stackSlices.length <= 1 &&
                    " Add more layers for taller voxel-style stacks."}
                </div>
              )}

              <label className="rotate3d-slider-row">
                <span>Yaw (Y)</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={yawDeg}
                  onChange={(e) => setYawDeg(Number(e.target.value))}
                />
                <span className="rotate3d-val">{yawDeg}°</span>
              </label>

              {mode === "extruded" ? (
                <>
                  <label className="rotate3d-slider-row">
                    <span>Pitch (X)</span>
                    <input
                      type="range"
                      min={-85}
                      max={85}
                      value={pitchDeg}
                      onChange={(e) => setPitchDeg(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{pitchDeg}°</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Roll (Z)</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={rollDeg}
                      onChange={(e) => setRollDeg(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{rollDeg}°</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Thickness</span>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={extrudeDepth}
                      onChange={(e) => setExtrudeDepth(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{extrudeDepth}px</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Perspective</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(perspective * 100)}
                      onChange={(e) =>
                        setPerspective(Number(e.target.value) / 100)
                      }
                    />
                    <span className="rotate3d-val">
                      {Math.round(perspective * 100)}%
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label className="rotate3d-slider-row">
                    <span>Tilt (Pitch)</span>
                    <input
                      type="range"
                      min={0}
                      max={75}
                      value={stackPitchDeg}
                      onChange={(e) =>
                        setStackPitchDeg(Number(e.target.value))
                      }
                    />
                    <span className="rotate3d-val">{stackPitchDeg}°</span>
                  </label>

                  <label className="rotate3d-slider-row">
                    <span>Slice Step</span>
                    <input
                      type="range"
                      min={0.5}
                      max={3}
                      step={0.25}
                      value={sliceSpacing}
                      onChange={(e) => setSliceSpacing(Number(e.target.value))}
                    />
                    <span className="rotate3d-val">{sliceSpacing}px</span>
                  </label>
                </>
              )}

              <div className="rotate3d-toggles">
                <label className="modal-checkbox">
                  <input
                    type="checkbox"
                    checked={shadeDepth}
                    onChange={(e) => setShadeDepth(e.target.checked)}
                  />
                  <span>Depth Shading</span>
                </label>

                {mode === "extruded" && (
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={supersample}
                      onChange={(e) => setSupersample(e.target.checked)}
                    />
                    <span>Clean 2x Sample</span>
                  </label>
                )}

                <div className="rotate3d-outline-row">
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={outlineEnabled}
                      onChange={(e) => setOutlineEnabled(e.target.checked)}
                    />
                    <span>1px Outline</span>
                  </label>
                  {outlineEnabled && (
                    <input
                      type="color"
                      value={outlineHex}
                      onChange={(e) => setOutlineHex(e.target.value)}
                      className="rotate3d-color-input"
                      title="Outline Color"
                    />
                  )}
                </div>
              </div>

              <div className="rotate3d-bake-box">
                <div className="rotate3d-bake-title">
                  <Film size={12} />
                  <span>Turntable Bake</span>
                </div>
                <div className="modal-grid-2">
                  <label className="modal-field">
                    <span>Frames</span>
                    <select
                      className="palette-select"
                      value={bakeFrameCount}
                      onChange={(e) =>
                        setBakeFrameCount(Number(e.target.value))
                      }
                    >
                      <option value={4}>4 frames</option>
                      <option value={8}>8 frames</option>
                      <option value={12}>12 frames</option>
                      <option value={16}>16 frames</option>
                    </select>
                  </label>

                  {mode === "extruded" && (
                    <label className="modal-field">
                      <span>Spin Axis</span>
                      <select
                        className="palette-select"
                        value={spinAxis}
                        onChange={(e) =>
                          setSpinAxis(e.target.value as SpinAxis)
                        }
                      >
                        <option value="yaw">Yaw (Turntable)</option>
                        <option value="pitch">Pitch (Tumble)</option>
                        <option value="roll">Roll (Wheel)</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="mini-btn"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={handleApplyCurrentFrame}
            >
              <Sparkles size={12} />
              <span>Apply to Frame</span>
            </button>
            <button
              type="button"
              className="export-cta"
              onClick={handleBakeTurntable}
            >
              <Film size={13} />
              <span>Bake Turntable ({bakeFrameCount}f)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
