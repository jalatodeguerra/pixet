import { PixelBuffer } from "../document/PixelBuffer.ts";

export type NormalConvention = "opengl" | "directx";
export type HeightMapSource = "hybrid" | "luminance" | "bevel" | "pillow";
export type DepthMapMode = "volume" | "topDown" | "isometric" | "radial";

export interface HeightMapOptions {
  source: HeightMapSource;
  bevelWeight: number;
  contrast: number;
  gamma: number;
  blurRadius: number;
  invert: boolean;
  normalize: boolean;
}

export interface NormalMapOptions {
  strength: number;
  kernel: "sobel" | "scharr";
  convention: NormalConvention;
  invertX: boolean;
  invertY: boolean;
  bevelStrength: number;
  blurRadius: number;
  heightMap?: PixelBuffer | null;
}

export interface DepthMapOptions {
  mode: DepthMapMode;
  relief: number;
  near: number;
  far: number;
  gamma: number;
  invert: boolean;
  heightMap?: PixelBuffer | null;
}

const DEFAULT_HEIGHT_OPTS: HeightMapOptions = {
  source: "hybrid",
  bevelWeight: 0.55,
  contrast: 1.0,
  gamma: 1.0,
  blurRadius: 0,
  invert: false,
  normalize: true,
};

const DEFAULT_NORMAL_OPTS: NormalMapOptions = {
  strength: 2.5,
  kernel: "sobel",
  convention: "opengl",
  invertX: false,
  invertY: false,
  bevelStrength: 0.45,
  blurRadius: 0,
};

const DEFAULT_DEPTH_OPTS: DepthMapOptions = {
  mode: "volume",
  relief: 0.35,
  near: 0,
  far: 1,
  gamma: 1.0,
  invert: false,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * 2-pass Chamfer distance-to-transparent transform.
 * Returns normalized distance [0, 1] for opaque pixels (0 on transparent).
 */
function computeChamferField(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  mode: "bevel" | "pillow"
): Float32Array {
  const size = w * h;
  const INF = 1e6;
  const dist = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    dist[i] = data[i * 4 + 3] > 0 ? INF : 0;
  }

  const DIAG = Math.SQRT2;
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

  const out = new Float32Array(size);
  if (maxDist <= 0) return out;

  if (mode === "bevel") {
    for (let i = 0; i < size; i++) {
      const d = dist[i];
      if (d === 0) continue;
      out[i] = maxDist <= 1 ? 1 : clamp01((d - 0.5) / Math.max(1, maxDist - 0.5));
    }
  } else {
    for (let i = 0; i < size; i++) {
      const d = dist[i];
      if (d === 0) continue;
      if (maxDist <= 1) {
        out[i] = 1;
      } else {
        const t = clamp01((d - 0.5) / Math.max(1, maxDist - 0.5));
        const inv = 1 - t;
        out[i] = Math.sqrt(Math.max(0, 1 - inv * inv));
      }
    }
  }
  return out;
}

/**
 * Separable opaque-only box blur so transparent pixels do not bleed dark fringes.
 */
function blurOpaqueField(
  field: Float32Array,
  alphaSrc: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const r = Math.max(0, Math.min(4, Math.round(radius)));
  if (r === 0) return field;

  const temp = new Float32Array(field.length);
  const out = new Float32Array(field.length);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (alphaSrc[idx * 4 + 3] === 0) continue;
      let sum = 0;
      let count = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let kx = x0; kx <= x1; kx++) {
        const kIdx = row + kx;
        if (alphaSrc[kIdx * 4 + 3] > 0) {
          sum += field[kIdx];
          count++;
        }
      }
      temp[idx] = count > 0 ? sum / count : field[idx];
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (alphaSrc[idx * 4 + 3] === 0) continue;
      let sum = 0;
      let count = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let ky = y0; ky <= y1; ky++) {
        const kIdx = ky * w + x;
        if (alphaSrc[kIdx * 4 + 3] > 0) {
          sum += temp[kIdx];
          count++;
        }
      }
      out[idx] = count > 0 ? sum / count : temp[idx];
    }
  }

  return out;
}

/**
 * Computes a normalized per-pixel height field in [0, 1] from an albedo buffer.
 * Transparent pixels remain 0.
 */
export function computeHeightField(
  albedo: PixelBuffer,
  opts?: Partial<HeightMapOptions>
): Float32Array {
  const cfg: HeightMapOptions = { ...DEFAULT_HEIGHT_OPTS, ...opts };
  const w = albedo.width;
  const h = albedo.height;
  const size = w * h;
  const src = albedo.data;
  let field: Float32Array = new Float32Array(size);
  if (w === 0 || h === 0) return field;

  const chamfer =
    cfg.source === "bevel"
      ? computeChamferField(src, w, h, "bevel")
      : cfg.source === "pillow" || cfg.source === "hybrid"
        ? computeChamferField(src, w, h, "pillow")
        : null;

  const weight = clamp01(cfg.bevelWeight);

  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    const a = src[idx + 3];
    if (a === 0) continue;

    const luma =
      (0.2126 * src[idx] + 0.7152 * src[idx + 1] + 0.0722 * src[idx + 2]) / 255;

    if (cfg.source === "luminance") {
      field[i] = luma;
    } else if (cfg.source === "bevel" || cfg.source === "pillow") {
      field[i] = chamfer ? chamfer[i] : luma;
    } else {
      const shape = chamfer ? chamfer[i] : 1;
      field[i] = shape * weight + luma * (1 - weight);
    }
  }

  if (cfg.blurRadius > 0) {
    field = blurOpaqueField(field, src, w, h, cfg.blurRadius);
  }

  const contrast = Math.max(0.2, Math.min(3.0, cfg.contrast));
  const gamma = Math.max(0.3, Math.min(3.0, cfg.gamma));

  let minV = Infinity;
  let maxV = -Infinity;

  for (let i = 0; i < size; i++) {
    if (src[i * 4 + 3] === 0) continue;
    let v = (field[i] - 0.5) * contrast + 0.5;
    v = clamp01(v);
    if (gamma !== 1.0) {
      v = Math.pow(v, gamma);
    }
    field[i] = v;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  if (cfg.normalize && maxV - minV > 1e-4) {
    const span = maxV - minV;
    for (let i = 0; i < size; i++) {
      if (src[i * 4 + 3] === 0) continue;
      field[i] = clamp01((field[i] - minV) / span);
    }
  }

  if (cfg.invert) {
    for (let i = 0; i < size; i++) {
      if (src[i * 4 + 3] === 0) continue;
      field[i] = 1 - field[i];
    }
  }

  return field;
}

/**
 * Generates a grayscale displacement/height map PixelBuffer from an albedo buffer.
 */
export function generateHeightMap(
  albedo: PixelBuffer,
  opts?: Partial<HeightMapOptions>
): PixelBuffer {
  const w = albedo.width;
  const h = albedo.height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const field = computeHeightField(albedo, opts);
  const src = albedo.data;
  const dst = out.data;

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    if (src[idx + 3] === 0) continue;
    const v = clampByte(field[i] * 255);
    dst[idx] = v;
    dst[idx + 1] = v;
    dst[idx + 2] = v;
    dst[idx + 3] = 255;
  }

  out.markAllDirty();
  return out;
}

/**
 * Generates a tangent-space normal map PixelBuffer (OpenGL +Y up or DirectX -Y down)
 * using Sobel or Scharr gradients over an optional heightMap or derived albedo height field.
 */
export function generateNormalMap(
  albedo: PixelBuffer,
  opts?: Partial<NormalMapOptions>
): PixelBuffer {
  const cfg: NormalMapOptions = { ...DEFAULT_NORMAL_OPTS, ...opts };
  const w = albedo.width;
  const h = albedo.height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const src = albedo.data;
  let field: Float32Array;

  if (cfg.heightMap && cfg.heightMap.width === w && cfg.heightMap.height === h) {
    field = new Float32Array(w * h);
    const hm = cfg.heightMap.data;
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const a = hm[idx + 3];
      if (a === 0 || src[idx + 3] === 0) continue;
      const lum =
        (0.2126 * hm[idx] + 0.7152 * hm[idx + 1] + 0.0722 * hm[idx + 2]) / 255;
      field[i] = lum * (a / 255);
    }
    if (cfg.blurRadius > 0) {
      field = blurOpaqueField(field, src, w, h, cfg.blurRadius);
    }
  } else {
    const bevelWeight = clamp01(cfg.bevelStrength);
    field = computeHeightField(albedo, {
      source: bevelWeight > 0 ? "hybrid" : "luminance",
      bevelWeight,
      blurRadius: cfg.blurRadius,
      normalize: false,
    });
  }

  const sampleH = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const idx = y * w + x;
    if (src[idx * 4 + 3] === 0) return 0;
    return field[idx];
  };

  const nz = 1 / Math.max(0.1, cfg.strength);
  const ySign = cfg.convention === "directx" ? -1 : 1;
  const xFlip = cfg.invertX ? -1 : 1;
  const yFlip = cfg.invertY ? -1 : 1;
  const dst = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (src[idx + 3] === 0) continue;

      const tl = sampleH(x - 1, y - 1);
      const t = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const l = sampleH(x - 1, y);
      const r = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const b = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      let gx: number;
      let gy: number;
      if (cfg.kernel === "scharr") {
        gx = (3 * tr + 10 * r + 3 * br - (3 * tl + 10 * l + 3 * bl)) * 0.25;
        gy = (3 * bl + 10 * b + 3 * br - (3 * tl + 10 * t + 3 * tr)) * 0.25;
      } else {
        gx = tr + 2 * r + br - (tl + 2 * l + bl);
        gy = bl + 2 * b + br - (tl + 2 * t + tr);
      }

      // OpenGL tangent space: +X right, +Y up, +Z out
      const nx = -gx * xFlip;
      const ny = gy * ySign * yFlip;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      dst[idx] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Generates a grayscale depth map PixelBuffer (white = near, black = far by default).
 */
export function generateDepthMap(
  albedo: PixelBuffer,
  opts?: Partial<DepthMapOptions>
): PixelBuffer {
  const cfg: DepthMapOptions = { ...DEFAULT_DEPTH_OPTS, ...opts };
  const w = albedo.width;
  const h = albedo.height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const src = albedo.data;
  const dst = out.data;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return out;

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const halfX = Math.max(0.5, spanX * 0.5);
  const halfY = Math.max(0.5, spanY * 0.5);

  const pillow =
    cfg.mode === "volume" ? computeChamferField(src, w, h, "pillow") : null;

  let reliefField: Float32Array | null = null;
  if (cfg.relief > 0) {
    if (cfg.heightMap && cfg.heightMap.width === w && cfg.heightMap.height === h) {
      reliefField = new Float32Array(w * h);
      const hm = cfg.heightMap.data;
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const a = hm[idx + 3];
        if (a === 0) continue;
        const lum =
          (0.2126 * hm[idx] + 0.7152 * hm[idx + 1] + 0.0722 * hm[idx + 2]) / 255;
        reliefField[i] = lum * (a / 255);
      }
    } else {
      reliefField = computeHeightField(albedo, {
        source: "luminance",
        normalize: true,
      });
    }
  }

  const relief = clamp01(cfg.relief);
  const near = clamp01(cfg.near);
  const far = clamp01(cfg.far);
  const gamma = Math.max(0.3, Math.min(3.0, cfg.gamma));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const idx = i * 4;
      if (src[idx + 3] === 0) continue;

      let baseDepth: number;
      if (cfg.mode === "topDown") {
        baseDepth = (y - minY) / spanY;
      } else if (cfg.mode === "isometric") {
        baseDepth = ((x - minX) / spanX + (y - minY) / spanY) * 0.5;
      } else if (cfg.mode === "radial") {
        const dx = (x - centerX) / halfX;
        const dy = (y - centerY) / halfY;
        const r2 = Math.min(1, dx * dx + dy * dy);
        baseDepth = Math.sqrt(Math.max(0, 1 - r2));
      } else {
        baseDepth = 0.25 + 0.75 * (pillow ? pillow[i] : 0.5);
      }

      let d = reliefField
        ? baseDepth * (1 - relief) + reliefField[i] * relief
        : baseDepth;

      d = clamp01(near + (far - near) * d);
      if (gamma !== 1.0) {
        d = Math.pow(d, gamma);
      }
      if (cfg.invert) {
        d = 1 - d;
      }

      const byte = clampByte(d * 255);
      dst[idx] = byte;
      dst[idx + 1] = byte;
      dst[idx + 2] = byte;
      dst[idx + 3] = 255;
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Triggers a browser PNG download of a PixelBuffer (safe no-op in headless Node tests).
 */
export function downloadPixelBufferAsPng(
  buf: PixelBuffer,
  filename: string
): void {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height),
    0,
    0
  );
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}
