import { useEffect, useMemo, useState } from "react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { unpackCell } from "../../engine/tiles/cell";
import { collisionPolygons } from "../../engine/tiles/collision";
import { isRectObject } from "../../engine/tiles/objects";
import { useEditorStore } from "../../store/editorStore";

/** Re-render whenever the engine reports a change (tile paint, undo, ...). */
function useEngineRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => pixelEngine.subscribe(() => setRev((r) => r + 1)), []);
  return rev;
}

/** Map-mode overlay: every collidable cell's transformed shape. */
export function TileCollisionOverlay() {
  const layers = useEditorStore((s) => s.layers);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const rev = useEngineRevision();

  const polys = useMemo(() => {
    void tilesetVersion;
    void rev;
    const out: string[] = [];
    const baseTs = pixelEngine.tilesetRegistry.get(0);
    const baseW = baseTs?.tileWidth ?? 16;
    const baseH = baseTs?.tileHeight ?? 16;
    for (const layer of layers) {
      if (layer.kind !== "tilemap" || !layer.visible) continue;
      const tm = pixelEngine.getTilemap(layer.id, currentFrame);
      if (!tm) continue;
      for (let row = 0; row < tm.rows; row++) {
        for (let col = 0; col < tm.cols; col++) {
          const cell = tm.getCell(col, row);
          if (cell === 0) continue;
          const resolved = pixelEngine.tilesetRegistry.resolve(cell);
          if (!resolved || !resolved.meta.collision?.length) continue;
          const shapes = collisionPolygons(
            resolved.meta.collision,
            unpackCell(cell),
            resolved.tileset.tileWidth,
            resolved.tileset.tileHeight
          );
          for (const pts of shapes) {
            out.push(
              pts
                .map(([x, y]) => `${col * baseW + x},${row * baseH + y}`)
                .join(" ")
            );
          }
        }
      }
    }
    return out;
  }, [layers, currentFrame, tilesetVersion, rev]);

  return (
    <svg
      className="tiles-collision-overlay-svg"
      data-testid="collision-overlay"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
    >
      {polys.map((points, i) => (
        <polygon key={i} className="tiles-collision-shape" points={points} />
      ))}
    </svg>
  );
}

/** Map-mode overlay: outlines and labels for object layers (never exported). */
export function TileObjectsOverlay() {
  const layers = useEditorStore((s) => s.layers);
  const zoom = useEditorStore((s) => s.zoom);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const objectDraft = useEditorStore((s) => s.objectDraft);
  useEngineRevision();

  const px = 1 / Math.max(0.01, zoom);
  return (
    <svg
      className="tiles-collision-overlay-svg"
      data-testid="objects-overlay"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
      style={{ zIndex: 7 }}
    >
      {layers
        .filter((l) => l.kind === "object" && l.visible)
        .flatMap((l) =>
          pixelEngine.getObjects(l.id).map((o) => {
            const sel = o.id === selectedObjectId;
            const label = o.type ? `${o.name} [${o.type}]` : o.name;
            if (isRectObject(o)) {
              return (
                <g key={o.id}>
                  <rect
                    className={`tiles-object-shape${sel ? " selected" : ""}`}
                    x={o.x}
                    y={o.y}
                    width={o.w}
                    height={o.h}
                  />
                  <text
                    className="tiles-object-label"
                    x={o.x + 2 * px}
                    y={o.y + 11 * px}
                    fontSize={10 * px}
                    strokeWidth={2 * px}
                  >
                    {label}
                  </text>
                </g>
              );
            }
            return (
              <g key={o.id}>
                <circle
                  className={`tiles-object-point${sel ? " selected" : ""}`}
                  cx={o.x}
                  cy={o.y}
                  r={3 * px}
                  strokeWidth={px}
                />
                <text
                  className="tiles-object-label"
                  x={o.x + 5 * px}
                  y={o.y - 4 * px}
                  fontSize={10 * px}
                  strokeWidth={2 * px}
                >
                  {label}
                </text>
              </g>
            );
          })
        )}
      {objectDraft && (
        <rect
          className="tiles-object-shape selected"
          x={objectDraft.x}
          y={objectDraft.y}
          width={objectDraft.w}
          height={objectDraft.h}
        />
      )}
    </svg>
  );
}
