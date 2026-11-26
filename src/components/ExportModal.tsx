import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  type ExportFormat,
  type PackMode,
  exportSpritesheetAction,
  isTauriRuntime,
} from "../engine/io/projectBridge";
import {
  exportGifAction,
  exportPngSequenceAction,
  exportTilemapAction,
} from "../engine/export/exportActions";
import { useEditorStore } from "../store/editorStore";

type ExportMode = "sheet" | "gif" | "png_sequence" | "tilemap";

const MODE_LABELS: Record<ExportMode, string> = {
  sheet: "Spritesheet",
  gif: "Animated GIF",
  png_sequence: "PNG sequence",
  tilemap: "Tilemap",
};

const GIF_RULE_TIP =
  "GIF transparency is 1-bit: pixels with alpha below 128 become transparent, " +
  "pixels at 128 or above become fully opaque. Animations with more than 256 " +
  "colours get a per-frame palette (colours are reduced).";

export function ExportModal() {
  const exportModalOpen = useEditorStore((s) => s.exportModalOpen);
  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const documentName = useEditorStore((s) => s.documentName);
  const mode = useEditorStore((s) => s.exportModalMode);
  const tags = useEditorStore((s) => s.tags);
  const frameCount = useEditorStore((s) => s.frames.length);
  const layers = useEditorStore((s) => s.layers);
  const desktop = isTauriRuntime();

  const defaultName =
    documentName.replace(/\.pixet$/i, "") || "spritesheet";

  const [format, setFormat] = useState<ExportFormat>("json");
  const [pack, setPack] = useState<PackMode>("tight");
  const [trim, setTrim] = useState(true);
  const [extrude, setExtrude] = useState(0);
  const [padding, setPadding] = useState(1);
  const [sheetName, setSheetName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [tagId, setTagId] = useState<string>("");
  const [scale, setScale] = useState(1);
  const [loop, setLoop] = useState(true);
  const [bgMode, setBgMode] = useState<"transparent" | "color">("transparent");
  const [bgColor, setBgColor] = useState("#000000");
  const [mapFormat, setMapFormat] = useState<"godot" | "png">("godot");
  const [mapExcluded, setMapExcluded] = useState<string[]>([]);
  const mapLayers = layers.filter(
    (l) => l.kind === "tilemap" || (l.kind === "object" && mapFormat === "godot")
  );
  const mapLayerIds = mapLayers
    .filter((l) => !mapExcluded.includes(l.id))
    .map((l) => l.id);

  useEffect(() => {
    if (exportModalOpen) {
      setSheetName(documentName.replace(/\.pixet$/i, "") || "spritesheet");
    }
  }, [exportModalOpen, documentName]);

  useEffect(() => {
    if (exportModalOpen && tagId && !tags.some((t) => t.id === tagId)) {
      setTagId("");
    }
  }, [exportModalOpen, tags, tagId]);

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
      if (mode === "tilemap") {
        const okMap = await exportTilemapAction({
          name: sheetName.trim() || "map",
          format: mapFormat,
          layerIds: mapLayerIds,
        });
        if (okMap) setExportModalOpen(false);
        return;
      }
      if (mode !== "sheet") {
        const animated = {
          name: sheetName.trim() || (mode === "gif" ? "animation" : "frame"),
          tagId: tagId || null,
          scale,
          background: bgMode === "color" ? bgColor : null,
          loop,
        };
        const okAnim =
          mode === "gif"
            ? await exportGifAction(animated)
            : await exportPngSequenceAction(animated);
        if (okAnim) setExportModalOpen(false);
        return;
      }
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
      <div
        className="modal-card"
        role="dialog"
        aria-label={`Export ${MODE_LABELS[mode]}`}
      >
        <div className="modal-header">
          <span>Export {MODE_LABELS[mode]}</span>
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
          <div className="modal-field">
            <span>Export type</span>
            <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Export type">
              {(Object.keys(MODE_LABELS) as ExportMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`toggle-chip${mode === m ? " active" : ""}`}
                  style={{ flex: 1 }}
                  aria-pressed={mode === m}
                  onClick={() => setExportModalOpen(true, m)}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          {mode === "tilemap" && (
            <>
              <label className="modal-field">
                <span>Format</span>
                <select
                  className="palette-select"
                  data-testid="tilemap-format"
                  value={mapFormat}
                  onChange={(e) =>
                    setMapFormat(e.target.value as "godot" | "png")
                  }
                >
                  <option value="godot">
                    Godot 4 scene + TileSet (.tscn + .tres + PNG)
                  </option>
                  <option value="png">Map as PNG (flattened, 1x)</option>
                </select>
              </label>
              <label className="modal-field">
                <span>File Name</span>
                <input
                  type="text"
                  className="tag-form-input"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                />
              </label>
              <div className="modal-field">
                <span>Layers</span>
                {mapLayers.length === 0 && (
                  <span>No tilemap layers yet.</span>
                )}
                {mapLayers.map((l) => (
                  <label key={l.id} className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={!mapExcluded.includes(l.id)}
                      onChange={(e) =>
                        setMapExcluded((cur) =>
                          e.target.checked
                            ? cur.filter((id) => id !== l.id)
                            : [...cur, l.id]
                        )
                      }
                    />
                    <span>
                      {l.name}
                      {l.kind === "object" ? " (objects)" : ""}
                      {l.visible ? "" : " - hidden"}
                    </span>
                  </label>
                ))}
              </div>
              <div className="modal-field">
                <span>
                  {mapFormat === "godot"
                    ? (desktop
                        ? "Pick a folder; writes name.tscn, name_tileset.tres and atlas PNGs. "
                        : "Downloads one .zip with name.tscn, name_tileset.tres and atlas PNGs. ") +
                      "Copy the files into your Godot project root (paths are res://name...). Collision presets become TileSet physics polygons; object layers become Marker2D / Area2D nodes."
                    : "Flattens the selected visible tilemap layers into one PNG at 1x. Object layers are not drawn."}
                </span>
              </div>
            </>
          )}

          {mode !== "sheet" && mode !== "tilemap" && (
            <>
              <label className="modal-field">
                <span>File Name</span>
                <input
                  type="text"
                  className="tag-form-input"
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                />
              </label>

              <label className="modal-field">
                <span>Animation</span>
                <select
                  className="palette-select"
                  value={tagId}
                  onChange={(e) => setTagId(e.target.value)}
                >
                  <option value="">All frames ({frameCount})</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.fromFrame}-{t.toFrame}
                      {t.direction && t.direction !== "forward"
                        ? `, ${t.direction}`
                        : ""}
                      )
                    </option>
                  ))}
                </select>
              </label>

              <div className="modal-grid-2">
                <label className="modal-field">
                  <span>Scale</span>
                  <select
                    className="palette-select"
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </label>

                <label className="modal-field">
                  <span>Background</span>
                  <select
                    className="palette-select"
                    value={bgMode}
                    onChange={(e) =>
                      setBgMode(e.target.value as "transparent" | "color")
                    }
                  >
                    <option value="transparent">Transparent</option>
                    <option value="color">Solid colour</option>
                  </select>
                </label>
              </div>

              {bgMode === "color" && (
                <label className="modal-field">
                  <span>Background colour</span>
                  <input
                    type="color"
                    className="tag-form-input"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                  />
                </label>
              )}

              {mode === "gif" && (
                <>
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(e) => setLoop(e.target.checked)}
                    />
                    <span>Loop forever (off = play once)</span>
                  </label>
                  <div
                    className="modal-field"
                    title={GIF_RULE_TIP}
                    data-testid="gif-transparency-note"
                  >
                    <span>
                      GIF transparency is on/off: alpha below 128 is
                      transparent, otherwise opaque. Over 256 colours are
                      reduced per frame.
                    </span>
                  </div>
                </>
              )}
              {mode === "png_sequence" && (
                <div className="modal-field">
                  <span>
                    {desktop
                      ? "Pick a folder; one PNG per frame is written as name_0000.png."
                      : "Downloads one .zip containing name_0000.png, name_0001.png, ..."}
                  </span>
                </div>
              )}
            </>
          )}

          {mode === "sheet" && (
          <>
          <label className="modal-field">
            <span>Format</span>
            <select
              className="palette-select"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <option value="json">Generic PNG + JSON (Aseprite schema)</option>
              <option value="godot">Godot 4 SpriteFrames (.tres + PNG)</option>
              <option value="godot_tileset" disabled={!desktop}>
                Godot 4 TileSet (.tres + Atlas PNG){desktop ? "" : " - Desktop app only"}
              </option>
              <option value="tiled" disabled={!desktop}>
                Tiled Map &amp; Tileset (.tmj + .tsj + PNG){desktop ? "" : " - Desktop app only"}
              </option>
            </select>
            {!desktop && (
              <span data-testid="desktop-only-note">
                Desktop app only: Godot TileSet and Tiled exports.
              </span>
            )}
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
          </>
          )}

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
