import { useEffect, useRef } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { unpackCell } from "../../engine/tiles/cell";
import { cellRectToScreen } from "../../engine/tiles/overlayGeometry";
import { blitTileTransformed } from "../../engine/tiles/TilemapEngine";
import { useEditorStore } from "../../store/editorStore";
import { TileCollisionOverlay, TileObjectsOverlay } from "./TileMetaOverlays";

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
  const tileBrushAnchor = useEditorStore((s) => s.tileBrushAnchor);
  const tileEraserSize = useEditorStore((s) => s.tileEraserSize);
  const tileSelection = useEditorStore((s) => s.tileSelection);
  const tilePreviewChanges = useEditorStore((s) => s.tilePreviewChanges);
  const tileMarqueeRect = useEditorStore((s) => s.tileMarqueeRect);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tileProjection = useEditorStore((s) => s.tileProjection);
  const zoom = useEditorStore((s) => s.zoom);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const showCollisionOverlay = useEditorStore((s) => s.showCollisionOverlay);
  const hasObjectLayers = useEditorStore((s) =>
    s.layers.some((l) => l.kind === "object")
  );

  const ghostRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const active =
    (workspaceMode === "tiles" && tilesMode === "map") ||
    activeTool === "tileStamp";

  const isEraser = workspaceMode === "tiles" && tileTool === "eraser";
  const brushCols = isEraser ? tileEraserSize : tileBrush ? tileBrush.cols : 1;
  const brushRows = isEraser ? tileEraserSize : tileBrush ? tileBrush.rows : 1;

  const anchorColOffset = isEraser
    ? Math.floor(tileEraserSize / 2)
    : tileBrushAnchor === "center"
      ? Math.floor(brushCols / 2)
      : 0;
  const anchorRowOffset = isEraser
    ? Math.floor(tileEraserSize / 2)
    : tileBrushAnchor === "center"
      ? Math.floor(brushRows / 2)
      : 0;

  const hoverCol = hoveredTileCell
    ? hoveredTileCell.col - anchorColOffset
    : 0;
  const hoverRow = hoveredTileCell
    ? hoveredTileCell.row - anchorRowOffset
    : 0;

  const outline =
    active && hoveredTileCell
      ? cellRectToScreen(
          hoverCol,
          hoverRow,
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
    !isEraser &&
    tileTool !== "picker" &&
    tileTool !== "select" &&
    tilePreviewChanges.length === 0 &&
    !tileMarqueeRect &&
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
              { flipH: u.flipH, flipV: u.flipV, flipD: u.flipD },
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

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !active || tilePreviewChanges.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgba = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
    for (const ch of tilePreviewChanges) {
      if (ch.cell === 0) continue;
      const resolved = pixelEngine.tilesetRegistry.resolve(ch.cell);
      if (!resolved) continue;
      blitTileTransformed(
        rgba,
        canvasWidth,
        canvasHeight,
        resolved.buf,
        ch.col * tileWidth,
        ch.row * tileHeight,
        resolved.flags,
        1,
        "Normal"
      );
    }

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.putImageData(new ImageData(rgba, canvasWidth, canvasHeight), 0, 0);
  }, [active, tilePreviewChanges, canvasWidth, canvasHeight, tileWidth, tileHeight]);

  if (!active) return null;

  const marqueeOutline = tileMarqueeRect
    ? cellRectToScreen(
        Math.min(tileMarqueeRect.c0, tileMarqueeRect.c1),
        Math.min(tileMarqueeRect.r0, tileMarqueeRect.r1),
        Math.abs(tileMarqueeRect.c1 - tileMarqueeRect.c0) + 1,
        Math.abs(tileMarqueeRect.r1 - tileMarqueeRect.r0) + 1,
        tileWidth,
        tileHeight,
        canvasWidth,
        tileProjection
      )
    : null;

  return (
    <>
      {showCollisionOverlay && tileProjection === "orthogonal" && (
        <TileCollisionOverlay />
      )}
      {hasObjectLayers && <TileObjectsOverlay />}
      {tilePreviewChanges.length > 0 && tileProjection === "orthogonal" && (
        <canvas
          ref={previewRef}
          width={canvasWidth}
          height={canvasHeight}
          className="tiles-ghost-canvas"
          style={{
            left: 0,
            top: 0,
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
          }}
        />
      )}

      {showGhost && hoveredTileCell && (
        <canvas
          ref={ghostRef}
          width={brushCols * tileWidth}
          height={brushRows * tileHeight}
          className="tiles-ghost-canvas"
          style={{
            left: hoverCol * tileWidth * zoom,
            top: hoverRow * tileHeight * zoom,
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
        {tileSelection.map((key) => {
          const [c, r] = key.split(",").map(Number);
          const sel = cellRectToScreen(
            c,
            r,
            1,
            1,
            tileWidth,
            tileHeight,
            canvasWidth,
            tileProjection
          );
          return sel.kind === "rect" ? (
            <rect
              key={key}
              className="tiles-selection-outline"
              x={sel.x}
              y={sel.y}
              width={sel.w}
              height={sel.h}
            />
          ) : (
            <polygon
              key={key}
              className="tiles-selection-outline"
              points={sel.points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
          );
        })}

        {marqueeOutline &&
          (marqueeOutline.kind === "rect" ? (
            <rect
              className="tiles-marquee-outline"
              x={marqueeOutline.x}
              y={marqueeOutline.y}
              width={marqueeOutline.w}
              height={marqueeOutline.h}
            />
          ) : (
            <polygon
              className="tiles-marquee-outline"
              points={marqueeOutline.points
                .map((p) => `${p.x},${p.y}`)
                .join(" ")}
            />
          ))}

        {outline &&
          (outline.kind === "rect" ? (
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
          ))}
      </svg>
    </>
  );
}
