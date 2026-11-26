import { PixelBuffer } from "../document/PixelBuffer.ts";
import { cloneCuboidData, cloneModelNode } from "./Model3DEngine.ts";
import type {
  CuboidData,
  CuboidFaceName,
  CuboidFaceUV,
  ModelNode,
  PolyFace,
  Vec2,
  Vec3,
} from "./types.ts";

export const CUBOID_FACE_NAMES: readonly CuboidFaceName[] = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;

/**
 * Computes the standard Blockbench 6-face Box-UV cross layout in integer pixel coordinates.
 *
 * Layout dimensions for box size (dx, dy, dz) at origin [ox, oy]:
 * - Row 0 (height dz): up   [ox + dz, oy .. ox + dz + dx, oy + dz]
 *                      down [ox + dz + dx, oy .. ox + dz + 2*dx, oy + dz]
 * - Row 1 (height dy): west  [ox, oy + dz .. ox + dz, oy + dz + dy]
 *                      north [ox + dz, oy + dz .. ox + dz + dx, oy + dz + dy]
 *                      east  [ox + dz + dx, oy + dz .. ox + 2*dz + dx, oy + dz + dy]
 *                      south [ox + 2*dz + dx, oy + dz .. ox + 2*dz + 2*dx, oy + dz + dy]
 */
export function computeBoxUvFaces(
  from: Vec3,
  to: Vec3,
  boxUvOrigin: Vec2,
  materialId: string,
  mirrorX = false,
  prevFaces?: Partial<Record<CuboidFaceName, CuboidFaceUV>>
): Record<CuboidFaceName, CuboidFaceUV> {
  const dx = Math.max(1, Math.round(Math.abs(to[0] - from[0])));
  const dy = Math.max(1, Math.round(Math.abs(to[1] - from[1])));
  const dz = Math.max(1, Math.round(Math.abs(to[2] - from[2])));
  const ox = Math.round(boxUvOrigin[0]);
  const oy = Math.round(boxUvOrigin[1]);

  const rects: Record<CuboidFaceName, [number, number, number, number]> = {
    up: [ox + dz, oy, ox + dz + dx, oy + dz],
    down: [ox + dz + dx, oy, ox + dz + 2 * dx, oy + dz],
    west: [ox, oy + dz, ox + dz, oy + dz + dy],
    north: [ox + dz, oy + dz, ox + dz + dx, oy + dz + dy],
    east: [ox + dz + dx, oy + dz, ox + 2 * dz + dx, oy + dz + dy],
    south: [ox + 2 * dz + dx, oy + dz, ox + 2 * dz + 2 * dx, oy + dz + dy],
  };

  if (mirrorX) {
    const origWest = rects.west;
    rects.west = rects.east;
    rects.east = origWest;
  }

  const makeFace = (name: CuboidFaceName): CuboidFaceUV => {
    const prev = prevFaces?.[name];
    const face: CuboidFaceUV = {
      uv: rects[name],
      rotation: 0,
      materialId,
    };
    if (mirrorX) {
      face.flipX = true;
    }
    if (prev?.hidden) {
      face.hidden = true;
    }
    return face;
  };

  return {
    north: makeFace("north"),
    south: makeFace("south"),
    east: makeFace("east"),
    west: makeFace("west"),
    up: makeFace("up"),
    down: makeFace("down"),
  };
}

/**
 * Updates a cuboid's `from` and `to` bounds while respecting `uvLock` and `uvMode`.
 * - If `uvLock === true` or `uvMode === "per-face"`, existing `faces` UV rects remain pinned.
 * - If `uvLock === false` and `uvMode === "box"`, Box-UV face rects are recomputed.
 */
export function resizeCuboidWithUvLock(
  cuboid: CuboidData,
  nextFrom: Vec3,
  nextTo: Vec3
): CuboidData {
  const cloned = cloneCuboidData(cuboid);
  cloned.from = [nextFrom[0], nextFrom[1], nextFrom[2]];
  cloned.to = [nextTo[0], nextTo[1], nextTo[2]];

  if (!cloned.uvLock && cloned.uvMode === "box") {
    const recomputed = computeBoxUvFaces(
      cloned.from,
      cloned.to,
      cloned.boxUvOrigin,
      cloned.faces.north.materialId,
      Boolean(cloned.mirrorUvX),
      cloned.faces
    );
    for (const faceName of CUBOID_FACE_NAMES) {
      const prevMat = cloned.faces[faceName]?.materialId;
      if (prevMat) {
        recomputed[faceName].materialId = prevMat;
      }
    }
    cloned.faces = recomputed;
  }

  return cloned;
}

/**
 * Rotates (in 90° clockwise image-space steps) and/or flips an array of 3 or 4 corner UVs.
 *
 * For 4-corner quads ordered `[bottomLeft, bottomRight, topRight, topLeft]`:
 * - `flipX` / `flipY` mirror UV coordinates within the polygon's UV bounding box.
 * - `rotation` shifts the 4 corners around the quad cycle so non-square rects remain exact.
 *
 * For 3-corner triangles (or other polygon sizes), `rotation` rotates coordinates in 90° steps
 * around the UV bounding box center after applying `flipX` / `flipY`.
 */
export function transformFaceCornerUvs(
  uvs: ReadonlyArray<Vec2>,
  rotation: 0 | 90 | 180 | 270,
  flipX: boolean,
  flipY: boolean
): Vec2[] {
  if (uvs.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [u, v] of uvs) {
    if (u < minX) minX = u;
    if (u > maxX) maxX = u;
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }

  const flipped: Vec2[] = uvs.map(([u, v]): Vec2 => [
    flipX ? minX + maxX - u : u,
    flipY ? minY + maxY - v : v,
  ]);

  const steps = (((rotation / 90) % 4) + 4) % 4;
  if (steps === 0) {
    return flipped;
  }

  if (flipped.length === 4) {
    return [
      [flipped[(0 + steps) % 4][0], flipped[(0 + steps) % 4][1]],
      [flipped[(1 + steps) % 4][0], flipped[(1 + steps) % 4][1]],
      [flipped[(2 + steps) % 4][0], flipped[(2 + steps) % 4][1]],
      [flipped[(3 + steps) % 4][0], flipped[(3 + steps) % 4][1]],
    ];
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  return flipped.map(([u, v]): Vec2 => {
    const dx = u - cx;
    const dy = v - cy;
    if (steps === 1) return [cx + dy, cy - dx];
    if (steps === 2) return [cx - dx, cy - dy];
    return [cx - dy, cy + dx];
  });
}

/**
 * Converts a `CuboidFaceUV` rect `[u0, v0, u1, v1]` (top-left pixel origin) plus
 * `rotation`, `flipX`, and `flipY` into 4 ordered pixel-coordinate corners:
 * `[bottomLeft, bottomRight, topRight, topLeft]`.
 */
export function cuboidFaceUvToCorners(
  faceUv: CuboidFaceUV
): [Vec2, Vec2, Vec2, Vec2] {
  const [u0, v0, u1, v1] = faceUv.uv;
  const left = faceUv.flipX ? u1 : u0;
  const right = faceUv.flipX ? u0 : u1;
  const top = faceUv.flipY ? v1 : v0;
  const bottom = faceUv.flipY ? v0 : v1;

  const base: [Vec2, Vec2, Vec2, Vec2] = [
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top],
  ];

  const steps = (((faceUv.rotation / 90) % 4) + 4) % 4;
  if (steps === 0) return base;

  return [
    base[(0 + steps) % 4],
    base[(1 + steps) % 4],
    base[(2 + steps) % 4],
    base[(3 + steps) % 4],
  ];
}

/**
 * Converts Pixet top-left pixel coordinates `(px, py)` into normalized GPU UV `[u, v]`
 * using OpenGL/Three.js bottom-left V convention (`u = px / texWidth`, `v = 1 - py / texHeight`).
 *
 * When `centroidPx` is provided, nudges `(px, py)` inward toward `centroidPx` by `microInset`
 * pixels before dividing so grazing camera angles do not bleed across UV island seams.
 */
export function pixelUvToNormalized(
  px: number,
  py: number,
  texWidth: number,
  texHeight: number,
  centroidPx?: Vec2,
  microInset = 1e-4
): Vec2 {
  const w = Math.max(1, texWidth);
  const h = Math.max(1, texHeight);
  let qx = px;
  let qy = py;

  if (centroidPx && microInset > 0) {
    const dx = centroidPx[0] - px;
    const dy = centroidPx[1] - py;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-9) {
      const step = Math.min(microInset, dist * 0.5);
      qx += (dx / dist) * step;
      qy += (dy / dist) * step;
    }
  }

  return [qx / w, 1 - qy / h];
}

/**
 * Inverse mapping from GPU normalized `[u, v]` (`0..1`) back to clamped integer pixel
 * coordinates `[px, py]` in `[0..texWidth - 1, 0..texHeight - 1]`.
 */
export function normalizedUvToPixel(
  u: number,
  v: number,
  texWidth: number,
  texHeight: number
): Vec2 {
  const w = Math.max(1, Math.round(texWidth));
  const h = Math.max(1, Math.round(texHeight));
  const rawX = u * w;
  const rawY = (1 - v) * h;
  const px = Math.max(0, Math.min(w - 1, Math.floor(rawX + 1e-9)));
  const py = Math.max(0, Math.min(h - 1, Math.floor(rawY + 1e-9)));
  return [px, py];
}

interface PackItem {
  order: number;
  width: number;
  height: number;
  applyPlacement: (x: number, y: number) => void;
}

function getPolyFaceUvBounds(face: PolyFace): {
  minU: number;
  minV: number;
  width: number;
  height: number;
} {
  if (face.uvs.length === 0) {
    return { minU: 0, minV: 0, width: 1, height: 1 };
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [u, v] of face.uvs) {
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return {
    minU,
    minV,
    width: Math.max(1, Math.ceil(maxU - minU)),
    height: Math.max(1, Math.ceil(maxV - minV)),
  };
}

/**
 * Deterministic shelf bin-packer (sorted largest height first, then width, then node order).
 * Packs cuboid Box-UV footprints `(2*dz + 2*dx) × (dz + dy)`, per-face cuboid rects,
 * and mesh face UV bounding boxes into `canvasWidth × canvasHeight` with `paddingPx` gutters.
 */
export function autoPackModelUvs(
  nodes: ReadonlyArray<ModelNode>,
  canvasWidth: number,
  canvasHeight: number,
  paddingPx = 1
): { nodes: ModelNode[]; packedCount: number; overflowCount: number } {
  const texW = Math.max(1, Math.round(canvasWidth));
  const texH = Math.max(1, Math.round(canvasHeight));
  const pad = Math.max(0, Math.round(paddingPx));

  const clonedNodes = nodes.map(cloneModelNode);
  const items: PackItem[] = [];
  let order = 0;

  for (const node of clonedNodes) {
    if (node.kind === "cuboid" && node.cuboid) {
      const cuboid = node.cuboid;
      if (cuboid.uvMode === "box") {
        const dx = Math.max(1, Math.round(Math.abs(cuboid.to[0] - cuboid.from[0])));
        const dy = Math.max(1, Math.round(Math.abs(cuboid.to[1] - cuboid.from[1])));
        const dz = Math.max(1, Math.round(Math.abs(cuboid.to[2] - cuboid.from[2])));
        const w = 2 * dz + 2 * dx;
        const h = dz + dy;
        items.push({
          order: order++,
          width: w,
          height: h,
          applyPlacement: (x, y) => {
            cuboid.boxUvOrigin = [x, y];
            const recomputed = computeBoxUvFaces(
              cuboid.from,
              cuboid.to,
              [x, y],
              cuboid.faces.north.materialId,
              Boolean(cuboid.mirrorUvX),
              cuboid.faces
            );
            for (const fn of CUBOID_FACE_NAMES) {
              if (cuboid.faces[fn]?.materialId) {
                recomputed[fn].materialId = cuboid.faces[fn].materialId;
              }
            }
            cuboid.faces = recomputed;
          },
        });
      } else {
        for (const faceName of CUBOID_FACE_NAMES) {
          const faceUv = cuboid.faces[faceName];
          if (faceUv.hidden) continue;
          const w = Math.max(1, Math.round(Math.abs(faceUv.uv[2] - faceUv.uv[0])));
          const h = Math.max(1, Math.round(Math.abs(faceUv.uv[3] - faceUv.uv[1])));
          items.push({
            order: order++,
            width: w,
            height: h,
            applyPlacement: (x, y) => {
              faceUv.uv = [x, y, x + w, y + h];
            },
          });
        }
      }
    } else if (node.kind === "mesh" && node.mesh) {
      for (const face of node.mesh.faces) {
        const bounds = getPolyFaceUvBounds(face);
        items.push({
          order: order++,
          width: bounds.width,
          height: bounds.height,
          applyPlacement: (x, y) => {
            const shiftX = x - bounds.minU;
            const shiftY = y - bounds.minV;
            face.uvs = face.uvs.map(([u, v]): Vec2 => [u + shiftX, v + shiftY]);
          },
        });
      }
    }
  }

  items.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    if (b.width !== a.width) return b.width - a.width;
    return a.order - b.order;
  });

  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  let packedCount = 0;
  let overflowCount = 0;

  for (const item of items) {
    if (item.width > texW || item.height > texH) {
      overflowCount++;
      continue;
    }

    if (shelfX > 0 && shelfX + item.width > texW) {
      shelfY += shelfHeight + pad;
      shelfX = 0;
      shelfHeight = 0;
    }

    if (shelfY + item.height > texH) {
      overflowCount++;
      continue;
    }

    item.applyPlacement(shelfX, shelfY);
    shelfX += item.width + pad;
    shelfHeight = Math.max(shelfHeight, item.height);
    packedCount++;
  }

  return {
    nodes: clonedNodes,
    packedCount,
    overflowCount,
  };
}

const UV_GUIDE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [76, 139, 245], // accent blue
  [88, 196, 114], // green
  [235, 168, 52], // amber
  [224, 92, 112], // coral
  [168, 112, 232], // violet
  [64, 196, 208], // cyan
] as const;

function blendGuidePixel(
  buf: PixelBuffer,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const [dr, dg, db, da] = buf.getPixel(x, y);
  if (da === 0) {
    buf.setPixel(x, y, r, g, b, a);
    return;
  }
  const srcA = a / 255;
  const dstA = da / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  const outR = Math.round((r * srcA + dr * dstA * (1 - srcA)) / outA);
  const outG = Math.round((g * srcA + dg * dstA * (1 - srcA)) / outA);
  const outB = Math.round((b * srcA + db * dstA * (1 - srcA)) / outA);
  buf.setPixel(x, y, outR, outG, outB, Math.round(outA * 255));
}

function drawGuideLine(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number
): void {
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    blendGuidePixel(buf, cx, cy, r, g, b, a);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
}

function pointInPolygon(px: number, py: number, poly: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Renders translucent color-coded UV island fills + crisp 1px borders onto a `PixelBuffer`
 * so artists can click "Generate UV Guide Layer in Draw".
 */
export function rasterizeUvGuideToBuffer(
  nodes: ReadonlyArray<ModelNode>,
  width: number,
  height: number
): PixelBuffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const buf = new PixelBuffer(w, h);
  let colorIndex = 0;

  for (const node of nodes) {
    if (node.kind === "cuboid" && node.cuboid) {
      for (const faceName of CUBOID_FACE_NAMES) {
        const face = node.cuboid.faces[faceName];
        if (face.hidden) continue;
        const [r, g, b] =
          UV_GUIDE_PALETTE[colorIndex++ % UV_GUIDE_PALETTE.length];

        const minU = Math.min(face.uv[0], face.uv[2]);
        const maxU = Math.max(face.uv[0], face.uv[2]);
        const minV = Math.min(face.uv[1], face.uv[3]);
        const maxV = Math.max(face.uv[1], face.uv[3]);

        const x0 = Math.max(0, Math.floor(minU));
        const y0 = Math.max(0, Math.floor(minV));
        const x1 = Math.min(w - 1, Math.max(x0, Math.ceil(maxU) - 1));
        const y1 = Math.min(h - 1, Math.max(y0, Math.ceil(maxV) - 1));

        if (minU >= w || maxU <= 0 || minV >= h || maxV <= 0) continue;

        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const isBorder = x === x0 || x === x1 || y === y0 || y === y1;
            blendGuidePixel(buf, x, y, r, g, b, isBorder ? 235 : 80);
          }
        }
      }
    } else if (node.kind === "mesh" && node.mesh) {
      for (const face of node.mesh.faces) {
        if (face.uvs.length < 3) continue;
        const [r, g, b] =
          UV_GUIDE_PALETTE[colorIndex++ % UV_GUIDE_PALETTE.length];

        let minU = Infinity;
        let maxU = -Infinity;
        let minV = Infinity;
        let maxV = -Infinity;
        for (const [u, v] of face.uvs) {
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        if (minU >= w || maxU <= 0 || minV >= h || maxV <= 0) continue;

        const x0 = Math.max(0, Math.floor(minU));
        const y0 = Math.max(0, Math.floor(minV));
        const x1 = Math.min(w - 1, Math.max(x0, Math.ceil(maxU) - 1));
        const y1 = Math.min(h - 1, Math.max(y0, Math.ceil(maxV) - 1));

        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (pointInPolygon(x + 0.5, y + 0.5, face.uvs)) {
              blendGuidePixel(buf, x, y, r, g, b, 80);
            }
          }
        }

        const edgePts: Array<[number, number]> = face.uvs.map(([u, v]) => {
          const px =
            u >= maxU && maxU > minU ? Math.ceil(u) - 1 : Math.floor(u);
          const py =
            v >= maxV && maxV > minV ? Math.ceil(v) - 1 : Math.floor(v);
          return [px, py];
        });
        for (let i = 0; i < edgePts.length; i++) {
          const a = edgePts[i];
          const next = edgePts[(i + 1) % edgePts.length];
          drawGuideLine(buf, a[0], a[1], next[0], next[1], r, g, b, 235);
        }
      }
    }
  }

  return buf;
}
