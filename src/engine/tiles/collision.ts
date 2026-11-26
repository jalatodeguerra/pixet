// Pure collision-shape helpers for tile metadata (T5).
//
// Shapes live in tile-local pixel space: origin top-left of the tile, x right,
// y down, extent 0..w x 0..h. They are stored on `TileMeta.collision`.

import type { CellFlags } from "./cell.ts";
import type { CollisionShape } from "./Tileset.ts";

export type CollisionPreset = Extract<
  CollisionShape,
  { kind: "preset" }
>["preset"];

export type Point = [number, number];

/** Presets offered by the UI, in display order. */
export const COLLISION_PRESETS: ReadonlyArray<{
  preset: CollisionPreset;
  label: string;
}> = [
  { preset: "full", label: "Full" },
  { preset: "halfTop", label: "Half top" },
  { preset: "halfBottom", label: "Half bottom" },
  { preset: "slopeR", label: "Slope ◢" },
  { preset: "slopeL", label: "Slope ◣" },
];

/**
 * Preset polygons (clockwise from top-left, y down).
 *
 * slopeR = solid lower-right triangle (the surface rises to the right, glyph
 * ◢); slopeL = solid lower-left triangle (rises to the left, glyph ◣).
 * The 2:1 variants span two tiles: "a" is the lower tile and "b" the upper
 * tile of a rising pair, in the direction named by L/R.
 */
export function presetToPolygon(
  preset: CollisionPreset,
  w: number,
  h: number
): Point[] {
  const hh = h / 2;
  switch (preset) {
    case "full":
      return [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ];
    case "halfTop":
      return [
        [0, 0],
        [w, 0],
        [w, hh],
        [0, hh],
      ];
    case "halfBottom":
      return [
        [0, hh],
        [w, hh],
        [w, h],
        [0, h],
      ];
    case "slopeR":
      return [
        [w, 0],
        [w, h],
        [0, h],
      ];
    case "slopeL":
      return [
        [0, 0],
        [w, h],
        [0, h],
      ];
    case "slopeR2a":
      return [
        [w, hh],
        [w, h],
        [0, h],
      ];
    case "slopeR2b":
      return [
        [w, 0],
        [w, h],
        [0, h],
        [0, hh],
      ];
    case "slopeL2a":
      return [
        [0, hh],
        [w, h],
        [0, h],
      ];
    case "slopeL2b":
      return [
        [0, 0],
        [w, hh],
        [w, h],
        [0, h],
      ];
  }
}

/** Convert any shape to a polygon in tile-local pixel space. */
export function shapeToPolygon(
  shape: CollisionShape,
  w: number,
  h: number
): Point[] {
  switch (shape.kind) {
    case "preset":
      return presetToPolygon(shape.preset, w, h);
    case "rect":
      return [
        [shape.x, shape.y],
        [shape.x + shape.w, shape.y],
        [shape.x + shape.w, shape.y + shape.h],
        [shape.x, shape.y + shape.h],
      ];
    case "polygon":
      return shape.points.map(([x, y]): Point => [x, y]);
  }
}

/**
 * Map a continuous point from tile-local source space to where the renderer
 * puts it for a flagged cell. Pixel rendering (transformTileCoord) samples
 * `source = swap(flip(dest))`, so the inverse is `dest = flip(swap(source))`:
 * transpose first, then flips (same convention as Tiled/Godot transform
 * flags). The transpose is ignored for non-square tiles, exactly like the
 * renderer.
 */
export function transformPoint(
  x: number,
  y: number,
  flags: CellFlags,
  w: number,
  h: number
): Point {
  let px = x;
  let py = y;
  if (flags.flipD && w === h) {
    const t = px;
    px = py;
    py = t;
  }
  if (flags.flipH) px = w - px;
  if (flags.flipV) py = h - py;
  return [px, py];
}

/**
 * Transform a shape for a flipped/rotated cell. Rects stay rects (the result
 * is always axis aligned); presets and polygons become polygons. Flip flips
 * reverse the winding, so polygons are re-wound to keep the original
 * orientation (Godot rejects nothing, but a stable winding keeps exports
 * deterministic).
 */
export function transformShape(
  shape: CollisionShape,
  flags: CellFlags,
  w: number,
  h: number
): CollisionShape {
  if (shape.kind === "rect") {
    const [ax, ay] = transformPoint(shape.x, shape.y, flags, w, h);
    const [bx, by] = transformPoint(
      shape.x + shape.w,
      shape.y + shape.h,
      flags,
      w,
      h
    );
    return {
      kind: "rect",
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax),
      h: Math.abs(by - ay),
    };
  }
  const poly = shapeToPolygon(shape, w, h);
  let out = poly.map(([x, y]) => transformPoint(x, y, flags, w, h));
  const mirrored =
    (flags.flipH ? 1 : 0) +
    (flags.flipV ? 1 : 0) +
    (flags.flipD && w === h ? 1 : 0);
  if (mirrored % 2 === 1) out = out.reverse();
  return { kind: "polygon", points: out };
}

/** All of a tile's collision as transformed polygons. */
export function collisionPolygons(
  shapes: ReadonlyArray<CollisionShape> | undefined,
  flags: CellFlags,
  w: number,
  h: number
): Point[][] {
  if (!shapes) return [];
  return shapes.map((s) => {
    const t = transformShape(s, flags, w, h);
    return shapeToPolygon(t, w, h);
  });
}

/** Signed area (shoelace); positive = clockwise in y-down coordinates. */
export function polygonArea(points: ReadonlyArray<Point>): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function pointInPolygon(
  x: number,
  y: number,
  points: ReadonlyArray<Point>
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The preset a tile's collision equals, or null when it is not a single preset. */
export function getCollisionPreset(
  shapes: ReadonlyArray<CollisionShape> | undefined
): CollisionPreset | null {
  if (!shapes || shapes.length !== 1) return null;
  const s = shapes[0];
  return s.kind === "preset" ? s.preset : null;
}

/** Replace a tile's collision with a single preset (or clear it with null). */
export function collisionFromPreset(
  preset: CollisionPreset | null
): CollisionShape[] | undefined {
  return preset === null ? undefined : [{ kind: "preset", preset }];
}
