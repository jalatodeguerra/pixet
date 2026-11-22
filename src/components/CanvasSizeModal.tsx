import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import { useEditorStore } from "../store/editorStore";

type AnchorCoord = 0 | 1 | 2;

export function CanvasSizeModal() {
  const open = useEditorStore((s) => s.canvasSizeModalOpen);
  const setOpen = useEditorStore((s) => s.setCanvasSizeModalOpen);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);

  const [width, setWidth] = useState(canvasWidth);
  const [height, setHeight] = useState(canvasHeight);
  const [anchorX, setAnchorX] = useState<AnchorCoord>(1);
  const [anchorY, setAnchorY] = useState<AnchorCoord>(1);

  useEffect(() => {
    if (open) {
      setWidth(canvasWidth);
      setHeight(canvasHeight);
      setAnchorX(1);
      setAnchorY(1);
    }
  }, [open, canvasWidth, canvasHeight]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    commitFloatingSelection();
    const state = useEditorStore.getState();
    const w = Math.max(1, Math.min(1024, Math.round(width) || canvasWidth));
    const h = Math.max(1, Math.min(1024, Math.round(height) || canvasHeight));

    pixelEngine.resizeCanvas(w, h, anchorX, anchorY);
    state.setCanvasSize(w, h);
    state.setHistoryFlags(false, false);
    state.setHasSelection(false);
    syncTimelineCels();
    state.setStatusMessage(`Resized canvas to ${w}×${h}`);
    setOpen(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-label="Canvas Size">
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Maximize2 size={14} />
            <span>Canvas Size</span>
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

        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="modal-grid-2">
            <label className="modal-field">
              <span>Width (px)</span>
              <input
                type="number"
                min={1}
                max={1024}
                className="palette-select"
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label className="modal-field">
              <span>Height (px)</span>
              <input
                type="number"
                min={1}
                max={1024}
                className="palette-select"
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="modal-field">
            <span>Anchor</span>
            <div className="anchor-grid-wrap">
              <div className="anchor-grid-3x3" role="radiogroup" aria-label="Resize Anchor">
                {([0, 1, 2] as AnchorCoord[]).map((ay) =>
                  ([0, 1, 2] as AnchorCoord[]).map((ax) => {
                    const selected = anchorX === ax && anchorY === ay;
                    return (
                      <button
                        key={`${ax}-${ay}`}
                        type="button"
                        className={`anchor-cell ${selected ? "active" : ""}`}
                        onClick={() => {
                          setAnchorX(ax);
                          setAnchorY(ay);
                        }}
                        title={`Anchor (${ax === 0 ? "Left" : ax === 1 ? "Center" : "Right"}, ${ay === 0 ? "Top" : ay === 1 ? "Middle" : "Bottom"})`}
                      />
                    );
                  })
                )}
              </div>
              <span className="rotate3d-hint">
                Current: {canvasWidth}×{canvasHeight} px
              </span>
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
            <button type="submit" className="export-cta">
              <Maximize2 size={13} />
              <span>Resize Canvas</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
