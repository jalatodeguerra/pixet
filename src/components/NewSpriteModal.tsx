import { useEffect, useState } from "react";
import { FilePlus2, X } from "lucide-react";
import { hexToRgba } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import { useEditorStore } from "../store/editorStore";

type BgFill = "transparent" | "secondary" | "white";

const SIZE_PRESETS = [16, 32, 64, 128, 256];

export function NewSpriteModal() {
  const open = useEditorStore((s) => s.newSpriteModalOpen);
  const setOpen = useEditorStore((s) => s.setNewSpriteModalOpen);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);

  const [name, setName] = useState("untitled.pixet");
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(32);
  const [colorMode, setColorMode] = useState<"RGBA" | "Indexed">("RGBA");
  const [bgFill, setBgFill] = useState<BgFill>("transparent");

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

    const w = Math.max(1, Math.min(1024, Math.round(width) || 32));
    const h = Math.max(1, Math.min(1024, Math.round(height) || 32));
    const cleanName = name.trim() || "untitled";
    const docName = cleanName.toLowerCase().endsWith(".pixet")
      ? cleanName
      : `${cleanName}.pixet`;

    pixelEngine.resetForDocument(w, h);
    const cel = pixelEngine.getOrCreateCel("layer-1", 0);

    if (bgFill !== "transparent") {
      const fillHex = bgFill === "white" ? "#ffffff" : secondaryColor;
      const [r, g, b, a] = hexToRgba(fillHex, 255);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          cel.setPixel(x, y, r, g, b, a);
        }
      }
      cel.markAllDirty();
    }

    state.loadProjectState({
      documentName: docName,
      filePath: null,
      canvasWidth: w,
      canvasHeight: h,
      colorMode,
      paletteName: state.paletteName,
      palette: state.palette,
      layers: [
        {
          id: "layer-1",
          name: "Layer 1",
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 100,
          alphaLock: false,
          blendMode: "Normal",
          parentId: null,
          cels: { 0: !cel.isEmpty() },
        },
      ],
      frames: [
        { id: "frame-new-1", index: 0, durationMs: Math.round(1000 / state.fps) },
      ],
      tags: [],
    });

    state.setZoom(Math.max(1, Math.min(16, Math.floor(384 / Math.max(w, h)))));
    syncTimelineCels();
    pixelEngine.emitChange();
    state.setStatusMessage(`Created "${docName}" (${w}×${h})`);
    setOpen(false);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-label="New Sprite">
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FilePlus2 size={14} />
            <span>New Sprite</span>
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
          <label className="modal-field">
            <span>File Name</span>
            <input
              type="text"
              className="palette-select"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

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

          <div className="rotate3d-presets">
            {SIZE_PRESETS.map((sz) => (
              <button
                key={sz}
                type="button"
                className={`mini-btn ${width === sz && height === sz ? "active" : ""}`}
                onClick={() => {
                  setWidth(sz);
                  setHeight(sz);
                }}
              >
                {sz}×{sz}
              </button>
            ))}
          </div>

          <div className="modal-grid-2">
            <label className="modal-field">
              <span>Color Mode</span>
              <select
                className="palette-select"
                value={colorMode}
                onChange={(e) =>
                  setColorMode(e.target.value as "RGBA" | "Indexed")
                }
              >
                <option value="RGBA">RGBA (Full Color)</option>
                <option value="Indexed">Indexed (Palette)</option>
              </select>
            </label>

            <label className="modal-field">
              <span>Background</span>
              <select
                className="palette-select"
                value={bgFill}
                onChange={(e) => setBgFill(e.target.value as BgFill)}
              >
                <option value="transparent">Transparent</option>
                <option value="secondary">Secondary Color</option>
                <option value="white">White</option>
              </select>
            </label>
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
              <FilePlus2 size={13} />
              <span>Create Sprite</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
