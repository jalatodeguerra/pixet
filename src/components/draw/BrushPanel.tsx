import { useState } from "react";
import { ChevronDown, ChevronRight, Paintbrush } from "lucide-react";
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

  const [open, setOpen] = useState(false);

  const shapeOptions = customBrush
    ? [...BRUSH_SHAPES, { id: "custom" as const, label: "Custom" }]
    : BRUSH_SHAPES;

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
