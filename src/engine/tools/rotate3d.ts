import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import {
  applyPixelCleanup,
  collectPalette,
  hasPixelCleanup,
  packRgba,
  type PixelCleanupOptions,
} from "../rig/pixelCleanup.ts";
import {
  mat3FacingZ,
  mat3FromEulerDeg,
  mat3MulVec,
  mat3TransposeMulVec,
} from "./math3d.ts";
import { scale2xEPX } from "./rotsprite.ts";

export type Rotate3DMode = "extruded" | "stack";
export type SpinAxis = "yaw" | "pitch" | "roll";
export type DepthProfile = "slab" | "bevel" | "pillow" | "heightmap";

export interface Rotate25DOptions {
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
  extrudeDepth: number;
  perspective: number;
  shadeDepth: boolean;
  supersample: boolean;
  outlineColor: RGBA | null;
  pivotX?: number;
  pivotY?: number;
  autoFitBounds?: boolean;
  depthProfile?: DepthProfile;
  heightMap?: PixelBuffer | null;
  directionalLighting?: boolean;
  lightAzimuthDeg?: number;
  lightElevationDeg?: number;
  ambient?: number;
  rimStrength?: number;
  backSource?: PixelBuffer | null;
  mirrorBack?: boolean;
  preScaleEPX?: boolean;
  cleanup?: PixelCleanupOptions | null;
}

export type TurntableEasing = "linear" | "easeInOut" | "easeIn" | "easeOut";

export interface SpriteStackOptions {
  yawDeg: number;
  pitchDeg: number;
  sliceSpacing: number;
  depthShading: boolean;
  outlineColor: RGBA | null;
  rollDeg?: number;
  perspective?: number;
  sliceThickness?: number;
  reverseOrder?: boolean;
  directionalLighting?: boolean;
  lightAzimuthDeg?: number;
  lightElevationDeg?: number;
  ambient?: number;
  autoFitBounds?: boolean;
  cleanup?: PixelCleanupOptions | null;
}

export interface TurntableAngleOptions {
  startDeg?: number;
  sweepDeg?: number;
  pingPong?: boolean;
  easing?: TurntableEasing;
}

export interface BakeTurntableOptions extends TurntableAngleOptions {
  mode: Rotate3DMode;
  frameCount: number;
  spinAxis: SpinAxis;
  source?: PixelBuffer;
  slices?: readonly PixelBuffer[];
  opts25d: Rotate25DOptions;
  optsStack: SpriteStackOptions;
  sourceFrames?: readonly PixelBuffer[];
  backFrames?: readonly PixelBuffer[];
}

export interface Rotate3DCameraPreset {
  id: string;
  label: string;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export const ROTATE3D_CAMERA_PRESETS: Record<
  "front" | "threeQuarterL" | "threeQuarterR" | "iso2to1" | "topDown" | "coinFlip",
  Rotate3DCameraPreset
> = {
  front: { id: "front", label: "Front", yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
  threeQuarterL: {
    id: "threeQuarterL",
    label: "3/4 L",
    yawDeg: -35,
    pitchDeg: 22,
    rollDeg: 0,
  },
  threeQuarterR: {
    id: "threeQuarterR",
    label: "3/4 R",
    yawDeg: 35,
    pitchDeg: 22,
    rollDeg: 0,
  },
  iso2to1: {
    id: "iso2to1",
    label: "Iso 2:1",
    yawDeg: 45,
    pitchDeg: 30,
    rollDeg: 0,
  },
  topDown: {
    id: "topDown",
    label: "Top-Down",
    yawDeg: 0,
    pitchDeg: 65,
    rollDeg: 0,
  },
  coinFlip: {
    id: "coinFlip",
    label: "Coin Flip",
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
  },
};

export interface TurntablePreset {
  id: string;
  label: string;
  frameCount: number;
  startDeg: number;
  sweepDeg: number;
  pingPong: boolean;
  easing: TurntableEasing;
}

export const TURNTABLE_PRESETS: Record<
  "dir4" | "dir8" | "dir16" | "sway",
  TurntablePreset
> = {
  dir4: {
    id: "dir4",
    label: "4-Dir",
    frameCount: 4,
    startDeg: 0,
    sweepDeg: 360,
    pingPong: false,
    easing: "linear",
  },
  dir8: {
    id: "dir8",
    label: "8-Dir",
    frameCount: 8,
    startDeg: 0,
    sweepDeg: 360,
    pingPong: false,
    easing: "linear",
  },
  dir16: {
    id: "dir16",
    label: "16-Dir",
    frameCount: 16,
    startDeg: 0,
    sweepDeg: 360,
    pingPong: false,
    easing: "linear",
  },
  sway: {
    id: "sway",
    label: "Sway ±35°",
    frameCount: 8,
    startDeg: -35,
    sweepDeg: 70,
    pingPong: true,
    easing: "easeInOut",
  },
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Adds a 1-pixel 4-connected outline around opaque pixels in `src`.
 */
export function applyPixelOutline(src: PixelBuffer, color: RGBA): PixelBuffer {
  const out = src.clone();
  const w = src.width;
  const h = src.height;
  const srcData = src.data;
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (srcData[idx + 3] > 0) continue;

      const hasNeighbor =
        (x > 0 && srcData[idx - 4 + 3] > 0) ||
        (x + 1 < w && srcData[idx + 4 + 3] > 0) ||
        (y > 0 && srcData[idx - w * 4 + 3] > 0) ||
        (y + 1 < h && srcData[idx + w * 4 + 3] > 0);

      if (hasNeighbor) {
        outData[idx] = color[0];
        outData[idx + 1] = color[1];
        outData[idx + 2] = color[2];
        outData[idx + 3] = color[3];
      }
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Builds a normalized per-pixel thickness map in [0, 1] for depth profiles.
 * Transparent pixels always have thickness 0.
 */
function buildThicknessMap(
  src: PixelBuffer,
  profile: DepthProfile,
  heightMap: PixelBuffer | null,
  depth: number,
  sampleScale: number
): Float32Array {
  const w = src.width;
  const h = src.height;
  const size = w * h;
  const map = new Float32Array(size);
  const srcData = src.data;

  if (profile === "slab" || (profile === "heightmap" && !heightMap)) {
    for (let i = 0; i < size; i++) {
      map[i] = srcData[i * 4 + 3] > 0 ? 1 : 0;
    }
    return map;
  }

  if (profile === "heightmap" && heightMap) {
    const hmW = heightMap.width;
    const hmH = heightMap.height;
    const hmData = heightMap.data;
    if (hmW === 0 || hmH === 0) return map;

    for (let y = 0; y < h; y++) {
      const hy = Math.min(hmH - 1, Math.floor((y * hmH) / h));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (srcData[i * 4 + 3] === 0) continue;
        const hx = Math.min(hmW - 1, Math.floor((x * hmW) / w));
        const hIdx = (hy * hmW + hx) * 4;
        const ha = hmData[hIdx + 3];
        if (ha === 0) {
          map[i] = 0;
        } else {
          const luma =
            (0.2126 * hmData[hIdx] +
              0.7152 * hmData[hIdx + 1] +
              0.0722 * hmData[hIdx + 2]) /
            255;
          map[i] = luma * (ha / 255);
        }
      }
    }
    return map;
  }

  // 2-pass Chamfer distance-to-transparent transform for "bevel" and "pillow"
  const INF = 1e6;
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    dist[i] = srcData[i * 4 + 3] > 0 ? INF : 0;
  }

  const DIAG = Math.SQRT2;
  // Pass 1: top-left -> bottom-right
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let d = dist[i];
      if (d === 0) continue;
      const left = x > 0 ? dist[i - 1] : 0;
      const up = y > 0 ? dist[i - w] : 0;
      const upLeft = x > 0 && y > 0 ? dist[i - w - 1] : 0;
      const upRight = x + 1 < w && y > 0 ? dist[i - w + 1] : 0;
      if (left + 1 < d) d = left + 1;
      if (up + 1 < d) d = up + 1;
      if (upLeft + DIAG < d) d = upLeft + DIAG;
      if (upRight + DIAG < d) d = upRight + DIAG;
      dist[i] = d;
    }
  }

  // Pass 2: bottom-right -> top-left
  let maxDist = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let d = dist[i];
      if (d === 0) continue;
      const right = x + 1 < w ? dist[i + 1] : 0;
      const down = y + 1 < h ? dist[i + w] : 0;
      const downRight = x + 1 < w && y + 1 < h ? dist[i + w + 1] : 0;
      const downLeft = x > 0 && y + 1 < h ? dist[i + w - 1] : 0;
      if (right + 1 < d) d = right + 1;
      if (down + 1 < d) d = down + 1;
      if (downRight + DIAG < d) d = downRight + DIAG;
      if (downLeft + DIAG < d) d = downLeft + DIAG;
      dist[i] = d;
      if (d > maxDist) maxDist = d;
    }
  }

  if (maxDist <= 0) return map;

  if (profile === "bevel") {
    const bevelWidth = Math.max(
      1.5,
      Math.min(maxDist, Math.max(2, depth * 0.5) * sampleScale)
    );
    for (let i = 0; i < size; i++) {
      const d = dist[i];
      if (d === 0) continue;
      map[i] = maxDist <= 1 ? 1 : Math.min(1, Math.max(0.05, d - 0.5) / bevelWidth);
    }
  } else {
    // "pillow": smooth rounded inflation sqrt(1 - (1 - t)^2)
    for (let i = 0; i < size; i++) {
      const d = dist[i];
      if (d === 0) continue;
      if (maxDist <= 1) {
        map[i] = 1;
      } else {
        const t = Math.min(1, Math.max(0.05, d - 0.5) / Math.max(1, maxDist - 0.5));
        const inv = 1 - t;
        map[i] = Math.sqrt(Math.max(0, 1 - inv * inv));
      }
    }
  }

  return map;
}

interface HitSample {
  r: number;
  g: number;
  b: number;
  a: number;
  t: number;
}

/**
 * Renders a 2D sprite rotated in 3D (Pitch X, Yaw Y, Roll Z) with optional
 * Z-extrusion depth, depth profiles, perspective projection, directional
 * lighting, back-face mapping, auto-fit bounds, EPX pre-scaling, pixel
 * cleanup, and 1px outline.
 */
export function render25DSprite(
  src: PixelBuffer,
  opts: Rotate25DOptions
): PixelBuffer {
  const w = src.width;
  const h = src.height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const pivotX = opts.pivotX ?? (w - 1) / 2;
  const pivotY = opts.pivotY ?? (h - 1) / 2;

  const R = mat3FromEulerDeg(opts.yawDeg, opts.pitchDeg, opts.rollDeg);
  const facingZ = mat3FacingZ(R);

  const persp = Math.max(0, Math.min(1, opts.perspective));
  const usePersp = persp > 0.001;
  const maxDim = Math.max(w, h);
  const camDist = usePersp ? maxDim * (2.6 - 1.5 * persp) : maxDim * 4;

  const depth = Math.max(0, Math.min(16, Math.round(opts.extrudeDepth)));
  const halfDepth = depth / 2;
  const sliceValues: number[] = [];
  if (depth === 0) {
    sliceValues.push(0);
  } else {
    const steps = Math.max(2, Math.round(depth * 2));
    for (let i = 0; i <= steps; i++) {
      sliceValues.push(-halfDepth + (i / steps) * depth);
    }
  }

  // Optional 2x EPX pre-scaling for cleaner diagonal edges
  const useEPX = opts.preScaleEPX === true;
  const sampleScale = useEPX ? 2 : 1;
  const sampleSrc = useEPX ? scale2xEPX(src) : src;
  const sw = sampleSrc.width;
  const sh = sampleSrc.height;
  const srcData = sampleSrc.data;

  const rawBack = opts.backSource ?? null;
  const sampleBack = rawBack ? (useEPX ? scale2xEPX(rawBack) : rawBack) : null;
  const backData = sampleBack ? sampleBack.data : null;
  const backW = sampleBack ? sampleBack.width : sw;
  const backH = sampleBack ? sampleBack.height : sh;
  const hasBack = Boolean(sampleBack || opts.mirrorBack);

  const rawHeightMap = opts.heightMap ?? null;
  const sampleHeightMap = rawHeightMap
    ? useEPX
      ? scale2xEPX(rawHeightMap)
      : rawHeightMap
    : null;

  const depthProfile: DepthProfile = opts.depthProfile ?? "slab";
  const useDirectional = opts.directionalLighting === true;
  const rimStrength = Math.max(0, Math.min(1, opts.rimStrength ?? 0));
  const needsLighting = useDirectional || rimStrength > 0;
  const needsThickness =
    (depth > 0 && depthProfile !== "slab") ||
    (needsLighting && depthProfile !== "slab");
  const thicknessMap = needsThickness
    ? buildThicknessMap(
        sampleSrc,
        depthProfile,
        sampleHeightMap,
        Math.max(1, depth),
        sampleScale
      )
    : null;

  // Compute directional light unit vector in world space (+X right, +Y down, +Z viewer)
  const lightAz = degToRad(opts.lightAzimuthDeg ?? -35);
  const lightEl = degToRad(opts.lightElevationDeg ?? 45);
  const cosEl = Math.cos(lightEl);
  const lightX = Math.sin(lightAz) * cosEl;
  const lightY = -Math.sin(lightEl);
  const lightZ = Math.cos(lightAz) * cosEl;
  const ambient = Math.max(0.1, Math.min(1, opts.ambient ?? 0.45));

  // Tight 2D opaque bounding box in sampleSrc space (shared by Ray-AABB and autoFitBounds)
  let minU = sw;
  let maxU = -1;
  let minV = sh;
  let maxV = -1;
  for (let v = 0; v < sh; v++) {
    const row = v * sw;
    for (let u = 0; u < sw; u++) {
      if (srcData[(row + u) * 4 + 3] > 0) {
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  if (backData) {
    for (let bv = 0; bv < backH; bv++) {
      const v = backH === sh ? bv : Math.min(sh - 1, Math.floor((bv * sh) / backH));
      const row = bv * backW;
      for (let bu = 0; bu < backW; bu++) {
        if (backData[(row + bu) * 4 + 3] > 0) {
          const u =
            backW === sw
              ? sw - 1 - bu
              : Math.max(0, Math.min(sw - 1, sw - 1 - Math.floor((bu * sw) / backW)));
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
    }
  }
  if (maxU < minU || maxV < minV) {
    return out;
  }

  const boxMinX = minU / sampleScale - 0.5 - pivotX;
  const boxMaxX = (maxU + 1) / sampleScale - 0.5 - pivotX;
  const boxMinY = minV / sampleScale - 0.5 - pivotY;
  const boxMaxY = (maxV + 1) / sampleScale - 0.5 - pivotY;
  const boxMinZ = -halfDepth;
  const boxMaxZ = halfDepth;

  // Optional auto-fit bounds: project 8 corners of opaque 3D AABB
  let fitScale = 1;
  let projCenterX = 0;
  let projCenterY = 0;
  const useAutoFit = opts.autoFitBounds === true;
  const canvasCx = (w - 1) / 2;
  const canvasCy = (h - 1) / 2;

  if (useAutoFit) {
    const xs = [boxMinX, boxMaxX];
    const ys = [boxMinY, boxMaxY];
    const zs = depth > 0 ? [boxMinZ, boxMaxZ] : [0];

    let pMinX = Infinity;
    let pMaxX = -Infinity;
    let pMinY = Infinity;
    let pMaxY = -Infinity;

    for (const lx of xs) {
      for (const ly of ys) {
        for (const lz of zs) {
          const [wx, wy, wz] = mat3MulVec(R, lx, ly, lz);
          let pxProj = wx;
          let pyProj = wy;
          if (usePersp) {
            const denom = Math.max(1e-3, camDist - wz);
            pxProj = (wx * camDist) / denom;
            pyProj = (wy * camDist) / denom;
          }
          if (pxProj < pMinX) pMinX = pxProj;
          if (pxProj > pMaxX) pMaxX = pxProj;
          if (pyProj < pMinY) pMinY = pyProj;
          if (pyProj > pMaxY) pMaxY = pyProj;
        }
      }
    }

    const spanX = pMaxX - pMinX;
    const spanY = pMaxY - pMinY;
    const scaleX = spanX > 1e-4 ? w / spanX : 1;
    const scaleY = spanY > 1e-4 ? h / spanY : 1;
    fitScale = Math.min(1, scaleX, scaleY);
    projCenterX = (pMinX + pMaxX) / 2;
    projCenterY = (pMinY + pMaxY) / 2;
  }

  const subOffsets = opts.supersample ? [-0.25, 0.25] : [0];
  const outData = out.data;
  const stepSize = Math.min(0.45, 0.5 / sampleScale);

  const readThickness = (ux: number, uy: number): number => {
    if (ux < 0 || uy < 0 || ux >= sw || uy >= sh) return 0;
    if (thicknessMap) return thicknessMap[uy * sw + ux];
    return srcData[(uy * sw + ux) * 4 + 3] > 0 ? 1 : 0;
  };

  const sobelGradient = (u: number, v: number): [number, number] => {
    const tl = readThickness(u - 1, v - 1);
    const tc = readThickness(u, v - 1);
    const tr = readThickness(u + 1, v - 1);
    const ml = readThickness(u - 1, v);
    const mr = readThickness(u + 1, v);
    const bl = readThickness(u - 1, v + 1);
    const bc = readThickness(u, v + 1);
    const br = readThickness(u + 1, v + 1);
    const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
    const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
    return [gx, gy];
  };

  interface SolidSample {
    u: number;
    v: number;
    r: number;
    g: number;
    b: number;
    a: number;
    effectiveT: number;
  }

  const sampleSolidAt = (lx: number, ly: number, lz: number): SolidSample | null => {
    if (depth > 0 && Math.abs(lz) > halfDepth + 1e-4) return null;
    const sx = lx + pivotX;
    const sy = ly + pivotY;
    const u = useEPX ? Math.floor((sx + 0.5) * 2) : Math.round(sx);
    const v = useEPX ? Math.floor((sy + 0.5) * 2) : Math.round(sy);
    if (u < 0 || v < 0 || u >= sw || v >= sh) return null;

    const useBack =
      hasBack &&
      (depth === 0 ? facingZ < 0 : lz < -1e-4 || (Math.abs(lz) <= 1e-4 && facingZ < 0));

    let baseR: number;
    let baseG: number;
    let baseB: number;
    let alpha: number;

    if (useBack) {
      if (backData) {
        const bu =
          backW === sw
            ? sw - 1 - u
            : Math.min(backW - 1, Math.floor(((sw - 1 - u) * backW) / sw));
        const bv =
          backH === sh
            ? v
            : Math.min(backH - 1, Math.floor((v * backH) / sh));
        const bIdx = (bv * backW + bu) * 4;
        alpha = backData[bIdx + 3];
        if (alpha === 0) return null;
        baseR = backData[bIdx];
        baseG = backData[bIdx + 1];
        baseB = backData[bIdx + 2];
      } else {
        const mu = sw - 1 - u;
        const mIdx = (v * sw + mu) * 4;
        alpha = srcData[mIdx + 3];
        if (alpha === 0) return null;
        baseR = srcData[mIdx];
        baseG = srcData[mIdx + 1];
        baseB = srcData[mIdx + 2];
      }
    } else {
      const sIdx = (v * sw + u) * 4;
      alpha = srcData[sIdx + 3];
      if (alpha === 0) return null;
      baseR = srcData[sIdx];
      baseG = srcData[sIdx + 1];
      baseB = srcData[sIdx + 2];
    }

    let effectiveT = 1;
    if (depth > 0 && thicknessMap) {
      const normT = thicknessMap[v * sw + u];
      effectiveT = normT > 0 ? normT : useBack && backData ? 1 : 0;
      const localHalfZ = halfDepth * effectiveT;
      if (Math.abs(lz) > localHalfZ + 1e-4) return null;
    }

    return { u, v, r: baseR, g: baseG, b: baseB, a: alpha, effectiveT };
  };

  const shadeHit = (
    hit: SolidSample,
    hitLz: number,
    isSideWall: boolean,
    dx: number,
    dy: number,
    t: number
  ): HitSample => {
    let shade = 1;
    let rim = 0;
    const needNormal = (opts.shadeDepth && depth > 0) || needsLighting;

    if (needNormal) {
      let nlx = 0;
      let nly = 0;
      let nlz = depth === 0 ? (facingZ >= 0 ? 1 : -1) : hitLz >= 0 ? 1 : -1;

      if (depth > 0 && depthProfile === "slab") {
        if (isSideWall) {
          const [gx, gy] = sobelGradient(hit.u, hit.v);
          nlx = -gx;
          nly = -gy;
          nlz = 0;
          if (Math.hypot(nlx, nly) < 1e-5) {
            nlx = -dx;
            nly = -dy;
            nlz = 0;
          }
        }
      } else if (thicknessMap) {
        const [gx, gy] = sobelGradient(hit.u, hit.v);
        const hScale = Math.max(1, halfDepth) * (useEPX ? 0.5 : 1) * 0.25;
        nlx = -gx * hScale;
        nly = -gy * hScale;
        if (depth > 0 && Math.abs(hitLz) < halfDepth * 0.25 && hit.effectiveT < 0.4) {
          const rimT = Math.max(0, Math.min(1, Math.abs(hitLz) / (halfDepth * 0.25)));
          nlz = (hitLz >= 0 ? 1 : -1) * rimT;
        }
      }

      const rawSlope = Math.hypot(nlx, nly);
      const nLen = Math.hypot(nlx, nly, nlz);
      if (nLen > 1e-6) {
        nlx /= nLen;
        nly /= nLen;
        nlz /= nLen;
      } else {
        nlx = 0;
        nly = 0;
        nlz = depth === 0 ? (facingZ >= 0 ? 1 : -1) : hitLz >= 0 ? 1 : -1;
      }

      const [wnx, wny, wnz] = mat3MulVec(R, nlx, nly, nlz);

      if (opts.shadeDepth && depth > 0) {
        const depthT = Math.max(
          0,
          Math.min(1, (facingZ >= 0 ? hitLz + halfDepth : halfDepth - hitLz) / depth)
        );
        const sideCue =
          0.74 +
          0.26 * Math.max(0, 0.4 * -wny + 0.55 * Math.abs(wnz) + 0.2 * -wnx);

        if (depthProfile === "slab") {
          if (isSideWall) {
            shade = (0.76 + 0.14 * depthT) * sideCue;
          }
        } else {
          const sideFactor = isSideWall
            ? Math.max(0.55, Math.min(1, rawSlope))
            : Math.min(1, rawSlope);
          const sideShade = (0.78 + 0.14 * depthT) * sideCue;
          shade = 1 - sideFactor * (1 - sideShade);
        }
      }

      if (useDirectional) {
        const diffuse = Math.max(0, wnx * lightX + wny * lightY + wnz * lightZ);
        shade *= ambient + (1 - ambient) * diffuse;
      }
      if (rimStrength > 0) {
        const grazing = 1 - Math.abs(wnz);
        rim = rimStrength * grazing * grazing;
      }
    }

    const litR = hit.r * shade;
    const litG = hit.g * shade;
    const litB = hit.b * shade;

    return {
      r: clampByte(rim > 0 ? litR + (255 - litR) * rim : litR),
      g: clampByte(rim > 0 ? litG + (255 - litG) * rim : litG),
      b: clampByte(rim > 0 ? litB + (255 - litB) * rim : litB),
      a: hit.a,
      t,
    };
  };

  const traceSubRay = (px: number, py: number): HitSample | null => {
    const sx = useAutoFit
      ? (px - canvasCx) / fitScale + projCenterX
      : px - pivotX;
    const sy = useAutoFit
      ? (py - canvasCy) / fitScale + projCenterY
      : py - pivotY;

    let worldOx: number;
    let worldOy: number;
    let worldOz: number;
    let worldDx: number;
    let worldDy: number;
    let worldDz: number;

    if (usePersp) {
      worldOx = 0;
      worldOy = 0;
      worldOz = camDist;
      worldDx = sx;
      worldDy = sy;
      worldDz = -camDist;
    } else {
      worldOx = sx;
      worldOy = sy;
      worldOz = camDist;
      worldDx = 0;
      worldDy = 0;
      worldDz = -1;
    }

    // Transform into local sprite space via R^T and normalize ray direction
    const [ox, oy, oz] = mat3TransposeMulVec(R, worldOx, worldOy, worldOz);
    const [rawDx, rawDy, rawDz] = mat3TransposeMulVec(R, worldDx, worldDy, worldDz);
    const dirLen = Math.hypot(rawDx, rawDy, rawDz);
    if (dirLen < 1e-6) return null;
    const dx = rawDx / dirLen;
    const dy = rawDy / dirLen;
    const dz = rawDz / dirLen;

    if (depth === 0) {
      if (Math.abs(dz) < 1e-5) return null;
      const t = -oz / dz;
      if (t <= 0) return null;
      const hit = sampleSolidAt(ox + t * dx, oy + t * dy, 0);
      if (!hit) return null;
      return shadeHit(hit, 0, false, dx, dy, t);
    }

    // Ray-AABB slab intersection against tight 3D bounds
    let tEnter = -Infinity;
    let tExit = Infinity;
    let enterAxis = 2;

    if (Math.abs(dx) < 1e-8) {
      if (ox < boxMinX || ox > boxMaxX) return null;
    } else {
      const inv = 1 / dx;
      let t0 = (boxMinX - ox) * inv;
      let t1 = (boxMaxX - ox) * inv;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tEnter) {
        tEnter = t0;
        enterAxis = 0;
      }
      if (t1 < tExit) tExit = t1;
    }

    if (Math.abs(dy) < 1e-8) {
      if (oy < boxMinY || oy > boxMaxY) return null;
    } else {
      const inv = 1 / dy;
      let t0 = (boxMinY - oy) * inv;
      let t1 = (boxMaxY - oy) * inv;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tEnter) {
        tEnter = t0;
        enterAxis = 1;
      }
      if (t1 < tExit) tExit = t1;
    }

    if (Math.abs(dz) < 1e-8) {
      if (oz < boxMinZ || oz > boxMaxZ) return null;
    } else {
      const inv = 1 / dz;
      let t0 = (boxMinZ - oz) * inv;
      let t1 = (boxMaxZ - oz) * inv;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tEnter) {
        tEnter = t0;
        enterAxis = 2;
      }
      if (t1 < tExit) tExit = t1;
    }

    if (tEnter > tExit || tExit < 0) return null;

    const tStart = Math.max(0, tEnter);
    let t = tStart;
    let tPrev = tStart;
    let stepIdx = 0;

    while (true) {
      const lx = ox + t * dx;
      const ly = oy + t * dy;
      const lz = oz + t * dz;
      const hit = sampleSolidAt(lx, ly, lz);
      if (hit) {
        let bestSolid = hit;
        let bestT = t;
        let prevLz = oz + tPrev * dz;
        if (stepIdx > 0) {
          let lo = tPrev;
          let hi = t;
          for (let b = 0; b < 3; b++) {
            const mid = (lo + hi) * 0.5;
            const midHit = sampleSolidAt(
              ox + mid * dx,
              oy + mid * dy,
              oz + mid * dz
            );
            if (midHit) {
              bestSolid = midHit;
              bestT = mid;
              hi = mid;
            } else {
              lo = mid;
            }
          }
          prevLz = oz + lo * dz;
        }
        const hitLz = oz + bestT * dz;
        const isSideWall =
          depthProfile === "slab"
            ? (stepIdx === 0 && enterAxis !== 2) ||
              (stepIdx > 0 && Math.abs(prevLz) <= halfDepth - 1e-3)
            : (stepIdx === 0 && enterAxis !== 2) ||
              Math.abs(hitLz) < halfDepth * 0.85;
        return shadeHit(bestSolid, hitLz, isSideWall, dx, dy, bestT);
      }

      if (t >= tExit) break;
      tPrev = t;
      t = Math.min(tExit, t + stepSize);
      stepIdx++;
    }

    return null;
  };

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let bestHit: HitSample | null = null;
      for (const oy of subOffsets) {
        for (const ox of subOffsets) {
          const hit = traceSubRay(px + ox, py + oy);
          if (hit && (!bestHit || hit.t < bestHit.t)) {
            bestHit = hit;
          }
        }
      }

      if (bestHit) {
        const oIdx = (py * w + px) * 4;
        outData[oIdx] = bestHit.r;
        outData[oIdx + 1] = bestHit.g;
        outData[oIdx + 2] = bestHit.b;
        outData[oIdx + 3] = bestHit.a;
      }
    }
  }

  out.markAllDirty();

  let result = out;
  if (opts.cleanup && hasPixelCleanup(opts.cleanup)) {
    const palette = collectPalette(src);
    if (rawBack) {
      const seen = new Set<number>();
      for (const c of palette) {
        seen.add(packRgba(c[0], c[1], c[2], c[3]));
      }
      for (const c of collectPalette(rawBack)) {
        const packed = packRgba(c[0], c[1], c[2], c[3]);
        if (!seen.has(packed)) {
          seen.add(packed);
          palette.push(c);
        }
      }
    }
    result = applyPixelCleanup(result, opts.cleanup, {
      palette,
      outlineColor: opts.outlineColor,
    });
    if (opts.outlineColor && !opts.cleanup.preserveOutline) {
      result = applyPixelOutline(result, opts.outlineColor);
    }
  } else if (opts.outlineColor) {
    result = applyPixelOutline(result, opts.outlineColor);
  }

  return result;
}

/**
 * Renders a stack of 2D horizontal slice layers (`slices[0]` = bottom,
 * `slices[n-1]` = top) rotated by yaw/roll, tilted by pitch, with optional
 * perspective scaling, slice thickness repeat, reverse ordering, directional
 * lighting, auto-fit bounds, pixel cleanup, and 1px outline.
 */
export function renderSpriteStack(
  slices: readonly PixelBuffer[],
  opts: SpriteStackOptions
): PixelBuffer {
  if (slices.length === 0) {
    return new PixelBuffer(1, 1);
  }

  const w = slices[0].width;
  const h = slices[0].height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  const yaw = degToRad(opts.yawDeg);
  const pitch = degToRad(Math.max(0, Math.min(80, opts.pitchDeg)));
  const roll = degToRad(opts.rollDeg ?? 0);
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const cpitch = Math.cos(pitch);
  const spitch = Math.sin(pitch);
  const croll = Math.cos(roll);
  const sroll = Math.sin(roll);
  const hasRoll = Math.abs(roll) > 1e-7;

  const tiltScale = Math.max(0.15, cpitch);
  const sliceSpacing = Math.max(0.25, Math.min(4, opts.sliceSpacing));
  const sliceThickness = Math.max(0.25, Math.min(4, opts.sliceThickness ?? 1));
  const zLift = spitch * sliceSpacing;
  const midZ = (slices.length - 1) / 2;
  const subSteps = Math.max(1, Math.ceil(sliceSpacing * sliceThickness));

  const persp = Math.max(0, Math.min(1, opts.perspective ?? 0));
  const usePersp = persp > 0.001;
  const maxDim = Math.max(w, h, slices.length * sliceSpacing);
  const camDist = maxDim * (2.6 - 1.5 * persp);

  const reverseOrder = opts.reverseOrder === true;
  const useDirectional = opts.directionalLighting === true;
  const lightAz = degToRad(opts.lightAzimuthDeg ?? -35);
  const lightEl = degToRad(opts.lightElevationDeg ?? 45);
  const cosEl = Math.cos(lightEl);
  const lightX = Math.sin(lightAz) * cosEl;
  const lightY = -Math.sin(lightEl);
  const lightZ = Math.cos(lightAz) * cosEl;
  const ambient = Math.max(0.1, Math.min(1, opts.ambient ?? 0.45));

  // Optional auto-fit bounds: project 3D AABB of all opaque slice pixels
  const useAutoFit = opts.autoFitBounds === true;
  let fitScale = 1;
  let projCenterX = 0;
  let projCenterY = 0;

  if (useAutoFit) {
    let minLx = Infinity;
    let maxLx = -Infinity;
    let minLy = Infinity;
    let maxLy = -Infinity;

    for (let sIdx = 0; sIdx < slices.length; sIdx++) {
      const slice = slices[sIdx];
      const sw = slice.width;
      const sh = slice.height;
      const scx = (sw - 1) / 2;
      const scy = (sh - 1) / 2;
      const sData = slice.data;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (sData[(y * sw + x) * 4 + 3] > 0) {
            const lx = x - scx;
            const ly = y - scy;
            if (lx < minLx) minLx = lx;
            if (lx > maxLx) maxLx = lx;
            if (ly < minLy) minLy = ly;
            if (ly > maxLy) maxLy = ly;
          }
        }
      }
    }

    if (maxLx >= minLx && maxLy >= minLy) {
      const lxs = [minLx - 0.5, maxLx + 0.5];
      const lys = [minLy - 0.5, maxLy + 0.5];
      const zMin = 0;
      const zMax =
        slices.length - 1 + ((subSteps - 1) / subSteps) * sliceThickness;
      const zs = zMax > zMin ? [zMin, zMax] : [zMin];

      let pMinX = Infinity;
      let pMaxX = -Infinity;
      let pMinY = Infinity;
      let pMaxY = -Infinity;

      for (const lx of lxs) {
        for (const ly of lys) {
          const x1 = lx * cyaw - ly * syaw;
          const y1 = lx * syaw + ly * cyaw;
          for (const zPos of zs) {
            const yShift = (zPos - midZ) * zLift;
            const x2 = x1;
            const y2 = y1 * tiltScale - yShift;
            const zDepth = (zPos - midZ) * sliceSpacing;
            const pScale = usePersp
              ? camDist / Math.max(1e-3, camDist - zDepth)
              : 1;
            const x3 = x2 * pScale;
            const y3 = y2 * pScale;
            const x4 = hasRoll ? x3 * croll - y3 * sroll : x3;
            const y4 = hasRoll ? x3 * sroll + y3 * croll : y3;
            if (x4 < pMinX) pMinX = x4;
            if (x4 > pMaxX) pMaxX = x4;
            if (y4 < pMinY) pMinY = y4;
            if (y4 > pMaxY) pMaxY = y4;
          }
        }
      }

      const spanX = pMaxX - pMinX;
      const spanY = pMaxY - pMinY;
      const scaleX = spanX > 1e-4 ? w / spanX : 1;
      const scaleY = spanY > 1e-4 ? h / spanY : 1;
      fitScale = Math.min(1, scaleX, scaleY);
      projCenterX = (pMinX + pMaxX) / 2;
      projCenterY = (pMinY + pMaxY) / 2;
    }
  }

  // Precompute top-face directional lighting factor: local normal (0, 0, 1)
  // After pitch tilt: (0, -sin(pitch), cos(pitch)); after screen roll:
  const topWnx = hasRoll ? spitch * sroll : 0;
  const topWny = hasRoll ? -spitch * croll : -spitch;
  const topWnz = cpitch;
  const topDiffuse = Math.max(
    0,
    topWnx * lightX + topWny * lightY + topWnz * lightZ
  );
  const topLitShade = ambient + (1 - ambient) * topDiffuse;

  const outData = out.data;
  const maxSliceIdx = Math.max(1, slices.length - 1);

  for (let sIdx = 0; sIdx < slices.length; sIdx++) {
    const srcSliceIdx = reverseOrder ? slices.length - 1 - sIdx : sIdx;
    const slice = slices[srcSliceIdx];
    const sw = slice.width;
    const sh = slice.height;
    const scx = (sw - 1) / 2;
    const scy = (sh - 1) / 2;
    const srcData = slice.data;

    const baseShade = opts.depthShading
      ? 0.72 + 0.28 * (sIdx / maxSliceIdx)
      : 1;

    for (let sub = 0; sub < subSteps; sub++) {
      const zPos = sIdx + (sub / subSteps) * sliceThickness;
      const yShift = (zPos - midZ) * zLift;
      const zDepth = (zPos - midZ) * sliceSpacing;
      const perspScale = usePersp
        ? camDist / Math.max(1e-3, camDist - zDepth)
        : 1;
      const invPerspScale = 1 / perspScale;
      const isTopMost = sIdx === slices.length - 1 && sub === subSteps - 1;

      for (let py = 0; py < h; py++) {
        const ry0 = useAutoFit ? (py - cy) / fitScale + projCenterY : py - cy;
        for (let px = 0; px < w; px++) {
          const rx0 = useAutoFit ? (px - cx) / fitScale + projCenterX : px - cx;

          const x3 = hasRoll ? rx0 * croll + ry0 * sroll : rx0;
          const y3 = hasRoll ? -rx0 * sroll + ry0 * croll : ry0;

          const sx = x3 * invPerspScale;
          const sy = (y3 * invPerspScale + yShift) / tiltScale;

          // Inverse rotate by -yaw
          const u = Math.round(sx * cyaw + sy * syaw + scx);
          const v = Math.round(-sx * syaw + sy * cyaw + scy);
          if (u < 0 || v < 0 || u >= sw || v >= sh) continue;

          const pIdx = (v * sw + u) * 4;
          const alpha = srcData[pIdx + 3];
          if (alpha === 0) continue;

          let shade = baseShade;
          if (useDirectional) {
            if (isTopMost) {
              shade *= topLitShade;
            } else {
              // Extruded side silhouette normal in local slice space
              const aL = u > 0 && srcData[(v * sw + (u - 1)) * 4 + 3] > 0 ? 1 : 0;
              const aR =
                u + 1 < sw && srcData[(v * sw + (u + 1)) * 4 + 3] > 0 ? 1 : 0;
              const aU =
                v > 0 && srcData[((v - 1) * sw + u) * 4 + 3] > 0 ? 1 : 0;
              const aD =
                v + 1 < sh && srcData[((v + 1) * sw + u) * 4 + 3] > 0 ? 1 : 0;
              const nlx = -(aR - aL);
              const nly = -(aD - aU);

              if (nlx === 0 && nly === 0) {
                shade *= topLitShade;
              } else {
                const nLen = Math.hypot(nlx, nly);
                const ux = nlx / nLen;
                const uy = nly / nLen;
                // Forward rotate normal: yaw -> pitch -> roll
                const nx1 = ux * cyaw - uy * syaw;
                const ny1 = ux * syaw + uy * cyaw;
                const ny2 = ny1 * cpitch;
                const nz2 = ny1 * spitch;
                const wnx = hasRoll ? nx1 * croll - ny2 * sroll : nx1;
                const wny = hasRoll ? nx1 * sroll + ny2 * croll : ny2;
                const wnz = nz2;
                const diffuse = Math.max(
                  0,
                  wnx * lightX + wny * lightY + wnz * lightZ
                );
                shade *= ambient + (1 - ambient) * diffuse;
              }
            }
          }

          const oIdx = (py * w + px) * 4;
          outData[oIdx] = clampByte(srcData[pIdx] * shade);
          outData[oIdx + 1] = clampByte(srcData[pIdx + 1] * shade);
          outData[oIdx + 2] = clampByte(srcData[pIdx + 2] * shade);
          outData[oIdx + 3] = alpha;
        }
      }
    }
  }

  out.markAllDirty();

  let result = out;
  if (opts.cleanup && hasPixelCleanup(opts.cleanup)) {
    const palette: RGBA[] = [];
    const seen = new Set<number>();
    for (const slice of slices) {
      for (const c of collectPalette(slice)) {
        const packed = packRgba(c[0], c[1], c[2], c[3]);
        if (!seen.has(packed)) {
          seen.add(packed);
          palette.push(c);
        }
      }
    }
    result = applyPixelCleanup(result, opts.cleanup, {
      palette,
      outlineColor: opts.outlineColor,
    });
    if (opts.outlineColor && !opts.cleanup.preserveOutline) {
      result = applyPixelOutline(result, opts.outlineColor);
    }
  } else if (opts.outlineColor) {
    result = applyPixelOutline(result, opts.outlineColor);
  }

  return result;
}

function applyTurntableEasing(u: number, easing: TurntableEasing): number {
  const t = Math.max(0, Math.min(1, u));
  switch (easing) {
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "linear":
    default:
      return t;
  }
}

/**
 * Computes the angle offset (in degrees) for frame `frameIndex` of an N-frame
 * turntable sequence, supporting custom start/sweep angles, ping-pong sway,
 * and easing curves.
 */
export function computeTurntableAngleOffset(
  frameIndex: number,
  frameCount: number,
  opts: TurntableAngleOptions = {}
): number {
  const startDeg = opts.startDeg ?? 0;
  const sweepDeg = opts.sweepDeg ?? 360;
  const pingPong = opts.pingPong === true;
  const easing: TurntableEasing = opts.easing ?? "linear";

  const count = Math.max(1, Math.round(frameCount));
  const idx = Math.max(0, Math.min(count - 1, frameIndex));

  let u: number;
  if (pingPong) {
    const phase = idx / count;
    u = phase <= 0.5 ? phase * 2 : (1 - phase) * 2;
  } else {
    const isFullLoop = sweepDeg !== 0 && Math.abs(sweepDeg) % 360 === 0;
    if (isFullLoop) {
      u = idx / count;
    } else {
      u = count > 1 ? idx / (count - 1) : 0;
    }
  }

  const eased = applyTurntableEasing(u, easing);
  return startDeg + eased * sweepDeg;
}

/**
 * Generates an N-frame turntable sequence for either 2.5D Extruded
 * or Sprite Stacking mode, supporting custom start/sweep angles, ping-pong
 * sway, easing, and animated source/back frame sequences.
 */
export function bakeTurntableFrames(
  options: BakeTurntableOptions
): PixelBuffer[] {
  const count = Math.max(2, Math.min(32, Math.round(options.frameCount)));
  const frames: PixelBuffer[] = [];
  const sourceFrames =
    options.sourceFrames && options.sourceFrames.length > 0
      ? options.sourceFrames
      : null;
  const backFrames =
    options.backFrames && options.backFrames.length > 0
      ? options.backFrames
      : null;

  for (let i = 0; i < count; i++) {
    const angleOffset = computeTurntableAngleOffset(i, count, options);
    if (options.mode === "stack") {
      const slices = options.slices ?? [];
      frames.push(
        renderSpriteStack(slices, {
          ...options.optsStack,
          yawDeg:
            options.spinAxis === "yaw"
              ? options.optsStack.yawDeg + angleOffset
              : options.optsStack.yawDeg,
          pitchDeg:
            options.spinAxis === "pitch"
              ? options.optsStack.pitchDeg + angleOffset
              : options.optsStack.pitchDeg,
          rollDeg:
            options.spinAxis === "roll"
              ? (options.optsStack.rollDeg ?? 0) + angleOffset
              : options.optsStack.rollDeg,
        })
      );
    } else {
      const src = sourceFrames
        ? sourceFrames[i % sourceFrames.length]
        : (options.source ?? new PixelBuffer(1, 1));
      const backSource = backFrames
        ? backFrames[i % backFrames.length]
        : options.opts25d.backSource;
      const nextOpts: Rotate25DOptions = {
        ...options.opts25d,
        backSource,
        yawDeg:
          options.spinAxis === "yaw"
            ? options.opts25d.yawDeg + angleOffset
            : options.opts25d.yawDeg,
        pitchDeg:
          options.spinAxis === "pitch"
            ? options.opts25d.pitchDeg + angleOffset
            : options.opts25d.pitchDeg,
        rollDeg:
          options.spinAxis === "roll"
            ? options.opts25d.rollDeg + angleOffset
            : options.opts25d.rollDeg,
      };
      frames.push(render25DSprite(src, nextOpts));
    }
  }

  return frames;
}
