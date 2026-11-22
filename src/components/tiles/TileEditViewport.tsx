import { useEffect, useRef, useState } from "react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { hexToRgba, rgbaToHex } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  captureTilemapHistorySnapshot,
  type TilemapHistorySnapshot,
} from "../../engine/tiles/TilemapHistory";
import { useEditorStore } from "../../store/editorStore";

export function TileEditViewport() {
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const tileEditWrapPreview = useEditorStore((s) => s.tileEditWrapPreview);
  const toggleTileEditWrapPreview = useEditorStore(
    (s) => s.toggleTileEditWrapPreview
  );
  const activeTool = useEditorStore((s) => s.activeTool);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const setSecondaryColor = useEditorStore((s) => s.setSecondaryColor);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const [tileZoom, setTileZoom] = useState(16);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beforeSnapRef = useRef<TilemapHistorySnapshot | null>(null);
  const drawingRef = useRef<{
    erase: boolean;
    changed: boolean;
  } | null>(null);

  const ts =
    pixelEngine.tilesetRegistry.get(activeTilesetIndex) ??
    pixelEngine.tileset;
  const tileBuf = activeTileId > 0 ? ts.getTile(activeTileId) : undefined;
  const tw = ts.tileWidth;
  const th = ts.tileHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tileBuf) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, tw * 3, th * 3);
    const tileImg = new ImageData(
      new Uint8ClampedArray(tileBuf.data),
      tw,
      th
    );

    const off = document.createElement("canvas");
    off.width = tw;
    off.height = th;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.putImageData(tileImg, 0, 0);

    if (tileEditWrapPreview) {
      ctx.globalAlpha = 0.45;
      for (let ry = 0; ry < 3; ry++) {
        for (let rx = 0; rx < 3; rx++) {
          if (rx === 1 && ry === 1) continue;
          ctx.drawImage(off, rx * tw, ry * th);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(off, tw, th);
  }, [tileBuf, tw, th, tileEditWrapPreview, tilesetVersion]);

  if (!tileBuf || activeTileId <= 0) {
    return (
      <div className="tiles-edit-stage">
        <div className="mode-hint">Select a tile in the browser to edit its pixels.</div>
      </div>
    );
  }

  const getLocalCoord = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left) / tileZoom);
    const gy = Math.floor((e.clientY - rect.top) / tileZoom);
    return {
      lx: ((gx % tw) + tw) % tw,
      ly: ((gy % th) + th) % th,
      inCenter: gx >= tw && gx < tw * 2 && gy >= th && gy < th * 2,
    };
  };

  const paintAt = (lx: number, ly: number, erase: boolean) => {
    const rgba = erase
      ? ([0, 0, 0, 0] as const)
      : hexToRgba(primaryColor, 255);
    if (tileBuf.setPixel(lx, ly, rgba[0], rgba[1], rgba[2], rgba[3])) {
      if (drawingRef.current) drawingRef.current.changed = true;
      bumpTilesetVersion();
      pixelEngine.emitChange();
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const { lx, ly } = getLocalCoord(e);
    const isSecondary = e.button === 2;

    if (e.altKey || activeTool === "eyedropper") {
      const [r, g, b, a] = tileBuf.getPixel(lx, ly);
      if (a > 0) {
        const hex = rgbaToHex(r, g, b);
        if (isSecondary) setSecondaryColor(hex);
        else setPrimaryColor(hex);
        setStatusMessage(`Picked ${hex.toUpperCase()}`);
      }
      return;
    }

    const erase = isSecondary || activeTool === "eraser";
    e.currentTarget.setPointerCapture(e.pointerId);
    beforeSnapRef.current = captureTilemapHistorySnapshot(pixelEngine);
    drawingRef.current = { erase, changed: false };
    paintAt(lx, ly, erase);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const { lx, ly } = getLocalCoord(e);
    paintAt(lx, ly, drawingRef.current.erase);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const { changed } = drawingRef.current;
    drawingRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (changed && beforeSnapRef.current) {
      const after = captureTilemapHistorySnapshot(pixelEngine);
      pixelEngine.tilemapHistory.pushTilesetSnapshot(
        `Edit Tile #${activeTileId}`,
        beforeSnapRef.current,
        after
      );
      syncHistoryAndCelState();
    }
    beforeSnapRef.current = null;
  };

  return (
    <div
      className="tiles-edit-stage"
      onWheel={(e) => {
        if (e.deltaY < 0) setTileZoom((z) => Math.min(32, z + 2));
        else setTileZoom((z) => Math.max(4, z - 2));
      }}
    >
      <div className="tiles-edit-toolbar">
        <span className="mono-value" style={{ fontSize: 11 }}>
          Tile #{activeTileId} ({tw}×{th}) · {tileZoom}×
        </span>
        <button
          type="button"
          className={`toggle-chip ${tileEditWrapPreview ? "active" : ""}`}
          onClick={toggleTileEditWrapPreview}
        >
          3×3 Wrap
        </button>
      </div>

      <div
        className="tiles-edit-frame"
        style={{
          width: tw * 3 * tileZoom,
          height: th * 3 * tileZoom,
        }}
      >
        <canvas
          ref={canvasRef}
          width={tw * 3}
          height={th * 3}
          className="tiles-edit-canvas"
          style={{
            width: tw * 3 * tileZoom,
            height: th * 3 * tileZoom,
          }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
        <div
          className="tiles-edit-center-box"
          style={{
            left: tw * tileZoom,
            top: th * tileZoom,
            width: tw * tileZoom,
            height: th * tileZoom,
          }}
        />
      </div>
    </div>
  );
}
