import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  type ExportFormat,
  type PackMode,
  exportSpritesheetAction,
} from "../engine/io/projectBridge";
import { useEditorStore } from "../store/editorStore";

export function ExportModal() {
  const exportModalOpen = useEditorStore((s) => s.exportModalOpen);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const documentName = useEditorStore((s) => s.documentName);

  const defaultName =
    documentName.replace(/\.pixet$/i, "") || "spritesheet";

  const [format, setFormat] = useState<ExportFormat>("json");
  const [pack, setPack] = useState<PackMode>("tight");
  const [trim, setTrim] = useState(true);
  const [extrude, setExtrude] = useState(0);
  const [padding, setPadding] = useState(1);
  const [sheetName, setSheetName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (exportModalOpen) {
      setSheetName(documentName.replace(/\.pixet$/i, "") || "spritesheet");
    }
  }, [exportModalOpen, documentName]);

  useEffect(() => {
    if (!exportModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExportModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportModalOpen, setExportModalOpen]);

  if (!exportModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await exportSpritesheetAction({
        format,
        pack,
        trim,
        extrude: Math.max(0, Math.min(8, extrude)),
        padding: Math.max(0, Math.min(16, padding)),
        sheetName: sheetName.trim() || "spritesheet",
      });
      if (ok) {
        setExportModalOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setExportModalOpen(false);
      }}
    >
      <div className="modal-card" role="dialog" aria-label="Export Spritesheet">
        <div className="modal-header">
          <span>Export Spritesheet</span>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setExportModalOpen(false)}
          >
            <X size={13} />
          </button>
        </div>

        <form className="modal-body" onSubmit={handleSubmit}>
          <label className="modal-field">
            <span>Format</span>
            <select
              className="palette-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <option value="json">Generic PNG + JSON (Aseprite schema)</option>
              <option value="godot">Godot 4 SpriteFrames (.tres + PNG)</option>
              <option value="godot_tileset">Godot 4 TileSet (.tres + Atlas PNG)</option>
              <option value="tiled">Tiled Map &amp; Tileset (.tmj + .tsj + PNG)</option>
            </select>
          </label>

          <label className="modal-field">
            <span>Packing Algorithm</span>
            <select
              className="palette-select"
              value={pack}
              onChange={(e) => setPack(e.target.value as PackMode)}
            >
              <option value="tight">Tight (MaxRects Bin Pack)</option>
              <option value="grid">Uniform Grid</option>
            </select>
          </label>

          <label className="modal-field">
            <span>Sheet Name</span>
            <input
              type="text"
              className="tag-form-input"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
            />
          </label>

          <div className="modal-grid-2">
            <label className="modal-field">
              <span>Padding (px)</span>
              <input
                type="number"
                className="tag-form-input"
                min={0}
                max={16}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
              />
            </label>

            <label className="modal-field">
              <span>Extrude Edges (px)</span>
              <input
                type="number"
                className="tag-form-input"
                min={0}
                max={8}
                value={extrude}
                onChange={(e) => setExtrude(Number(e.target.value))}
              />
            </label>
          </div>

          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={trim}
              onChange={(e) => setTrim(e.target.checked)}
            />
            <span>Trim transparent whitespace</span>
          </label>

          <div className="modal-footer">
            <button
              type="button"
              className="toggle-chip"
              onClick={() => setExportModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="export-cta"
              disabled={busy}
            >
              <Download size={13} />
              <span>{busy ? "Exporting..." : "Export..."}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
