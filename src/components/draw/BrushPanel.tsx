import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FlipHorizontal2,
  FlipVertical2,
  Paintbrush,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  flipCustomBrushH,
  flipCustomBrushV,
  rotateCustomBrushCW,
} from "../../engine/tools/sprayJumble";
import {
  useEditorStore,
  type BrushShape,
  type InkMode,
  type RightClickMode,
} from "../../store/editorStore";

const BRUSH_SHAPES: Array<{ id: BrushShape; label: string }> = [
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
  { id: "diamond", label: "Diamond" },
  { id: "diagonalL", label: "Diag \\" },
  { id: "diagonalR", label: "Diag /" },
];

const INK_MODES: Array<{ id: InkMode; label: string }> = [
  { id: "simple", label: "Simple" },
  { id: "alphaBlend", label: "Alpha" },
  { id: "shadingRamp", label: "Shading" },
  { id: "replaceColor", label: "Replace" },
  { id: "lockAlpha", label: "Lock α" },
  { id: "dither", label: "Dither" },
];

const RIGHT_CLICK_MODES: Array<{ id: RightClickMode; label: string }> = [
  { id: "secondaryColor", label: "Secondary" },
  { id: "erase", label: "Erase" },
  { id: "eyedropper", label: "Eyedropper" },
];

export function BrushPanel() {
  const brushShape = useEditorStore((s) => s.brushShape);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const setBrushOpacity = useEditorStore((s) => s.setBrushOpacity);
  const brushSpacing = useEditorStore((s) => s.brushSpacing);
  const setBrushSpacing = useEditorStore((s) => s.setBrushSpacing);
  const inkMode = useEditorStore((s) => s.inkMode);
  const setInkMode = useEditorStore((s) => s.setInkMode);
  const rightClickMode = useEditorStore((s) => s.rightClickMode);
  const setRightClickMode = useEditorStore((s) => s.setRightClickMode);
  const customBrush = useEditorStore((s) => s.customBrush);
  const setCustomBrush = useEditorStore((s) => s.setCustomBrush);
  const savedCustomBrushes = useEditorStore((s) => s.savedCustomBrushes);
  const addSavedCustomBrush = useEditorStore((s) => s.addSavedCustomBrush);
  const removeSavedCustomBrush = useEditorStore(
    (s) => s.removeSavedCustomBrush
  );

  const [open, setOpen] = useState(false);

  const shapeOptions = customBrush
    ? [...BRUSH_SHAPES, { id: "custom" as const, label: "Custom" }]
    : BRUSH_SHAPES;

  const updateActiveCustomBrush = (
    updater: (b: NonNullable<typeof customBrush>) => NonNullable<typeof customBrush>
  ) => {
    if (!customBrush) return;
    const next = updater(customBrush);
    setCustomBrush(next);
    if (savedCustomBrushes.some((b) => b.id === next.id)) {
      addSavedCustomBrush(next);
    }
  };

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Paintbrush size={11} />
          <span>Brush &amp; Ink</span>
        </button>
        <span
          className="mono-value"
          style={{ fontSize: 10, color: "var(--text-muted)" }}
        >
          {brushSize}px · {brushOpacity}%
        </span>
      </div>

      {open && (
        <div className="panel-body">
          <div className="draw-field-group">
            <span className="draw-field-label">Shape</span>
            <div className="draw-chip-grid">
              {shapeOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`toggle-chip draw-chip-btn ${brushShape === opt.id ? "active" : ""}`}
                  onClick={() => setBrushShape(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {brushShape === "custom" && customBrush && (
            <div className="draw-field-group">
              <span className="draw-field-label">
                Custom Brush ({customBrush.width}×{customBrush.height})
              </span>
              <div className="draw-chip-grid">
                <button
                  type="button"
                  className="toggle-chip draw-chip-btn"
                  title="Flip Custom Brush Horizontal"
                  onClick={() => updateActiveCustomBrush(flipCustomBrushH)}
                >
                  <FlipHorizontal2 size={12} />
                  <span>Flip H</span>
                </button>
                <button
                  type="button"
                  className="toggle-chip draw-chip-btn"
                  title="Flip Custom Brush Vertical"
                  onClick={() => updateActiveCustomBrush(flipCustomBrushV)}
                >
                  <FlipVertical2 size={12} />
                  <span>Flip V</span>
                </button>
                <button
                  type="button"
                  className="toggle-chip draw-chip-btn"
                  title="Rotate Custom Brush 90° CW"
                  onClick={() => updateActiveCustomBrush(rotateCustomBrushCW)}
                >
                  <RotateCw size={12} />
                  <span>Rot 90°</span>
                </button>
              </div>
            </div>
          )}

          {savedCustomBrushes.length > 0 && (
            <div className="draw-field-group">
              <span className="draw-field-label">Saved Custom Brushes</span>
              <div className="draw-custom-brush-list">
                {savedCustomBrushes.map((b) => {
                  const isActive =
                    brushShape === "custom" && customBrush?.id === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`draw-custom-brush-row ${isActive ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="draw-custom-brush-select"
                        onClick={() => {
                          setCustomBrush(b);
                          setBrushShape("custom");
                        }}
                      >
                        <span className="draw-custom-brush-name">{b.name}</span>
                        <span className="mono-value draw-val">
                          {b.width}×{b.height}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        style={{ width: 20, height: 20 }}
                        title="Remove saved brush"
                        onClick={() => {
                          removeSavedCustomBrush(b.id);
                          if (customBrush?.id === b.id) {
                            setCustomBrush(null);
                            if (brushShape === "custom") {
                              setBrushShape("circle");
                            }
                          }
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="draw-slider-list">
            <label className="draw-slider-row">
              <span>Size</span>
              <input
                type="range"
                className="compact-range draw-range"
                min={1}
                max={64}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
              <span className="mono-value draw-val">{brushSize}px</span>
            </label>

            <label className="draw-slider-row">
              <span>Opacity</span>
              <input
                type="range"
                className="compact-range draw-range"
                min={1}
                max={100}
                value={brushOpacity}
                onChange={(e) => setBrushOpacity(Number(e.target.value))}
              />
              <span className="mono-value draw-val">{brushOpacity}%</span>
            </label>

            <label className="draw-slider-row">
              <span>Spacing</span>
              <input
                type="range"
                className="compact-range draw-range"
                min={1}
                max={16}
                value={brushSpacing}
                onChange={(e) => setBrushSpacing(Number(e.target.value))}
              />
              <span className="mono-value draw-val">{brushSpacing}</span>
            </label>
          </div>

          <label className="draw-select-row">
            <span>Ink Mode</span>
            <select
              className="palette-select"
              aria-label="Ink Mode"
              value={inkMode}
              onChange={(e) => setInkMode(e.target.value as InkMode)}
            >
              {INK_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="draw-select-row">
            <span>Right-Click</span>
            <select
              className="palette-select"
              aria-label="Right-Click Action"
              value={rightClickMode}
              onChange={(e) =>
                setRightClickMode(e.target.value as RightClickMode)
              }
            >
              {RIGHT_CLICK_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}
