import { PixelBuffer } from "../document/PixelBuffer.ts";
import type {
  BoneWeightInfluence,
  BoneWeights,
  BoneWorldTransform,
  EasingMode,
} from "./RigEngine.ts";
import { evaluateEasing } from "./RigEngine.ts";
import {
  buildBoneDeformTable,
  deformPointByInfluences,
  lookupInfluencesAt,
  opaquePixelBounds,
  sampleInverseTriangles,
  type BoneTransformMap,
  type InverseTriangle,
} from "./skinning.ts";

/**
 * R6 — auto-generated grid meshes with bone-weighted vertices and optional
 * FFD vertex offsets keyable in `clip.meshTracks[meshId]`. Rendering reuses
 * the inverse-triangle sampler from `skinning.ts`.
 *
 * React-free; explicit `.ts` relative imports for `node --test`.
 */

export interface RigMeshVertex {
  /** Rest position in cel pixels (grid intersection). */
  x: number;
  y: number;
  /** Persistent manual FFD offset (used when no mesh track key exists). */
  offsetX?: number;
  offsetY?: number;
  /** Bone influences sampled from the skin weight map. */
  weights?: BoneWeightInfluence[];
}

export interface RigMesh {
  id: string;
  name: string;
  /** Raster layer this mesh deforms, or null for a standalone mesh. */
  layerId: string | null;
  /** Requested cell size in px (actual cells are never larger). */
  cellSize: number;
  boundsX: number;
  boundsY: number;
  boundsWidth: number;
  boundsHeight: number;
  vertices: RigMeshVertex[];
  /** Flat vertex-index triples. */
  triangles: number[];
}

export interface RigMeshKeyframe {
  frame: number;
  /** Absolute FFD offsets per vertex, in rest space. */
  offsets: Array<[number, number]>;
  easing?: EasingMode;
}

export interface GridMeshOptions {
  id?: string;
  name?: string;
  layerId?: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  cellSize?: number;
}

export interface MeshDeformOptions {
  offsets?: ReadonlyArray<readonly [number, number]> | null;
  pixelSnap?: boolean;
  transforms?: BoneTransformMap | null;
  weights?: BoneWeights | null;
}

export interface RenderMeshOptions extends MeshDeformOptions {
  track?: readonly RigMeshKeyframe[] | null;
  frame?: number;
}

function clampCellSize(cellSize: number | undefined): number {
  if (!Number.isFinite(cellSize)) return 8;
  return Math.max(1, Math.min(64, Math.round(cellSize!)));
}

/**
 * Builds a regular grid mesh over `bounds`. Grid cells are equal and never
 * larger than `cellSize`.
 */
export function createGridMesh(options: GridMeshOptions): RigMesh {
  const cellSize = clampCellSize(options.cellSize);
  const width = Math.max(1, options.bounds.width);
  const height = Math.max(1, options.bounds.height);
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const stepX = width / cols;
  const stepY = height / rows;

  const vertices: RigMeshVertex[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      vertices.push({
        x: options.bounds.x + i * stepX,
        y: options.bounds.y + j * stepY,
      });
    }
  }

  const triangles: number[] = [];
  const stride = cols + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      triangles.push(a, b, c, b, d, c);
    }
  }

  return {
    id: options.id ?? "mesh-1",
    name: options.name ?? "Mesh",
    layerId: options.layerId ?? null,
    cellSize,
    boundsX: options.bounds.x,
    boundsY: options.bounds.y,
    boundsWidth: width,
    boundsHeight: height,
    vertices,
    triangles,
  };
}

/** Auto-generates a grid mesh over the opaque bounds of `src`. */
export function createAutoGridMesh(
  src: PixelBuffer,
  options: Omit<GridMeshOptions, "bounds"> = {}
): RigMesh | null {
  const bounds = opaquePixelBounds(src);
  if (!bounds) return null;
  return createGridMesh({ ...options, bounds });
}

/** Per-vertex persistent FFD offsets. */
export function baseMeshOffsets(mesh: RigMesh): Array<[number, number]> {
  return mesh.vertices.map((vertex) => [vertex.offsetX ?? 0, vertex.offsetY ?? 0]);
}

/**
 * Samples `clip.meshTracks[meshId]` (linear/eased between keys) and returns
 * absolute per-vertex offsets. Tracks replace the persistent base offsets;
 * vertices missing from a key fall back to the base offset.
 */
export function sampleMeshOffsets(
  mesh: RigMesh,
  track: readonly RigMeshKeyframe[] | null | undefined,
  frame: number
): Array<[number, number]> {
  const base = baseMeshOffsets(mesh);
  if (!track || track.length === 0) return base;

  const offsetAt = (key: RigMeshKeyframe, index: number): [number, number] => {
    const value = key.offsets[index];
    if (value) return [value[0], value[1]];
    return base[index] ?? [0, 0];
  };

  if (frame <= track[0].frame) {
    const key = track[0];
    return mesh.vertices.map((_, index) => offsetAt(key, index));
  }
  const last = track[track.length - 1];
  if (frame >= last.frame) {
    return mesh.vertices.map((_, index) => offsetAt(last, index));
  }

  for (let k = 0; k < track.length - 1; k++) {
    const k0 = track[k];
    const k1 = track[k + 1];
    if (frame < k0.frame || frame > k1.frame) continue;
    const span = Math.max(1, k1.frame - k0.frame);
    const t = evaluateEasing((frame - k0.frame) / span, k0.easing ?? "linear");
    return mesh.vertices.map((_, index) => {
      const a = offsetAt(k0, index);
      const b = offsetAt(k1, index);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    });
  }
  return base;
}

/**
 * Inserts/replaces a mesh FFD keyframe, keeping the track sorted and trimming
 * offsets to the vertex count.
 */
export function upsertMeshKeyframe(
  track: readonly RigMeshKeyframe[],
  mesh: RigMesh,
  frame: number,
  offsets: ReadonlyArray<readonly [number, number]>,
  easing: EasingMode = "linear"
): RigMeshKeyframe[] {
  const next: RigMeshKeyframe = {
    frame: Math.round(frame),
    offsets: mesh.vertices.map((_, index) => {
      const value = offsets[index];
      return value ? [value[0], value[1]] : [0, 0];
    }),
    easing,
  };
  const result = track.filter((key) => key.frame !== next.frame);
  result.push(next);
  result.sort((a, b) => a.frame - b.frame);
  return result;
}

/** Copies sampled skin weights onto mesh vertices (nearest weighted pixel). */
export function assignMeshVertexWeights(
  mesh: RigMesh,
  weights: BoneWeights
): void {
  for (const vertex of mesh.vertices) {
    const influences = lookupInfluencesAt(
      weights,
      vertex.x - 0.5,
      vertex.y - 0.5,
      2,
      true
    );
    if (influences && influences.length > 0) {
      vertex.weights = influences.map((influence) => ({ ...influence }));
    } else {
      delete vertex.weights;
    }
  }
}

function vertexInfluences(
  vertex: RigMeshVertex,
  weights: BoneWeights | null | undefined
): BoneWeightInfluence[] | null {
  if (vertex.weights && vertex.weights.length > 0) return vertex.weights;
  if (!weights) return null;
  return lookupInfluencesAt(weights, vertex.x - 0.5, vertex.y - 0.5, 2, true);
}

/**
 * Forward-maps every mesh vertex through LBS (+ FFD offsets) and returns the
 * inverse-sampling triangles. Pixel Snap rounds deformed vertices to pixels.
 */
export function buildMeshTriangles(
  mesh: RigMesh,
  options: MeshDeformOptions = {}
): InverseTriangle[] {
  const table = options.transforms
    ? buildBoneDeformTable(options.transforms)
    : null;
  const offsets = options.offsets ?? baseMeshOffsets(mesh);
  const pixelSnap = options.pixelSnap ?? false;

  const sourceX: number[] = [];
  const sourceY: number[] = [];
  const destX: number[] = [];
  const destY: number[] = [];

  for (let i = 0; i < mesh.vertices.length; i++) {
    const vertex = mesh.vertices[i];
    const offset = offsets[i];
    const offsetX = offset ? offset[0] : 0;
    const offsetY = offset ? offset[1] : 0;
    // Texture coordinates stay glued to the rest vertex; the FFD offset only
    // moves the deformed geometry (so dragging a vertex warps the texture).
    sourceX.push(vertex.x);
    sourceY.push(vertex.y);

    const restX = vertex.x + offsetX;
    const restY = vertex.y + offsetY;
    let dx = restX;
    let dy = restY;
    if (table) {
      const influences = vertexInfluences(vertex, options.weights);
      if (influences) {
        const deformed = deformPointByInfluences(restX, restY, influences, table);
        dx = deformed.x;
        dy = deformed.y;
      }
    }
    destX.push(pixelSnap ? Math.round(dx) : dx);
    destY.push(pixelSnap ? Math.round(dy) : dy);
  }

  const triangles: InverseTriangle[] = [];
  for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
    const a = mesh.triangles[t];
    const b = mesh.triangles[t + 1];
    const c = mesh.triangles[t + 2];
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a < 0 ||
      b < 0 ||
      c < 0 ||
      a >= mesh.vertices.length ||
      b >= mesh.vertices.length ||
      c >= mesh.vertices.length
    ) {
      continue;
    }
    triangles.push({
      sx0: sourceX[a],
      sy0: sourceY[a],
      sx1: sourceX[b],
      sy1: sourceY[b],
      sx2: sourceX[c],
      sy2: sourceY[c],
      dx0: destX[a],
      dy0: destY[a],
      dx1: destX[b],
      dy1: destY[b],
      dx2: destX[c],
      dy2: destY[c],
    });
  }
  return triangles;
}

/** Renders a source cel through a mesh using the inverse-triangle sampler. */
export function renderRigMesh(
  src: PixelBuffer,
  mesh: RigMesh,
  options: RenderMeshOptions = {}
): PixelBuffer {
  const offsets =
    options.offsets ??
    sampleMeshOffsets(mesh, options.track, options.frame ?? 0);
  const triangles = buildMeshTriangles(mesh, {
    offsets,
    pixelSnap: options.pixelSnap,
    transforms: options.transforms,
    weights: options.weights,
  });
  return sampleInverseTriangles(src, triangles);
}

/** Nearest rest-space bone id for a point (used when a vertex has no weights). */
export function nearestBoneAtPoint(
  x: number,
  y: number,
  bones: ReadonlyMap<string, BoneWorldTransform>
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const [boneId, bone] of bones.entries()) {
    const vx = bone.tipX - bone.x;
    const vy = bone.tipY - bone.y;
    const lenSq = vx * vx + vy * vy;
    let t = 0;
    if (lenSq > 1e-6) {
      t = Math.max(
        0,
        Math.min(1, ((x - bone.x) * vx + (y - bone.y) * vy) / lenSq)
      );
    }
    const px = bone.x + t * vx;
    const py = bone.y + t * vy;
    const dist = (x - px) * (x - px) + (y - py) * (y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = boneId;
    }
  }
  return bestId;
}
