import { PixelBuffer, hexToRgba } from "../document/PixelBuffer.ts";

export type LayerMapRole = "albedo" | "normal" | "emission";

export interface Light2DOptions {
  enabled: boolean;
  lightX: number; // 0..1 normalized canvas X
  lightY: number; // 0..1 normalized canvas Y
  lightZ: number; // 0.05..2.0 height
  lightColor: string; // #rrggbb
  intensity: number; // 0..3
  ambient: number; // 0..1
  emissionStrength: number; // 0..2.5
}

export const DEFAULT_LIGHT_2D: Light2DOptions = {
  enabled: false,
  lightX: 0.35,
  lightY: 0.25,
  lightZ: 0.35,
  lightColor: "#fff4d6",
  intensity: 1.4,
  ambient: 0.28,
  emissionStrength: 1.2,
};

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/**
 * Applies live 2D point-light shading using optional tangent-space normal
 * (+X right, +Y up, +Z out) and unlit emission layers.
 */
export function apply2DLighting(
  albedo: Uint8ClampedArray,
  normal: Uint8ClampedArray | null,
  emission: Uint8ClampedArray | null,
  width: number,
  height: number,
  opts: Light2DOptions
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(albedo.length);
  if (!opts.enabled) {
    out.set(albedo);
    return out;
  }

  const [lr, lg, lb] = hexToRgba(opts.lightColor);
  const lightR = lr / 255;
  const lightG = lg / 255;
  const lightB = lb / 255;
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);

  for (let y = 0; y < height; y++) {
    const py = (y + 0.5) / safeH;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = albedo[idx + 3];
      const ea = emission ? emission[idx + 3] : 0;

      if (alpha === 0 && ea === 0) continue;

      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (normal && normal[idx + 3] > 0) {
        const rx = (normal[idx] / 255) * 2 - 1;
        const ry = (normal[idx + 1] / 255) * 2 - 1;
        const rz = (normal[idx + 2] / 255) * 2 - 1;
        const nLen = Math.hypot(rx, ry, rz);
        if (nLen > 1e-4) {
          nx = rx / nLen;
          ny = ry / nLen;
          nz = rz / nLen;
        }
      }

      const px = (x + 0.5) / safeW;
      const dx = opts.lightX - px;
      // OpenGL/Godot normal map +Y points up (-Y in canvas coords)
      const dyUp = py - opts.lightY;
      const dz = Math.max(0.05, opts.lightZ);
      const distSq = dx * dx + dyUp * dyUp + dz * dz;
      const invLen = 1 / Math.sqrt(distSq);
      const lx = dx * invLen;
      const ly = dyUp * invLen;
      const lz = dz * invLen;

      const ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
      const atten = 1 / (1 + (dx * dx + dyUp * dyUp) * 1.5);
      const direct = ndotl * opts.intensity * atten;

      const emFactor = ea > 0 ? (ea / 255) * opts.emissionStrength : 0;
      const er = emission ? emission[idx] * emFactor : 0;
      const eg = emission ? emission[idx + 1] * emFactor : 0;
      const eb = emission ? emission[idx + 2] * emFactor : 0;

      out[idx] = clampByte(albedo[idx] * (opts.ambient + lightR * direct) + er);
      out[idx + 1] = clampByte(
        albedo[idx + 1] * (opts.ambient + lightG * direct) + eg
      );
      out[idx + 2] = clampByte(
        albedo[idx + 2] * (opts.ambient + lightB * direct) + eb
      );
      out[idx + 3] = alpha > 0 ? alpha : ea;
    }
  }

  return out;
}

/**
 * Generates an OpenGL/Godot tangent-space normal map (+X right, +Y up, +Z out)
 * from an albedo buffer's Sobel height/luminance gradient.
 */
export function generateAutoNormalMap(
  albedo: PixelBuffer,
  strength = 2.0
): PixelBuffer {
  const w = albedo.width;
  const h = albedo.height;
  const src = albedo.data;
  const out = new PixelBuffer(w, h);

  const sampleHeight = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const idx = (y * w + x) * 4;
    const a = src[idx + 3];
    if (a === 0) return 0;
    const lum =
      (0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]) / 255;
    return (0.35 + 0.65 * lum) * (a / 255);
  };

  const zBase = 1 / Math.max(0.1, strength);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (src[idx + 3] === 0) continue;

      const tl = sampleHeight(x - 1, y - 1);
      const t = sampleHeight(x, y - 1);
      const tr = sampleHeight(x + 1, y - 1);
      const l = sampleHeight(x - 1, y);
      const r = sampleHeight(x + 1, y);
      const bl = sampleHeight(x - 1, y + 1);
      const b = sampleHeight(x, y + 1);
      const br = sampleHeight(x + 1, y + 1);

      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);

      const nx = -gx;
      const nyUp = gy;
      const nz = zBase;
      const invLen = 1 / Math.hypot(nx, nyUp, nz);

      out.setPixel(
        x,
        y,
        clampByte((nx * invLen * 0.5 + 0.5) * 255),
        clampByte((nyUp * invLen * 0.5 + 0.5) * 255),
        clampByte((nz * invLen * 0.5 + 0.5) * 255),
        255
      );
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Remaps opaque pixel colors present in `sourcePalette` to the corresponding
 * index in `targetPalette`, preserving per-pixel alpha.
 */
export function applyPaletteSwapLut(
  rgba: Uint8ClampedArray,
  sourcePalette: readonly string[],
  targetPalette: readonly string[]
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  if (sourcePalette.length === 0 || targetPalette.length === 0) {
    return out;
  }

  const lut = new Map<number, [number, number, number]>();
  for (let i = 0; i < sourcePalette.length; i++) {
    const [sr, sg, sb] = hexToRgba(sourcePalette[i]);
    const [tr, tg, tb] = hexToRgba(targetPalette[i % targetPalette.length]);
    const packed = (sr << 16) | (sg << 8) | sb;
    lut.set(packed, [tr, tg, tb]);
  }

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    const mapped = lut.get(key);
    if (mapped) {
      out[i] = mapped[0];
      out[i + 1] = mapped[1];
      out[i + 2] = mapped[2];
    }
  }

  return out;
}
