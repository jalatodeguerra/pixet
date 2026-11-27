import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";
import { drawPreviewComposite, usePreviewRedrawKey } from "./previewRender";

type Backdrop = "checker" | "dark" | "light";
type Zoom = "fit" | 1 | 2 | 4;

/** Animated sprite preview that fills its area (the docked sibling of FloatingPreview). */
export function EmbeddedPreview() {
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const tags = useEditorStore((s) => s.tags);
  const activeTagId = useEditorStore((s) => s.activeTagId);
  const setActiveTagId = useEditorStore((s) => s.setActiveTagId);
  const redrawKey = usePreviewRedrawKey();

  const [zoom, setZoom] = useState<Zoom>("fit");
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    drawPreviewComposite(canvasRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, redrawKey);

  useEffect(
    () => pixelEngine.subscribe(() => drawPreviewComposite(canvasRef.current)),
    []
  );

  let scale = 1;
  if (zoom === "fit") {
    const f = Math.min(
      (box.w - 16) / Math.max(1, canvasWidth),
      (box.h - 16) / Math.max(1, canvasHeight)
    );
    scale = f >= 1 ? Math.floor(f) : Math.max(0.25, Math.floor(f * 4) / 4);
  } else {
    scale = zoom;
  }

  const nextBackdrop = () =>
    setBackdrop((b) => (b === "checker" ? "dark" : b === "dark" ? "light" : "checker"));

  return (
    <div className="area-preview">
      <div className="area-preview-toolbar">
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 20, height: 20 }}
          title={isPlaying ? "Pause" : "Play"}
          onClick={togglePlaying}
        >
          {isPlaying ? <Pause size={11} /> : <Play size={11} />}
        </button>
        {(["fit", 1, 2, 4] as Zoom[]).map((z) => (
          <button
            key={String(z)}
            type="button"
            className={`toggle-chip ${zoom === z ? "active" : ""}`}
            style={{ padding: "1px 5px", fontSize: 10 }}
            onClick={() => setZoom(z)}
          >
            {z === "fit" ? "Fit" : `${z}×`}
          </button>
        ))}
        <button
          type="button"
          className="toggle-chip"
          style={{ padding: "1px 5px", fontSize: 10 }}
          title="Backdrop (click to cycle)"
          onClick={nextBackdrop}
        >
          {backdrop === "checker" ? "Chk" : backdrop === "dark" ? "Drk" : "Lgt"}
        </button>
        {tags.length > 0 && (
          <select
            className="palette-select"
            style={{ maxWidth: 80, padding: "1px 3px", fontSize: 10 }}
            aria-label="Preview Tag Filter"
            value={activeTagId ?? ""}
            onChange={(e) => setActiveTagId(e.target.value || null)}
          >
            <option value="">All</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div ref={stageRef} className={`preview-stage area-preview-stage draw-preview-bg-${backdrop}`}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="preview-canvas"
          style={{ width: canvasWidth * scale, height: canvasHeight * scale }}
        />
      </div>
    </div>
  );
}
