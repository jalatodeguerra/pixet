import { useState } from "react";
import { X } from "lucide-react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { decodeImageFileToPixelBuffer } from "../../engine/io/imageImport";
import { sliceImageToTiles } from "../../engine/tiles/tileAuthoring";
import { useEditorStore } from "../../store/editorStore";

export function ImportTilesetModal() {
  const open = useEditorStore((s) => s.tileImportModalOpen);
  const setOpen = useEditorStore((s) => s.setTileImportModalOpen);
  const setActiveTilesetIndex = useEditorStore((s) => s.setActiveTilesetIndex);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("Imported Tileset");
  const [tileWidth, setTileWidth] = useState(16);
  const [tileHeight, setTileHeight] = useState(16);
  const [margin, setMargin] = useState(0);
  const [spacing, setSpacing] = useState(0);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [dedupe, setDedupe] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const decoded = await decodeImageFileToPixelBuffer(file);
      const sliced = sliceImageToTiles(
        decoded.buffer,
        { tileWidth, tileHeight, margin, spacing, skipEmpty, dedupe },
        `tileset-${Date.now().toString(36)}`,
        name.trim() || file.name.replace(/\.[^.]+$/, "")
      );
      if (sliced.uniqueTiles === 0) {
        setStatusMessage("No non-empty tiles found with those slice settings");
        setBusy(false);
        return;
      }
      const newIdx = pixelEngine.recordTilesetOp("Import Tileset PNG", () =>
        pixelEngine.tilesetRegistry.add(sliced.tileset)
      );
      setActiveTilesetIndex(newIdx);
      setActiveTileId(1);
      bumpTilesetVersion();
      syncHistoryAndCelState();
      pixelEngine.emitChange();
      setStatusMessage(
        `Imported "${sliced.tileset.name}" (${sliced.uniqueTiles} tiles from ${sliced.totalCells} cells)`
      );
      setOpen(false);
    } catch (err) {
      setStatusMessage(`Tileset import failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Import Tileset Image</span>
          <button
            type="button"
            className="icon-action-btn"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="tiles-prop-row">
            <label className="tiles-prop-label">Image</label>
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg,image/bmp"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) setName(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>

          <div className="tiles-prop-row">
            <label className="tiles-prop-label">Name</label>
            <input
              type="text"
              className="tiles-text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="tiles-prop-row">
            <label className="tiles-prop-label">Size</label>
            <input
              type="number"
              min={4}
              max={64}
              className="tiles-text-input"
              value={tileWidth}
              onChange={(e) => setTileWidth(Math.max(4, Math.min(64, Number(e.target.value) || 16)))}
            />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>×</span>
            <input
              type="number"
              min={4}
              max={64}
              className="tiles-text-input"
              value={tileHeight}
              onChange={(e) => setTileHeight(Math.max(4, Math.min(64, Number(e.target.value) || 16)))}
            />
          </div>

          <div className="tiles-prop-row">
            <label className="tiles-prop-label">Margin</label>
            <input
              type="number"
              min={0}
              max={64}
              className="tiles-text-input"
              value={margin}
              onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
            />
            <label className="tiles-prop-label" style={{ width: 52 }}>Spacing</label>
            <input
              type="number"
              min={0}
              max={64}
              className="tiles-text-input"
              value={spacing}
              onChange={(e) => setSpacing(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          <div className="tileset-controls-row">
            <button
              type="button"
              className={`toggle-chip ${skipEmpty ? "active" : ""}`}
              onClick={() => setSkipEmpty((v) => !v)}
            >
              Skip Empty
            </button>
            <button
              type="button"
              className={`toggle-chip ${dedupe ? "active" : ""}`}
              onClick={() => setDedupe((v) => !v)}
            >
              Dedupe Exact
            </button>
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
            className="export-cta"
            disabled={!file || busy}
            onClick={() => void handleImport()}
          >
            {busy ? "Importing..." : "Import Tileset"}
          </button>
        </div>
      </div>
    </div>
  );
}
