import { useEffect, useRef } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { unpackCell } from "../../engine/tiles/cell";
import { cellRectToScreen } from "../../engine/tiles/overlayGeometry";
import { blitTileTransformed } from "../../engine/tiles/TilemapEngine";
import { useEditorStore } from "../../store/editorStore";

export function TileOverlay() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const tileTool = useEditorStore((s) => s.tileTool);
  const hoveredTileCell = useEditorStore((s) => s.hoveredTileCell);
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tileBrush = useEditorStore((s) => s.tileBrush);
  const tileBrushFlags = useEditorStore((s) => s.tileBrushFlags);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tileProjection = useEditorStore((s) => s.tileProjection);
  const zoom = useEditorStore((s) => s.zoom);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);

  const ghostRef = useRef<HTMLCanvasElement>(null);
  const active =
    (workspaceMode === "tiles" && tilesMode === "map") ||
    activeTool === "tileStamp";

  const brushCols = tileBrush ? tileBrush.cols : 1;
  const brushRows = tileBrush ? tileBrush.rows : 1;
  const outline =
    active && hoveredTileCell
      ? cellRectToScreen(
          hoveredTileCell.col,
          hoveredTileCell.row,
          brushCols,
          brushRows,
          tileWidth,
          tileHeight,
          canvasWidth,
          tileProjection
        )
      : null;

  const showGhost =
    active &&
    hoveredTileCell !== null &&
    tileProjection === "orthogonal" &&
    tileTool !== "eraser" &&
    tileTool !== "picker" &&
    (activeTileId > 0 || (tileBrush !== null && tileBrush.cells.length > 0));

  useEffect(() => {
    const canvas = ghostRef.current;
    if (!canvas || !showGhost) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = brushCols * tileWidth;
    const h = brushRows * tileHeight;
    const rgba = new Uint8ClampedArray(w * h * 4);

    if (tileBrush && tileBrush.cells.length > 0) {
      const ts = pixelEngine.tilesetRegistry.get(tileBrush.tilesetIndex);
      if (ts) {
        for (let br = 0; br < tileBrush.rows; br++) {
          for (let bc = 0; bc < tileBrush.cols; bc++) {
            const raw = tileBrush.cells[br * tileBrush.cols + bc];
            if (raw === 0) continue;
            const u = unpackCell(raw);
            const buf = ts.getTile(u.localId);
            if (!buf) continue;
            blitTileTransformed(
              rgba,
              w,
              h,
              buf,
              bc * tileWidth,
              br * tileHeight,
              tileBrushFlags,
              1,
              "Normal"
            );
          }
        }
      }
    } else if (activeTileId > 0) {
      const ts =
        pixelEngine.tilesetRegistry.get(activeTilesetIndex) ??
        pixelEngine.tileset;
      const buf = ts.getTile(activeTileId);
      if (buf) {
        blitTileTransformed(
          rgba,
          w,
          h,
          buf,
          0,
          0,
          tileBrushFlags,
          1,
          "Normal"
        );
      }
    }

    ctx.clearRect(0, 0, w, h);
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  }, [
    showGhost,
    brushCols,
    brushRows,
    tileWidth,
    tileHeight,
    activeTileId,
    activeTilesetIndex,
    tileBrush,
    tileBrushFlags,
    tilesetVersion,
  ]);

  if (!active || !outline || !hoveredTileCell) return null;

  return (
    <>
      {showGhost && (
        <canvas
          ref={ghostRef}
          width={brushCols * tileWidth}
          height={brushRows * tileHeight}
          className="tiles-ghost-canvas"
          style={{
            left: hoveredTileCell.col * tileWidth * zoom,
            top: hoveredTileCell.row * tileHeight * zoom,
            width: brushCols * tileWidth * zoom,
            height: brushRows * tileHeight * zoom,
          }}
        />
      )}
      <svg
        className="tiles-overlay-svg"
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        preserveAspectRatio="none"
      >
        {outline.kind === "rect" ? (
          <rect
            className="tiles-hover-outline"
            x={outline.x}
            y={outline.y}
            width={outline.w}
            height={outline.h}
          />
        ) : (
          <polygon
            className="tiles-hover-outline"
            points={outline.points.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        )}
      </svg>
    </>
  );
}
