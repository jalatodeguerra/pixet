import {
  FlipHorizontal2,
  FlipVertical2,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { DockablePanelSection } from "../DockablePanelSection";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { packCell, rotateCellCW, unpackCell } from "../../engine/tiles/cell";
import {
  getVariantBaseUid,
  setTileVariantOf,
} from "../../engine/tiles/tileAuthoring";
import { useEditorStore } from "../../store/editorStore";

export function TilePropertiesPanel() {
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const tileBrushFlags = useEditorStore((s) => s.tileBrushFlags);
  const setTileBrushFlags = useEditorStore((s) => s.setTileBrushFlags);
  const animateTilesPreview = useEditorStore((s) => s.animateTilesPreview);
  const toggleAnimateTilesPreview = useEditorStore(
    (s) => s.toggleAnimateTilesPreview
  );

  void tilesetVersion;
  const ts =
    pixelEngine.tilesetRegistry.get(activeTilesetIndex) ??
    pixelEngine.tileset;
  const meta = activeTileId > 0 ? ts.getMeta(activeTileId) : undefined;
  const variantBaseUid = getVariantBaseUid(meta);
  const variantBaseId =
    variantBaseUid !== null
      ? ts.meta.findIndex((m, idx) => idx > 0 && m.uid === variantBaseUid)
      : 0;
  const animFrames = meta?.animation?.frames ?? [];

  const rotateFlagsCW = () => {
    const packed = packCell(0, 1, tileBrushFlags);
    const rotated = unpackCell(rotateCellCW(packed));
    setTileBrushFlags({
      flipH: rotated.flipH,
      flipV: rotated.flipV,
      flipD: rotated.flipD,
    });
  };

  return (
    <DockablePanelSection
      id="tiles-props"
      title="Tile Properties"
      actions={
        <span className="mono-value" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {activeTileId > 0 ? `#${activeTileId}` : "Empty"}
        </span>
      }
    >
      {meta && activeTileId > 0 ? (
            <>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-name-input">
                  Name
                </label>
                <input
                  id="tile-name-input"
                  type="text"
                  className="tiles-text-input"
                  value={meta.name ?? ""}
                  placeholder={`Tile ${activeTileId}`}
                  onChange={(e) => {
                    ts.setMeta(activeTileId, { name: e.target.value });
                    bumpTilesetVersion();
                  }}
                />
              </div>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-prob-input">
                  Weight
                </label>
                <input
                  id="tile-prob-input"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className="tiles-text-input"
                  value={meta.probability ?? 1}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value) || 0);
                    ts.setMeta(activeTileId, { probability: val });
                    bumpTilesetVersion();
                  }}
                />
              </div>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-tags-input">
                  Tags
                </label>
                <input
                  id="tile-tags-input"
                  type="text"
                  className="tiles-text-input"
                  value={(meta.tags ?? []).join(", ")}
                  placeholder="ground, grass"
                  onChange={(e) => {
                    const tags = e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);
                    ts.setMeta(activeTileId, { tags });
                    bumpTilesetVersion();
                  }}
                />
              </div>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-var-input">
                  Variant of
                </label>
                <input
                  id="tile-var-input"
                  type="number"
                  min={0}
                  max={ts.count}
                  className="tiles-text-input"
                  value={variantBaseId > 0 ? variantBaseId : 0}
                  onChange={(e) => {
                    const baseId = Math.round(Number(e.target.value) || 0);
                    setTileVariantOf(ts, activeTileId, baseId > 0 ? baseId : null);
                    bumpTilesetVersion();
                  }}
                />
              </div>

              <div className="tiles-anim-row">
                <span className="tiles-prop-label">Anim ({animFrames.length})</span>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => {
                    const next = [
                      ...animFrames,
                      { localId: activeTileId, durationMs: 150 },
                    ];
                    ts.setMeta(activeTileId, { animation: { frames: next } });
                    bumpTilesetVersion();
                  }}
                >
                  <Plus size={10} />
                  <span>Frame</span>
                </button>
                <button
                  type="button"
                  className={`toggle-chip ${animateTilesPreview ? "active" : ""}`}
                  style={{ marginLeft: "auto" }}
                  onClick={toggleAnimateTilesPreview}
                >
                  Animate
                </button>
              </div>
              {animFrames.map((f, fIdx) => (
                <div key={fIdx} className="tiles-anim-row">
                  <input
                    type="number"
                    min={1}
                    max={ts.count}
                    className="tiles-text-input"
                    value={f.localId}
                    title="Frame Tile ID"
                    onChange={(e) => {
                      const next = animFrames.map((item, idx) =>
                        idx === fIdx
                          ? { ...item, localId: Math.max(1, Number(e.target.value) || 1) }
                          : item
                      );
                      ts.setMeta(activeTileId, { animation: { frames: next } });
                      bumpTilesetVersion();
                    }}
                  />
                  <input
                    type="number"
                    min={16}
                    max={5000}
                    step={10}
                    className="tiles-text-input"
                    value={f.durationMs}
                    title="Duration (ms)"
                    onChange={(e) => {
                      const next = animFrames.map((item, idx) =>
                        idx === fIdx
                          ? { ...item, durationMs: Math.max(16, Number(e.target.value) || 100) }
                          : item
                      );
                      ts.setMeta(activeTileId, { animation: { frames: next } });
                      bumpTilesetVersion();
                    }}
                  />
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 20, height: 20 }}
                    onClick={() => {
                      const next = animFrames.filter((_, idx) => idx !== fIdx);
                      ts.setMeta(
                        activeTileId,
                        next.length > 0 ? { animation: { frames: next } } : { animation: undefined }
                      );
                      bumpTilesetVersion();
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </>
          ) : (
            <div className="mode-hint">Select a tile to edit metadata.</div>
          )}

          <div className="tiles-flag-row">
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipH ? "active" : ""}`}
              title="Flip Brush Horizontal (X)"
              onClick={() =>
                setTileBrushFlags({
                  ...tileBrushFlags,
                  flipH: !tileBrushFlags.flipH,
                })
              }
            >
              <FlipHorizontal2 size={11} />
              <span>X</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipV ? "active" : ""}`}
              title="Flip Brush Vertical (Y)"
              onClick={() =>
                setTileBrushFlags({
                  ...tileBrushFlags,
                  flipV: !tileBrushFlags.flipV,
                })
              }
            >
              <FlipVertical2 size={11} />
              <span>Y</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipD ? "active" : ""}`}
              title="Rotate Brush 90° CW (Z)"
              onClick={rotateFlagsCW}
            >
              <RotateCw size={11} />
              <span>Z</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              style={{ marginLeft: "auto", fontSize: 10 }}
              onClick={() =>
                setTileBrushFlags({ flipH: false, flipV: false, flipD: false })
              }
            >
              Reset
            </button>
          </div>
    </DockablePanelSection>
  );
}
